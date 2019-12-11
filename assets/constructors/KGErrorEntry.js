class KGErrorEntry {
    constructor(type, severity, errorCode, name, description, dsPath, dataPath) {
        this["@type"] = "kgv:"+type;
        this["kgv:severity"] = severity;
        this["kgv:errorCode"] = errorCode;
        if (name !== null) {
            this["schema:name"] = name;
        }
        if (description !== null) {
            this["schema:description"] = description;
        }
        if (dsPath !== null) {
            this["kgv:dsPath"] = dsPath;
        }
        if (dataPath !== null) {
            this["kgv:dataPath"] = dataPath;
        }
    }
}

module.exports = KGErrorEntry;