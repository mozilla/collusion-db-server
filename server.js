var express = require("express");
var app = express();
var pg = require("pg");

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
        var client = new pg.Client(process.env.DATABASE_URL);
        var rowAdded = 0;
        client.connect(function(err) {
            if (err) console.log(err);
        });
        for (var i=0; i<connections.length; i++){
            connections[i][2] = parseInt(connections[i][2]) / 1000; // converts this UNIX time format from milliseconds to seconds
            //a paramaterized query provides a barrier to sql injection attacks
            client.query({
                text: "INSERT INTO connections(source, target, timestamp, contenttype, cookie, sourcevisited, secure, sourcepathdepth, sourcequerydepth) VALUES ($1, $2, to_timestamp($3), $4, $5, $6, $7, $8, $9)",
                values: connections[i]
            }, function(err,result){
                if (err) {
                    console.log("=== ERROR === " + err);
                    res.send("Sorry. Error occurred. Please try again.");
                }else{ rowAdded++; }
            });
        }
        //disconnect client and send response when all queries are finished
        client.on("drain", function(){
            client.end.bind(client);
            res.send("Thanks! " + rowAdded + " of rows were successfully added to the database.");
        });
    }else{
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
                filterArray.push("source LIKE $" + paramNum);
                valueArray.push("%" + req.param("source").slice(2));
            }else{
                filterArray.push("source = $" + paramNum);
                valueArray.push(req.param("source"));
            }
        }
        
        if ( req.param("target") ){
            paramNum++;
            if ( req.param("target").charAt(0) == "*" ){
                filterArray.push("target LIKE $" + paramNum);
                valueArray.push("%" + req.param("target").slice(2));
            }else{
                filterArray.push("target = $" + paramNum);
                valueArray.push(req.param("target"));
            }
        }
        
        if ( req.param("date") ){
            paramNum++;
            filterArray.push("timestamp BETWEEN to_timestamp($" +  paramNum + ", 'YYYY-MM-DD') " +
                                                 " AND to_timestamp($" + paramNum + ", 'YYYY-MM-DD') + interval '1 day'" );
            valueArray.push(req.param("date"));
        }
        
        if ( req.param("cookie") ){
            paramNum++;
            filterArray.push("cookie = $" + paramNum );
            valueArray.push(req.param("cookie"));
        }
        
        if ( req.param("sourcevisited") ){
            paramNum++;
            filterArray.push("sourcevisited = $" + paramNum );
            valueArray.push(req.param("sourcevisited"));
        }
        
        if ( req.param("secure") ){
            paramNum++;
            filterArray.push("secure = $" + paramNum );
            valueArray.push(req.param("secure"));
        }
        
        if ( filterArray.length > 0 && valueArray.length > 0 ){
            var resObj = {};
            var client = new pg.Client(process.env.DATABASE_URL);
            client.connect(function(err) {
                if (err) console.log(err);
            });
            //a paramaterized query provides a barrier to sql injection attacks
            var queryConfig = {
                text: "SELECT * FROM connections WHERE " + filterArray.join(" AND "),
                values: valueArray
            };
            client.query(queryConfig, function(err, result){
                if (err) {
                    resObj.error = "Error encountered: " + err;
                    console.log("=== ERROR === " + err);
                }
                resObj.rowCount = result.rowCount;
                resObj.rows = result.rows;
            });
            //disconnect client and send response when all queries are finished
            client.on("drain", function(){
                client.end.bind(client);
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
    var client = new pg.Client(process.env.DATABASE_URL);
        client.connect(function(err) {
            if (err) console.log(err);
    });
  
    client.query(req.param("trackersQuery"), function(err, result){
        if (err) {
            resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.trackers = result.rows;
    });

    client.query(req.param("websitesQuery"), function(err, result){
        if (err) {
           resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.websites = result.rows;
    });

    //disconnect client and send response when all queries are finished
    client.on("drain", function(){
        client.end.bind(client);
        res.jsonp(resObj);
    });
});


/**************************************************
*   Get getVisitedWebsite query result
*/
app.get("/getVisitedWebsite", function(req,res){
    console.log("=== getVisitedWebsite === " + req.param("source"));
    var resObj = {};
    var client = new pg.Client(process.env.DATABASE_URL);
    client.connect(function(err) {
        if (err) console.log(err);
    });

    var queryConfig = {
        text: "SELECT DISTINCT target, cookie FROM connections WHERE source LIKE substr(quote_literal($1), 2, length($1)) ORDER BY target",
        values: [ req.param("source") ]
    };
  
    client.query(queryConfig, function(err, result){
        if (err) {
            resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.rowCount = result.rowCount;
        resObj.rows = result.rows;
    });

    //disconnect client and send response when all queries are finished
    client.on("drain", function(){
        client.end.bind(client);
        res.jsonp(resObj);
    });
});



/**************************************************
*   Get getTracker query result
*/
app.get("/getTracker", function(req,res){
    console.log("=== getTracker === " + req.param("target"));
    var resObj = {};
    var client = new pg.Client(process.env.DATABASE_URL);
        client.connect(function(err) {
            if (err) console.log(err);
    });

    var queryConfig = {
        text: "SELECT DISTINCT source, cookie FROM connections WHERE target LIKE substr(quote_literal($1), 2, length($1)) ORDER BY source",
        values: [ req.param("target") ]
    };
  
    client.query(queryConfig, function(err, result){
        if (err) {
            resObj.error = "Error encountered:" + err;
            console.log("=== ERROR === " + err);
        }
        resObj.rowCount = result.rowCount;
        resObj.rows = result.rows;
    });

    //disconnect client and send response when all queries are finished
    client.on("drain", function(){
        client.end.bind(client);
        res.jsonp(resObj);
    });
});




app.listen(process.env.PORT, function() {
    console.log("Listening on " + process.env.PORT);
});