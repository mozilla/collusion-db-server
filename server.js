if ( process.env.NEW_RELIC_HOME ) {
  require( 'newrelic' );
}

var express = require("express");
var app = express();
var crypto = require("crypto");
var mysql = require("mysql");
var pool = mysql.createPool(process.env.DATABASE_URL+"?flags=MULTI_STATEMENTS ");
var aggregate = require("./aggregate.js");
 
// Constants for indexes of properties in array format
const SOURCE = 0;
const TARGET = 1;
const TIMESTAMP = 2;
const CONTENT_TYPE = 3;
const COOKIE = 4;
const SOURCE_VISITED = 5;
const SECURE = 6;
const SOURCE_PATH_DEPTH = 7;
const SOURCE_QUERY_DEPTH = 8;
const SOURCE_SUB = 9;
const TARGET_SUB = 10;
const METHOD = 11;
const STATUS = 12;
const CACHEABLE = 13;
const IS_ROBOT = 14;
// ===
const DEFAULT_TIME_SPAN = 7; // in days

// enable CORS ==========
app.use(express.methodOverride());

// ## CORS middleware
// based on https://gist.github.com/cuppster/2344435
var allowCrossDomain = function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "resource://jid1-F9UJ2thwoAm5gQ-at-jetpack");
    res.header("Access-Control-Allow-Methods", "POST");
    res.header("Access-Control-Allow-Headers", "Content-Type, Collusion-Share-Data");
    if ("OPTIONS" == req.method) {
        res.send(200);
    }else{
        next();
    }
};
app.use("/shareData",allowCrossDomain);

app.configure(function(){
    app.use(express.static(__dirname + "/public"));
    app.use(express.bodyParser());
});

app.get("/", function(req, res) {
    console.log('/');
    res.send("Hello World!");
});


function dequeueResQueue(data,resQueue){
    while ( resQueue.length > 0 ){
        resQueue.shift().jsonp( data );
    }
}



/**************************************************
*   Get data handler
*/
app.get("/getData", function(req,res){
    console.log('/getData');
    var paramsLength = req.params.length || Object.keys(req.body).length || Object.keys(req.query).length;
    // if no params, show messages explaining how the parameters should be used
    if ( paramsLength == 0 ){
        res.redirect('/help.html');
    }else{
        aggregate.getAggregate(req,pool,function(result){
            res.jsonp(result);
        });
    }
});


/**************************************************
*   Dashboard Data
*/

var dashboardQueryRunning = false;
var dashboardQueue = [];

var dbDashboardQuery = function(callback){
    dashboardQueryRunning = true;
    var dataReturned = {};
    pool.getConnection(function(err,dbConnection){
        if ( err ){
            callback();
        }else{
            var queryArray = [];
            queryArray.push("SELECT COUNT(DISTINCT token) AS uniqueUsersUpload FROM LogUpload");
            queryArray.push("SELECT timestamp AS uniqueUsersUploadSince FROM LogUpload WHERE id=1");
            queryArray.push("SELECT COUNT(DISTINCT token) AS uniqueUsersUploadLast24H FROM LogUpload WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW()");
            queryArray.push("SELECT COUNT(*) AS totalConnectionsEver FROM Connection");
            queryArray.push("SELECT COUNT(*) AS totalConnectionsLast24H FROM Connection WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW()");
            queryArray.push("SELECT target AS site, count(DISTINCT source) AS numSources, count(id) as numConnections FROM Connection WHERE sourceVisited = false AND cookie = true GROUP BY target ORDER BY numSources DESC LIMIT 10");
            dbConnection.query(queryArray.join(";"),function(err, results){
                dbConnection.release();
                if (err) {
                    console.log("[ ERROR ] dashboardData query execution error: " + err);
                    dataReturned.error = err;
                }else{
                    dataReturned.uniqueUsersUpload = results[0][0].uniqueUsersUpload;
                    dataReturned.uniqueUsersUploadSince = new Date(results[1][0].uniqueUsersUploadSince).toString().slice(4,15);
                    dataReturned.uniqueUsersUploadLast24H = results[2][0].uniqueUsersUploadLast24H;
                    dataReturned.totalConnectionsEver = results[3][0].totalConnectionsEver;
                    dataReturned.totalConnectionsLast24H = results[4][0].totalConnectionsLast24H;
                    dataReturned.trackersArray = results[5];
                }
                callback(dataReturned);
            });
        }
    });
}

var runDashboardQuery = function(resQueue){
    dbDashboardQuery(function(data){
        dashboardQueryRunning = false;
        dequeueResQueue(data,resQueue);
    });
}

app.get("/dashboardData", function(req,res){
    dashboardQueue.push(res);
    if ( !dashboardQueryRunning ){
        runDashboardQuery(dashboardQueue);
    }
});


/**************************************************
*   Share data
*/

function shareDataHelper(req,res){
    var jsonObj = req.body;
    if ( jsonObj.format === "Collusion Save File" && jsonObj.version === "1.1" ){ // check format and version
        postToDB(jsonObj.connections,jsonObj.isRobot,function(result){
            console.log("========== SHARE DATA ENDS ==========");
            if ( result.error ){
                console.log("[ ERROR ] " + result.error);
            }else{
                console.log("[ Row Inserted into Table Connections ] " + result.rowAdded + " rows.");
                logUpload(jsonObj.token, result.rowAdded, result.timeStart, result.timeEnd);
            }
        });
        res.send('posting ' + jsonObj.connections.length + ' connections to database');
    }else{
        res.send("Sorry. Format/version " + jsonObj.format + "/" + jsonObj.version + " not supported.");
    }
}

function postToDB(connections,isRobot,callback){
    var postResponse = {
        rowAdded : 0,
        rowFailed: 0
    };
    var postConnectionQuery = "INSERT INTO Connection(source, target, timestamp, contentType, cookie, sourceVisited, secure, sourcePathDepth, sourceQueryDepth, sourceSub, targetSub, method, status, cacheable) VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    if (isRobot){ // data from spidering, setting the "isRobot" field to true
        postConnectionQuery = "INSERT INTO Connection(source, target, timestamp, contentType, cookie, sourceVisited, secure, sourcePathDepth, sourceQueryDepth, sourceSub, targetSub, method, status, cacheable, isRobot) VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)";
    }
    pool.getConnection( function(err,dbConnection){
        console.log("========== SHARE DATA STARTS ==========");
        postResponse.timeStart = Date.now();
        for (var i=0; i<connections.length; i++){
            connections[i][TIMESTAMP] = parseInt(connections[i][TIMESTAMP]) / 1000; // converts this UNIX time format from milliseconds to seconds
            dbConnection.query(postConnectionQuery, connections[i], function(err, results){
                dbConnection.release();
                if (err) {
                    if (err) console.log("[ ERROR ] shareData query execution error: " + err);
                    postResponse.error = "Sorry. Error occurred. Please try again.";
                    postResponse.rowFailed++;
                }else{
                    postResponse.rowAdded++;
                }
                if ( (postResponse.rowAdded+postResponse.rowFailed) == connections.length ){ // finished posting the last connection
                    postResponse.timeEnd = Date.now();
                    callback(postResponse);
                }
            });
        }
    });
}


// COR enabled
app.post("/shareData", function(req, res){
    shareDataHelper(req,res);
});

app.post("/donateData", function(req, res){
    shareDataHelper(req,res);
});



/**************************************************
*   Log posting transaction
*/
function logUpload(token,rowInserted,timeStart,timeEnd){
    var timestamp = timeStart;
    var processTime = timeEnd - timeStart; // in milliseconds
    pool.getConnection(function(err,dbConnection){
        var queryConfig = {
            text : "INSERT INTO LogUpload(token, rowInserted, timestamp, processTime) VALUES (?,?,FROM_UNIXTIME(?),?)",
            values : [ hashToken(token), rowInserted, timestamp, processTime ]
        };
        console.log("Logging upload transaction...");
        dbConnection.query(queryConfig.text, queryConfig.values, function(err, result){
            dbConnection.release();
            if (err) console.log("[ ERROR ] logUpload query execution error: " + err);
            else console.log("[ Row Inserted into Table LogUpload ] Row id: " + result.insertId);
        });
    });

}

/**************************************************
*   Get getBrowseData query result
*/
app.get("/getBrowseData", function(req,res){
    console.log("/getBrowseData");
    aggregate.getAggregate(req,pool,function(result){
        res.jsonp(result);
    });
});


/**************************************************
*   Get getVisitedWebsite query result
*/
app.get("/getSiteProfile", function(req,res){
    console.log("=== getSiteProfile === " + req.param("name"));
    aggregate.getAggregate(req,pool,function(result){
        res.jsonp(result);
    });
});


// === For the New Website ============================================================================


/**************************************************
*   Get databaseSiteList query result
*/

var databaseSiteListQueryRunning = false;
var databaseSiteListQueue = [];

function dbDatabaseSiteListQuery(callback){
    databaseSiteListQueryRunning = true;
    var queryArray = [];

    // for performance issue, for now set the time range to be the last 24 hours
    var top10Query =    "SELECT target AS site, count(DISTINCT source) AS numSources, count(id) as numConnections "+
                        "FROM Connection " + 
                        "WHERE sourceVisited = false AND cookie = true AND timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 7 DAY ) AND NOW() "+ // past 7 days
                        "GROUP BY target " + 
                        "ORDER BY numSources DESC LIMIT 10";
    var sitesQuery = 
        "SELECT source AS site, count(DISTINCT target) AS numConnectedSites, count(id) as numConnections " + 
        "FROM Connection " +
        "WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 7 DAY ) AND NOW() " + // past 7 days
        "GROUP BY source " +
        "UNION ALL " +
        "SELECT target AS site, count(DISTINCT source) AS numConnectedSites, count(id) as numConnections " + 
        "FROM Connection " +
        "WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 7 DAY ) AND NOW() " + // past 7 days
        "GROUP BY target " +
        "ORDER BY numConnectedSites DESC";
    
    // based on *all time* data
    // var top10Query =    "SELECT target AS site, count(DISTINCT source) AS numSources, count(id) as numConnections "+
    //                     "FROM Connection " + 
    //                     "WHERE sourceVisited = false AND cookie = true "+
    //                     "GROUP BY target " + 
    //                     "ORDER BY numSources DESC LIMIT 10";
    // var sitesQuery = 
    //     "SELECT source AS site, count(DISTINCT target) AS numConnectedSites, count(id) as numConnections " + 
    //     "FROM Connection " +
    //     "GROUP BY source " +
    //     "UNION ALL " +
    //     "SELECT target AS site, count(DISTINCT source) AS numConnectedSites, count(id) as numConnections " + 
    //     "FROM Connection " +
    //     "GROUP BY target " +
    //     "ORDER BY numConnectedSites DESC";

    queryArray.push(sitesQuery);
    queryArray.push(top10Query);

    pool.getConnection(function(connectionErr,dbConnection){
        if ( connectionErr ){
            dbConnection.release();
            callback();
        }else{
            dbConnection.query(queryArray.join(";"), function(err, results){
                dbConnection.release();
                if (err) console.log("[ ERROR ] databaseSiteList query execution error: " + err);
                callback(results);
            });
        }
    });
}

var runDatabaseSiteListQuery = function(resQueue){
    dbDatabaseSiteListQuery(function(data){
        databaseSiteListQueryRunning = false;
        dequeueResQueue(data,resQueue);
    });
}

app.get("/databaseSiteList", function(req,res){
    databaseSiteListQueue.push(res);
    if ( !databaseSiteListQueryRunning ){
        runDatabaseSiteListQuery(databaseSiteListQueue);
    }
});


/**************************************************
*   Get getSiteProfileNew query result
*/

var siteProfileNewQueryRunning = false;
var siteProfileNewQueue = [];

function dbSiteProfileNewQuery(req,callback){
    siteProfileNewQueryRunning = true;
    aggregate.getAllTimeSiteAggregate(req,pool,function(result){
        callback(result);
    });
}

var runSiteProfileNewQuery = function(req,site,resQueue){
    dbSiteProfileNewQuery(req,function(data){
        siteProfileNewQueryRunning = false;
        dequeueResQueue(data,resQueue);
    });
}


app.get("/getSiteProfileNew", function(req,res){
    console.log("=== getSiteProfile === " + req.param("name"));
    var site = req.param("name");
    siteProfileNewQueue.push(res);
    if ( !siteProfileNewQueryRunning ){
        runSiteProfileNewQuery(req,site,siteProfileNewQueue);
    }
});






app.listen(process.env.PORT, function() {
    console.log("Listening on " + process.env.PORT);
});
