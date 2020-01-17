const KGComplianceVerification = require("./KGComplianceVerification");

main();
async function main() {
    const connectionSettings = {
        user: null,
        pw: null,
        timeout: 0, //maximum timeout to wait for queries, 0 = unlimited
        endPointURL: "http://graphdb.sti2.at:8080",
        repositoryId: "onebillion",
        namedGraph: null
        //namedGraph: "https://graph.semantify.it/ryJfFtrYZ/2019-11-16"
    };
    const verificationSettings = {
        entityGraphChuckSize: 5000, //amount of entities that should be queried together when retrieving their data graphs
        verificationLimit: 0, //maximum amount of entities that should be verified, 0 = unlimited
        errorsPerErrorFile : 50000, //amount of errors that should be saved in a single local file (50k errors are around 20 mb)
        exactMatch: true, //false -> subclasses of the target classes are also considered (false makes verification more expensive, eventually more target entities)
        onlyRootEntities: false, // true -> only entities that are not objects (?o) in any triple (?s ?p ?o) are considered (true makes verification more expensive, eventually less target entities)
        retailMode: true // true -> makes use of internal IDs of GraphDB (false makes verification more expensive)
    };
    const domainSpecification = require("./DomainSpecifications/DS_Person");
    let processFinished = await KGComplianceVerification.verifyKnowledgeGraph(connectionSettings, verificationSettings, domainSpecification);
    process.exit();
}