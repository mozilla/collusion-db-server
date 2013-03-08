var express = require("express");
var app = express();
var mysql = require("mysql");

app.configure(function(){
    app.use(express.static(__dirname + "/public"));
    app.use(express.bodyParser());
});


app.get("/", function(req, res) {
    res.send("Hello World!");
});


/**************************************************
*   Donate data
*/
app.post("/donateData", function(req, res){
    var jsonObj = req.body;
    if ( jsonObj.format === "Collusion Save File" && jsonObj.version === "1.0" ){ // check format and version
        var connections = jsonObj.connections;
        var rowAdded = 0;
        var client = mysql.createConnection(process.env.DATABASE_URL);
        client.connect(function(err){
            if ( err ) console.log("=== ERROR === " + err);
        }); 
        for (var i=0; i<connections.length; i++){
            connections[i][2] = parseInt(connections[i][2]) / 1000; // converts this UNIX time format from milliseconds to seconds
            //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
            client.query("INSERT INTO Connection(source, target, timestamp, contenttype, cookie, sourcevisited, secure, sourcepathdepth, sourcequerydepth) VALUES (?, ?, FROM_UNIXTIME(?), ?, ?, ?, ?, ?, ?)", connections[i], function(err, results){
                if (err) {
                    console.log("=== ERROR === " + err);
                    res.send("Sorry. Error occurred. Please try again.");
                }else{ rowAdded++; }           
            });
        }      
        client.end(function(err) {
            if (err) { console.log("=== ERROR === " + err); }
        });        
    }
    else{
        res.send("Sorry. Format/version " + jsonObj.format + "/" + jsonObj.version + " not supported.");
    }
});


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
                   "<li><b>source</b>: domain of the requested site. (eg. www.example.com, *.example.com)</li>" +
                   "<li><b>target</b>: domain of the target site.  (eg. www.example.com, *.example.com)</li>" + 
                   "<li><b>date</b>: date that the connection was set (YYYY-MM-DD eg. 2012-12-31)</li>" +
                   "<li><b>dateSince</b>: (if param dataBefore is not presented), returns every connection that were set between dateSince and now (YYYY-MM-DD eg. 2013-02-11)</li>" +
                   "<li><b>dateBefore</b>: (if param dataSince is not presented), returns every connection that were set up to and including dateBefore (YYYY-MM-DD eg. 2013-03-01)</li>" +
                   "<li><b>cookie</b>: whether or not any cookies were set. (true/false)</li>" + 
                   "<li><b>sourcevisited</b>: whether or not the source was loaded by the user in a page or tab.  (true/false)</li>" + 
                   "<li><b>secure</b>: whether or not content loaded via the HTTPS protocol.  (true/false)</li>" +  
                   "</ul></div>"       
        );
    }else{
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
            var resObj = {};
            var client = mysql.createConnection(process.env.DATABASE_URL);
    client.connect(function(err){
        if ( err ) console.log("=== ERROR === " + err);
    }); 
            //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
            var queryConfig = {
                text: "SELECT * FROM Connection WHERE " + filterArray.join(" AND "),
                values: valueArray
            };
            client.query(queryConfig.text, queryConfig.values, function(err, rows){
                if (err) {
                    resObj.error = "Error encountered: " + err;
                    console.log("=== ERROR === " + err);
                }
                resObj.rowCount = rows.length;
                resObj.rows = rows;
            });
            //disconnect client and send response when all queries are finished
            client.end(function(err) {
                if (err) { console.log("=== ERROR === " + err); }
                res.jsonp(resObj);
            });
        }
    }    
});



/**************************************************
*   Get getBrowseData query result
*/
app.get("/getBrowseData", function(req,res){
    var resObj = {};
    var client = mysql.createConnection(process.env.DATABASE_URL);
    client.connect(function(err){
        if ( err ) console.log("=== ERROR === " + err);
    }); 
  
    var trackersQuery = "SELECT target, COUNT(distinct source) FROM Connection GROUP BY target ORDER BY COUNT(distinct source) DESC LIMIT 10";
    var websitesQuery = "SELECT source, COUNT(distinct target), MAX(timestamp) FROM Connection where sourceVisited = true GROUP BY source ORDER BY COUNT(distinct target) DESC LIMIT 10";
    client.query(trackersQuery, function(err, rows){
        if (err) {
            resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.trackers = rows;
    });

    client.query(websitesQuery, function(err, rows){
        if (err) {
            resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.websites = rows;
    });

    client.end(function(err) {
        if (err) { console.log("=== ERROR === " + err); }
        res.jsonp(resObj);
    });
});


/**************************************************
*   Get getVisitedWebsite query result
*/
app.get("/getVisitedWebsite", function(req,res){
    console.log("=== getVisitedWebsite === " + req.param("source"));
    var resObj = {};
    var client = mysql.createConnection(process.env.DATABASE_URL);
    client.connect(function(err){
        if ( err ) console.log("=== ERROR === " + err);
    }); 

    var queryConfig = {
        text: "SELECT DISTINCT target, cookie FROM Connection WHERE source = ? ORDER BY target",
        values: [ req.param("source") ]
    };
  
    client.query(queryConfig.text, queryConfig.values, function(err, rows){
        if (err) {
            resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.rowCount = rows.length;
        resObj.rows = rows;
    });

    client.end(function(err) {
        if (err) { console.log("=== ERROR === " + err); }
        res.jsonp(resObj);
    });
});



/**************************************************
*   Get getTracker query result
*/
app.get("/getTracker", function(req,res){
    console.log("=== getTracker === " + req.param("target"));
    var resObj = {};
    var client = mysql.createConnection(process.env.DATABASE_URL);
    client.connect(function(err){
        if ( err ) console.log("=== ERROR === " + err);
    }); 
    
    //avoid SQL Injection attacks by using ? as placeholders for values to be escaped
    var queryConfig = {
        text: "SELECT DISTINCT source, cookie FROM Connection WHERE target = ? ORDER BY source",
        values: [ req.param("target") ]
    };
  
    client.query(queryConfig.text, queryConfig.values, function(err, rows){
        if (err) {
            resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.rowCount = rows.length;
        resObj.rows = rows;
    });

    client.end(function(err) {
        if (err) { console.log("=== ERROR === " + err); }
        res.jsonp(resObj);
    });
});




app.listen(process.env.PORT, function() {
    console.log("Listening on " + process.env.PORT);
});