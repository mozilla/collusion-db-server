var express = require("express");
var app = express();
var mysql = require("mysql");

app.configure(function(){
    app.use(express.static(__dirname + "/public"));
    app.use(express.bodyParser());
});

var pool = mysql.createPool(process.env.DATABASE_URL);

app.get("/", function(req, res) {
    res.send("Hello World!");
});

function Site(conn, isSource){
    this.firstAccess = this.lastAccess = conn.timestamp;
    this.linkedFrom = [];
    this.linkedTo = [];
    this.contentTypes = [];
    this.subdomain = [];
    this.method = [];
    this.status = [];
    this.visitedCount = 0;
    this.secureCount = 0;
    this.cookieCount = 0;
    this.howMany = 0;
    if (conn){
        this.update(conn, isSource);
    }
}

Site.prototype.update = function (conn, isSource){
    if (!this.name){
        this.name = isSource ? conn.source : conn.target;
    }
    if (conn.timestamp > this.lastAccess){
        this.lastAccess = conn.timestamp;
    }
    if (conn.timestamp < this.firstAccess){
        this.firstAccess = conn.timestamp;
    }
    if (isSource && (this.linkedTo.indexOf(conn.target) < 0)){
        this.linkedTo.push(conn.target);
    }
    if ((!isSource) && (this.linkedFrom.indexOf(conn.source) < 0)){
        this.linkedFrom.push(conn.source);
    }
    if (this.contentTypes.indexOf(conn.contentType) < 0){
        this.contentTypes.push(conn.contentType);
    }
    if (isSource){
        this.visitedCount = conn.sourceVisited ? this.visitedCount+1 : this.visitedCount;
        if ( this.subdomain.indexOf(conn.sourceSub) < 0 ){
            this.subdomain.push(conn.sourceSub);
        }
    }else{
        if ( this.subdomain.indexOf(conn.targetSub) < 0 ){
            this.subdomain.push(conn.targetSub);
        }
    }
    this.cookieCount = conn.cookie ? this.cookieCount+1 : this.cookieCount;
    this.secureCount = conn.secure ? this.secureCount+1 : this.secureCount;
    if ( this.method.indexOf(conn.method) < 0 ){
        this.method.push(conn.method);
    }
    if ( this.status.indexOf(conn.status) < 0 ){
        this.status.push(conn.status);
    }
    this.howMany++; 
    if ( this.visitedCount/this.howMany == 1 ){
        this.nodeType = 'site';
    }else if ( this.visitedCount/this.howMany == 0 ){
        this.nodeType = 'thirdparty';
    }else{
        this.nodeType = 'both';
    }
 
    return this;
}


/**************************************************
*   Get aggregate data by building a nodemap
*/
function getAggregate(req, callback){
    var nodemap = {};
    
    // include linked nodes to the result
    function includeLinkedNodes(nodeName, result){
        var linkedNodes = nodemap[nodeName].linkedFrom.concat(nodemap[nodeName].linkedTo);
        linkedNodes.forEach(function(linkedNodeName){
            // include the node when it is not in the result map yet
            if ( !result[linkedNodeName] ){ 
                var clone = {};
                for ( var p in nodemap[linkedNodeName] ){
                    if ( !(p == "linkedFrom" || p == "linkedTo") ){
                        clone[p] = nodemap[linkedNodeName][p];
                    }
                }
                result[linkedNodeName] = clone;
            }
        });
    }


    var timeFilter = "";
    var valueArray = new Array();
    if ( req.param("date") ){
        timeFilter = "timestamp BETWEEN TIMESTAMP(?) AND DATE_ADD( TIMESTAMP(?), INTERVAL 1 DAY ) ";
        valueArray.push( req.param("date") );
        valueArray.push( req.param("date") );
    }
    
    if ( req.param("dateSince") && req.param("dateBefore") ){
        timeFilter = "timestamp BETWEEN TIMESTAMP(?) AND DATE_ADD( TIMESTAMP(?), INTERVAL 1 DAY )";
        valueArray.push(req.param("dateSince"));
        valueArray.push(req.param("dateBefore"));
    }
    
    if ( req.param("dateSince") && !req.param("dateBefore") ){
        timeFilter = "timestamp BETWEEN TIMESTAMP(?) AND NOW()";
        valueArray.push(req.param("dateSince"));
    }

    if ( !req.param("dateSince") && req.param("dateBefore") ){
        timeFilter = "timestamp < TIMESTAMP(?)";
        valueArray.push(req.param("dateBefore"));
    }
    

    // get data from database
    pool.getConnection( function(err,dbConnection){
    
        console.log("================= GET AGGREGATE DATA START ===================");
        if ( valueArray.length > 0 ){
            var getAllquery = dbConnection.query("SELECT * FROM Connection WHERE " + timeFilter + " ORDER BY source, target ", valueArray );
        }else{
            // by default returns data from the past 24 hours
            var searchTo = new Date(Date.now());
            var dateOffset = (24*60*60*1000) * 1; // 1 day
            var searchFrom = new Date();
            searchFrom.setTime(searchFrom.getTime() - dateOffset);
            var timeRange = searchFrom + " to " + searchTo;
            var getAllquery = dbConnection.query("SELECT * FROM Connection WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW() ORDER BY source, target " );
        }
        getAllquery
            .on("error", function(err){})
            .on("fields", function(fields){})
            .on("result", function(row){
                if ( row ){
                    var site;
                    row.timestamp = row.timestamp.valueOf();
                    // check if the source site is existed in the map, if not create one
                    if ( !nodemap[row.source] ){
                        site = new Site(row, true);
                        nodemap[row.source] = site;
                    }else{
                        site = nodemap[row.source];
                        site.update(row, true);
                    }
                    // check if the target site is existed in the map, if not create one
                    if ( !nodemap[row.target] ){
                        site = new Site(row, false);
                        nodemap[row.target] = site;
                    }else{
                        site = nodemap[row.target];
                        site.update(row, false);
                    }
                }
            })
            .on("end", function(){
                if (err) { console.log("=== ERROR === " + err); }
                if ( req.param("name") ) {
                    var result = {};
                    if ( nodemap[req.param("name")] ){
                        result[req.param("name")] = nodemap[req.param("name")];
                        includeLinkedNodes(req.param("name"), result);
                    }
                    console.log("================= GET AGGREGATE DATA END ===================");
                    callback( Object.keys(result).length != 0 ? result : {});
                }else{
                    // sort the map by the value of the howMany property
                    var arr = Object.keys(nodemap).map(function(key){
                        return [ nodemap[key].howMany, nodemap[key] ];
                    }).sort(function(a,b){
                        return b[0] - a[0];
                    });
                    // when return, returns the top 50 nodes and their linked nodes
                    var top50 = {};
                    arr.slice(0,50).forEach(function(item){
                        top50[ item[1].name ] = item[1];
                    });
                    for ( var i in top50 ){
                        includeLinkedNodes(top50[i].name, top50);
                    }
                
                    console.log("================= GET AGGREGATE DATA(TOP 50) END ===================");
                    callback( Object.keys(top50).length != 0 ? top50 : {});
                }
            });
    });

};


/**************************************************
*   Get raw connection data
*/
function getRawData(req, callback){
    var filterArray = new Array();
    var valueArray = new Array();
    var paramNum = filterArray.length;      
    if ( req.param("source") ){
        paramNum++;
        if ( req.param("source").charAt(0) == "*" ){
            filterArray.push("source LIKE ?");
            valueArray.push("%" + req.param("source").slice(2));
        }else{
            filterArray.push("source = ?");
            valueArray.push(req.param("source"));
        }
    }
    
    if ( req.param("target") ){
        paramNum++;
        if ( req.param("target").charAt(0) == "*" ){
            filterArray.push("target LIKE ?");
            valueArray.push("%" + req.param("target").slice(2));
        }else{
            filterArray.push("target = ?");
            valueArray.push(req.param("target"));
        }
    }
    
    if ( req.param("date") ){
        paramNum++;
        filterArray.push("timestamp BETWEEN TIMESTAMP(?) AND DATE_ADD( TIMESTAMP(?), INTERVAL 1 DAY ) ");
        valueArray.push(req.param("date"));
        valueArray.push(req.param("date"));
    }
    
    if ( req.param("dateSince") && req.param("dateBefore") ){
        paramNum++;
        filterArray.push("timestamp BETWEEN TIMESTAMP(?) AND DATE_ADD( TIMESTAMP(?), INTERVAL 1 DAY )");
        valueArray.push(req.param("dateSince"));
        valueArray.push(req.param("dateBefore"));    
    }
    
    if ( req.param("dateSince") && !req.param("dateBefore") ){
        paramNum++;
        filterArray.push("timestamp BETWEEN TIMESTAMP(?) AND NOW()");
        valueArray.push(req.param("dateSince"));
    }

    if ( !req.param("dateSince") && req.param("dateBefore") ){
        paramNum++;
        filterArray.push("timestamp < TIMESTAMP(?)");
        valueArray.push(req.param("dateBefore"));
    }
           
    if ( req.param("cookie") ){
        paramNum++;
        filterArray.push("cookie = ?" );
        valueArray.push(req.param("cookie") == "true"); // convert String to Boolean
    }
    
    if ( req.param("sourcevisited") ){
        paramNum++;
        filterArray.push("sourcevisited = ?");
        valueArray.push(req.param("sourcevisited") == "true" );  // convert String to Boolean
    }
    
    if ( req.param("secure") ){
        paramNum++;
        filterArray.push("secure = ?");
        valueArray.push(req.param("secure") == "true" );  // convert String to Boolean
    }
    
    if ( filterArray.length > 0 && valueArray.length > 0 ){
        pool.getConnection( function(err,dbConnection){
            console.log("================= GET RAW DATA START ===================");
            var resObj = {};
            //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
            var queryConfig = {
                text: "SELECT * FROM Connection WHERE " + filterArray.join(" AND "),
                values: valueArray
            };
            dbConnection.query(queryConfig.text, queryConfig.values, function(err, rows){
                if (err) {
                    resObj.error = "Error encountered: " + err;
                    console.log("=== ERROR === " + err);
                }
                resObj.rowCount = rows.length;
                resObj.rows = rows;
                //disconnect dbConnection and send response when all queries are finished
                dbConnection.end(function(err) {
                    if (err) { console.log("=== ERROR === " + err); }
                    console.log("================= GET RAW DATA END ===================");
                    callback(resObj);
                });
            });
            
        });
    }
}




/**************************************************
*   Get SELECT query result
*/
app.get("/getData", function(req,res){
    var paramsLength = req.params.length || Object.keys(req.body).length || Object.keys(req.query).length;
    // if no params, show messages explaining how the parameters should be used
    if ( paramsLength == 0 ){
        res.send(  "<div style='font-family: Georgia'>" +
                   "<h1>Oops!</h1>" +
                   "The currently accepted params are: " +
                   "<ul>" +
                   "<li><b>aggregateData</b>: whether or not you want the returned data to be aggregate (true/false)</li><br/>" +
                   "<li>When <b>aggregateData</b> is <b>true</b>, the additional params you can pass in are" +
                        "<br/>Note that data returned is based on connections made in the last 24 hours" +
                        "<ul><li><b>name</b>: url of the site that you want to search for (eg. www.example.com)</li></ul>" +
                   "</li><br/>" +
                   "<li>When <b>aggregateData</b> is <b>false</b>, the additional params you can pass in are" +
                        "<ul>" +
                        "<li><b>source</b>: domain of the requested site. (eg. www.example.com, *.example.com)</li>" +
                        "<li><b>target</b>: domain of the target site.  (eg. www.example.com, *.example.com)</li>" + 
                        "<li><b>date</b>: date that the connection was set (YYYY-MM-DD eg. 2012-12-31)</li>" +
                        "<li><b>dateSince</b>: (if param dataBefore is not presented), returns every connection that were set between dateSince and now (YYYY-MM-DD eg. 2013-02-11)</li>" +
                        "<li><b>dateBefore</b>: (if param dataSince is not presented), returns every connection that were set up to and including dateBefore (YYYY-MM-DD eg. 2013-03-01)</li>" +
                        "<li><b>cookie</b>: whether or not any cookies were set. (true/false)</li>" + 
                        "<li><b>sourcevisited</b>: whether or not the source was loaded by the user in a page or tab.  (true/false)</li>" + 
                        "<li><b>secure</b>: whether or not content loaded via the HTTPS protocol.  (true/false)</li>" +
                            "</ul>" +
                       "</li>" +

                     
                   "</ul></div>"       
        );
    }else{
        if ( req.param("aggregateData") == "true" ){
            getAggregate(req,function(result){
                res.jsonp(result);
            });
        }else{
            getRawData(req,function(result){
                res.jsonp(result);
            });
        }
    }
});



/**************************************************
*   Donate data
*/
app.post("/donateData", function(req, res){
    var jsonObj = req.body;
    if ( jsonObj.format === "Collusion Save File" && jsonObj.version === "1.1" ){ // check format and version
        var connections = jsonObj.connections;
        var rowAdded = 0;
        pool.getConnection( function(err,dbConnection){
            console.log("================= DONATE DATA START ===================");
            for (var i=0; i<connections.length; i++){
                connections[i][2] = parseInt(connections[i][2]) / 1000; // converts this UNIX time format from milliseconds to seconds
                //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
                dbConnection.query("INSERT INTO Connection(source, target, timestamp, contentType, cookie, sourceVisited, secure, sourcePathDepth, sourceQueryDepth, sourceSub, targetSub, method, status, cacheable) VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", connections[i], function(err, results){
                    if (err) {
                        console.log("=== ERROR === " + err);
                        res.send("Sorry. Error occurred. Please try again.");
                    }else{
                        rowAdded++;
                    }
                    dbConnection.end(function(err) {
                        if (err) { console.log("=== ERROR === " + err); }
                    });                     
                });
            }
            console.log("================= DONATE DATA END ===================");
            res.send("Successfully shared %i connections", rowAdded);
        });     
    }
    else{
        res.send("Sorry. Format/version " + jsonObj.format + "/" + jsonObj.version + " not supported.");
    }
});




/**************************************************
*   Get getBrowseData query result
*/
app.get("/getBrowseData", function(req,res){
    pool.getConnection( function(err,dbConnection){
        var resObj = {};
        var trackersQuery = "SELECT target, COUNT(distinct source) FROM Connection GROUP BY target ORDER BY COUNT(distinct source) DESC LIMIT 10";
        var websitesQuery = "SELECT source, COUNT(distinct target), MAX(timestamp) FROM Connection where sourceVisited = true GROUP BY source ORDER BY COUNT(distinct target) DESC LIMIT 10";
        dbConnection.query(trackersQuery, function(err, rows){
            if (err) {
                resObj.error = "Error encountered:" + err;
                console.log("=== ERROR === " + err);
            }
            resObj.trackers = rows;
        });

        dbConnection.query(websitesQuery, function(err, rows){
            if (err) {
                resObj.error = "Error encountered:" + err;
                console.log("=== ERROR === " + err);
            }
            resObj.websites = rows;
            
            dbConnection.end(function(err) {
                if (err) { console.log("=== ERROR === " + err); }
                res.jsonp(resObj);
            });
        });

    });
    
});


/**************************************************
*   Get getVisitedWebsite query result
*/
app.get("/getVisitedWebsite", function(req,res){
    console.log("=== getVisitedWebsite === " + req.param("source"));
    pool.getConnection( function(err,dbConnection){
        var resObj = {};

        var queryConfig = {
            text: "SELECT DISTINCT target, cookie FROM Connection WHERE source = ? ORDER BY target",
            values: [ req.param("source") ]
        };
  
        dbConnection.query(queryConfig.text, queryConfig.values, function(err, rows){
            if (err) {
                resObj.error = "Error encountered:" + err;
                console.log("=== ERROR === " + err);
            }
            resObj.rowCount = rows.length;
            resObj.rows = rows;
            dbConnection.end(function(err) {
            if (err) { console.log("=== ERROR === " + err); }
                res.jsonp(resObj);
            });
        });        
    });
});



/**************************************************
*   Get getThirdPartyWebsite query result
*/
app.get("/getThirdPartyWebsite", function(req,res){
    console.log("=== getTracker === " + req.param("target"));
    pool.getConnection( function(err,dbConnection){
        var resObj = {};
    
        //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
        var queryConfig = {
            text: "SELECT DISTINCT source, cookie FROM Connection WHERE target = ? ORDER BY source",
            values: [ req.param("target") ]
        };
  
        dbConnection.query(queryConfig.text, queryConfig.values, function(err, rows){
            if (err) {
                resObj.error = "Error encountered:" + err;
                console.log("=== ERROR === " + err);
            }
            resObj.rowCount = rows.length;
            resObj.rows = rows;
            dbConnection.end(function(err) {
                if (err) { console.log("=== ERROR === " + err); }
                res.jsonp(resObj);
            });
        });
    });
});




app.listen(process.env.PORT, function() {
    console.log("Listening on " + process.env.PORT);
});