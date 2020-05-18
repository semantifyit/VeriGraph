const KGComplianceVerification = require("../../KGComplianceVerification");

//this is the main script that uses the function provided by the Knowledge Graph Compliance Verification module
main();

async function main() {
    let ds1 = require("../../domainSpecifications/DS_ContactPoint");
    let ds2 = require("../../domainSpecifications/DS_CreativeWork");
    let ds3 = require("../../domainSpecifications/DS_Event");
    let ds4 = require("../../domainSpecifications/DS_Offer");
    let ds5 = require("../../domainSpecifications/DS_Organization");
    let ds6 = require("../../domainSpecifications/DS_Person");
    let ds7 = require("../../domainSpecifications/DS_Place");
    let ds8 = require("../../domainSpecifications/DS_PriceSpecification");
    let ds9 = require("../../domainSpecifications/DS_Product");
    let ds10 = require("../../domainSpecifications/PropertyDS_availabilityStarts");
    let ds11 = require("../../domainSpecifications/PropertyDS_validFrom");
    await verificationJob(ds1);
    await verificationJob(ds2);
    await verificationJob(ds3);
    await verificationJob(ds4);
    await verificationJob(ds5);
    await verificationJob(ds6);
    await verificationJob(ds7);
    await verificationJob(ds8);
    await verificationJob(ds9);
    await verificationJob(ds10);
    await verificationJob(ds11);
    process.exit();
}

async function verificationJob(domainSpecification) {
    const connectionSettings = {
        user: null, //credential for access (if repository is not public)
        pw: null, //credential for access (if repository is not public)
        timeout: 0, //timeout in minutes for the SPARQL queries
        endPointURL: "https://graphdb.sti2.at", //URL of the SPARQL endpoint
        repositoryId: "hundredthousand", //id/name of the target repository
        namedGraph: null //URI of target named graph within the repository (null if whole repository should be used)
    };
    const verificationSettings = {
        entityGraphChuckSize: 5000,  // amount of entities for which data graphs are retrieved in a single query -> 5k is a good value, but depends on size of the single data graphs
        verificationLimit: 0, //amount of entities to verify, 0 is unlimited
        logErrors: true, //if true, then the found errors are bundle into output error files and written on the disc
        errorOutputFormat: "shacl", //can be either "ds" or "shacl", to select the used structure for the verification report
        errorsPerErrorFile: 50000, //amount of errors that are saved per output error file -> 50k is around 20 mb files
        exactMatch: true, //if false, then sub-class matching is checked -> false makes it more expensive since more classes are queried for, and it may result in more entities to fetch and verify
        onlyRootEntities: false, //if true, then only entities are verified that are "root" entities (where there are never ?o in ?s ?p ?o) -> true makes it more expensive, but it may even out if there are far less entities to fetch and verify
        retailMode: false //if true then internal graphDB Ids are used -> false makes it much more expensive the more entities are verified, scalability -> retailMode: true
    };
    //you can use other Domain Specifications, see the examples at /paperTestSuite/paperTestData/
    let processFinished = await KGComplianceVerification.verifyKnowledgeGraph(connectionSettings, verificationSettings, domainSpecification);
}

//note -> retailMode: true and errorOutputFormat: "shacl" will result in invalid values for sh:focusNode, since retail mode works based on internal IDs instead of the IRIs of entities