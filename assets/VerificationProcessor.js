const fs = require('fs');
const eventStream = require("event-stream");
const moment = require("moment");
const GraphComplianceVerification = require("./GraphComplianceVerification");
const utilities = require("./utilities");
const csvParse = require('csv-parse');

//global constants
const blankTargetReader_lineChunkSize = 6000; //each 100 lines -> stop and process graphs

//global variables
let G = {}; //must be initialized/reset with initGlobalVars()
function initGlobalVars() {
    G.entityArray = [];
    G.totalErrorsArray = [];
    G.errorFileCounter = 1;
    G.processedTriples = 0;
    G.blankTargetReader_EOF = false;
    G.blankTargetReader_values = [];
    G.usedStatistics = {};
    G.processBlankTargetsFinished = false;
    G.usedDomainSpecification = {};
    G.usedVerificationSettings = {};
    G.blankTargetReader_lineNumber = 0;
    G.blankTargetReader_totalErrorsArray = [];
    G.blankTargetReader_ReadStream = null;
    G.csvReader = null;
}

//(re-)initializes the CSV Parser, must be reinitialized every time after it has been "ended"
function blankTargetReader_initParser() {
    G.csvReader = csvParse();
    G.csvReader.on('readable', function () {
        let value;
        while (value = G.csvReader.read()) {
            G.blankTargetReader_values.push(...value);
        }
        //remove the last element if that element is a blank line
        if (G.blankTargetReader_values[G.blankTargetReader_values.length - 1] === "") {
            G.blankTargetReader_values.pop();
        }
    });
    G.csvReader.on('error', function (err) {
        console.error(err.message)
    });
    G.csvReader.on('end', async function () {
        G.blankTargetReader_lineNumber = 0;
        if (!G.blankTargetReader_EOF) {
            await processBlankTarget_values(false);
            blankTargetReader_initParser();
            G.blankTargetReader_ReadStream.resume();
        } else {
            await processBlankTarget_values(true);
            G.usedStatistics.processedTriples = G.processedTriples;
            G.processBlankTargetsFinished = true;
        }
    });
}

async function processBlankTarget_values(isLastChuck) {
    return new Promise(async function (resolve) {
        let valuesToProcess;
        let quadsToProcess = [];
        if (isLastChuck) {
            valuesToProcess = JSON.parse(JSON.stringify(G.blankTargetReader_values));
            G.blankTargetReader_values = [];
        } else {
            let targetQuadAmount = Math.round(G.blankTargetReader_values.length / 4);
            let lastGraphID = G.blankTargetReader_values[(targetQuadAmount * 4) - 1];
            let secondToLastFound = false;
            while (secondToLastFound === false) {
                targetQuadAmount--;
                if (G.blankTargetReader_values[(targetQuadAmount * 4) - 1] !== lastGraphID) {
                    secondToLastFound = true;
                }
            }
            valuesToProcess = G.blankTargetReader_values.slice(0, targetQuadAmount * 4);
            G.blankTargetReader_values = G.blankTargetReader_values.slice(targetQuadAmount * 4);
        }
        while (valuesToProcess.length > 0) {
            let actualQuad = [];
            actualQuad.push(...valuesToProcess.slice(0, 4));
            valuesToProcess = valuesToProcess.slice(4);
            if (actualQuad[0] !== "subj" && actualQuad[1] !== "pred") {
                G.processedTriples++;
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
        data = utilities.processDataGraphBulk(data);
        let time_verify_pre = moment();
        for (let j = 0; j < data.length; j++) {
            const dataGraph = data[j];
            G.usedStatistics.sumEntitiesVerified++;
            let verificationReport;
            try {
                verificationReport = await GraphComplianceVerification.isGraphValidAgainstDomainSpecification(dataGraph, G.usedDomainSpecification, true, G.usedVerificationSettings.errorOutputFormat);
                if (G.usedVerificationSettings.errorOutputFormat === "ds") {
                    if (verificationReport && Array.isArray(verificationReport["ds:errors"])) {
                        for (let e = 0; e < verificationReport["ds:errors"].length; e++) {
                            if (verificationReport["ds:errors"][e]["ds:severity"] !== "Warning") {
                                G.blankTargetReader_totalErrorsArray.push(JSON.parse(JSON.stringify(verificationReport["ds:errors"][e])));
                                let errorCode = verificationReport["ds:errors"][e]["ds:errorCode"] + "_" + verificationReport["ds:errors"][e]["schema:name"];
                                if (G.usedStatistics.errorMeta[errorCode] === undefined) {
                                    G.usedStatistics.errorMeta[errorCode] = 1;
                                } else {
                                    G.usedStatistics.errorMeta[errorCode]++;
                                }
                            }
                        }
                    }
                } else if (G.usedVerificationSettings.errorOutputFormat === "shacl") {
                    if (verificationReport && Array.isArray(verificationReport["sh:result"])) {
                        for (let err of verificationReport["sh:result"]) {
                            if (err["sh:resultSeverity"] !== "Warning" && err["schema:name"] !== "Non-conform property") { //Non-conform property is a warning usually
                                G.blankTargetReader_totalErrorsArray.push(JSON.parse(JSON.stringify(err)));
                                if (G.usedStatistics.errorMeta[err["schema:name"]] === undefined) {
                                    G.usedStatistics.errorMeta[err["schema:name"]] = 1;
                                } else {
                                    G.usedStatistics.errorMeta[err["schema:name"]]++;
                                }
                            }
                        }
                    }
                }

            } catch (e) {
                console.log(e)
                G.usedStatistics.executionErrors.isGraphValidAgainstDomainSpecification++;
            }
        }
        G.usedStatistics.durationVerification.add(moment.duration(moment().diff(time_verify_pre)));
        console.log("processEntities_blank(): verified " + data.length + " entity graphs -> found " + utilities.calculateSumErrors(G.usedStatistics.errorMeta) + " error so far.");
        while (G.blankTargetReader_totalErrorsArray.length >= G.usedVerificationSettings.errorsPerErrorFile) {
            let errorsToWrite = G.blankTargetReader_totalErrorsArray.slice(0, G.usedVerificationSettings.errorsPerErrorFile);
            G.blankTargetReader_totalErrorsArray = G.blankTargetReader_totalErrorsArray.slice(G.usedVerificationSettings.errorsPerErrorFile);
            //only write errors on disk if option is enabled
            if (G.usedVerificationSettings.logErrors) {
                await writeErrors(errorsToWrite, G.usedStatistics);
            }
        }
        if (isLastChuck) {
            //only write errors on disk if option is enabled
            if (G.usedVerificationSettings.logErrors) {
                await writeErrors(G.blankTargetReader_totalErrorsArray, G.usedStatistics);
            }
        }
        resolve(true);
    });
}

//starts the reading stream for the local file holding the entity list of blank entities with their data-graphs
function startBlankTargetReader() {
    G.blankTargetReader_ReadStream = fs.createReadStream(G.usedVerificationSettings.fileName_targetListWithData).on('error', function (err) {
        console.log('Error while reading file.', err);
    }).pipe(eventStream.split()).pipe(eventStream.mapSync(function (inputLine) {
        let processedInputLine = analyzeLine(inputLine);
        if (processedInputLine !== false) {
            G.csvReader.write(processedInputLine);
        }
        G.blankTargetReader_lineNumber++;
        if (processedInputLine !== false && G.blankTargetReader_lineNumber > blankTargetReader_lineChunkSize) {
            G.blankTargetReader_ReadStream.pause();
            G.csvReader.end();
        }
    })).on('end', async function () {
        G.blankTargetReader_EOF = true;
        G.csvReader.end();
    });
}

//starts the reading of the local file holding the entity list of blank entities with their data-graphs
async function processBlankTargets(verificationSettings, domainSpecification, statistics) {
    console.log("Starting processBlankTargets()");
    return new Promise(async function (resolve) {
        G.usedVerificationSettings = verificationSettings;
        G.usedDomainSpecification = domainSpecification;
        G.usedStatistics = statistics;
        G.processBlankTargetsFinished = false;
        blankTargetReader_initParser();
        startBlankTargetReader();
        let finished = false;
        //life-locks until job is done
        while (finished === false) {
            finished = await checkBlankTargetEnd();
        }
        statistics = G.usedStatistics;
        resolve(true);
    });
}

//periodically check if the processing of blank nodes (reading from local file and verification) has finished
async function checkBlankTargetEnd() {
    return new Promise(async function (resolve) {
        setTimeout(function () {
            resolve(G.processBlankTargetsFinished);
        }, 2000);
    });
}


let lineAnalyzerCache = ""; //cache for the analyzeLine() function
//analyzes a line that was read from the local file for entityList and their data-graphs for blank nodes (non-retail-mode)
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

//starts the reading of a local file, holding the URIs/IDs of entities to verify.
//for each entry a data-graph is fetched (multiple enties in a single query -> bulk)
//each data-graph is then verified against the given domain specification
async function processTargetList(graphDBConnector, verificationSettings, domainSpecification, statistics) {
    return new Promise(async function (resolve) {
        //set global variables for this job
        G.entityArray = [];
        G.totalErrorsArray = [];
        initGlobalVars(); //todo variables should be reset before each new verification job
        let jobRunning = false; //halts the reading of the local file securely until a certain amount of target entities is being processed
        let readStream = fs.createReadStream(verificationSettings.fileName_targetList)
            .on('error', function (err) {
                console.log('Error during reading of stream in processTargetList()', err);
                resolve(false);
            })
            .pipe(eventStream.split()).pipe(eventStream.mapSync(async function (line) {
                if (line !== "originID" && line !== "origin" && line !== "") {
                    G.entityArray.push(line);
                    if (G.entityArray.length % verificationSettings.entityGraphChuckSize === 0 || statistics.sumEntitiesVerified + G.entityArray.length === verificationSettings.verificationLimit) {
                        jobRunning = true;
                        readStream.pause();
                        await processEntities(G.entityArray, graphDBConnector, verificationSettings, domainSpecification, statistics);
                        statistics.sumEntitiesVerified += G.entityArray.length;
                        if (verificationSettings.verificationLimit === 0 || statistics.sumEntitiesVerified < verificationSettings.verificationLimit) {
                            G.entityArray = [];
                            jobRunning = false;
                            readStream.resume();
                        } else {
                            console.log("processTargetList(): Ending reading, since verification limit of " + verificationSettings.verificationLimit + " has been reached.");
                            readStream.end();
                            //only write errors on disk if option is enabled
                            if (verificationSettings.logErrors) {
                                await writeErrors(G.totalErrorsArray, statistics);
                            }
                            statistics.processedTriples = G.processedTriples;
                            resolve(true);
                        }
                    } else if (jobRunning) {
                        readStream.pause();
                    }
                }
            }))
            .on('end', async function () {
                console.log("processTargetList(): End of File reached.");
                statistics.sumEntitiesVerified += G.entityArray.length;
                await processEntities(G.entityArray, graphDBConnector, verificationSettings, domainSpecification, statistics);
                //only write errors on disk if option is enabled
                if (verificationSettings.logErrors) {
                    await writeErrors(G.totalErrorsArray, statistics);
                }
                statistics.processedTriples = G.processedTriples;
                resolve(true);
            });
    });
}

//retrieves the data-graphs of target entities specified in the given entityArray
//then it verifies these data-graphs against the given domain specification
async function processEntities(entityArray, graphDBConnector, verificationSettings, domainSpecification, statistics) {
    return new Promise(async function (resolve) {
        if (entityArray.length === 0) {
            resolve(true);
        } else {
            let data;
            try {
                let time_retrieveDataGraph = moment();
                data = await graphDBConnector.getEntityGraphBulk(entityArray, verificationSettings);
                //console.log(data)
                if (data && data.results && data.results.bindings) {
                    G.processedTriples += data.results.bindings.length;
                    data = utilities.processDataGraphBulk(data.results.bindings);
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
                    verificationReport = await GraphComplianceVerification.isGraphValidAgainstDomainSpecification(dataGraph, domainSpecification, true, verificationSettings.errorOutputFormat);
                    if (verificationSettings.errorOutputFormat === "ds") {
                        for (let e = 0; e < verificationReport["ds:errors"].length; e++) {
                            if (verificationReport["ds:errors"][e]["ds:severity"] !== "Warning") {
                                G.totalErrorsArray.push(JSON.parse(JSON.stringify(verificationReport["ds:errors"][e])));
                                let errorCode = verificationReport["ds:errors"][e]["ds:errorCode"] + "_" + verificationReport["ds:errors"][e]["schema:name"];
                                if (statistics.errorMeta[errorCode] === undefined) {
                                    statistics.errorMeta[errorCode] = 1;
                                } else {
                                    statistics.errorMeta[errorCode]++;
                                }
                            }
                        }
                    } else if (verificationSettings.errorOutputFormat === "shacl") {
                        if (verificationReport && Array.isArray(verificationReport["sh:result"])) {
                            for (let err of verificationReport["sh:result"]) {
                                if (err["sh:resultSeverity"] !== "Warning" && err["schema:name"] !== "Non-conform property") { //Non-conform property is a warning usually
                                    G.totalErrorsArray.push(JSON.parse(JSON.stringify(err)));
                                    if (statistics.errorMeta[err["schema:name"]] === undefined) {
                                        statistics.errorMeta[err["schema:name"]] = 1;
                                    } else {
                                        statistics.errorMeta[err["schema:name"]]++;
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log(e)
                    statistics.executionErrors.isGraphValidAgainstDomainSpecification++;
                }
            }
            statistics.durationVerification.add(moment.duration(moment().diff(time_verify_pre)));
            console.log("processEntities(): verified " + data.length + " entity graphs -> found " + utilities.calculateSumErrors(statistics.errorMeta) + " error so far.");

            while (G.totalErrorsArray.length >= verificationSettings.errorsPerErrorFile) {
                let errorsToWrite = G.totalErrorsArray.slice(0, verificationSettings.errorsPerErrorFile);
                G.totalErrorsArray = G.totalErrorsArray.slice(verificationSettings.errorsPerErrorFile);
                //only write errors on disk if option is enabled
                if (verificationSettings.logErrors) {
                    await writeErrors(errorsToWrite, statistics);
                }
            }
            resolve(true);
        }
    });
}

//saves a given array of errors in a local file
async function writeErrors(errorArray, statistics) {
    return new Promise(async function (resolve) {
        let fileName = statistics.dsName + "_" + statistics.startTimeStamp + "_errors" + G.errorFileCounter + ".txt";
        G.errorFileCounter++;
        console.log("writing " + errorArray.length + " errors in file " + fileName);
        fs.writeFileSync(fileName, JSON.stringify(errorArray, null, 2), 'utf-8');
        resolve(true);
    });
}

module.exports = {
    processTargetList,
    processBlankTargets
};