class KGErrorEntry {
    /**
     *
     * @param {string} type - req the type of the error -> AnnotationError | DSMetaError | ComplianceError | ExecutionError | JsonError | JsonLdError
     * @param {string} severity - severity level of the error -> Informational | Warning | Error | Critical
     * @param {number} errorCode - 3 integers representing the error found
     * @param {string | null} name - optional name for the error (can be related to the errorCode)
     * @param {string | null} description - optional description about the found error
     * @param {string | null} dsPath - string indicating the path within the DS where the error occurred
     * @param {[string] | null} dataPath - array pointing to the place where the error occurred
     * @param {string | object | null} value - the corresponding value-object of the data-graph
     */
    constructor(type, severity, errorCode, name, description, dsPath, dataPath, value) {
        this["@type"] = "ds:" + type;
        this["ds:severity"] = severity;
        this["ds:errorCode"] = errorCode;
        if (name) {
            this["schema:name"] = name;
        }
        if (description) {
            this["schema:description"] = description;
        }
        // https://www.w3.org/TR/shacl/#results-value
        if (value !== undefined && value !== null) {
            this["sh:value"] = value;
        }
        if (dsPath) {
            this["ds:dsPath"] = dsPath;
        }
        if (dataPath) {
            this["ds:dataPath"] = dataPath;
        }
    }
}

module.exports = KGErrorEntry;

/*
paths are arrays to easier travers over them and differentiate between "steps" which may include MTEs
e.g. https://docs.google.com/spreadsheets/d/144iAPlBpjFS4WF1-czwmiIo9IFQNtqH2JPrxiJdKuFM/edit#gid=0
 */