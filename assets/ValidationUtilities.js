function isObject(object) {
    if (Array.isArray(object)) {
        return false;
    }
    if (object === undefined || object === null) {
        return false;
    }
    return typeof object === 'object';
}

function isString(object) {
    if (object === undefined || object === null) {
        return false;
    }
    return typeof object === 'string' || object instanceof String;
}

function isNumber(object) {
    if (object === undefined || object === null || Number.isNaN(object)) {
        return false;
    }
    return typeof object === 'number';
}

function isUrl(s) {
    if (s.substring(0, 4) === "www.") {
        s = "http://".concat(s); //allow url without protocol
    }
    // let regex = new RegExp( /[-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?/gi );
    let regex = new RegExp(/^(?:(?:https?|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,}))\.?)(?::\d{2,5})?(?:[/?#]\S*)?$/i);
    let result = s.match(regex);
    if (result == null) {
        return false;
    }
    if (result.length == 1) {
        if (result[0].length == s.length) {
            return true;
        }
    }
    return false;
}

//returns the part of the data graph
function resolvePath_dataGraph(dataGraph, path) {
    //the path is an array, where it elements are either:
    //a. a URI, representing an entity
    //b. a blank node, representing an entity
    //c. a URI, representing a property
    //the elements in the path-array are ordered and consists of altering entity/property entries, starting with the root entity#
    //e.g. uri:entity1 , uri:property1, uri:entity2, uri:property2, blank:entity3, etc.
    //there should be a frontend version of this function because ->
    //since the this path is also used in the error report, its entries should "make sense" only having the original repository (no data graph with pre-processing)
    //that means that the path entries should be written without context (URIs in absolute form)
    if (!Array.isArray(dataGraph) && !isObject(dataGraph)) {
        throw new Error("Given dataGraph is not an Array or an Object.");
    }
    if (!Array.isArray(path) || path.length === 0) {
        throw new Error("Given path is not an Array.");
    }
    let actualEntity = dataGraph;
    for (let i = 0; i < path.length; i++) {
        let actualPathEntry = path[i];
        if (Array.isArray(actualEntity)) {
            //is array
            let foundRange = false;
            for (let k = 0; k < actualEntity.length; k++) {
                if (actualEntity[k].type === "uri" || actualEntity[k].type === "bnode") {
                    if (actualEntity[k].value === actualPathEntry) {
                        //uri or bnode should be in the dataGraph
                        foundRange = true;
                        actualEntity = dataGraph[actualPathEntry];
                        if (actualEntity === undefined) {
                            throw new Error("Given data path (entry " + actualPathEntry + ") is invalid for given dataGraph.");
                        }
                    }
                }
            }
            if (!foundRange) {
                throw new Error("Given data path (entry " + actualPathEntry + ") is invalid for given dataGraph.");
            }
        } else {
            //is object
            actualEntity = actualEntity[actualPathEntry];
            if (actualEntity === undefined) {
                throw new Error("Given data path (entry " + actualPathEntry + ") is invalid for given dataGraph.");
            }
        }
    }
    return actualEntity;
}


//returns the part of a ds object depending on the given path
//we assume that the dsPath is always given completely from the root (starts with "$")
function resolvePath_graphDS(graphDS, dsPath) {
    //dsPath has following format:
    //$ stands for the root
    //schema:Bakery stands for a class from the standard SDO vocab
    //schema:address stands for a property from the standard SDO vocab
    // _ is a delimiter between classes in a MTE class, e.g. "schema:Hotel_schema:Product"
    // . is a delimiter between a class and its property, e.g.  "schema:Hotel.schema:address"
    // / is a delimiter between a property and its range, e.g.  "schema:Hotel.schema:address/schema:PostalAddress"
    //$.schema:address/schema:PostalAddress.schema:addressRegion
    let foundDelimiter = true;
    let resultRef = {};
    try {
        do {
            //check property delimiter
            let bigTokens = dsPath.split("/");
            if (dsPath.startsWith("$")) { //start with root
                //assume that the first element of the graphDS is the root node
                //set that as the initial resultReference
                resultRef = graphDS[Object.keys(graphDS)[0]];
                dsPath = dsPath.substring(1); //trim dsPath from processed part
            } else if (dsPath.startsWith(".")) { //start with property
                let smallTokens = bigTokens[0].split(".");
                resultRef = resolvePathDS_graphProperty(graphDS, resultRef, smallTokens[1]); //smallTokens[1] is the next property URI, e.g. "schema:address"
                dsPath = dsPath.substring(smallTokens[1].length + 1);  //trim dsPath from processed part
            } else if (dsPath.startsWith("/")) { //start with range
                resultRef = resolvePathDS_graphRange(graphDS, resultRef, bigTokens[1].split(".")[0]); //bigTokens[1].split(".")[0] is the next range URI, e.g. "schema:PostalAddress"
                dsPath = dsPath.substring(bigTokens[1].split(".")[0].length + 1);  //trim dsPath from processed part
            } else {
                foundDelimiter = false;
            }
        } while (foundDelimiter);
        return resultRef;
    } catch (e) {
        console.log(e);
        console.log("dsPath: " + dsPath);
        return null;
    }
}

//returns the part of a given object that corresponds to the property definition given
// = looks for a given property inside the defined properties of a given class object
function resolvePathDS_graphProperty(graphDS, resultRef, propertyURI) {
    let propArray;
    if (resultRef["sh:targetClass"] !== undefined || resultRef["sh:targetSubjectOf"] !== undefined) { //is root class
        propArray = resultRef["sh:property"];
    } else {   //is not root class
        //resultRef["sh:node"] is a URI
        if (!resultRef["sh:node"] || !graphDS[resultRef["sh:node"]]["sh:property"]) {
            throw new Error("Path is invalid for the given Domain Specification."); //class has no properties defined
        }
        propArray = graphDS[resultRef["sh:node"]]["sh:property"];
        //propArray consists of node URIs for propertyShapes at this point
    }
    for (let i = 0; i < propArray.length; i++) {
        if (graphDS[propArray[i]] && graphDS[propArray[i]]["sh:path"] === propertyURI) {
            return graphDS[propArray[i]]; //return the propertyShape Object
        }
    }
    throw new Error("Path is invalid for the given Domain Specification."); //if no match was found
}

//returns the part of a given object that corresponds to the range definition given
// = looks for a given range inside the defined ranges of a given property object
function resolvePathDS_graphRange(graphDS, resultRef, rangeURI) {
    if (rangeURI.split("_").length > 1) {
        let classes = rangeURI.split("_");
        rangeURI = [];
        for (let j = 0; j < classes.length; j++) {
            rangeURI.push(classes[j]);
        }
    }
    let rangeArray = resultRef["sh:or"];
    //rangeArray consists of node URIs for range nodes at this point
    for (let i = 0; i < rangeArray.length; i++) {
        if (isString(rangeURI) && graphDS[rangeArray[i]] && graphDS[rangeArray[i]]["sh:datatype"] === rangeURI) {
            return graphDS[rangeArray[i]];
        }
        if (graphDS[rangeArray[i]]["sh:class"] !== undefined && checkIfTypesMatch(graphDS[rangeArray[i]]["sh:class"], rangeURI)) {
            return graphDS[rangeArray[i]];
        }
    }
    throw new Error("Path is invalid for the given Domain Specification."); //if no match was found
}

//returns the part of a given object that corresponds to the property definition given
// = looks for a given property inside the defined properties of a given class object
function resolvePathAnnotation_graphProperty(resultRef, propertyURI) {
    if (resultRef[propertyURI] !== undefined) {
        return resultRef[propertyURI];
    } else {
        throw new Error("Path is invalid for the given Annotation."); //if no match was found
    }
}

//returns the part of a given object that corresponds to the range definition given
// = looks for a given range inside the defined ranges of a given property object
function resolvePathAnnotation_graphRange(graphAnn, resultRef, rangeIndex) {
    //resultRef can be any literal, reference object, or array of such
    rangeIndex = Number(rangeIndex); //convert to Number since index was parsed from the string path
    if (rangeIndex !== 0 && (!Array.isArray(resultRef) || resultRef.length < rangeIndex + 1)) {
        //invalid value index
        throw new Error("Path is invalid for the given Annotation."); //if no match was found
    }
    let range;
    if (Array.isArray(resultRef)) {
        //is array of values
        range = resultRef[rangeIndex];
    } else {
        //is single value
        range = resultRef;
    }
    if (isObject(range)) {
        //is reference object - assume that there is a "@id"
        return graphAnn[range["@id"]];
    } else {
        //is literal
        return range;
    }
}

//checks if the URI(s) in types1 (array or single value) match the URI(s) in types2 (array or single value)
function checkIfTypesMatch(types1, types2) {
    if (Array.isArray(types1)) {
        if (Array.isArray(types2)) {
            for (let i = 0; i < types1.length; i++) {
                if (types2.indexOf(types1[i]) === -1) {
                    return false;
                }
            }
            for (let i = 0; i < types2.length; i++) {
                if (types1.indexOf(types2[i]) === -1) {
                    return false;
                }
            }
            return true;
        } else {
            return (types1.length === 1 && types1[0] === types2);
        }
    } else {
        if (Array.isArray(types2)) {
            return (types2.length === 1 && types2[0] === types1);
        } else {
            return (types1 === types2);
        }
    }
}

//returns the string representation of a type according to the path syntax
function stringifyTypeForPath(typesArray) {
    // _ is a delimiter between classes in a MTE class, e.g. "schema:Hotel_schema:Product"
    let result = "";
    for (let i = 0; i < typesArray.length; i++) {
        result = result.concat(typesArray[i]);
        if (i + 1 !== typesArray.length) {
            result = result.concat("_");
        }
    }
    return result;
}

function prettyPrintURI(uri) {
    if (uri.startsWith("schema:")) {
        return uri.substring("schema:".length)
    }
    return uri;
}

module.exports = {
    isObject,
    isString,
    isNumber,
    isUrl,
    resolvePath_graphDS,
    stringifyTypeForPath,
    prettyPrintURI,
    resolvePath_dataGraph
};