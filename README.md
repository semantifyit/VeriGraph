# VeriGraph - Knowledge Graph Verification

This project holds the code of VeriGraph, a tool that enables the verification of Knowledge Graphs based on Domain Specifications (though SHACL constraints).

### Install

* Download/Git Clone this repository (https://github.com/semantifyit/VeriGraph)
* In root directory: run `npm install` (NodeJS)

### Structure 

The file `verificationFramework.js` shows an example script that uses the functions of `KGComplianceVerification.js` to execute the verification in the Console. In  `verificationFramework.js` you can set your settings for the verification job.

The file `KGComplianceVerification.js` holds the main programming interface that wraps the components of this project (see directory `assets`). 

The directory `domainSpecifications` holds the input domain specifications relevant for our paper.

The directory `evaluation` holds different evaluation scripts for our paper, along with a link to a data-dump with the evaluation results.

### Quick Start

* In root directory: run `npm start` or `node verificationFramework.js`
* The duration of the processes heavily depend on the verification settings, the amount/complexity of the target data, and the current usage of the target server. The progress of http requests are shown in the console. 
* The outcome of the verification is logged in text files at the script location.
    * There is exactly one `*_meta.txt` file logging the overall verification meta data.
    * There might be zero or more `_errors.txt` files logging the errors detected.
* Edit the settings at `verificationFramework.js` to test yourself.

The option `verificationSettings.retailMode` defines if the verification tool uses internal ids from graphDB or not (<http://www.ontotext.com/owlim/entity#id>). These IDs allow to identify entities, including blank nodes. Depending on the retailMode, the resulting error-dataPath include either internal ids or URIs to identify entities (URIs for blank nodes are worthless, since they are not guaranteed to be the same in different SPARQL Queries).

### Algorithm (as described in the paper)

* Identification and retrieval of target entities: Domain Specifications define the entities for which they specify constraints, either by a certain type (sh:targetClass) or by a certain property (sh:targetSubjectOf) the target must have. Based on this target definition, two SPARQL-queries are constructed and sent to the SPARQL-Endpoint of the Knowledge Graph. The results of the queries are streamed into two local files (which serve as memory on the disk, to allow the processing of large data sources). These files represent the following:
    * Target-entity-list for non-blank nodes: This list contains the URIs of all entities on the Knowledge Graph that are non-blanks nodes and match the target definition of the domain specification. This list is processed in step 2. of this algorithm, where for each URI a "data-graph" is retrieved. A data-graph is a sub-graph of the Knowledge Graph that contains all entities (nodes and literals) that are connected (through properties) with a given entity, specified by its URI. For performance reasons, the retrieval of the target-entity-list and the retrieval of their corresponding data-graphs are split into two separate steps.
    * Target-entity-list and data-graphs for blank nodes: Since the retrieval of a data-graph for a specific entity can only be achieved if that entity can be identified (through a URI), the target-entity-list generation and data-graph generation must be done with a single SPARQL query for entities that do not have a URI (blank nodes).   
* For each URI in the target-entity-list for non-blank nodes:
    * A corresponding data-graph is retrieved from the Knowledge Graph through a SPARQL-query. This data-graph is a sub-graph of the Knowledge Graph that contains all entities and literals in the Knowledge Graph that are connected with the specified entity.
    * The resulting data-graph is analyzed based on the constraints defined in the domain specification. Any constraint-violations are recorded as formal errors and saved into a local file.
* Processing of the target-entity-list and data-graphs for blank nodes: These data-graphs are categorized by the entity to which they belong. Then, each of these data-graphs is analyzed based on the constraints defined  in the domain specification and resulting errors are saved into a local file.
* Finalization of the verification: Metadata about the overall process is saved into a local file. The metadata includes the duration for the retrieval of target entities, the duration for the retrieval of data graphs, the duration for the verification of the data graphs, the amount of found entities, the amount of found errors and their distribution regarding their error codes (violated constraint type).