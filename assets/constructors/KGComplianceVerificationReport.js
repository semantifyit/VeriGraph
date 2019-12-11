class KGComplianceVerificationReport {
    constructor(validationResult, name, description, errors, domainSpecification) {
        this["@context"]= {
            "schema": "http://schema.org/",
            "kgv": "http://vocab.sti2.at/domainSpecification/"
        };
        this["@type"] = "kgv:VerificationReport";
        this["kgv:validationResult"] = validationResult;
        if (name !== null) {
            this["schema:name"] = name;
        }
        if (description !== null) {
            this["schema:description"] = description;
        }
        this["kgv:errors"] = errors;
        if (domainSpecification !== null) {
            this["kgv:domainSpecification"] = domainSpecification;
        }
    }
}

module.exports = KGComplianceVerificationReport;