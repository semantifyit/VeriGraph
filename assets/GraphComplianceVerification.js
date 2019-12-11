const VUT = require("./ValidationUtilities");
const jsonld = require("jsonld");
const ComplianceValidationReport = require("./constructors/KGComplianceVerificationReport");
const ErrorEntry = require("./constructors/KGErrorEntry");
const vocHand = require("./vocabularyHandler");
const sdoAdapter = require("./sdoAdapter");
const moment = require("moment");

let mySdoAdapter;

async function setSdoAdapter(ds) {
    let vocabArray = vocHand.getVocabURLForIRIs(vocHand.analyzeDSVocabularies(ds));
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
                await setSdoAdapter(ds);
                return true;
            }, 500);
        } else {
            //use the already created adapter for this vocabulary-combination
            mySdoAdapter = correspondingSdoAdapter.sdoAdapter;
            return true;
        }
    }
}

async function isGraphValidAgainstDomainSpecification(dataGraph, domainSpecification, ignoreTargetMatching = false) {
    try {
        //lexical check
        let dataLexCheck = lexicalCheck(dataGraph);
        if (dataLexCheck !== null) {
            let err;
            switch (dataLexCheck) {
                case 101:
                    err = new ErrorEntry("JsonError", "Critical", 101, "Invalid JSON", "The input data graph is not valid JSON (cannot be parsed to JSON).", null, null);
                    break;
                case 102:
                    err = new ErrorEntry("JsonError", "Critical", 102, "Empty JSON", "The input data graph is empty.", null, null);
                    break;
                case 103:
                    err = new ErrorEntry("JsonError", "Critical", 103, "No JSON Object", "The input data graph is not a JSON object.", null, null);
                    break;
                case 104:
                    err = new ErrorEntry("JsonError", "Error", 104, "Usage of undefined", "The input data graph uses 'undefined' as value.", null, null);
                    break;
            }
            return new ComplianceValidationReport("Invalid", "Compliance Validation Report", "An error was detected during the lexical check of the input data graph.", [err]);
        }
        let dsLexCheck = lexicalCheck(domainSpecification);
        if (dsLexCheck !== null) {
            let err;
            switch (dsLexCheck) {
                case 101:
                    err = new ErrorEntry("JsonError", "Critical", 101, "Invalid JSON", "The input Domain Specification is not valid JSON (cannot be parsed to JSON).", null, null);
                    break;
                case 102:
                    err = new ErrorEntry("JsonError", "Critical", 102, "Empty JSON", "The input Domain Specification is empty.", null, null);
                    break;
                case 103:
                    err = new ErrorEntry("JsonError", "Critical", 103, "No JSON Object", "The input Domain Specification is not a JSON object.", null, null);
                    break;
                case 104:
                    err = new ErrorEntry("JsonError", "Error", 104, "Usage of undefined", "The input Domain Specification uses 'undefined' as value.", null, null);
                    break;
            }
            return new ComplianceValidationReport("Invalid", "Compliance Validation Report", "An error was detected during the lexical check of the input Domain Specification.", [err]);
        }
        //pre-process input
        domainSpecification = await preProcessDS(domainSpecification);
        dataGraph = await preProcessGraph(dataGraph, domainSpecification["@context"]);
        let dsRootNodeId = discoverRootNode(domainSpecification["@graph"]); //get the ID of the root node of the DS - Should be the first one in the dataGraph usually
        let dsGraph = {};
        setGraph(domainSpecification["@graph"], dsGraph);
        if (dsRootNodeId !== null && VUT.isString(dsGraph[dsRootNodeId]["schema:schemaVersion"])) {
            await setSdoAdapter(domainSpecification);
        } else {
            return new ComplianceValidationReport("Invalid", "Compliance Validation Report", "There was an execution error during the verification process: The Domain Specification does not provide the used schema.org version number.", [new ErrorEntry("ExecutionError", "Critical", 999, "Execution Error", "There was an execution error during the verification process: The Domain Specification does not provide the used schema.org version number.", "$", null)]);
        }
        //start verification
        let errorArray = validateClass(dataGraph, dsGraph, [Object.keys(dataGraph)[0]], "$", [], ignoreTargetMatching);
        //return verification report
        return createVerificationReport(errorArray, domainSpecification["@context"]);
    } catch (e) {
        console.error(e);
        return new ComplianceValidationReport("Invalid", "Compliance Validation Report", "There was an execution error during the verification process, make sure the sent data graph and domain specification have a valid serialization.", [new ErrorEntry("ExecutionError", "Critical", 999, "Execution Error", "There was an error during the validation process, make sure the sent data graph and domain specification have a valid serialization.", "$", null)]);
    }
}


function lexicalCheck(input) {
    try {
        JSON.parse(JSON.stringify(input));
    } catch (e) {
        return 101; //101	Invalid JSON	Critical	The input is not valid JSON. - string that can not be parsed to json
    }
    if (input === null || (Array.isArray(input) && input.length === 0) || input === "" || input === undefined || (VUT.isObject(input) && Object.keys(input).length === 0)) {
        return 102; //102	Empty JSON	Critical	The input is empty - null, empty object, "", undefined, []
    }
    if (!VUT.isObject(input)) {
        return 103; //103	No JSON Object	Critical	The input is not a JSON object - input should be an JSON object, and not an array of annotations, or something else
    }
    if (lexicalCheckRec(input) === false) {
        return 104; //104	Usage of undefined	Error	Usage of undefined as value - Not valid in JSON
    }
    return null; //no error
}

//returns false if undefined is used
function lexicalCheckRec(obj) {
    //input is supposed to be an object, array, or literal
    let result = true;
    if (obj === undefined) {
        result = false;
    } else if (VUT.isObject(obj)) {
        let keys = Object.keys(obj);
        for (let i = 0; i < keys.length; i++) {
            if (!lexicalCheckRec(obj[keys[i]])) {
                result = false;
                break;
            }
        }
    } else if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            if (!lexicalCheckRec(obj[i])) {
                result = false;
                break;
            }
        }
    }
    return result;
}

function setGraph(graphArray, targetArray) {
    for (let i = 0; i < graphArray.length; i++) {
        if (graphArray[i]["@id"] !== undefined) {
            targetArray[graphArray[i]["@id"]] = graphArray[i];
        } else {
            //meta error
            console.log("Node without @id!");
        }
    }
}

//returns the @id of the rootnode (should be always the first node)
function discoverRootNode(graphArray) {
    //root node is the only with "@type": ["sh:NodeShape", "schema:CreativeWork"]
    for (let i = 0; i < graphArray.length; i++) {
        if (Array.isArray(graphArray[i]["@type"])) {
            if (graphArray[i]["@type"].indexOf("sh:NodeShape") !== -1 && graphArray[i]["@type"].indexOf("schema:CreativeWork") !== -1) {
                return graphArray[i]["@id"];
            }
        }
    }
    return null;
}

//the standard JSON-LD Context for the verification process (it is used during the DS pre-processing)
const preProcessDsContext = {
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "sh": "http://www.w3.org/ns/shacl#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "schema": "http://schema.org/",
    "sh:targetClass": {
        "@id": "sh:targetClass",
        "@type": "@id"
    },
    "sh:targetSubjectOf": {
        "@id": "sh:targetSubjectOf",
        "@type": "@id"
    },
    "sh:property": {
        "@id": "sh:property",
        "@type": "@id"
    },
    "sh:path": {
        "@id": "sh:path",
        "@type": "@id"
    },
    "sh:datatype": {
        "@id": "sh:datatype",
        "@type": "@id"
    },
    "sh:node": {
        "@id": "sh:node",
        "@type": "@id"
    },
    "sh:class": {
        "@id": "sh:class",
        "@type": "@id"
    },
    "sh:or": {
        "@id": "sh:or",
        "@container": "@list",
        "@type": "@id"
    },
    "sh:in": {
        "@id": "sh:in",
        "@container": "@list"
    },
    "sh:languageIn": {
        "@id": "sh:languageIn",
        "@container": "@list"
    },
    "sh:equals": {
        "@id": "sh:equals",
        "@type": "@id"
    },
    "sh:disjoint": {
        "@id": "sh:disjoint",
        "@type": "@id"
    },
    "sh:lessThan": {
        "@id": "sh:lessThan",
        "@type": "@id"
    },
    "sh:lessThanOrEquals": {
        "@id": "sh:lessThanOrEquals",
        "@type": "@id"
    }
};

/**
 * Translates the data within a Domain Specification to an expected format/context to enable the verification process
 * @param {Object} DS - the input Domain Specification
 * @returns {Object} the translated Domain Specification
 */
async function preProcessDS(DS) {
    let newContext = JSON.parse(JSON.stringify(DS["@context"]));
    let wishedContextKeys = Object.keys(preProcessDsContext);
    for (let z = 0; z < wishedContextKeys.length; z++) {
        newContext[wishedContextKeys[z]] = preProcessDsContext[wishedContextKeys[z]];
    }
    DS = await jsonld.flatten(DS, newContext);
    //make always an Array for properties where a single value is a string and multiple are in Array (easier to work with)
    for (let i = 0; i < DS["@graph"].length; i++) {
        //sh:property
        if (VUT.isString(DS["@graph"][i]["sh:property"])) {
            DS["@graph"][i]["sh:property"] = [DS["@graph"][i]["sh:property"]];
        }
        //sh:class
        if (VUT.isString(DS["@graph"][i]["sh:class"])) {
            DS["@graph"][i]["sh:class"] = [DS["@graph"][i]["sh:class"]];
        }
        //sh:targetClass
        if (VUT.isString(DS["@graph"][i]["sh:targetClass"])) {
            DS["@graph"][i]["sh:targetClass"] = [DS["@graph"][i]["sh:targetClass"]];
        }
    }
    return DS;
}

/**
 * Translates the data within a DataGraph to an expected format/context to enable the verification process
 * @param {Object} dataGraph - the input data graph
 * @param {Object} DsContext - the context of the ds for the verification
 * @returns {Object} the translated data graph
 */
async function preProcessGraph(dataGraph, DsContext) {
    let graphIds = Object.keys(dataGraph);
    for (let i = 0; i < graphIds.length; i++) {
        let entity = dataGraph[graphIds[i]];
        let entityProps = Object.keys(entity);
        for (let p = 0; p < entityProps.length; p++) {
            if (entityProps[p] === "@type") {
                for (let t = 0; t < entity["@type"].length; t++) {
                    entity["@type"][t] = swapUriToIndicator(entity["@type"][t], DsContext);
                }
            } else if (!entityProps[p].startsWith("@")) {
                let swappedPropertyName = swapUriToIndicator(entityProps[p], DsContext);
                if (swappedPropertyName !== entityProps[p]) {
                    entity[swappedPropertyName] = entity[entityProps[p]];
                    delete entity[entityProps[p]];
                }
                // not needed if URIs are used
                // for (let k = 0; k < entity[swappedPropertyName].length; k++) {
                //     if (entity[swappedPropertyName][k]["type"] !== "literal" && entity[swappedPropertyName][k]["value"]) {
                //         for (let j = 0; j < graphIds.length; j++) {
                //             if (dataGraph[graphIds[j]]["@subj"]["value"] === entity[swappedPropertyName][k]["value"]) {
                //                 entity[swappedPropertyName][k]["targetId"] = graphIds[j];
                //             }
                //         }
                //     }
                // }
            }
        }
    }
    return dataGraph;
}

/**
 * Translates an absolute URI to one using a vocabulary indicator (prefix) taken from a given @context (if vocabulary is included)
 * @param {string} URI - the URI to translate
 * @param {Object} DsContext - the JSON-LD Context
 * @returns {string} the translated URI with prefix
 */
function swapUriToIndicator(URI, DsContext) {
    let contextIndicators = Object.keys(DsContext);
    for (let i = 0; i < contextIndicators.length; i++) {
        if (VUT.isString(DsContext[contextIndicators[i]])) {
            if (URI.startsWith(DsContext[contextIndicators[i]])) {
                return contextIndicators[i] + ":" + URI.substring(DsContext[contextIndicators[i]].length);
            }
        }
    }
    return URI;
}

/**
 * Translates a URI using a vocabulary indicator (prefix) taken from a given @context to an absolute URI to one (if vocabulary is included in context)
 * @param {string} URI - the URI to translate
 * @param {Object} DsContext - the JSON-LD Context
 * @returns {string} the absolute URI without prefix
 */
function swapIndicatorToUri(URI, DsContext) {
    let contextIndicators = Object.keys(DsContext);
    for (let i = 0; i < contextIndicators.length; i++) {
        if (VUT.isString(DsContext[contextIndicators[i]])) {
            if (URI.startsWith(contextIndicators[i])) {
                return DsContext[contextIndicators[i]] + URI.substring(contextIndicators[i].length + 1);
            }
        }
    }
    return URI;
}

//"post-processes" the dataPath in the errors and creates a verification report, depending on the severity of the given errors
function createVerificationReport(errors, dsContext) {
    let validationResult = "Valid";
    let description = "The data graph is in compliance with the Domain Specification.";
    let name = "Compliance Validation Report";
    for (let i = 0; i < errors.length; i++) {
        //curate dataPath entries, they should NOT use URIS with prefix
        if (Array.isArray(errors[i].dataPath)) {
            for (let k = 0; k < errors[i].dataPath.length; k++) {
                errors[i].dataPath[k] = swapIndicatorToUri(errors[i].dataPath[k], dsContext);
            }
        }
        if (validationResult !== "Invalid") {
            if (errors[i]["severity"] === "Warning") {
                validationResult = "ValidWithWarnings";
                description = "The data graph is in compliance with the Domain Specification, but with Warnings";
            } else if (errors[i]["severity"] === "Critical" || errors[i]["severity"] === "Error") {
                validationResult = "Invalid";
                description = "The data graph is NOT in compliance with the Domain Specification";
            }
        }
    }
    return new ComplianceValidationReport(validationResult, name, description, errors);
}

//recursive function to check if a valid Annotation is valid against a given valid Domain Specification
function validateClass(dataGraph, dsGraph, dataPath, dsPath, errorArray, ignoreTargetMatching = false) {
    let actualDsObject = VUT.resolvePath_graphDS(dsGraph, dsPath);
    let actualDataObject = VUT.resolvePath_dataGraph(dataGraph, dataPath);
    //1. Check if the sh:targetClass matches the annotation @type, this is called only once on the first call of this function
    if (actualDsObject["sh:targetClass"] && ignoreTargetMatching !== true) {
        if (!checkTypesMatch(actualDsObject["sh:targetClass"], actualDataObject["@type"])) {
            errorArray.push(new ErrorEntry("ComplianceError", "Critical", 501, "Non-conform target @type", "The data graph has a @type that is not specified by the Domain Specification.", dsPath, dataPath));
            return errorArray;
        }
    }
    //2. Check for every property in the specification if it is used/valid in the annotation
    //create reference of properties based on node type (root/nested), to make it easier to iterate over them
    let dsPropertyArray = [];
    if ((actualDsObject["sh:targetClass"] || actualDsObject["sh:targetSubjectOf"]) && actualDsObject["sh:property"]) {
        dsPropertyArray = actualDsObject["sh:property"];
    } else if (VUT.isString(actualDsObject["sh:node"])) {
        //sh:node has a URI as value
        dsPropertyArray = dsGraph[actualDsObject["sh:node"]]["sh:property"];
    }
    for (let i = 0; i < dsPropertyArray.length; i++) {
        //members or dsPropertyArray are node URIs of the dsGraph
        let ds_actualProperty = dsGraph[dsPropertyArray[i]];
        //check sh:min and sh:max
        validateCardinality(dataGraph, dsGraph, dataPath, dsPath.concat("." + ds_actualProperty["sh:path"]), errorArray);
        //If property is used by annotation -> validate property ranges (sh:or | sh:class , sh:datatype , sh:in)
        if (actualDataObject[ds_actualProperty['sh:path']] !== undefined) {
            let actualDataPath = copyByVal(dataPath);
            actualDataPath.push(ds_actualProperty['sh:path']);
            validateRanges(dataGraph, dsGraph, actualDataPath, dsPath.concat("." + ds_actualProperty["sh:path"]), errorArray);
        }
    }
    //3. Check for every property in the annotation if it is mentioned in the DS or not
    let dataObjectKeys = Object.keys(actualDataObject);
    for (let i = 0; i < dataObjectKeys.length; i++) {
        //skip object keys that are not representing properties
        if (dataObjectKeys[i] === "@type" || dataObjectKeys[i] === "@nodeType") {
            continue;
        }
        //check every DS Property definition, to see if the actual dataObjectKey is contained
        let propertyFound = false;
        for (let j = 0; j < dsPropertyArray.length; j++) {
            let ds_actualProperty = dsGraph[dsPropertyArray[j]];
            if (dataObjectKeys[i] === ds_actualProperty["sh:path"]) {
                propertyFound = true;
                break;
            }
        }
        if (propertyFound === false) {
            errorArray.push(new ErrorEntry("ComplianceError", "Warning", 502, "Non-conform property", "The entity has a property ('" + VUT.prettyPrintURI(dataObjectKeys[i]) + "') that is not specified by the domain specification.", dsPath, dataPath));
        }
    }
    return errorArray;
}


/**
 * dsType / annotationType = [schema:Airport] or [schema:Airport, schema:Hotel]
 * each type in annotationType (or a supertype of it) must be in dsType - additional types are not allowed
 * each type in dsType (or a subtype of it) must be in annotationType - missing types are not allowed
 * @param {array} dsTypes - the types defined by the ds
 * @param {array} dataTypes - the types used by the entity in the data graph
 * @returns {boolean} - returns true if the entity types contain the ds types or any allowed combinations of them
 */
function checkTypesMatch(dsTypes, dataTypes) {
    //must have the same amounts of types
    if (dsTypes.length !== dataTypes.length) {
        return false;
    }
    //each type in dataTypes (or a supertype of it) must be in dsTypes - additional types are not allowed
    for (let i = 0; i < dataTypes.length; i++) {
        let foundMatch = false;
        for (let j = 0; j < dsTypes.length; j++) {
            if (dataTypes[i] === dsTypes[j] || isSuperclass(dsTypes[j], dataTypes[i])) {
                foundMatch = true;
                break;
            }
        }
        if (!foundMatch) {
            return false;
        }
    }
    //each type in dsTypes (or a subtype of it) must be in dataTypes - missing types are not allowed
    for (let i = 0; i < dsTypes.length; i++) {
        let foundMatch = false;
        for (let j = 0; j < dataTypes.length; j++) {
            if (dsTypes[i] === dataTypes[j] || isSuperclass(dsTypes[i], dataTypes[j])) {
                foundMatch = true;
                break;
            }
        }
        if (!foundMatch) {
            return false;
        }
    }
    return true;
}

//checks if given class A is superclass (recursive=implicit) of given class B
function isSuperclass(classA, classB) {
    try {
        let superClasses = mySdoAdapter.getClass(classB).getSuperClasses(true);
        return (superClasses.indexOf(classA) !== -1);
    } catch (e) {
        return false;
    }

}

//checks if the annotations is in compliance with the DS-restrictions defined by sh:minCount and sh:maxCount
function validateCardinality(graphAnn, dsGraph, dataPath, dsPath, errorReport) {
    let actualDsProperty = VUT.resolvePath_graphDS(dsGraph, dsPath);
    let propertyPath = actualDsProperty['sh:path'];
    let minCount = actualDsProperty['sh:minCount'];
    let maxCount = actualDsProperty['sh:maxCount'];
    let actualDataObj = VUT.resolvePath_dataGraph(graphAnn, dataPath);
    let dataPathWithProperty = copyByVal(dataPath);
    dataPathWithProperty.push(propertyPath);
    //sh:minCount
    if (VUT.isNumber(minCount)) {
        if (actualDataObj[propertyPath] === undefined && minCount > 0) {
            errorReport.push(new ErrorEntry("ComplianceError", "Error", 503, "Missing Property", "The entity is missing a property ('" + VUT.prettyPrintURI(propertyPath) + "') that is defined as required by the domain specification.", dsPath, dataPath));
        } else if (minCount > 1 && (!Array.isArray(actualDataObj[propertyPath]) || actualDataObj[propertyPath].length < minCount)) {
            errorReport.push(new ErrorEntry("ComplianceError", "Error", 504, "Non-conform cardinality", "The entity has a property ('" + VUT.prettyPrintURI(propertyPath) + "') with a cardinality that is not in compliance with the domain specification.", dsPath, dataPathWithProperty));
        }
    }
    //sh:maxCount
    if (VUT.isNumber(maxCount)) {
        if ((Array.isArray(actualDataObj[propertyPath]) && actualDataObj[propertyPath].length > maxCount)) {
            errorReport.push(new ErrorEntry("ComplianceError", "Error", 504, "Non-conform cardinality", "The entity has a property ('" + VUT.prettyPrintURI(propertyPath) + "') with a cardinality that is not in compliance with the domain specification.", dsPath, dataPathWithProperty));
        }
    }
}

/**
 * Creates shallow copy of a JSON element
 * @param input - the json element to copy
 * @returns a shallow copy of the given JSON element
 */
function copyByVal(input) {
    return JSON.parse(JSON.stringify(input));
}

//checks if all the ranges for an annotation property are covered by the corresponding definition in the DS
function validateRanges(dataGraph, dsGraph, dataPath, dsPath, errorArray) {
    let actualDsProperty = VUT.resolvePath_graphDS(dsGraph, dsPath);
    let actualRangesArray = VUT.resolvePath_dataGraph(dataGraph, dataPath);
    //Array 1 -> values from the annotation that should be checked
    let dataRangesToCheck = copyByVal(actualRangesArray);
    //Array 2 -> possible values from the DS
    let dsRangesAllowed = [];
    if (Array.isArray(actualDsProperty["sh:or"])) {
        //multiple ranges possible
        for (let k = 0; k < actualDsProperty["sh:or"].length; k++) {
            dsRangesAllowed.push(dsGraph[actualDsProperty["sh:or"][k]]);
        }
    } else {
        //property definition has no ranges - should not be the case in general
        //for the verification: no restriction to check -> finish
        return;
    }
    //check sh:uniqueLang here
    check_shUniqueLang(actualRangesArray, dsRangesAllowed, dataPath, dsPath, errorArray);
    //check sh:in
    check_shIn(dataRangesToCheck, actualDsProperty, dataPath, dsPath, errorArray);
    //check sh:hasValue
    check_shHasValue(dataRangesToCheck, actualDsProperty, dataPath, dsPath, errorArray);
    //check sh:equals
    check_shEquals(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray);
    //check sh:disjoint
    check_shDisjoint(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray);
    //check sh:lessThan
    check_shLessThan(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray);
    //check sh:lessThan
    check_shLessThanOrEquals(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray);
    //check Matrix of actual vs. expected values
    for (let j = 0; j < dataRangesToCheck.length; j++) {
        //check if range is a non-literal, if so, check if it is present in the data graph
        if(dataRangesToCheck[j].type !== "literal"){
            //console.log(dataRangesToCheck[j]);
            try{
                let targetObj = copyByVal(VUT.resolvePath_dataGraph(dataGraph, [dataRangesToCheck[j].value]));
                //console.log(targetObj);
            } catch (e) {
                let dataPathNonExistentNode = copyByVal(dataPath);
                dataPathNonExistentNode.push(dataRangesToCheck[j].value);
                //entity does not exist in data graph
                errorArray.push(new ErrorEntry("DataError", "Error", 900, "Non-existing entity" , "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a referenced entity that does not exist is the data graph.", dsPath, dataPathNonExistentNode));
                continue;
            }
        }
        let errorsOfBestMatch = null;
        //each check does return false if there is no match, otherwise it will return true
        //for each match-checking a new array for errors will be passed. If a match with 0 errors is found, then it is taken instantly as found match
        //else all range possibilities are tested and that with the least errors is taken as "the match"
        for (let k = 0; k < dsRangesAllowed.length; k++) {
            let matchResult_dataType = [];
            if (checkMatch_dataType(dataRangesToCheck[j], dsRangesAllowed[k], dataPath, dsPath, matchResult_dataType)) {
                //has sh:datatype
                if (errorsOfBestMatch === null || matchResult_dataType.length < errorsOfBestMatch.length) {
                    errorsOfBestMatch = copyByVal(matchResult_dataType);
                }
                if (errorsOfBestMatch.length === 0) {
                    break;
                }
            }
            let matchResult_restrictedClass = [];
            if (checkMatch_restrictedClass(dataRangesToCheck[j], dsRangesAllowed[k], dataGraph, dsGraph, dataPath, dsPath, matchResult_restrictedClass)) {
                //has sh:class, is not an enumeration
                //has no sh:node
                if (errorsOfBestMatch === null || matchResult_restrictedClass.length < errorsOfBestMatch.length) {
                    errorsOfBestMatch = copyByVal(matchResult_restrictedClass);
                }
                if (errorsOfBestMatch.length === 0) {
                    break;
                }
            }
            let matchResult_restrictedEnumeration = [];
            if (checkMatch_restrictedEnumeration(dataRangesToCheck[j], dsRangesAllowed[k], dataPath, dsPath, actualDsProperty['sh:path'], matchResult_restrictedEnumeration)) {
                //has sh:class with 1 value, which is an enumeration
                //has sh:in
                if (errorsOfBestMatch === null || matchResult_restrictedEnumeration.length < errorsOfBestMatch.length) {
                    errorsOfBestMatch = copyByVal(matchResult_restrictedEnumeration);
                }
                if (errorsOfBestMatch.length === 0) {
                    break;
                }
            }
            let matchResult_standardClass = [];
            if (checkMatch_standardClass(dataRangesToCheck[j], dsRangesAllowed[k], dataGraph, dsGraph, dataPath, dsPath, matchResult_standardClass)) {
                //has sh:class, is not an enumeration
                //has no sh:node
                if (errorsOfBestMatch === null || matchResult_standardClass.length < errorsOfBestMatch.length) {
                    errorsOfBestMatch = copyByVal(matchResult_standardClass);
                }
                if (errorsOfBestMatch.length === 0) {
                    break;
                }
            }
            let matchResult_enumeration = [];
            if (checkMatch_enumeration(dataRangesToCheck[j], dsRangesAllowed[k], dataPath, dsPath, actualDsProperty['sh:path'], matchResult_enumeration)) {
                //has sh:class with 1 value, which is an enumeration
                //has no sh:in
                //should it only allow SDO values (the case atm)? or any URIs?
                if (errorsOfBestMatch === null || matchResult_enumeration.length < errorsOfBestMatch.length) {
                    errorsOfBestMatch = copyByVal(matchResult_enumeration);
                }
                if (errorsOfBestMatch.length === 0) {
                    break;
                }
            }
        }
        if (errorsOfBestMatch === null) {
            errorArray.push(new ErrorEntry("ComplianceError", "Error", 505, "Non-conform range", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a @type/datatype that is non-conform to the domain specification.", dsPath, dataPath));
        } else if (errorsOfBestMatch.length > 0) {
            errorArray.push(...errorsOfBestMatch);
        }
    }
}


//returns true if the annVal (value) matches a given standard enumeration (has no "sh:in". "sh:class" has a valid enumeration)
function checkMatch_enumeration(dataObj, dsObj, dataPath, dsPath, propertyURI, errorArray) {
    //enumeration node has "sh:class" with an array with only one class (the enumeration) inside
    if (dsObj["sh:in"] === undefined && Array.isArray(dsObj["sh:class"]) && dsObj["sh:class"].length === 1 && check_isValidSDOEnumeration(dsObj["sh:class"][0])) {
        //example dataObj
        // {
        //     "type": "literal",
        //     "value": "http://schema.org/Monday"
        // }
        if (VUT.isObject(dataObj) && dataObj.type === "literal" && VUT.isString(dataObj.value)) {
            //we are not very strict here and allow the user to use any string as value
            return true;
            //if (dataObj.value.startsWith("http://schema.org/") && check_isValidSDOEnumerationMember(dataObj.value)) {
            //     return true;
            // } else {
            //     //if no match was found, then the value is a incorrect enumeration value
            //     errorArray.push(new ErrorEntry("ComplianceError", "Error", 506, "Non-conform enumeration value", "The data graph has a property ('" + VUT.prettyPrintURI(propertyURI) + "') with an enumeration value that does not exist in schema.org.", dsPath, dataPath));
            //     //return true, else the 505 "Non-conform range" error is also triggered
            //     return true;
            //}
        }
    }
    return false;
}

//returns true if the annVal (value) matches a given restricted enumeration (has "sh:in". "sh:class" has a valid enumeration)
function checkMatch_restrictedEnumeration(dataObj, dsObj, dataPath, dsPath, propertyURI, errorArray) {
    //restricted enumeration node has "sh:class" with an array with only one class (which is an enumeration)
    //restricted enumeration node has "sh:in" with allowed enumeration members
    //e.g.
    // {
    //     "sh:class": "schema:DayOfWeek",
    //     "sh:in": [
    //             "http://schema.org/Wednesday",
    //             "http://schema.org/Sunday",
    //             "http://schema.org/PublicHolidays",
    //             "http://schema.org/Monday",
    //             "http://schema.org/Friday",
    //             "http://schema.org/Tuesday",
    //             "http://schema.org/Saturday",
    //             "http://schema.org/Thursday"
    //      ]
    // }
    if (Array.isArray(dsObj["sh:in"]) && Array.isArray(dsObj["sh:class"]) && dsObj["sh:class"].length === 1 && check_isValidSDOEnumeration(dsObj["sh:class"][0])) {
        //possible value ->
        // {
        //     "type": "literal",
        //     "value": "http://schema.org/Monday"
        // }
        if (VUT.isObject(dataObj) && dataObj.type === "literal" && dsObj["sh:in"].includes(dataObj.value)) {
            return true;
        } else {
            //if no match was found, then the value is a incorrect enumeration value
            errorArray.push(new ErrorEntry("ComplianceError", "Error", 506, "Non-conform enumeration value", "The data graph has a property ('" + VUT.prettyPrintURI(propertyURI) + "') with an enumeration value that is non-conform to the domain specification.", dsPath, dataPath));
            //return true, else the 505 "Non-conform range" error is also triggered
            return true;
        }
    }
    return false;
}

function checkMatch_standardClass(dataObj, dsObj, dataGraph, dsGraph, dataPath, dsPath, errorArray) {
    //has non-enumeration types in "sh:class", has no "sh:node" property
    if (dsObj["sh:in"] === undefined && dsObj["sh:node"] === undefined && Array.isArray(dsObj["sh:class"]) && dataObj.type !== "literal") {
        //check every entry in "sh:class"
        for (let i = 0; i < dsObj["sh:class"].length; i++) {
            if (!check_isValidSDOClass(dsObj["sh:class"][i])) {
                return false;
            }
        }
        //at this point the class(es) is a confirmed standard class definition
        //dataObj must be object, with all the types defined in sh:class
        let targetObj = copyByVal(VUT.resolvePath_dataGraph(dataGraph, [dataObj.value]));
        if (VUT.isObject(targetObj) && targetObj["@type"] !== undefined && checkTypesMatch(dsObj["sh:class"], targetObj["@type"])) {
            return true;
        }
    }
    return false;
}

function checkMatch_restrictedClass(dataObj, dsObj, dataGraph, dsGraph, dataPath, dsPath, errorArray) {
    //ds must have sh:node(which holds an @id of the nodeShape) and sh:class
    if (Array.isArray(dsObj["sh:class"]) && VUT.isString(dsObj["sh:node"]) && !dsObj["sh:in"] && dataObj.type !== "literal") {
        //ann is an object with @type that matches sh:class of ds
        //target must be an object
        let targetObj = copyByVal(VUT.resolvePath_dataGraph(dataGraph, [dataObj.value]));
        let newDataPath = copyByVal(dataPath);
        newDataPath.push(dataObj.value);
        if (VUT.isObject(targetObj) && Array.isArray(targetObj["@type"]) && !check_isValidSDOEnumeration(targetObj["@type"][0]) && checkTypesMatch(targetObj["@type"], dsObj["sh:class"])) {
            //types matched -> start recursive check
            validateClass(dataGraph, dsGraph, newDataPath, dsPath.concat("/" + VUT.stringifyTypeForPath(dsObj["sh:class"])), errorArray);
            return true;
        }
    }
    return false;
}

/**
 * Returns true if the dataObj (value) matches a given data type definition (DS)
 * @param {object} dsObj - the DS range definition
 * @param {object} dataObj - the range value (in object format)
 * @param {string} dataPath
 * @param {array} dsPath
 * @param {array} errorArray
 * @returns {boolean} - returns true if the dataObj (value) matches a given data type definition (DS)
 */
function checkMatch_dataType(dataObj, dsObj, dataPath, dsPath, errorArray) {
    //  Example data type format
    // {
    //     "xml:lang": "en",
    //     "type": "literal",
    //     "value": "Skischule \"Mayrhofen 3000\""
    // }
    // The values seem to be always strings
    if (VUT.isObject(dataObj) && dataObj.type === "literal") {
        try {
            if (VUT.isString(dsObj["sh:datatype"]) && dsObj["sh:datatype"].startsWith("xsd:")) {
                switch (dsObj["sh:datatype"].substring("xsd:".length)) {
                    //note: for the compliance check we should check the "intended" data type the user was using,
                    //so it is better to not be too strict about specific formats
                    case "string":
                        if (VUT.isString(dataObj.value)) {
                            //since the values are always strings...
                            if (dsObj["sh:maxLength"]) {
                                if (!check_shMaxLength(dataObj.value, dsObj["sh:maxLength"])) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 511, "Non-conform sh:maxLength", "The data graph has a string value with a length that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minLength"]) {
                                if (!check_shMinLength(dataObj.value, dsObj["sh:minLength"])) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 512, "Non-conform sh:minLength", "The data graph has a string value with a length that is lesser than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:pattern"]) {
                                if (!check_shPattern(dataObj.value, dsObj["sh:pattern"])) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 513, "Non-conform sh:pattern", "The data graph has a string value that does not match the Regex pattern specified by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:languageIn"]) {
                                if (!check_shLanguageIn(dataObj["xml:lang"], dsObj["sh:languageIn"])) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 514, "Non-conform sh:languageIn", "The data graph has a string value that does not match any of the language tags specified by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    case "boolean":
                        return (dataObj.value === "true" || dataObj.value === "false");
                    case "date":
                        let dateObj = genDateObj(dataObj.value);
                        if (dateObj !== false) {
                            if (dsObj["sh:minExclusive"]) {
                                if (!check_shMinExclusive(dateObj, dsObj["sh:minExclusive"], "date")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 521, "Non-conform sh:minExclusive", "The data graph has a date value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minInclusive"]) {
                                if (!check_shMinInclusive(dateObj, dsObj["sh:minInclusive"], "date")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 522, "Non-conform sh:minInclusive", "The data graph has a date value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxExclusive"]) {
                                if (!check_shMaxExclusive(dateObj, dsObj["sh:maxExclusive"], "date")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 523, "Non-conform sh:maxExclusive", "The data graph has a date value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxInclusive"]) {
                                if (!check_shMaxInclusive(dateObj, dsObj["sh:maxInclusive"], "date")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 524, "Non-conform sh:maxInclusive", "The data graph has a date value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    case "dateTime":
                        //https://schema.org/DateTime
                        //https://momentjs.com/docs/#/parsing/string-format/
                        //return moment(dataObj.value, moment.ISO_8601, true).isValid();
                        let dateTimeObj = genDateTimeObj(dataObj.value);
                        if (dateTimeObj !== false) {
                            if (dsObj["sh:minExclusive"]) {
                                if (!check_shMinExclusive(dateTimeObj, dsObj["sh:minExclusive"], "dateTime")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 521, "Non-conform sh:minExclusive", "The data graph has a dateTime value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minInclusive"]) {
                                if (!check_shMinInclusive(dateTimeObj, dsObj["sh:minInclusive"], "dateTime")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 522, "Non-conform sh:minInclusive", "The data graph has a dateTime value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxExclusive"]) {
                                if (!check_shMaxExclusive(dateTimeObj, dsObj["sh:maxExclusive"], "dateTime")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 523, "Non-conform sh:maxExclusive", "The data graph has a dateTime value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxInclusive"]) {
                                if (!check_shMaxInclusive(dateTimeObj, dsObj["sh:maxInclusive"], "dateTime")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 524, "Non-conform sh:maxInclusive", "The data graph has a dateTime value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    case "time":
                        let timeObj = genTimeObj(dataObj.value);
                        if (timeObj !== false) {
                            if (dsObj["sh:minExclusive"]) {
                                if (!check_shMinExclusive(timeObj, dsObj["sh:minExclusive"], "time")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 521, "Non-conform sh:minExclusive", "The data graph has a time value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minInclusive"]) {
                                if (!check_shMinInclusive(timeObj, dsObj["sh:minInclusive"], "time")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 522, "Non-conform sh:minInclusive", "The data graph has a time value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxExclusive"]) {
                                if (!check_shMaxExclusive(timeObj, dsObj["sh:maxExclusive"], "time")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 523, "Non-conform sh:maxExclusive", "The data graph has a time value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxInclusive"]) {
                                if (!check_shMaxInclusive(timeObj, dsObj["sh:maxInclusive"], "time")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 524, "Non-conform sh:maxInclusive", "The data graph has a time value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    case "double":
                        let doubleVal = Number(dataObj.value);
                        let isDouble = VUT.isNumber(doubleVal);
                        if (isDouble) {
                            if (dsObj["sh:minExclusive"]) {
                                if (!check_shMinExclusive(doubleVal, dsObj["sh:minExclusive"], "double")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 521, "Non-conform sh:minExclusive", "The data graph has a numeric value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minInclusive"]) {
                                if (!check_shMinInclusive(doubleVal, dsObj["sh:minInclusive"], "double")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 522, "Non-conform sh:minInclusive", "The data graph has a numeric value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxExclusive"]) {
                                if (!check_shMaxExclusive(doubleVal, dsObj["sh:maxExclusive"], "double")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 523, "Non-conform sh:maxExclusive", "The data graph has a numeric value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxInclusive"]) {
                                if (!check_shMaxInclusive(doubleVal, dsObj["sh:maxInclusive"], "double")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 524, "Non-conform sh:maxInclusive", "The data graph has a numeric value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    case "float":
                        let floatVal = Number(dataObj.value);
                        let isFloat = VUT.isNumber(floatVal);
                        if (isFloat) {
                            if (dsObj["sh:minExclusive"]) {
                                if (!check_shMinExclusive(floatVal, dsObj["sh:minExclusive"], "float")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 521, "Non-conform sh:minExclusive", "The data graph has a numeric value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minInclusive"]) {
                                if (!check_shMinInclusive(floatVal, dsObj["sh:minInclusive"], "float")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 522, "Non-conform sh:minInclusive", "The data graph has a numeric value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxExclusive"]) {
                                if (!check_shMaxExclusive(floatVal, dsObj["sh:maxExclusive"], "float")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 523, "Non-conform sh:maxExclusive", "The data graph has a numeric value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxInclusive"]) {
                                if (!check_shMaxInclusive(floatVal, dsObj["sh:maxInclusive"], "float")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 524, "Non-conform sh:maxInclusive", "The data graph has a numeric value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    case "integer":
                        let intVal = Number(dataObj.value);
                        let isInt = Number.isInteger(intVal);
                        if (isInt) {
                            if (dsObj["sh:minExclusive"]) {
                                if (!check_shMinExclusive(intVal, dsObj["sh:minExclusive"], "integer")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 521, "Non-conform sh:minExclusive", "The data graph has a numeric value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minInclusive"]) {
                                if (!check_shMinInclusive(intVal, dsObj["sh:minInclusive"], "integer")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 522, "Non-conform sh:minInclusive", "The data graph has a numeric value that is smaller than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxExclusive"]) {
                                if (!check_shMaxExclusive(intVal, dsObj["sh:maxExclusive"], "integer")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 523, "Non-conform sh:maxExclusive", "The data graph has a numeric value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:maxInclusive"]) {
                                if (!check_shMaxInclusive(intVal, dsObj["sh:maxInclusive"], "integer")) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 524, "Non-conform sh:maxInclusive", "The data graph has a numeric value that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    case "anyURI":
                        let isAnyURI = VUT.isUrl(dataObj.value);
                        if (isAnyURI) {
                            if (dsObj["sh:maxLength"]) {
                                if (!check_shMaxLength(dataObj.value, dsObj["sh:maxLength"])) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 511, "Non-conform sh:maxLength", "The data graph has a string value with a length that is greater than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:minLength"]) {
                                if (!check_shMinLength(dataObj.value, dsObj["sh:minLength"])) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 512, "Non-conform sh:minLength", "The data graph has a string value with a length that is lesser than allowed by the domain specification.", dsPath, dataPath));
                                }
                            }
                            if (dsObj["sh:pattern"]) {
                                if (!check_shPattern(dataObj.value, dsObj["sh:pattern"])) {
                                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 513, "Non-conform sh:pattern", "The data graph has a string value that does not match the Regex pattern specified by the domain specification.", dsPath, dataPath));
                                }
                            }
                            return true;
                        } else {
                            return false;
                        }
                    default:
                        //meta error
                        console.log("Error data type definition is not a valid one");
                        errorArray.push(new ErrorEntry("MetaError", "Critical", 400, "DS Meta Error", "The given domain specification includes a data type definition that is not valid: " + dsObj["sh:datatype"], dsPath, dataPath));
                }
            }
        } catch (e) {
            //execution error
            console.log(e);
            errorArray.push(new ErrorEntry("ExecutionError", "Critical", 999, "Execution Error", "There was an error during the verification process, make sure the sent data graph and domain specification have a valid serialization.", dsPath, dataPath));
        }
    }
    return false;
}

/**
 * checks the given max length of a given string (sh:maxLength)
 * @param {string} string - the string to check
 * @param {number} maxLength - the maximum length of the string
 * @return {boolean} returns false if the length of the string is greater than allowed
 */
function check_shMaxLength(string, maxLength) {
    return (VUT.isString(string) && string.length <= maxLength);
}

/**
 * checks the given min length of a given string (sh:minLength)
 * @param {string} string - the string to check
 * @param {number} minLength - the minimum length of the string
 * @return {boolean} returns false if the length of the string is less than allowed
 */
function check_shMinLength(string, minLength) {
    return (VUT.isString(string) && string.length >= minLength);
}

/**
 * checks if a given string matches a given regex pattern (sh:pattern)
 * @param {string} string - the string to check
 * @param {string} regexPattern - the regex pattern to check
 * @return {boolean} returns true if string matches the pattern
 */
function check_shPattern(string, regexPattern) {
    let reg = new RegExp(regexPattern);
    return (VUT.isString(string) && reg.test(string));
}

/**
 * checks if a given language Tag is in the allowed array of language Tags
 * @param {string} languageTag - the language Tag to check
 * @param {array} languageTagArray - array of language tags (strings)
 * @return {boolean} returns true if given language Tag is in the allowed array of language Tags
 */
function check_shLanguageIn(languageTag, languageTagArray) {
    return languageTagArray.includes(languageTag);
}

/**
 * checks if string ranges from a given valuesArray use the same language tag
 */
function check_shUniqueLang(actualRangesArray, dsRangesAllowed, dataPath, dsPath, errorArray) {
    for (let i = 0; i < dsRangesAllowed.length; i++) {
        if (dsRangesAllowed[i]["sh:uniqueLang"] === true) {
            let seenLanguages = [];
            for (let i = 0; i < actualRangesArray.length; i++) {
                if (actualRangesArray[i].type === "literal" && actualRangesArray[i]["xml:lang"]) {
                    if (seenLanguages.includes(actualRangesArray[i]["xml:lang"])) {
                        //already seen
                        errorArray.push(new ErrorEntry("ComplianceError", "Error", 515, "Non-conform sh:uniqueLang", "The data graph has a property with multiple string values that use the same language tag, which is not allowed by the domain specification.", dsPath, dataPath));
                        return;
                    } else {
                        seenLanguages.push(actualRangesArray[i]["xml:lang"]);
                    }
                }
            }
        }
    }
}

/**
 * checks if the given value is greater than the given minimum exclusive (sh:minExclusive)
 * @param {number|date|time|dateTime} value - the value to check
 * @param {number|date|time|dateTime} minExclusive - the minimum exclusive value that is allowed
 * @param {string} dataType - the supposed data type of the value to check
 * @return {boolean} returns true if the given value is greater than the given minimum exclusive
 */
function check_shMinExclusive(value, minExclusive, dataType) {
    if (dataType === "double" || dataType === "float" || dataType === "integer") {
        return (VUT.isNumber(value) && value > minExclusive);
    }
    if (dataType === "time") {
        let minTimeObj = genTimeObj(minExclusive);
        if (minTimeObj !== false && minTimeObj.isValid()) {
            return value.isAfter(minTimeObj);
        }
    }
    if (dataType === "date") {
        let minDateObj = genDateObj(minExclusive);
        if (minDateObj !== false && minDateObj.isValid()) {
            return value.isAfter(minDateObj);
        }
    }
    if (dataType === "dateTime") {
        let minDateTimeObj = genDateTimeObj(minExclusive);
        if (minDateTimeObj !== false && minDateTimeObj.isValid()) {
            return value.isAfter(minDateTimeObj);
        }
    }
    return false; //returns false if the value could not been parsed into the expected format
}


/**
 * checks if the given value is greater than or equal to the given minimum inclusive (sh:minInclusive)
 * @param {number} value - the value to check
 * @param {number} minInclusive - the minimum inclusive value that is allowed
 * @param {string} dataType - the supposed data type of the value to check
 * @return {boolean} returns true if the given value is greater than or equal to the given minimum inclusive
 */
function check_shMinInclusive(value, minInclusive, dataType) {
    if (dataType === "double" || dataType === "float" || dataType === "integer") {
        return (VUT.isNumber(value) && value >= minInclusive);
    }
    if (dataType === "time") {
        let minTimeObj = genTimeObj(minInclusive);
        if (minTimeObj !== false && minTimeObj.isValid()) {
            return value.isSameOrAfter(minTimeObj);
        }
    }
    if (dataType === "date") {
        let minDateObj = genDateObj(minInclusive);
        if (minDateObj !== false && minDateObj.isValid()) {
            return value.isSameOrAfter(minDateObj);
        }
    }
    if (dataType === "dateTime") {
        let minDateTimeObj = genDateTimeObj(minInclusive);
        if (minDateTimeObj !== false && minDateTimeObj.isValid()) {
            return value.isSameOrAfter(minDateTimeObj);
        }
    }
    return false; //returns false if the value could not been parsed into the expected format
}

/**
 * checks if the given value is smaller than the given maximum exclusive (sh:maxExclusive)
 * @param {number} value - the value to check
 * @param {number} maxExclusive - the maximum exclusive value that is allowed
 * @param {string} dataType - the supposed data type of the value to check
 * @return {boolean} returns true if the given value is smaller than the given maximum exclusive
 */
function check_shMaxExclusive(value, maxExclusive, dataType) {
    if (dataType === "double" || dataType === "float" || dataType === "integer") {
        return (VUT.isNumber(value) && value < maxExclusive);
    }
    if (dataType === "time") {
        let minTimeObj = genTimeObj(maxExclusive);
        if (minTimeObj !== false && minTimeObj.isValid()) {
            return value.isBefore(minTimeObj);
        }
    }
    if (dataType === "date") {
        let minDateObj = genDateObj(maxExclusive);
        if (minDateObj !== false && minDateObj.isValid()) {
            return value.isBefore(minDateObj);
        }
    }
    if (dataType === "dateTime") {
        let minDateTimeObj = genDateTimeObj(maxExclusive);
        if (minDateTimeObj !== false && minDateTimeObj.isValid()) {
            return value.isBefore(minDateTimeObj);
        }
    }
    return false; //returns false if the value could not been parsed into the expected format
}

/**
 * checks if the given value is smaller than or equal to the given minimum inclusive (sh:maxInclusive)
 * @param {number} value - the value to check
 * @param {number} maxInclusive - the maximum inclusive value that is allowed
 * @param {string} dataType - the supposed data type of the value to check
 * @return {boolean} returns true if the given value is smaller than or equal to the given maximum inclusive
 */
function check_shMaxInclusive(value, maxInclusive, dataType) {
    if (dataType === "double" || dataType === "float" || dataType === "integer") {
        return (VUT.isNumber(value) && value <= maxInclusive);
    }
    if (dataType === "time") {
        let minTimeObj = genTimeObj(maxInclusive);
        if (minTimeObj !== false && minTimeObj.isValid()) {
            return value.isSameOrBefore(minTimeObj);
        }
    }
    if (dataType === "date") {
        let minDateObj = genDateObj(maxInclusive);
        if (minDateObj !== false && minDateObj.isValid()) {
            return value.isSameOrBefore(minDateObj);
        }
    }
    if (dataType === "dateTime") {
        let minDateTimeObj = genDateTimeObj(maxInclusive);
        if (minDateTimeObj !== false && minDateTimeObj.isValid()) {
            return value.isSameOrBefore(minDateTimeObj);
        }
    }
    return false; //returns false if the value could not been parsed into the expected format
}

function check_shIn(dataRangesToCheck, actualDsProperty, dataPath, dsPath, errorArray) {
    if (Array.isArray(actualDsProperty["sh:in"])) {
        //values of sh:in expected to be any of multiple data types. values of the dataObj.value expected to be string
        let transformedValues = [];
        for (let i = 0; i < actualDsProperty["sh:in"].length; i++) {
            transformedValues.push(String(actualDsProperty["sh:in"][i]));
        }
        for (let j = 0; j < dataRangesToCheck.length; j++) {
            if (dataRangesToCheck[j].type !== "literal" || !transformedValues.includes(dataRangesToCheck[j].value)) {
                errorArray.push(new ErrorEntry("ComplianceError", "Error", 535, "Non-conform sh:in", "The data graph has a literal value that does not match any of the allowed values specified by the domain specification.", dsPath, dataPath));
            }
        }
    }
}

function check_shHasValue(dataRangesToCheck, actualDsProperty, dataPath, dsPath, errorArray) {
    if (actualDsProperty["sh:hasValue"] !== undefined) {
        //values of sh:hasValue expected to be from one of multiple data types. values of the dataObj.value expected to be string
        let foundValue = false;
        for (let j = 0; j < dataRangesToCheck.length; j++) {
            if (dataRangesToCheck[j].type === "literal" && dataRangesToCheck[j].value === String(actualDsProperty["sh:hasValue"])) {
                foundValue = true;
            }
        }
        if (!foundValue) {
            errorArray.push(new ErrorEntry("ComplianceError", "Error", 536, "Non-conform sh:hasValue", "The data graph is missing a literal value that is specified as mandatory by the domain specification.", dsPath, dataPath));
        }
    }
}

function check_shEquals(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray) {
    if (actualDsProperty["sh:equals"] !== undefined) {
        //get data by reusing the actual datapath, substitute the last part of the path with the target property
        let foreignTargetPath = copyByVal(dataPath);
        foreignTargetPath.pop();
        foreignTargetPath.push(actualDsProperty["sh:equals"]);
        let foundError = false;
        let foreignRangesArray;
        try {
            foreignRangesArray = VUT.resolvePath_dataGraph(dataGraph, foreignTargetPath);
        } catch (e) {
            //the target property is not being used -> generates error for sh:equals
            foundError = true;
        }
        //every value of each array must be a literal and must be present in the other array
        let valuesLocalProp = [];
        if (!foundError) {
            for (let j = 0; j < dataRangesToCheck.length; j++) {
                if (dataRangesToCheck[j].type !== "literal") {
                    foundError = true;
                    break;
                }
                valuesLocalProp.push(dataRangesToCheck[j].value);
            }
        }
        let valuesForeignProp = [];
        if (!foundError) {
            for (let i = 0; i < foreignRangesArray.length; i++) {
                if (foreignRangesArray[i].type !== "literal") {
                    foundError = true;
                    break;
                }
                valuesForeignProp.push(foreignRangesArray[i].value);
            }
        }
        if (!foundError) {
            for (let i = 0; i < valuesLocalProp.length; i++) {
                if (!valuesForeignProp.includes(valuesLocalProp[i])) {
                    foundError = true;
                    break;
                }
            }
        }
        if (!foundError) {
            for (let i = 0; i < valuesForeignProp.length; i++) {
                if (!valuesLocalProp.includes(valuesForeignProp[i])) {
                    foundError = true;
                    break;
                }
            }
        }
        if (foundError) {
            errorArray.push(new ErrorEntry("ComplianceError", "Error", 531, "Non-conform sh:equals", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with values that are not equal to the values of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:equals"]) + "') as specified by the domain specification.", dsPath, dataPath));
        }
    }
}

function check_shDisjoint(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray) {
    if (actualDsProperty["sh:disjoint"] !== undefined) {
        //get data by reusing the actual datapath, substitute the last part of the path with the target property
        let foreignTargetPath = copyByVal(dataPath);
        foreignTargetPath.pop();
        foreignTargetPath.push(actualDsProperty["sh:disjoint"]);
        let foundError = false;
        let foreignRangesArray;
        try {
            foreignRangesArray = VUT.resolvePath_dataGraph(dataGraph, foreignTargetPath);
        } catch (e) {
            //the target property is not being used -> generates no error for sh:disjoint
            return;
        }
        //every value of each array that is a literal must not be present in the other array
        let valuesLocalProp = [];
        if (!foundError) {
            for (let j = 0; j < dataRangesToCheck.length; j++) {
                if (dataRangesToCheck[j].type === "literal") {
                    valuesLocalProp.push(dataRangesToCheck[j].value);
                }
            }
        }
        let valuesForeignProp = [];
        if (!foundError) {
            for (let i = 0; i < foreignRangesArray.length; i++) {
                if (foreignRangesArray[i].type === "literal") {
                    valuesForeignProp.push(foreignRangesArray[i].value);
                }

            }
        }
        if (!foundError) {
            for (let i = 0; i < valuesLocalProp.length; i++) {
                if (valuesForeignProp.includes(valuesLocalProp[i])) {
                    foundError = true;
                    break;
                }
            }
        }
        if (!foundError) {
            for (let i = 0; i < valuesForeignProp.length; i++) {
                if (valuesLocalProp.includes(valuesForeignProp[i])) {
                    foundError = true;
                    break;
                }
            }
        }
        if (foundError) {
            errorArray.push(new ErrorEntry("ComplianceError", "Error", 532, "Non-conform sh:disjoint", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with values that are not disjoint to the values of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:disjoint"]) + "') as specified by the domain specification.", dsPath, dataPath));
        }
    }
}

function check_shLessThan(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray) {
    if (actualDsProperty["sh:lessThan"] !== undefined) {
        //get data by reusing the actual datapath, substitute the last part of the path with the target property
        let foreignTargetPath = copyByVal(dataPath);
        foreignTargetPath.pop();
        foreignTargetPath.push(actualDsProperty["sh:lessThan"]);
        let foreignRangesArray;
        try {
            foreignRangesArray = VUT.resolvePath_dataGraph(dataGraph, foreignTargetPath);
        } catch (e) {
            //the target property is not being used -> does not generate error for sh:lessThan
            return;
        }
        /*
        there are 2 arrays with values to compare. These values can be from 4 different categories (values can only be compared with other values from the same category):
            1. Numbers (double, float, integer)
            2. Times (time)
            3. Dates (date, dateTime)
            4. Strings (string and its subtypes)
         */
        let valuesLocalProp_Numbers = []; //values pushed into this array are double-numbers
        let valuesLocalProp_Times = []; //values pushed into this array are moment-objects for time
        let valuesLocalProp_Dates = []; //values pushed into this array are moment-objects for date/dateTime
        let valuesLocalProp_Strings = []; //values pushed into this array are strings
        let valuesForeignProp_Numbers = [];  //values pushed into this array are double-numbers
        let valuesForeignProp_Times = []; //values pushed into this array are moment-objects for time
        let valuesForeignProp_Dates = []; //values pushed into this array are moment-objects for date/dateTime
        let valuesForeignProp_Strings = []; //values pushed into this array are strings

        //categorize the values from the first property
        for (let j = 0; j < dataRangesToCheck.length; j++) {
            if (dataRangesToCheck[j].type !== "literal") {
                continue; //skip the objects
            }
            //check value is a number
            let val_Number = Number(dataRangesToCheck[j].value);
            if (VUT.isNumber(val_Number)) {
                valuesLocalProp_Numbers.push(val_Number);
                continue;
            }
            //check value is a time
            let val_time = genTimeObj(dataRangesToCheck[j].value);
            if (val_time !== false) {
                valuesLocalProp_Times.push(val_time);
                continue;
            }
            //check value is a date
            let val_date = genDateObj(dataRangesToCheck[j].value);
            if (val_date !== false) {
                valuesLocalProp_Dates.push(val_date);
                continue;
            }
            let val_dateTime = genDateTimeObj(dataRangesToCheck[j].value);
            if (val_dateTime !== false) {
                valuesLocalProp_Dates.push(val_dateTime);
                continue;
            }
            //else view the value as a string
            valuesLocalProp_Strings.push(dataRangesToCheck[j].value);
        }

        //categorize the values from the second property
        for (let j = 0; j < foreignRangesArray.length; j++) {
            if (foreignRangesArray[j].type !== "literal") {
                continue; //skip the objects
            }
            //check value is a number
            let val_Number = Number(foreignRangesArray[j].value);
            if (VUT.isNumber(val_Number)) {
                valuesForeignProp_Numbers.push(val_Number);
                continue;
            }
            //check value is a time
            let val_time = genTimeObj(foreignRangesArray[j].value);
            if (val_time !== false) {
                valuesForeignProp_Times.push(val_time);
                continue;
            }
            //check value is a date
            let val_date = genDateObj(foreignRangesArray[j].value);
            if (val_date !== false) {
                valuesForeignProp_Dates.push(val_date);
                continue;
            }
            let val_dateTime = genDateTimeObj(foreignRangesArray[j].value);
            if (val_dateTime !== false) {
                valuesForeignProp_Dates.push(val_dateTime);
                continue;
            }
            //else view the value as a string
            valuesForeignProp_Strings.push(foreignRangesArray[j].value);
        }

        //compare the local and foreign values, based on their categories
        //Numbers
        for (let i = 0; i < valuesLocalProp_Numbers.length; i++) {
            for (let j = 0; j < valuesForeignProp_Numbers.length; j++) {
                if (valuesLocalProp_Numbers[i] >= valuesForeignProp_Numbers[j]) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 533, "Non-conform sh:lessThan", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a numeric value that is not less than the numeric value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThan"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
        //Times
        for (let i = 0; i < valuesLocalProp_Times.length; i++) {
            for (let j = 0; j < valuesForeignProp_Times.length; j++) {
                if (valuesLocalProp_Times[i].isSameOrAfter(valuesForeignProp_Times[j])) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 533, "Non-conform sh:lessThan", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a time value that is not less than the time value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThan"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
        //Dates
        for (let i = 0; i < valuesLocalProp_Dates.length; i++) {
            for (let j = 0; j < valuesForeignProp_Dates.length; j++) {
                if (valuesLocalProp_Dates[i].isSameOrAfter(valuesForeignProp_Dates[j])) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 533, "Non-conform sh:lessThan", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a date value that is not less than the date value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThan"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
        //String
        for (let i = 0; i < valuesLocalProp_Strings.length; i++) {
            for (let j = 0; j < valuesForeignProp_Strings.length; j++) {
                if (valuesLocalProp_Strings[i] >= valuesForeignProp_Strings[j]) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 533, "Non-conform sh:lessThan", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a string value that is not less than the string value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThan"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
    }
}

function check_shLessThanOrEquals(dataRangesToCheck, actualDsProperty, dataGraph, dataPath, dsPath, errorArray) {
    if (actualDsProperty["sh:lessThanOrEquals"] !== undefined) {
        //get data by reusing the actual datapath, substitute the last part of the path with the target property
        let foreignTargetPath = copyByVal(dataPath);
        foreignTargetPath.pop();
        foreignTargetPath.push(actualDsProperty["sh:lessThanOrEquals"]);
        let foreignRangesArray;
        try {
            foreignRangesArray = VUT.resolvePath_dataGraph(dataGraph, foreignTargetPath);
        } catch (e) {
            //the target property is not being used -> does not generate error for sh:lessThan
            return;
        }
        /*
        there are 2 arrays with values to compare. These values can be from 4 different categories (values can only be compared with other values from the same category):
            1. Numbers (double, float, integer)
            2. Times (time)
            3. Dates (date, dateTime)
            4. Strings (string and its subtypes)
         */
        let valuesLocalProp_Numbers = []; //values pushed into this array are double-numbers
        let valuesLocalProp_Times = []; //values pushed into this array are moment-objects for time
        let valuesLocalProp_Dates = []; //values pushed into this array are moment-objects for date/dateTime
        let valuesLocalProp_Strings = []; //values pushed into this array are strings
        let valuesForeignProp_Numbers = [];  //values pushed into this array are double-numbers
        let valuesForeignProp_Times = []; //values pushed into this array are moment-objects for time
        let valuesForeignProp_Dates = []; //values pushed into this array are moment-objects for date/dateTime
        let valuesForeignProp_Strings = []; //values pushed into this array are strings

        //categorize the values from the first property
        for (let j = 0; j < dataRangesToCheck.length; j++) {
            if (dataRangesToCheck[j].type !== "literal") {
                continue; //skip the objects
            }
            //check value is a number
            let val_Number = Number(dataRangesToCheck[j].value);
            if (VUT.isNumber(val_Number)) {
                valuesLocalProp_Numbers.push(val_Number);
                continue;
            }
            //check value is a time
            let val_time = genTimeObj(dataRangesToCheck[j].value);
            if (val_time !== false) {
                valuesLocalProp_Times.push(val_time);
                continue;
            }
            //check value is a date
            let val_date = genDateObj(dataRangesToCheck[j].value);
            if (val_date !== false) {
                valuesLocalProp_Dates.push(val_date);
                continue;
            }
            let val_dateTime = genDateTimeObj(dataRangesToCheck[j].value);
            if (val_dateTime !== false) {
                valuesLocalProp_Dates.push(val_dateTime);
                continue;
            }
            //else view the value as a string
            valuesLocalProp_Strings.push(dataRangesToCheck[j].value);
        }

        //categorize the values from the second property
        for (let j = 0; j < foreignRangesArray.length; j++) {
            if (foreignRangesArray[j].type !== "literal") {
                continue; //skip the objects
            }
            //check value is a number
            let val_Number = Number(foreignRangesArray[j].value);
            if (VUT.isNumber(val_Number)) {
                valuesForeignProp_Numbers.push(val_Number);
                continue;
            }
            //check value is a time
            let val_time = genTimeObj(foreignRangesArray[j].value);
            if (val_time !== false) {
                valuesForeignProp_Times.push(val_time);
                continue;
            }
            //check value is a date
            let val_date = genDateObj(foreignRangesArray[j].value);
            if (val_date !== false) {
                valuesForeignProp_Dates.push(val_date);
                continue;
            }
            let val_dateTime = genDateTimeObj(foreignRangesArray[j].value);
            if (val_dateTime !== false) {
                valuesForeignProp_Dates.push(val_dateTime);
                continue;
            }
            //else view the value as a string
            valuesForeignProp_Strings.push(foreignRangesArray[j].value);
        }

        //compare the local and foreign values, based on their categories
        //Numbers
        for (let i = 0; i < valuesLocalProp_Numbers.length; i++) {
            for (let j = 0; j < valuesForeignProp_Numbers.length; j++) {
                if (valuesLocalProp_Numbers[i] > valuesForeignProp_Numbers[j]) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 534, "Non-conform sh:lessThanOrEquals", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a numeric value that is not less than or equal to the numeric value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThanOrEquals"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
        //Times
        for (let i = 0; i < valuesLocalProp_Times.length; i++) {
            for (let j = 0; j < valuesForeignProp_Times.length; j++) {
                if (valuesLocalProp_Times[i].isAfter(valuesForeignProp_Times[j])) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 534, "Non-conform sh:lessThanOrEquals", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a time value that is not less than or equal to the time value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThanOrEquals"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
        //Dates
        for (let i = 0; i < valuesLocalProp_Dates.length; i++) {
            for (let j = 0; j < valuesForeignProp_Dates.length; j++) {
                if (valuesLocalProp_Dates[i].isAfter(valuesForeignProp_Dates[j])) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 534, "Non-conform sh:lessThanOrEquals", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a date value that is not less than or equal to the date value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThanOrEquals"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
        //String
        for (let i = 0; i < valuesLocalProp_Strings.length; i++) {
            for (let j = 0; j < valuesForeignProp_Strings.length; j++) {
                if (valuesLocalProp_Strings[i] > valuesForeignProp_Strings[j]) {
                    errorArray.push(new ErrorEntry("ComplianceError", "Error", 534, "Non-conform sh:lessThanOrEquals", "The data graph has a property ('" + VUT.prettyPrintURI(actualDsProperty['sh:path']) + "') with a string value that is not less than or equal to the string value of another property ('" + VUT.prettyPrintURI(actualDsProperty["sh:lessThanOrEquals"]) + "') as specified by the domain specification.", dsPath, dataPath));
                }
            }
        }
    }
}

//https://en.wikipedia.org/wiki/ISO_8601#Dates
//returns the valid date Moment object if accepted, returns false if not valid
function genDateTimeObj(val) {
    let validFormats = ["YYYY-MM-DDTHH:mm:ss.SZ", "YYYY-MM-DDTHH:mm:ssZ", "YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm:ss.S"];
    for (let i = 0; i < validFormats.length; i++) {
        let dateTimeObj = moment(val, validFormats[i], false);
        if (dateTimeObj.isValid()) {
            return dateTimeObj;
        }
    }
    return false;
}

//https://en.wikipedia.org/wiki/ISO_8601#Dates
//returns the valid date Moment object if accepted, returns false if not valid
function genDateObj(val) {
    let validFormats = [
        "YYYY-MM-DD", "YYYYMMDD", "YYYY-MM", "--MM-DD", "--MMDD"
    ];
    for (let i = 0; i < validFormats.length; i++) {
        let momentObj = moment(val, validFormats[i], true);
        if (momentObj.isValid()) {
            return momentObj;
        }
    }
    return false;
}

//https://schema.org/Time (we allow to omit the seconds)
//https://www.w3.org/TR/xmlschema-2/#isoformats
//returns the valid time Moment object if accepted, returns false if not valid
function genTimeObj(val) {
    let validFormats = ["HH:mm:ss.SSSZ", "HH:mm:ss.SSS","HH:mm:ssZ", "HH:mm:ss", "HH:mmZ", "HH:mm"];
    for (let i = 0; i < validFormats.length; i++) {
        let timeObj = moment(val, validFormats[i], true);
        if (timeObj.isValid()) {
            return timeObj;
        }
    }
    return false;
}


//checks if a value is a class conform to sdo
function check_isValidSDOClass(value) {
    try {
        mySdoAdapter.getClass(value, {"termType": "Class"});
        return true;
    } catch (e) {
        //no valid class
        return false;
    }
}

//checks if a value is a enumeration conform to sdo
function check_isValidSDOEnumeration(value) {
    try {
        mySdoAdapter.getEnumeration(value, {"termType": "Enumeration"});
        return true;
    } catch (e) {
        //no valid class
        return false;
    }
}

//checks if a value is a enumeration member conform to sdo
function check_isValidSDOEnumerationMember(value) {
    try {
        mySdoAdapter.getEnumerationMember(value);
        return true;
    } catch (e) {
        //no valid class
        return false;
    }
}

module.exports = {
    isGraphValidAgainstDomainSpecification
};