const utilities = require("./assets/utilities");
const GraphComplianceVerification = require("./assets/GraphComplianceVerification");
const GraphDBConnector = require("./assets/GraphDBConnector");
const moment = require("moment");
const VerificationProcessor = require("./assets/VerificationProcessor");
const vocHand = require("./assets/vocabularyHandler");
const fs = require('fs');
const fileName_targetList = "entityList.txt";
const fileName_targetListWithData = "entityListAndData_BlankNodes.txt";

async function verifyKnowledgeGraph(connectionSettings, verificationSettings, domainSpecification) {
    return new Promise(async function (resolve) {
        const startTime = moment();
        const statistics = initializeStatistics(domainSpecification, startTime);
        verificationSettings.fileName_targetList = fileName_targetList;
        verificationSettings.fileName_targetListWithData = fileName_targetListWithData;
        console.log("Stating time: " + moment().format("dddd, MMMM Do YYYY, h:mm:ss a"));
        const graphDBConnector = new GraphDBConnector(connectionSettings.endPointURL, connectionSettings.repositoryId, connectionSettings.namedGraph, connectionSettings.timeout);
        if (connectionSettings.user && connectionSettings.pw) {
            let loginSuccess = await graphDBConnector.login(connectionSettings.user, connectionSettings.pw);
        }
        await vocHand.setSdoAdapter(domainSpecification); //set the needed sdoAdapter for the given DS
        let dsTargetObject = utilities.getTargetOfDomainSpecification(domainSpecification);
        //step 1/1b: get list of targets (URIs without blank nodes or GraphDBIds with blank nodes)
        let timeTargetList_pre = moment();
        let getTargetListSuccess = await graphDBConnector.getTargetList(dsTargetObject, verificationSettings);
        if (getTargetListSuccess === false) {
            statistics.executionErrors.getTargetList++;
        }
        statistics.durationTargetList.add(moment.duration(moment().diff(timeTargetList_pre)));
        //step 2: for each target in the list: fetch data graph and verify
        if (getTargetListSuccess) {
            let processTargetListSuccess = await VerificationProcessor.processTargetList(graphDBConnector, verificationSettings, domainSpecification, statistics);
        }
        //step 2b: fetch list of targets (blank nodes) with their data
        if (verificationSettings.retailMode === false) {
            let timeGetBlankTargetsAndData_pre = moment();
            let getBlankTargetsAndDataSuccess = await graphDBConnector.getTargetListWithDataGraphs(dsTargetObject, verificationSettings);
            statistics.durationRetrieveBlankNodes.add(moment.duration(moment().diff(timeGetBlankTargetsAndData_pre)));
            let processBlankTargetAndDataSuccess = await VerificationProcessor.processBlankTargets(verificationSettings, domainSpecification, statistics);
        }
        //step 3: create meta data and finalize verification
        const metaData = utilities.createMetaInformation(connectionSettings, verificationSettings, domainSpecification, statistics);
        console.log(JSON.stringify(metaData, null, 2));
        await writeVerificationMeta(metaData, statistics);
        const endTime = moment();
        console.log("End time: " + endTime.format("dddd, MMMM Do YYYY, h:mm:ss a"));
        console.log("Total Duration: " + moment.duration(endTime.diff(startTime)).humanize());
        resolve(true);
    });
}

//initializes the statistics object
function initializeStatistics(domainSpecification, startTime) {
    let statistics = {};
    statistics.startTimeStamp = startTime.format("X");
    statistics.durationTargetList = moment.duration(0);
    statistics.durationEntityGraphs = moment.duration(0);
    statistics.durationVerification = moment.duration(0);
    statistics.durationRetrieveBlankNodes = moment.duration(0);
    statistics.sumEntitiesVerified = 0;
    statistics.processedTriples = 0;
    statistics.executionErrors = {
        getTargetList: 0,
        getEntityGraphBulk: 0,
        isGraphValidAgainstDomainSpecification: 0
    };
    statistics.errorMeta = {};
    statistics.dsName = "DS";
    if (domainSpecification && domainSpecification["@graph"] && domainSpecification["@graph"][0] && domainSpecification["@graph"][0]["schema:name"]) {
        statistics.dsName = domainSpecification["@graph"][0]["schema:name"];
    }
    return statistics;
}

async function writeVerificationMeta(metaData, statistics) {
    return new Promise(async function (resolve) {
        let fileName = statistics.dsName + "_" + statistics.startTimeStamp + "_meta.txt";
        console.log("writing meta data in file " + fileName);
        fs.writeFileSync(fileName, JSON.stringify(metaData, null, 2), 'utf-8');
        resolve(true);
    });
}

/**
 * Verifies the compliance of a given entity graph against a given domain specification
 * @param {Object} entityGraph - the graph to verify
 * @param {Object} domainSpecifications - the specification to check
 * @returns {Object} The resulting verification report
 */
async function verifyEntityGraphAgainstDomainSpecification(entityGraph, domainSpecifications) {
    return await GraphComplianceVerification.isGraphValidAgainstDomainSpecification(entityGraph, domainSpecifications);
}

module.exports = {
    verifyEntityGraphAgainstDomainSpecification,
    verifyKnowledgeGraph
};