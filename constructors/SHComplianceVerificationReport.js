class SHComplianceVerificationReport {
    /**
     * @param {[object]} errors
     */
    constructor(errors) {
        this["@context"] = {
            "schema": "http://schema.org/",
            "sh": "http://www.w3.org/ns/shacl#"
        };
        this["@type"] = "sh:ValidationReport";
        if (Array.isArray(errors) && errors.length > 0) {
            this["sh:conforms"] = false;
            this["sh:result"] = errors;
        } else {
            this["sh:conforms"] = true;
        }
    }
}

module.exports = SHComplianceVerificationReport;
// https://www.w3.org/TR/shacl/#results-validation-result