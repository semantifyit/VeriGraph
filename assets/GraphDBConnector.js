const request = require('request');
const progress = require('request-progress');
const fs = require('fs');
const sparqlFactory = require("./sparqlFactory");

/**
 * A graph DB connector is supposed to be created once for several verification tasks on the same graphDB target
 * This way the target and auth handling is done just once
 */
class GraphDBConnector {
    /**
     * Creates a GraphDBConnector, holding all important connection information. If the access needs credentials, then the function login() should be used after creation.
     * @param {string} endPointURL - the URL of the target GraphDB endpoint
     * @param {string} repositoryId - the ID of the target repository
     * @param {?string} namedGraph - the name of the target graph (if needed)
     * @param {?number} timeOutDuration - the maximal timeout duration in minutes for SPARQL queries
     */
    constructor(endPointURL, repositoryId, namedGraph = null, timeOutDuration = 10) {
        this.endPointURL = endPointURL;
        this.repositoryId = repositoryId;
        this.namedGraph = namedGraph;
        this.loginToken = null;
        this.timeOutDuration = timeOutDuration;

        /**
         * Triggers a login query to receive a loginToken and enable further queries
         * @param {string} user - the user credential
         * @param {string} pw - the password credential
         * @return {string} the authentication token (loginToken)
         */
        this.login = async function (user, pw) {
            this.loginToken = await new Promise(async function (resolve) {
                request(
                    {
                        url: this.endPointURL + "/rest/login",
                        headers: {
                            'Accept': 'application/ld+json',
                            'Content-Type': 'application/ld+json',
                        },
                        method: 'POST',
                        json: {
                            "username": user,
                            "password": pw
                        }
                    },
                    (err, res, body) => {
                        if (res.statusCode === 200) {
                            console.log("Graph DB Login success!");
                            resolve(res.headers["x-auth-token"]);
                        } else {
                            console.log("Error during Graph DB login: " + JSON.stringify(res, null, 2));
                            resolve(null);
                        }
                    }
                );
            }.bind(this));
            return (this.loginToken !== null)
        };

        /**
         * Retrieves a list of target entities for a given target specification (by class or by property).
         * The outcome of the query will be streamed into a local file.
         * @param {object} dsTargetObject - the target specification for the wished entities
         * @param {object} verificationSettings - the verification settings that may be relevant for the query
         * @return {boolean} true if the query was successful
         */
        this.getTargetList = async function (dsTargetObject, verificationSettings) {
            return new Promise(async function (resolve) {
                let query = await sparqlFactory.genQuery_EntityList(this.namedGraph, dsTargetObject, verificationSettings);
                console.log(query);
                console.log("Query has a length of " + query.length + " chars.");
                let headers = {
                    'Accept': "text/csv",
                    'Content-Type': "application/x-www-form-urlencoded"
                };
                if (this.loginToken !== null) {
                    headers['X-AUTH-TOKEN'] = this.loginToken;
                }
                try {
                    progress(request({
                            method: 'POST',
                            uri: this.endPointURL + '/repositories/' + this.repositoryId,
                            headers: headers,
                            form: {
                                query: query,
                                infer: false, //if graphDB should do inference (e.g. sub-classes)
                                timeout: this.timeOutDuration * 60 //timeout for graphdb in seconds
                            },
                            timeout: this.timeOutDuration * 60 * 1000 //timeout for request.js in milliseconds
                        }),
                        {
                            throttle: 5000, //time in ms between progress updates (see .on 'progress')
                            delay: 5000 //delay between seing the query and the first progress update
                        }
                    ).on('progress', function (state) {
                        console.log("Download so far: " + state.time.elapsed + " seconds -> " + state.size.transferred / 1024 / 1024 + " MB");
                    }).on('error', function (err) {
                        console.log(err);
                        console.log("Error during execution of query 'getTargetList'");
                        resolve(false);
                    }).on('end', function () {
                        resolve(true);
                    }).pipe(fs.createWriteStream(verificationSettings.fileName_targetList));
                } catch (e) {
                    console.log(e);
                    console.log("Error during function 'getTargetList'");
                    resolve(false);
                }

            }.bind(this));
        };

        /**
         * Sends a query to GraphDB to retrieve a graph containing multiple target entity and all their connected nodes (entities and literals).
         * This query is used in retail-mode for all entities, and in non-retail-mode for entities that have URIs (non-blank nodes)
         * @param {array} entityArray - the identifier for the target entities
         * @param {object} verificationSettings - the verification settings that may be relevant for the query
         * @return {object} the result of the query in 'sparql-results+json' format
         */
        this.getEntityGraphBulk = async function (entityArray, verificationSettings) {
            return new Promise(async function (resolve, reject) {
                let query;
                if (verificationSettings.retailMode) {
                    query = await sparqlFactory.genQuery_EntityGraphBulk_withIds(entityArray, this.namedGraph, verificationSettings);
                } else {
                    query = await sparqlFactory.genQuery_EntityGraphBulk(entityArray, this.namedGraph, verificationSettings);
                }
                console.log(query);
                console.log("Query has a length of " + query.length + " chars.");
                let headers = {
                    'Accept': "application/sparql-results+json",
                    'Content-Type': "application/x-www-form-urlencoded"
                };
                if (this.loginToken !== null) {
                    headers['X-AUTH-TOKEN'] = this.loginToken;
                }
                try {
                    progress(request({
                            method: 'POST',
                            uri: this.endPointURL + '/repositories/' + this.repositoryId,
                            headers: headers,
                            form: {
                                query: query,
                                infer: false, //if graphDB should do inference (e.g. sub-classes)
                                timeout: this.timeOutDuration * 60 //timeout for graphdb in seconds
                            },
                            timeout: this.timeOutDuration * 60 * 1000 //timeout for request.js in milliseconds
                        }, function (err, res, body) {
                            if (err) {
                                reject(err);
                            } else {
                                try {
                                    resolve(JSON.parse(body));
                                } catch (e) {
                                    reject(err);
                                }
                            }
                        }),
                        {
                            throttle: 5000, //time in ms between progress updates (see .on 'progress')
                            delay: 5000 //delay between seing the query and the first progress update
                        }
                    ).on('progress', function (state) {
                        console.log("Download so far: " + state.time.elapsed + " seconds -> " + state.size.transferred / 1024 / 1024 + " MB");
                    }).on('error', function (err) {
                        console.log(err);
                        console.log("Error during execution of query 'getEntityGraphBulk'");
                        resolve(false);
                    }).on('end', function () {
                        //callback of request handles the promise resolving
                    });
                } catch (e) {
                    console.log(e);
                    console.log("Error during function 'getEntityGraphBulk'");
                    resolve(false);
                }
            }.bind(this));
        };

        /**
         * Retrieves a list of entities together with their data-graphs.
         * Only for !RetailMode and targets that are blank nodes.
         * @param {object} dsTargetObject - the target specification for the wished entities
         * @param {object} verificationSettings - the verification settings that may be relevant for the query
         * @return {boolean} true if the query was successful
         */
        this.getTargetListWithDataGraphs = async function (dsTargetObject, verificationSettings) {
            return new Promise(async function (resolve) {
                let query = await sparqlFactory.genQuery_EntityListWithData(this.namedGraph, dsTargetObject, verificationSettings);
                console.log(query);
                console.log("Query has a length of " + query.length + " chars.");
                let headers = {
                    'Accept': "text/csv",
                    'Content-Type': "application/x-www-form-urlencoded"
                };
                if (this.loginToken !== null) {
                    headers['X-AUTH-TOKEN'] = this.loginToken;
                }
                try {
                    progress(request({
                            method: 'POST',
                            uri: this.endPointURL + '/repositories/' + this.repositoryId,
                            headers: headers,
                            form: {
                                query: query,
                                infer: false,   //if graphDB should do inference (e.g. sub-classes)
                                timeout: this.timeOutDuration * 60 //timeout for graphdb in seconds
                            },
                            timeout: this.timeOutDuration * 60 * 1000 //timeout for request.js in milliseconds
                        }),
                        {
                            throttle: 5000,
                            delay: 1000
                        }
                    ).on('progress', function (state) {
                        console.log("Download so far: " + state.time.elapsed + " seconds -> " + state.size.transferred / 1024 / 1024 + " MB");
                    }).on('error', function (err) {
                        console.log(err);
                        console.log("Error during execution of query 'getTargetList'");
                        resolve(false);
                    }).on('end', function () {
                        resolve(true);
                    }).pipe(fs.createWriteStream(verificationSettings.fileName_targetListWithData));
                } catch (e) {
                    console.log(e);
                    console.log("Error during function 'getTargetListWithDataGraphs'");
                    resolve(false);
                }

            }.bind(this));
        };

        this.testQuery = async function (query) {
            return new Promise(async function (resolve, reject) {
                console.log(query);
                console.log("Query has a length of " + query.length + " chars.");
                let headers = {
                    'Accept': "text/csv",
                    'Content-Type': "application/x-www-form-urlencoded"
                };
                if (this.loginToken !== null) {
                    headers['X-AUTH-TOKEN'] = this.loginToken;
                }
                try {
                    request({
                        method: 'POST',
                        uri: this.endPointURL + '/repositories/' + this.repositoryId,
                        headers: headers,
                        form: {
                            query: query,
                            infer: false,
                            timeout: this.timeOutDuration * 60 //timeout for graphdb in seconds
                        },
                        timeout: this.timeOutDuration * 60 * 1000 //timeout for request.js in milliseconds
                    }, function (err, res, body) {
                        if (err) {
                            resolve(err);
                        } else {
                            try {
                                resolve(body);
                            } catch (e) {
                                console.log("could not JSON parse answer: " + body);
                                //response is no JSON
                                resolve(body);
                            }
                        }
                    });
                } catch (e) {
                    resolve(e);
                }
            }.bind(this));
        }
    }
}

module.exports = GraphDBConnector;