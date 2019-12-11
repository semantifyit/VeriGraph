const vocHand = require("./vocabularyHandler");
const sdoAdapter = require("./sdoAdapter");

let mySdoAdapter;

/**
 * sets mySdoAdapter with vocabularies needed for the given vocabulary array
 * @param {array} vocabularyArray - the vocabularies needed (array of strings), sdo must be given with a version number
 * @returns {Boolean} - returns true when done
 */
async function setSdoAdapter(vocabularyArray) {
    let vocabArray = vocHand.getVocabURLForIRIs(vocabularyArray);
    let correspondingSdoAdapter = vocHand.getSDOAdapter(vocabArray);
    if (correspondingSdoAdapter === null) {
        let newSDOAdapter = new sdoAdapter();
        vocHand.createAdapterMemoryItem(vocabArray, newSDOAdapter);
        mySdoAdapter = newSDOAdapter;
        await newSDOAdapter.addVocabularies(vocabArray, null);
        vocHand.registerVocabReady(vocabArray);
        return true;
    } else {
        if (correspondingSdoAdapter.initialized === false) {
            setTimeout(async function () {
                await setSdoAdapter(vocabularyArray);
                return true;
            }, 500);
        } else {
            //use the already created adapter for this vocabulary-combination
            mySdoAdapter = correspondingSdoAdapter.sdoAdapter;
            return true;
        }
    }
}

//covers RetailMode and !RetailMode
function genQuery_EntityGraphBulk(entityArray, namedGraph, verificationSettings) {
    let query = "PREFIX schema: <http://schema.org/> ";
    query = query.concat("select ?subj ?pred ?obj ?origin ");
    if (namedGraph !== null) {
        query = query.concat("from <" + namedGraph + "> ");
    }
    let valueString = genEntityValues(entityArray, verificationSettings.retailMode);
    if (verificationSettings.retailMode) {
        query = query.concat("where { VALUES ?ids { " + valueString + " } ");
        query = query.concat("?origin <http://www.ontotext.com/owlim/entity#id> ?ids . ");
    } else {
        query = query.concat("where { VALUES ?origin { " + valueString + " } ");
    }
    query = query.concat("?origin (schema:|!schema:)* ?subj . " +
        "?subj ?pred ?obj . " +
        "}");
    return trimWhiteSpaces(query);
}

function genEntityValues(idArray, retailMode) {
    let result = "";
    let openingChar = "";
    let closingChar = " ";
    if (retailMode === false) {
        openingChar = "<";
        closingChar = "> ";
    }
    for (let i = 0; i < idArray.length; i++) {
        result = result.concat(openingChar + idArray[i] + closingChar);
    }
    return result;
}

/**
 *
 * @param {Array} targetClasses - the Classes (Array of absolute URIs) which the target entity must have
 * @param {Boolean} exactMatch - if true, then the target classes must match exactly (subclasses of them are not allowed)
 */
async function genValues(targetClasses, exactMatch) {
    let targetVocabularies = ["https://schema.org/version/5.0/"];
    if (!exactMatch) {
        for (let i = 0; i < targetClasses.length; i++) {
            if (targetClasses[i].indexOf("schema.org") === -1) {
                //not sdo -> add to array
                let additionalVocab = targetClasses[i].substring(0, targetClasses[i].lastIndexOf("/") + 1);
                if (!targetVocabularies.includes(additionalVocab)) {
                    targetVocabularies.push(additionalVocab);
                }
            }
        }
        await setSdoAdapter(targetVocabularies);
    }
    let queryPart = "";
    //VALUES
    for (let i = 0; i < targetClasses.length; i++) {
        let target = targetClasses[i];
        if (!exactMatch) {
            target = [target];
            try {
                let subclasses = mySdoAdapter.getClass(target[0]).getSubClasses(true, {
                    "termType": "Class",
                    "isSuperseded": false
                });
                let usedVocabs = mySdoAdapter.getVocabularies();
                let vocabKeys = Object.keys(usedVocabs);
                for (let k = 0; k < subclasses.length; k++) {
                    if (subclasses[k].indexOf(":") !== -1) {
                        let usedVocabIndicator = subclasses[k].substring(0, subclasses[k].indexOf(":"));
                        if (vocabKeys.includes(usedVocabIndicator)) {
                            subclasses[k] = usedVocabs[usedVocabIndicator] + subclasses[k].substring(subclasses[k].indexOf(":") + 1);
                        }
                    }
                }
                target.push(...subclasses);
            } catch (e) {
                console.log("Error during getting sub classes of " + target[0])
            }
        } else {
            target = [target];
        }
        queryPart = queryPart.concat("VALUES ?target" + (i + 1) + " {");
        for (let j = 0; j < target.length; j++) {
            queryPart = queryPart.concat(" <" + target[j] + ">");
        }
        queryPart = queryPart.concat(" } ");
    }
    //target match
    for (let i = 0; i < targetClasses.length; i++) {
        queryPart = queryPart.concat("?origin a ?target" + (i + 1) + " . ");
    }
    //filter not same target
    for (let i = 0; i < targetClasses.length; i++) {
        for (let j = 0; j < targetClasses.length; j++) {
            if (j > i) {
                queryPart = queryPart.concat("FILTER (?target" + (i + 1) + " != ?target" + (j + 1) + ") . ");
            }
        }
    }
    return queryPart;
}

function trimWhiteSpaces(str) {
    return str.replace(/\s+/g, ' ').trim();
}

//covers get list of !RetailMode: URIs (wihtout blank nodes) and RetailMode: GraphIDs (with blank nodes)
//covers targetType "Class" and "Property"
//covers onlyRootEntities and !onlyRootEntities
async function genQuery_EntityList(namedGraph, dsTargetObject, verificationSettings) {
    let entityIdentifier = "?origin ";
    if (verificationSettings.retailMode) {
        entityIdentifier = "?originID ";
    }
    let query = "select " + entityIdentifier;
    if (namedGraph !== null) {
        query = query.concat("from <" + namedGraph + "> ");
    }
    query = query.concat("where { ");
    if (dsTargetObject.targetType === "Class") {
        query = query.concat("{ select ?origin where { ");
        query = query.concat(await genValues(dsTargetObject.target, verificationSettings.exactMatch));
        if (verificationSettings.onlyRootEntities) {
            query = query.concat(" FILTER (!EXISTS { ?b ?a ?origin}) ");
        }
        query = query.concat(" }} ");
    } else {
        query = query.concat("?origin <" + dsTargetObject.target + "> ?o . ");
        if (verificationSettings.onlyRootEntities) {
            query = query.concat("FILTER (!EXISTS { ?b ?a ?origin}) ");
        }
    }
    if (verificationSettings.retailMode) {
        query = query.concat("?origin <http://www.ontotext.com/owlim/entity#id> ?originID . ");
    } else {
        query = query.concat("FILTER (!isBlank(?origin)) ");
    }
    query = query.concat("}");
    return trimWhiteSpaces(query);
}


//this is for entities that are blank nodes in the !RetailMode version
async function genQuery_EntityListWithData(namedGraph, dsTargetObject, verificationSettings) {
    let query = "PREFIX schema: <http://schema.org/> select ?subj ?pred ?obj ?origin ";
    if (namedGraph !== null) {
        query = query.concat("from <" + namedGraph + "> ");
    }
    query = query.concat("where { ");
    if (dsTargetObject.targetType === "Class") {
        query = query.concat("{ select ?origin where { ");
        query = query.concat(await genValues(dsTargetObject.target, verificationSettings.exactMatch));

        if (verificationSettings.onlyRootEntities) {
            query = query.concat(" FILTER (!EXISTS { ?b ?a ?origin}) ");
        }
        query = query.concat(" }} ");
    } else {
        query = query.concat("?origin <" + dsTargetObject.target + "> ?o . ");
        if (verificationSettings.onlyRootEntities) {
            query = query.concat("FILTER (!EXISTS { ?b ?a ?origin}) ");
        }
    }
    query = query.concat(" FILTER (isBlank(?origin)) ");
    query = query.concat(" ?origin (schema:|!schema:)* ?subj . ");
    query = query.concat(" ?subj ?pred ?obj . ");
    query = query.concat("}");
    return trimWhiteSpaces(query);
}

module.exports = {
    genQuery_EntityList,
    genQuery_EntityGraphBulk,
    genQuery_EntityListWithData
};