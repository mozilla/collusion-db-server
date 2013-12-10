if ( process.env.NEW_RELIC_HOME ) {
  require( 'newrelic' );
}

var express = require("express");
var app = express();
var crypto = require("crypto");
var mysql = require("mysql");
console.log(process.env.DATABASE_URL);
var pool = mysql.createPool(process.env.DATABASE_URL+"?flags=MULTI_STATEMENTS ");
console.log(pool);
var aggregate = require("./aggregate.js");
var memjs = require('memjs');
var client = memjs.Client.create();

console.log('starting up');
console.log('mysql: %s', process.env.DATABASE_URL+"?flags=MULTI_STATEMENTS");
console.log('pool: ' + pool);
console.log('environment: %j', process.env);
 
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
const CACHE_EXPIRE_TIME = 15*60; // 15 minutes in seconds
const CACHE_PROFILE_KEY = "PROFILE_";

// enable CORS ==========
app.use(express.methodOverride());

// ## CORS middleware
// based on https://gist.github.com/cuppster/2344435
var allowCrossDomain = function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "resource://jid1-f9uj2thwoam5gq-at-jetpack");
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


/**************************************************
*   Memcached
*/
function addDataToMemcached(key, value, resQueue, callback){
    if ( typeof value === "object" ){
        value = JSON.stringify(value);
    }
    //client.set(key, value, callback, lifetime, flags)
    client.set(key, value, function(err){
        if ( err ){
            console.log("[ Memcached Set Error ] " + err);
        }
        callback(value,resQueue);
    }, CACHE_EXPIRE_TIME);
}

var memcachedCallback = function(data,resQueue){
    while ( resQueue.length > 0 ){
        resQueue.shift().jsonp( JSON.parse(data) );
    }
}


/**************************************************
*   Get data handler
*/
app.get("/getData", function(req,res){
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
*   Dashboard Data - Total Connections
*/

var dashboardQueryRunning_totalConns = false;
var dashboardQueue_totalConns = [];

var dbDashboardQuery_totalConns = function(callback){
    dashboardQueryRunning_totalConns = true;
    var dataReturned = {};
    pool.getConnection(function(err,dbConnection){
        if ( err ){
            callback();
        }else{
            var queryArray = [];
            queryArray.push("SELECT Max(id) As totalConnectionsEver FROM Connection");
            queryArray.push("SELECT timestamp AS uniqueUsersUploadSince FROM Connection WHERE id=1");
            queryArray.push("SELECT COUNT(*) AS totalConnectionsLast24H FROM Connection WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW()");
            dbConnection.query(queryArray.join(";"),function(err, results){
                dbConnection.release();
                if (err) {
                    console.log("[ ERROR ] dashboardData query execution error: " + err);
                    dataReturned.error = err;
                }else{
                    dataReturned.totalConnectionsEver = results[0][0].totalConnectionsEver;
                    dataReturned.uniqueUsersUploadSince = new Date(results[1][0].uniqueUsersUploadSince).toString().slice(4,15);
                    dataReturned.totalConnectionsLast24H = results[2][0].totalConnectionsLast24H;
                }
                callback(dataReturned);
            });
        }
    });
}

var runDashboardQuery_totalConns = function(resQueue){
    dbDashboardQuery_totalConns(function(data){
        dashboardQueryRunning_totalConns = false;
        addDataToMemcached("dashboard_totalConns", data, resQueue, memcachedCallback);
    });
}
app.get("/dashboardData_totalConns", function(req,res){
    client.get("dashboard_totalConns", function(err,value){
        if ( value ){
            res.jsonp(JSON.parse(value));
        }else{
            dashboardQueue_totalConns.push(res);
            if ( !dashboardQueryRunning_totalConns ){
                runDashboardQuery_totalConns(dashboardQueue_totalConns);
            }
        }
    });
}); 

setInterval(runDashboardQuery_totalConns, CACHE_EXPIRE_TIME*1000); // runs every 15 mins, in milliseconds


/**************************************************
*   Dashboard Data - Last 24 Hours Connections
*/

var dashboardQueryRunning_last24conns = false;
var dashboardQueue_last24conns = [];

var dbDashboardQuery_last24conns = function(callback){
    dashboardQueryRunning_last24conns = true;
    var dataReturned = {};
    pool.getConnection(function(err,dbConnection){
        if ( err ){
            callback();
        }else{
            var queryArray = [];
            queryArray.push("SELECT COUNT(*) AS totalConnectionsLast24H FROM Connection WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW()");
            dbConnection.query(queryArray.join(";"),function(err, results){
                dbConnection.release();
                if (err) {
                    console.log("[ ERROR ] dashboardData query execution error: " + err);
                    dataReturned.error = err;
                }else{
                    dataReturned.totalConnectionsLast24H = results[0].totalConnectionsLast24H;
                }
                callback(dataReturned);
            });
        }
    });
}

var runDashboardQuery_last24conns = function(resQueue){
    dbDashboardQuery_last24conns(function(data){
        dashboardQueryRunning_last24conns = false;
        addDataToMemcached("dashboard_last24conns", data, resQueue, memcachedCallback);
    });
}
app.get("/dashboardData_last24conns", function(req,res){
    client.get("dashboard_last24conns", function(err,value){
        if ( value ){
            res.jsonp(JSON.parse(value));
        }else{
            dashboardQueue_last24conns.push(res);
            if ( !dashboardQueryRunning_last24conns ){
                runDashboardQuery_last24conns(dashboardQueue_last24conns);
            }
        }
    });
}); 

setInterval(runDashboardQuery_last24conns, CACHE_EXPIRE_TIME*1000); // runs every 15 mins, in milliseconds



/**************************************************
*   Dashboard Data - Top 10
*/

var dashboardQueryRunning_top10 = false;
var dashboardQueue_top10 = [];

var dbDashboardQuery_top10 = function(callback){
    dashboardQueryRunning_top10 = true;
    var dataReturned = {};
    pool.getConnection(function(err,dbConnection){
        if ( err ){
            console.log(err);
            callback();
        }else{
            var queryArray = [];
            queryArray.push("SELECT target AS site, count(DISTINCT source) AS numSources, count(id) as numConnections " +
                            "FROM Connection " + 
                            "WHERE sourceVisited = false AND cookie = true " + 
                            "GROUP BY target ORDER BY numSources DESC LIMIT 10");
            dbConnection.query(queryArray.join(";"),function(err, results){
                dbConnection.release();
                if (err) {
                    console.log("[ ERROR ] dashboardData query execution error: " + err);
                    dataReturned.error = err;
                }else{
                    dataReturned.trackersArray = results;
                }
                callback(dataReturned);
            });
        }
    });
}

var runDashboardQuery_top10 = function(resQueue){
    dbDashboardQuery_top10(function(data){
        dashboardQueryRunning_top10 = false;
        addDataToMemcached("dashboard_top10", data, resQueue, memcachedCallback);
    });
}
app.get("/dashboardData_top10", function(req,res){
    client.get("dashboard_top10", function(err,value){
        if ( value ){
            res.jsonp(JSON.parse(value));
        }else{
            dashboardQueue_top10.push(res);
            if ( !dashboardQueryRunning_top10 ){
                runDashboardQuery_top10(dashboardQueue_top10);
            }
        }
    });
}); 

setInterval(runDashboardQuery_top10, CACHE_EXPIRE_TIME*1000); // runs every 15 mins, in milliseconds








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
        addDataToMemcached("databaseSiteList", data, resQueue, memcachedCallback);
    });
}

app.get("/databaseSiteList", function(req,res){
    client.get("databaseSiteList", function(err,value){
        if ( value ){
            res.jsonp(JSON.parse(value));
        }else{
            databaseSiteListQueue.push(res);
            if ( !databaseSiteListQueryRunning ){
                runDatabaseSiteListQuery(databaseSiteListQueue);
            }
        }
    });
});

setInterval(runDatabaseSiteListQuery, CACHE_EXPIRE_TIME*1000); // runs every 15 mins, in milliseconds


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
        addDataToMemcached("CACHE_PROFILE_KEY+site,", data, resQueue, memcachedCallback);
    });
}


app.get("/getSiteProfileNew", function(req,res){
    console.log("=== getSiteProfile === " + req.param("name"));
    var site = req.param("name");
    client.get(CACHE_PROFILE_KEY+site, function(err,value){
        if ( value ){
            res.jsonp(JSON.parse(value));
        }else{
            siteProfileNewQueue.push(res);
            if ( !siteProfileNewQueryRunning ){
                runSiteProfileNewQuery(req,site,siteProfileNewQueue);
            }
        }
    });
});


app.listen(process.env.PORT, function() {
    console.log("Listening on " + process.env.PORT);
});
