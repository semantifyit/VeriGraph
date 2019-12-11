const fs = require('fs');
const eventStream = require("event-stream");
const moment = require("moment");
const GraphComplianceVerification = require("./GraphComplianceVerification");
const utilities = require("./utilities");
const csvParse = require('csv-parse');

//global variables
const fileName_targetList = "entityList.txt";
let entityArray;
let totalErrorsArray;
let errorFileCounter = 1;
let processedTriples = 0;

const blankTargetReader_lineChunkSize = 6000;
let blankTargetReader_EOF = false;
let blankTargetReader_values = [];
let csvReader;
let blankTargetReader_ReadStream;
let blankTargetReader_lineNumber = 0;
let blankTargetReader_totalErrorsArray = [];
const fileName_targetListWithData = "entityListAndData_BlankNodes.txt";

function blankTargetReader_initParser() {
    csvReader = csvParse();
    csvReader.on('readable', function () {
        let value;
        while (value = csvReader.read()) {
            blankTargetReader_values.push(...value);
        }
        if (blankTargetReader_values[blankTargetReader_values.length - 1] === "") {
            blankTargetReader_values.pop();
        }
    });
    csvReader.on('error', function (err) {
        console.error(err.message)
    });
    csvReader.on('end', async function () {
        blankTargetReader_lineNumber = 0;
        if (!blankTargetReader_EOF) {
            await processBlankTarget_values(false);
            blankTargetReader_initParser();
            blankTargetReader_ReadStream.resume();
        } else {
            await processBlankTarget_values(true);
            usedStatistics.processedTriples = processedTriples;
            processBlankTargetsFinished = true;
        }
    });
}

async function processBlankTarget_values(isLastChuck) {
    return new Promise(async function (resolve) {
        let valuesToProcess;
        let quadsToProcess = [];
        if (isLastChuck) {
            valuesToProcess = JSON.parse(JSON.stringify(blankTargetReader_values));
            blankTargetReader_values = [];
        } else {
            let targetQuadAmount = Math.round(blankTargetReader_values.length / 4);
            let lastGraphID = blankTargetReader_values[(targetQuadAmount * 4) - 1];
            let secondToLastFound = false;
            while (secondToLastFound === false) {
                targetQuadAmount--;
                if (blankTargetReader_values[(targetQuadAmount * 4) - 1] !== lastGraphID) {
                    secondToLastFound = true;
                }
            }
            valuesToProcess = blankTargetReader_values.slice(0, targetQuadAmount * 4);
            blankTargetReader_values = blankTargetReader_values.slice(targetQuadAmount * 4);


        }
        while (valuesToProcess.length > 0) {
            let actualQuad = [];
            actualQuad.push(...valuesToProcess.slice(0, 4));
            valuesToProcess = valuesToProcess.slice(4);
            if (actualQuad[0] !== "subj" && actualQuad[1] !== "pred") {
                processedTriples++;
                quadsToProcess.push(actualQuad);
            }
        }
        await processEntities_blank(quadsToProcess, isLastChuck);
        resolve(true);
    });
}

async function processEntities_blank(quadsToProcess, isLastChuck) {
    return new Promise(async function (resolve) {

        if (quadsToProcess.length === 0) {
            resolve(true);
        }
        let data;
        data = utilities.transformBlankNodeQuads(quadsToProcess);
        data = utilities.postProcessQuery_getBlankEntityGraph(data);
        let time_verify_pre = moment();
        for (let j = 0; j < data.length; j++) {
            const dataGraph = data[j];
            usedStatistics.sumEntitiesVerified++;
            let verificationReport;
            try {
                verificationReport = await GraphComplianceVerification.isGraphValidAgainstDomainSpecification(dataGraph, usedDomainSpecification, true);
                if (verificationReport && Array.isArray(verificationReport["kgv:errors"])) {
                    for (let e = 0; e < verificationReport["kgv:errors"].length; e++) {
                        if (verificationReport["kgv:errors"][e]["kgv:severity"] !== "Warning") {
                            blankTargetReader_totalErrorsArray.push(JSON.parse(JSON.stringify(verificationReport["kgv:errors"][e])));
                            let errorCode = verificationReport["kgv:errors"][e]["kgv:errorCode"] + "_" + verificationReport["kgv:errors"][e]["schema:name"];
                            if (usedStatistics.errorMeta[errorCode] === undefined) {
                                usedStatistics.errorMeta[errorCode] = 1;
                            } else {
                                usedStatistics.errorMeta[errorCode]++;
                            }
                        }
                    }
                }
            } catch (e) {
                usedStatistics.executionErrors.isGraphValidAgainstDomainSpecification++;
            }
        }
        usedStatistics.durationVerification.add(moment.duration(moment().diff(time_verify_pre)));
        console.log("processEntities_blank(): verified " + data.length + " entity graphs -> found " + utilities.calculateSumErrors(usedStatistics.errorMeta) + " error so far.");
        while (blankTargetReader_totalErrorsArray.length >= usedVerificationSettings.errorsPerErrorFile) {
            let errorsToWrite = blankTargetReader_totalErrorsArray.slice(0, usedVerificationSettings.errorsPerErrorFile);
            blankTargetReader_totalErrorsArray = blankTargetReader_totalErrorsArray.slice(usedVerificationSettings.errorsPerErrorFile);
            await writeErrors(errorsToWrite, usedStatistics);
        }
        if (isLastChuck) {
            await writeErrors(blankTargetReader_totalErrorsArray, usedStatistics);
        }
        resolve(true);
    });
}


function startBlankTargetReader() {
    blankTargetReader_ReadStream = fs.createReadStream(fileName_targetListWithData).on('error', function (err) {
        console.log('Error while reading file.', err);
    }).pipe(eventStream.split()).pipe(eventStream.mapSync(function (inputLine) {
        let processedInputLine = analyzeLine(inputLine);
        if (processedInputLine !== false) {
            csvReader.write(processedInputLine);
        }
        blankTargetReader_lineNumber++;
        if (processedInputLine !== false && blankTargetReader_lineNumber > blankTargetReader_lineChunkSize) {
            blankTargetReader_ReadStream.pause();
            csvReader.end();
        }
    })).on('end', async function () {
        blankTargetReader_EOF = true;
        csvReader.end();
    });
}

//need to be global within this file
let usedVerificationSettings;
let usedDomainSpecification;
let usedStatistics;
let processBlankTargetsFinished;

async function processBlankTargets(verificationSettings, domainSpecification, statistics) {
    console.log("Starting processBlankTargets()");
    return new Promise(async function (resolve) {
        usedVerificationSettings = verificationSettings;
        usedDomainSpecification = domainSpecification;
        usedStatistics = statistics;
        processBlankTargetsFinished = false;
        blankTargetReader_initParser();
        startBlankTargetReader();
        let finished = false;
        while (finished === false) {
            finished = await checkBlankTargetEnd();
        }
        statistics = usedStatistics;
        resolve(true);
    });
}

async function checkBlankTargetEnd() {
    return new Promise(async function (resolve) {
        setTimeout(function () {
            resolve(processBlankTargetsFinished);
        }, 2000);
    });
}


let lineAnalyzerCache = "";

function analyzeLine(line) {
    if (lineAnalyzerCache !== "") {
        line = lineAnalyzerCache + "\n" + line;
    }
    let amountOfHochKommas = (line.match(/"/g) || []).length;
    let amountOfKommas = (line.match(/,/g) || []).length;
    if ((amountOfHochKommas === 0 && amountOfKommas === 3) || (amountOfHochKommas % 2 === 0 && amountOfKommas >= 3)) {
        lineAnalyzerCache = "";
        return line + ",";
    } else {
        lineAnalyzerCache = line;
        return false;
    }
}

async function processTargetList(graphDBConnector, verificationSettings, domainSpecification, statistics) {
    return new Promise(async function (resolve) {
        //set global variables for this job
        entityArray = [];
        totalErrorsArray = [];
        let jobRunning = false;

        let readStream = fs.createReadStream(fileName_targetList)
            .on('error', function (err) {
                console.log('Error during reading of stream in processTargetList()', err);
                resolve(false);
            })
            .pipe(eventStream.split()).pipe(eventStream.mapSync(async function (line) {
                if (line !== "originID" && line !== "origin" && line !== "") {
                    entityArray.push(line);
                    if (entityArray.length % verificationSettings.entityGraphChuckSize === 0 || statistics.sumEntitiesVerified + entityArray.length === verificationSettings.verificationLimit) {
                        jobRunning = true;
                        readStream.pause();
                        await processEntities(entityArray, graphDBConnector, verificationSettings, domainSpecification, statistics);
                        statistics.sumEntitiesVerified += entityArray.length;
                        if (verificationSettings.verificationLimit === 0 || statistics.sumEntitiesVerified < verificationSettings.verificationLimit) {
                            entityArray = [];
                            jobRunning = false;
                            readStream.resume();
                        } else {
                            console.log("processTargetList(): Ending reading, since verification limit of " + verificationSettings.verificationLimit + " has been reached.");
                            readStream.end();
                            await writeErrors(totalErrorsArray, statistics);
                            statistics.processedTriples = processedTriples;
                            resolve(true);
                        }
                    } else if (jobRunning) {
                        readStream.pause();
                    }
                }
            }))
            .on('end', async function () {
                console.log("processTargetList(): End of File reached.");
                statistics.sumEntitiesVerified += entityArray.length;
                await processEntities(entityArray, graphDBConnector, verificationSettings, domainSpecification, statistics);
                await writeErrors(totalErrorsArray, statistics);
                statistics.processedTriples = processedTriples;
                resolve(true);
            });
    });
}


async function processEntities(entityArray, graphDBConnector, verificationSettings, domainSpecification, statistics) {
    return new Promise(async function (resolve) {
        if (entityArray.length === 0) {
            resolve(true);
        } else {
            let data;
            try {
                let time_retrieveDataGraph = moment();
                data = await graphDBConnector.getEntityGraphBulk(entityArray, verificationSettings);
                if (data && data.results && data.results.bindings) {
                    processedTriples += data.results.bindings.length;
                    data = utilities.postProcessQuery_getBlankEntityGraph(data.results.bindings);
                } else {
                    data = [];
                }
                statistics.durationEntityGraphs.add(moment.duration(moment().diff(time_retrieveDataGraph)));
                console.log("processEntities(): retrieved " + data.length + " entity graphs.");
            } catch (e) {
                console.log(e);
                console.log("processEntities(): Error during getEntityGraphBulk()");
                statistics.executionErrors.getEntityGraphBulk++;
                data = [];
            }

            let time_verify_pre = moment();
            for (let j = 0; j < data.length; j++) {
                const dataGraph = data[j];
                let verificationReport;
                try {
                    verificationReport = await GraphComplianceVerification.isGraphValidAgainstDomainSpecification(dataGraph, domainSpecification, true);
                    if (verificationReport && Array.isArray(verificationReport["kgv:errors"])) {
                        for (let e = 0; e < verificationReport["kgv:errors"].length; e++) {
                            if (verificationReport["kgv:errors"][e]["kgv:severity"] !== "Warning") {
                                totalErrorsArray.push(JSON.parse(JSON.stringify(verificationReport["kgv:errors"][e])));
                                let errorCode = verificationReport["kgv:errors"][e]["kgv:errorCode"] + "_" + verificationReport["kgv:errors"][e]["schema:name"];
                                if (statistics.errorMeta[errorCode] === undefined) {
                                    statistics.errorMeta[errorCode] = 1;
                                } else {
                                    statistics.errorMeta[errorCode]++;
                                }
                            }
                        }
                    }
                } catch (e) {
                    statistics.executionErrors.isGraphValidAgainstDomainSpecification++;
                }
            }
            statistics.durationVerification.add(moment.duration(moment().diff(time_verify_pre)));
            console.log("processEntities(): verified " + data.length + " entity graphs -> found " + utilities.calculateSumErrors(statistics.errorMeta) + " error so far.");

            while (totalErrorsArray.length >= verificationSettings.errorsPerErrorFile) {
                let errorsToWrite = totalErrorsArray.slice(0, verificationSettings.errorsPerErrorFile);
                totalErrorsArray = totalErrorsArray.slice(verificationSettings.errorsPerErrorFile);
                await writeErrors(errorsToWrite, statistics);
            }
            resolve(true);
        }

    });
}

async function writeErrors(errorArray, statistics) {
    return new Promise(async function (resolve) {
        let fileName = statistics.dsName + "_" + statistics.startTimeStamp + "_errors" + errorFileCounter + ".txt";
        errorFileCounter++;
        console.log("writing " + errorArray.length + " errors in file " + fileName);
        fs.writeFileSync(fileName, JSON.stringify(errorArray, null, 2), 'utf-8');
        resolve(true);
    });
}

module.exports = {
    processTargetList,
    processBlankTargets
};