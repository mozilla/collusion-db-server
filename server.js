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


// Mavis: OK.  Works both with node.js.  POST jsonp via AJAX is not allowed.
/* Donate data handler ========================================================= */
app.post("/donateData", function(req, res){
  console.log(req.body);
  
  var jsonObj = req.body;
  if ( jsonObj.format == "CollusionSaveFile" && jsonObj.version == "1.0" ){ // check format and version
    var connections = jsonObj.connections;
    var client = new pg.Client(process.env.DATABASE_URL);
    client.connect(function(err) {
        if (err) console.log(err);
    });
    for (var i=0; i<connections.length; i++){
      connections[i][2] = parseInt(connections[i][2]) / 1000; // converts this UNIX time format from milliseconds to seconds
      client.query({
        text: "INSERT INTO connections(source, target, timestamp, contenttype, cookie, sourcevisited, secure, sourcepathdepth, sourcequerydepth) VALUES (substr(quote_literal($1), 2, length($1)), substr(quote_literal($2), 2, length($2)), to_timestamp($3), substr(quote_literal($4), 2, length($4)), $5, $6, $7, $8, $9)",
        values: connections[i]
      }, function(err,result){
            if (err) {
              console.log(err);
              res.send("Sorry. Error occurred. Please try again.");
            }else res.send("Thanks!");
      });
    }
  }else{
    res.send("Sorry. Format/version not supported.");
  }
});


// Mavis: OK.  Works both in ajax and node.js
/**************************************************
*   show SELECT query result
*/
app.get("/showResult", function(req,res){

  var resObj = {};
  var client = new pg.Client(process.env.DATABASE_URL);
    client.connect(function(err) {
      if (err) console.log(err);
  });
  
  if ( req.param("source") ){
    var queryConfig = {
      text: "SELECT * FROM connections WHERE source = substr(quote_literal($1), 2, length($1))",
      values: [ req.param("source") ]
    };
  }else if( req.param("target") ){
    var queryConfig = {
      text: "SELECT * FROM connections WHERE target = substr(quote_literal($1), 2, length($1))",
      values: [ req.param("target") ]
    };
  }else if( req.param("cookie") ){
    var queryConfig = {
      text: "SELECT * FROM connections WHERE cookie = $1",
      values: [ req.param("cookie") ]
    };
  }else if( req.param("sourcevisited") ){
    var queryConfig = {
      text: "SELECT * FROM connections WHERE sourcevisited = $1",
      values: [ req.param("sourcevisited") ]
    };
  }else if( req.param("secure") ){
    var queryConfig = {
      text: "SELECT * FROM connections WHERE secure = $1",
      values: [ req.param("secure") ]
    };
  }

  if ( queryConfig ){
    client.query(queryConfig, function(err, result){
      if (err) { resObj.error = "Error encountered:" + err; }
      resObj.rowCount = result.rowCount;
      resObj.rows = result.rows;
    });
  }

  //disconnect client and send response when all queries are finished
  client.on("drain", function(){
    client.end.bind(client);
    res.jsonp(resObj);
  });
  


});





app.listen(process.env.PORT, function() {
  console.log("Listening on " + process.env.PORT);
});