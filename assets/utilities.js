//these predicates are being ignored for the creation of the data graph
let blacklistedPredicates = ["http://purl.org/dc/elements/1.1/language"];

//transforms quads read from the local file into a wished format (similar to sparql-result-json
function transformBlankNodeQuads(quads) {
    let result = [];
    for (let i = 0; i < quads.length; i++) {
        let subjType = "bnode";
        if (quads[i][0].startsWith("http")) {
            subjType = "uri";
        }
        let objType = "literal";
        let checkId = 0;
        let foundEntity = false;
        while (checkId < quads.length && !foundEntity) {
            if (quads[checkId++][0] === quads[i][2]) {
                foundEntity = true;
                if (quads[i][2].startsWith("http")) {
                    objType = "uri";
                } else {
                    objType = "bnode";
                }
            }
        }
        result.push({
            subj: {
                type: subjType,
                value: quads[i][0]
            },
            pred: {
                value: quads[i][1]
            },
            obj: {
                type: objType,
                value: quads[i][2]
            },
            origin: {
                value: quads[i][3]
            }
        })
    }
    return result;
}

/**
 * transforms the query output of getEntityGraphForURI() into a graph with a wished format
 * @param {Array} inputData - The "results.bindings" array resulting from the getEntityGraphForURI() Query on graphDB
 *  * @return {Object} the resulting graph
 */
function processDataGraphBulk(inputData) {
    //console.log(JSON.stringify(inputData,null,2))
    let mommyGraph = {};
    //let graph = {};
    for (let i = 0; i < inputData.length; i++) {
        let originId = inputData[i].origin.value;
        if (!mommyGraph[originId]) {
            mommyGraph[originId] = {};
        }

        let actualId = inputData[i].subj.value;
        if (!mommyGraph[originId][actualId]) {
            mommyGraph[originId][actualId] = {};
        }
        if (inputData[i].pred && inputData[i].pred.value) {
            //change type of references (when using graphDB IDs, we could introduce the same system to !retailMode, but not feasible)
            if (inputData[i].obj.value.startsWith("GID:")) {
                inputData[i].obj.type = "reference"; //mark this object as a reference
                inputData[i].obj.value = inputData[i].obj.value.substr("GID:".length); //now that we already flagged this as a reference, we can use the actual reference value without flag as value
            }
            //describe @type always as arrays
            if (inputData[i].pred.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
                if (Array.isArray(mommyGraph[originId][actualId]["@type"])) {
                    mommyGraph[originId][actualId]["@type"].push(inputData[i].obj.value);
                } else {
                    mommyGraph[originId][actualId]["@type"] = [inputData[i].obj.value];
                }
            } else if (!blacklistedPredicates.includes(inputData[i].pred.value)) {
                if (Array.isArray(mommyGraph[originId][actualId][inputData[i].pred.value])) {
                    mommyGraph[originId][actualId][inputData[i].pred.value].push(inputData[i].obj);
                } else {
                    mommyGraph[originId][actualId][inputData[i].pred.value] = [inputData[i].obj];
                }
            }
        }
    }
    //save root node id
    let mommyGraphKeys = Object.keys(mommyGraph);
    for (let i = 0; i < mommyGraphKeys.length; i++) {
        mommyGraph[mommyGraphKeys[i]]["@RootEntity"] = mommyGraphKeys[i];
    }
    return Object.values(mommyGraph);
}

//returns an object holding the target definition of a given domain specification.
function getTargetOfDomainSpecification(domainSpecification) {
    let result = {
        targetType: null, //can be "Class" or "Property"
        target: null //can be an Array of Class-URIs or a single Property-URI
    };
    if (domainSpecification && domainSpecification["@graph"] && domainSpecification["@graph"][0] && domainSpecification["@graph"][0]["sh:targetClass"]) {
        let targetClasses = [];
        if (Array.isArray(domainSpecification["@graph"][0]["sh:targetClass"])) {
            targetClasses = JSON.parse(JSON.stringify(domainSpecification["@graph"][0]["sh:targetClass"]));
        } else {
            targetClasses.push(domainSpecification["@graph"][0]["sh:targetClass"]);
        }
        //transform to absolute URIs
        for (let i = 0; i < targetClasses.length; i++) {
            targetClasses[i] = getAbsoluteURI(targetClasses[i], domainSpecification["@context"]);
        }
        result.targetType = "Class";
        result.target = targetClasses;
    } else if (domainSpecification && domainSpecification["@graph"] && domainSpecification["@graph"][0] && domainSpecification["@graph"][0]["sh:targetSubjectOf"]) {
        result.targetType = "Property";
        result.target = getAbsoluteURI(domainSpecification["@graph"][0]["sh:targetSubjectOf"], domainSpecification["@context"]);
    }
    return result;
}

//gives the absolute form of a given compacted uri
function getAbsoluteURI(compactedURI, context) {
    return context[compactedURI.substring(0, compactedURI.indexOf(":"))].concat(compactedURI.substring(compactedURI.indexOf(":") + 1));
}

//creates an object holding meta information about a verification job
function createMetaInformation(connectionSettings, verificationSettings, domainSpecification, statistics) {
    let result = {
        "Connection settings": {
            "SPARQL endpoint": connectionSettings.endPointURL,
            "Repository ID": connectionSettings.repositoryId,
            "Named graph": connectionSettings.namedGraph,
            "Connection timeout (Minutes)": connectionSettings.timeout
        },
        "Verification settings": {
            "Used Domain Specification": statistics.dsName,
            "Allow sub-classes for entity-match": !verificationSettings.exactMatch,
            "Allow only root-entities for entity-match": verificationSettings.onlyRootEntities,
            "Allow use of internal KG-identifier": verificationSettings.retailMode,
            "Maximal amount of entities to verify": verificationSettings.verificationLimit,
            "Entity-chunk-size for data-graph-retrieval": verificationSettings.entityGraphChuckSize,
            "Logging of errors in error-files enabled": verificationSettings.logErrors
        },
        "Statistics": {
            "Number of verified entities": statistics.sumEntitiesVerified,
            "number of triples processed": statistics.processedTriples,
            "Number of errors found": calculateSumErrors(statistics.errorMeta),
            "Distribution of errors found": statistics.errorMeta
        }
    };
    if (verificationSettings.logErrors) {
        result["Verification settings"]["Maximal amount of errors per error-file"] = verificationSettings.errorsPerErrorFile
    }
    if (verificationSettings.retailMode) {
        result.Statistics["Duration for retrieval of target-entity-list (Seconds)"] = statistics.durationTargetList.as('seconds');
        result.Statistics["Duration for retrieval of data-graphs (Seconds)"] = statistics.durationEntityGraphs.as('seconds');
    } else {
        result.Statistics["Duration for retrieval of target-entity-list without blank nodes (Seconds)"] = statistics.durationTargetList.as('seconds');
        result.Statistics["Duration for retrieval of data-graphs of target-entities without blank nodes (Seconds)"] = statistics.durationEntityGraphs.as('seconds');
        result.Statistics["Duration for retrieval of target-entity-list and data-graphs for blank nodes (Seconds)"] = statistics.durationRetrieveBlankNodes.as('seconds');
    }
    result.Statistics["Duration for verification of data-graphs (Seconds)"] = statistics.durationVerification.as('seconds');
    if (verificationSettings.retailMode) {
        result.Statistics["Total duration (Seconds)"] = statistics.durationEntityGraphs.add(statistics.durationTargetList).add(statistics.durationVerification).as('seconds');
    } else {
        result.Statistics["Total duration (Seconds)"] = statistics.durationEntityGraphs.add(statistics.durationTargetList).add(statistics.durationRetrieveBlankNodes).add(statistics.durationVerification).as('seconds');
    }
    result.Statistics["Execution errors for the verification framework"] = statistics.executionErrors;
    return result;
}

//calculates the amount of total errors from a given error-meta object
function calculateSumErrors(errorMeta) {
    let keys = Object.keys(errorMeta);
    let sum = 0;
    for (let i = 0; i < keys.length; i++) {
        sum += errorMeta[keys[i]];
    }
    return sum;
}

module.exports = {
    processDataGraphBulk,
    getTargetOfDomainSpecification,
    createMetaInformation,
    calculateSumErrors,
    transformBlankNodeQuads
};