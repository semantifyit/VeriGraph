class KGComplianceVerificationReport {
    constructor(validationResult, name, description, errors, domainSpecification) {
        this["@context"] = {
            "schema": "http://schema.org/",
            "ds": "http://vocab.sti2.at/ds/",
            "sh": "http://www.w3.org/ns/shacl#"
        };
        this["@type"] = "ds:VerificationReport";
        this["ds:validationResult"] = validationResult;
        if (name !== null) {
            this["schema:name"] = name;
        }
        if (description !== null) {
            this["schema:description"] = description;
        }
        if (Array.isArray(errors) && errors.length > 0) {
            this["ds:errors"] = errors;
        }
        if (domainSpecification !== null) {
            this["ds:domainSpecification"] = domainSpecification;
        }
    }
}

module.exports = KGComplianceVerificationReport;
/*
validationResult = "Valid" | "ValidWithWarnings" | "Invalid"
name = string with a name/title for the validation
description = string explaining the validation result
errors = Array of Errors (can be from different @types)
domainSpecification = the DS used for the verification
 */