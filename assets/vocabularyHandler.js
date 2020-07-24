/*
This File contains functions to handle/load/create SDOAdapter for given SDO/External vocabulary combinations
*/
const sdoAdapter = require("schema-org-adapter");
const adapterMemory = [];
let mySdoAdapter;

/**
 * sets up the sdo adapter depending on the vocabularies used by the input domain specification
 * @param {object} domainSpecification - the input domain specification
 * @return {boolean} returns true when the setting up is done
 */
async function setSdoAdapter(domainSpecification) {
    let vocabArray = getVocabURLForDS(domainSpecification);
    let correspondingSdoAdapter = getSDOAdapter(vocabArray);
    if (correspondingSdoAdapter === null) {
        let newSDOAdapter = new sdoAdapter();
        createAdapterMemoryItem(vocabArray, newSDOAdapter);
        mySdoAdapter = newSDOAdapter;
        await newSDOAdapter.addVocabularies(vocabArray);
        registerVocabReady(vocabArray);
        return true;
    } else {
        if (correspondingSdoAdapter.initialized === false) {
            setTimeout(async function () {
                await setSdoAdapter(domainSpecification);
                return true;
            }, 500);
        } else {
            //use the already created adapter for this vocabulary-combination
            mySdoAdapter = correspondingSdoAdapter.sdoAdapter;
            return true;
        }
    }
}

function getMySdoAdapter() {
    return mySdoAdapter;
}

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

/**
 * Extracts the URLs needed for the SDO-Adapter to handle the data of the given DS
 * @param {Object} ds - The input DS
 * @return {[String]} - The Array of URLs where the vocabularies can be fetched (for the SDO Adapter)
 */
function getVocabURLForDS(ds) {
    let vocabs = [];
    if (ds && ds["@graph"][0] && Array.isArray(ds["@graph"][0]["ds:usedVocabularies"])) {
        vocabs = JSON.parse(JSON.stringify(ds["@graph"][0]["ds:usedVocabularies"]));
    }
    if (ds && ds["@graph"][0] && ds["@graph"][0]["schema:schemaVersion"]) {
        vocabs.push("https://raw.githubusercontent.com/schemaorg/schemaorg/main/data/releases/" + getSDOVersion(ds["@graph"][0]["schema:schemaVersion"]) + "/all-layers.jsonld");
    }
    return vocabs;
}

//helper function to retrieve the SDO version used in a DS
function getSDOVersion(domainSpecification) {
    let versionRegex = /.*schema\.org\/version\/([0-9\.]+)\//g;
    let match = versionRegex.exec(domainSpecification);
    return match[1];
}

module.exports = {
    setSdoAdapter,
    getMySdoAdapter
};