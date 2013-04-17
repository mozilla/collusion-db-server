var express = require("express");
var app = express();
var mysql = require("mysql");
var aggregate = require("./aggregate.js");

app.configure(function(){
    app.use(express.static(__dirname + "/public"));
    app.use(express.bodyParser());
});

var pool = mysql.createPool(process.env.DATABASE_URL);

app.get("/", function(req, res) {
    res.send("Hello World!");
});



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
            console.log("========== GET RAW DATA STARTS ==========");
            var resObj = {};
            //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
            var queryConfig = {
                text: "SELECT * FROM Connection WHERE " + filterArray.join(" AND "),
                values: valueArray
            };
            dbConnection.query(queryConfig.text, queryConfig.values, function(err, rows){
                if (err) {
                    resObj.error = "Error encountered: " + err;
                    console.log("[ ERROR ] getRawData query execution error: " + err);
                }
                resObj.rowCount = rows.length;
                resObj.rows = rows;
                //disconnect dbConnection and send response when all queries are finished
                dbConnection.end(function(err) {
                    if (err) { console.log("[ ERROR ] end connection error: " + err); }
                    console.log("========== GET RAW DATA ENDS ==========");
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
            aggregate.getAggregate(req,pool,function(result){
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

    function postToDB(connections,callback){
        var postResponse = {};
        postResponse.rowAdded = 0;
        postResponse.rowFailed = 0;
        pool.getConnection( function(err,dbConnection){
            var lastConnection = false;
            console.log("========== DONATE DATA STARTS ==========");
            for (var i=0; i<connections.length; i++){
                if ( i == (connections.length-1) ) lastConnection = true;
                connections[i][2] = parseInt(connections[i][2]) / 1000; // converts this UNIX time format from milliseconds to seconds
                //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
                dbConnection.query("INSERT INTO Connection(source, target, timestamp, contentType, cookie, sourceVisited, secure, sourcePathDepth, sourceQueryDepth, sourceSub, targetSub, method, status, cacheable) VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", connections[i], function(err, results){
                    if (err) {
                        if (err) console.log("[ ERROR ] donateData query execution error: " + err);
                        postResponse.error = "Sorry. Error occurred. Please try again.";
                        postResponse.rowFailed++;
                    }else{
                        postResponse.rowAdded++;
                    }
                    dbConnection.end(function(err) {
                        if (err) console.log("[ ERROR ] end connection error: " + err);
                        if ( (postResponse.rowAdded+postResponse.rowFailed) == connections.length ){ // finished posting the last connection
                            callback(postResponse);
                        }
                    });                     
                });
            }
        });     
    }
    
    
    var jsonObj = req.body;
    if ( jsonObj.format === "Collusion Save File" && jsonObj.version === "1.1" ){ // check format and version
        postToDB(jsonObj.connections,function(result){
            console.log("========== DONATE DATA ENDS ==========");
            if ( result.error ){
                res.send(result.error);
            }else{
                res.send("Successfully shared " + result.rowAdded + " connections.");
            }
        });
    }else{
        res.send("Sorry. Format/version " + jsonObj.format + "/" + jsonObj.version + " not supported.");
    }

});




/**************************************************
*   Get getBrowseData query result
*/
app.get("/getBrowseData", function(req,res){
    pool.getConnection( function(err,dbConnection){
        aggregate.getAggregate(req,pool,function(result){
                res.jsonp(result);
        });
    });
    
});


/**************************************************
*   Get getVisitedWebsite query result
*/
app.get("/getSiteProfile", function(req,res){
    console.log("=== getSiteProfile === " + req.param("name"));
    pool.getConnection( function(err,dbConnection){
        aggregate.getAggregate(req,pool,function(result){
            res.jsonp(result);
        });
    });
});



app.listen(process.env.PORT, function() {
    console.log("Listening on " + process.env.PORT);
});