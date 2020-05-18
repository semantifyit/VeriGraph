const vocHand = require("./vocabularyHandler");

//retrieves data-graphs (all entities and literals connected to a specific entity) for an array of entities by their URIs (non-retail-mode) or by their GraphDB-IDs (retail-mode)
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

//retrieves data-graphs (all entities and literals connected to a specific entity) for an array of entities by their URIs GraphDB-IDs -> only retail-mode is supported by this query, since there wont be blank nodes or uris used, but their internal IDs
function genQuery_EntityGraphBulk_withIds(entityArray, namedGraph, verificationSettings) {
    let query = "PREFIX schema: <http://schema.org/> ";
    query = query.concat("select ?subj ?pred ?obj ?origin ");
    if (namedGraph !== null) {
        query = query.concat("from <" + namedGraph + "> ");
    }
    let valueString = genEntityValues(entityArray, verificationSettings.retailMode);

    query = query.concat("where { VALUES ?ids { " + valueString + " } ");
    query = query.concat("?ori <http://www.ontotext.com/owlim/entity#id> ?ids . ");
    query = query.concat("?ori <http://www.ontotext.com/owlim/entity#id> ?origin . ");
    query = query.concat("?ori (schema:|!schema:)* ?s . " +
        "?s ?pred ?o . ");
    query = query.concat("?s <http://www.ontotext.com/owlim/entity#id> ?subj . ");
    //render entities by their IDs, but filter those URIs which are supposed to be rendered as values
    query = query.concat("OPTIONAL { FILTER (!isLiteral(?o) && NOT EXISTS{?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?o}) " +
        "?o <http://www.ontotext.com/owlim/entity#id> ?objId . " +
        "BIND(CONCAT('GID:',STR(?objId)) AS ?obj)} ");
    query = query.concat("OPTIONAL { FILTER (!isLiteral(?o) && EXISTS{?s <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?o}) " +
        "BIND(?o AS ?obj)} ");
    //render literals by their value
    query = query.concat("OPTIONAL { FILTER (isLiteral(?o)) " +
        "BIND(?o AS ?obj)} ");
    query = query.concat(" } ");
    return trimWhiteSpaces(query);
}

//generates the SPARQL-Code for the entity values (URIs or GraphDB-IDs)
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
 * generates the class URIs for the SPARQL-Query
 * @param {Array} targetClasses - the Classes (Array of absolute URIs) which the target entity must have
 * @param {Boolean} exactMatch - if true, then the target classes must match exactly (subclasses of them are not allowed)
 */
async function genValues(targetClasses, exactMatch) {
    let queryPart = "";
    //VALUES
    for (let i = 0; i < targetClasses.length; i++) {
        let target = targetClasses[i];
        if (!exactMatch) {
            target = [target];
            try {
                let subclasses = vocHand.getMySdoAdapter().getClass(target[0]).getSubClasses(true, {
                    "termType": "Class",
                    "isSuperseded": false
                });
                let usedVocabs = vocHand.getMySdoAdapter().getVocabularies();
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

//substitutes whitespaces from a string with a single whitespace
function trimWhiteSpaces(str) {
    return str.replace(/\s+/g, ' ').trim();
}

//for now support only exactMatch = true
//checks how many entities exist for a given target query
async function genQuery_CheckExist(namedGraph, dsTargetObject, verificationSettings) {
    let query = "select ?numTypes (COUNT(?subj) as ?numTypes) ";
    if (namedGraph !== null) {
        query = query.concat("from <" + namedGraph + "> ");
    }
    query = query.concat("where { ");
    if (dsTargetObject.targetType === "Class") {
        for (let i = 0; i < dsTargetObject.target.length; i++) {
            query = query.concat("?subj a <" + dsTargetObject.target[i] + "> .");
        }
        if (verificationSettings.onlyRootEntities) {
            query = query.concat("FILTER (!EXISTS { ?b ?a ?origin}) ");
        }
    } else {
        query = query.concat("?subj <" + dsTargetObject.target + "> ?o . ");
        if (verificationSettings.onlyRootEntities) {
            query = query.concat("FILTER (!EXISTS { ?b ?a ?origin}) ");
        }
    }
    query = query.concat("}");
    return query;
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
    genValues,
    genQuery_CheckExist,
    genQuery_EntityList,
    genQuery_EntityGraphBulk,
    genQuery_EntityGraphBulk_withIds,
    genQuery_EntityListWithData
};