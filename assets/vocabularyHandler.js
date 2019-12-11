/*
This File contains functions to handle/load/create SDOAdapter for given SDO/External vocabulary combinations
*/
let adapterMemory = [];

//creates a new item in the adapterMemory. The "initialized" field is set to true in another function, when the sdoAdapter had its vocabularies added.
function createAdapterMemoryItem(vocabsArray, sdoAdapterInstance) {
    adapterMemory.push({
        "vocabsArray": vocabsArray,
        "sdoAdapter": sdoAdapterInstance,
        "initialized": false
    });
}

//sets the "initialized" field to true for a given item in the adapterMemory.
function registerVocabReady(vocabsArray) {
    let sdoAdapterItem = getSDOAdapter(vocabsArray);
    if (sdoAdapterItem !== null) {
        sdoAdapterItem.initialized = true;
    }
}

//returns the corresponding item from the adapterMemory based on the given "vocabsArray" (array of vocabularies used in that sdoAdapter).
//returns null if no match found
function getSDOAdapter(vocabsArray) {
    for (let i = 0; i < adapterMemory.length; i++) {
        //every URL in the source vocabsArray must be in the target vocabsArray and vice versa
        let foundMismatch = false;
        let targetVocabs = adapterMemory[i]["vocabsArray"];
        for (let a = 0; a < targetVocabs.length; a++) {
            if (vocabsArray.indexOf(targetVocabs[a]) === -1) {
                foundMismatch = true;
                break;
            }
        }
        if (!foundMismatch) {
            for (let b = 0; b < vocabsArray.length; b++) {
                if (targetVocabs.indexOf(vocabsArray[b]) === -1) {
                    foundMismatch = true;
                    break;
                }
            }
        }
        if (!foundMismatch) {
            return adapterMemory[i];
        }
    }
    return null;
}

//helper function to determine used vocabularies and versions of the given DS
function analyzeDSVocabularies(ds) {
    let vocabularies = [];
    if (ds && ds["@graph"] && ds["@graph"][0] && ds["@graph"][0]["schema:schemaVersion"]) {
        vocabularies.push(ds["@graph"][0]["schema:schemaVersion"]);
    }
    if (ds && ds["@context"]) {
        let contextKeys = Object.keys(ds["@context"]);
        let standardContextIdentifiers = ["rdf", "rdfs", "sh", "xsd", "schema", "sh:targetClass", "sh:property", "sh:path", "sh:nodeKind", "sh:datatype", "sh:node", "sh:class", "sh:or", "sh:in", "sh:languageIn", "sh:equals", "sh:disjoint", "sh:lessThan", "sh:lessThanOrEquals", "sh:targetSubjectOf"];
        for (let i = 0; i < contextKeys.length; i++) {
            if (standardContextIdentifiers.indexOf(contextKeys[i]) === -1) {
                vocabularies.push(ds["@context"][contextKeys[i]]);
            }
        }
    }
    return vocabularies;
}

//constructs the URL for given vocabulary IRIs
function getVocabURLForIRIs(vocabulariesArray) {
    let result = [];
    for (let i = 0; i < vocabulariesArray.length; i++) {
        if (vocabulariesArray[i].indexOf("schema.org") !== -1) {
            result.push("https://raw.githubusercontent.com/schemaorg/schemaorg/master/data/releases/" + getSDOVersion(vocabulariesArray[i]) + "/all-layers.jsonld");
        }
        //for this public project only the public schema.org vocabulary is available
    }
    return result;
}

//helper function to retrieve the SDO version used in a DS
function getSDOVersion(domainSpecification) {
    let versionRegex = /.*schema\.org\/version\/([0-9\.]+)\//g;
    let match = versionRegex.exec(domainSpecification);
    return match[1];
}

module.exports = {
    createAdapterMemoryItem,
    registerVocabReady,
    getSDOAdapter,
    analyzeDSVocabularies,
    getVocabURLForIRIs
};