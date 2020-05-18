class SHErrorEntry {
    /**
     *
     * @param {string} severity - severity level of the error -> sh:Info | sh:Warning | sh:Violation
     * @param {?string} sourceConstraintComponent - req IRI of (shacl) constraint that caused the error
     * @param {?string} name - optional name for the error
     * @param {?string} description - optional description about the found error
     * @param {?string} focusNode - req IRI of data entity (we gonna use the GraphDB-ID for retail-mode)
     * @param {?string} sourceShape - optional IRI of the DS node that contains the constraint that caused the error
     * @param {?string} resultPath - optional IRI of property where the value is wrong (sh:path)
     * @param {?object} value - optional the actual value that caused the error, the parameter given here is however the corresponding data-graph node
     */
    constructor(severity, sourceConstraintComponent, name, description, focusNode, sourceShape, resultPath, value) {
        this["@type"] = "sh:ValidationResult";
        this["sh:resultSeverity"] = severity;
        this["sh:focusNode"] = focusNode;
        if (resultPath) {
            this["sh:resultPath"] = resultPath;
        }
        // https://www.w3.org/TR/shacl/#results-value
        if (value !== undefined && value !== null) {
            this["sh:value"] = value;
        }
        if (name) {
            this["schema:name"] = name;
        }
        if (description) {
            this["sh:resultMessage"] = description;
        }
        this["sh:sourceConstraintComponent"] = sourceConstraintComponent;
        if (sourceShape) {
            this["sh:sourceShape"] = sourceShape;
        }
    }
}

module.exports = SHErrorEntry;
/*
https://www.w3.org/TR/shacl/#results-validation-result
 */