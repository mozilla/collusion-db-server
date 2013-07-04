const DEFAULT_TIME_SPAN = 7;
var nodemapAllTime = {};
var nodemap = {};

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
*   Get and Return Aggregated Data 
*/
exports.getAggregate = function(req, pool, callback){
    var query = "";
    var timeFilter = "";
    var valueArray = new Array();
    var timeSpan = DEFAULT_TIME_SPAN;
    
    if ( req.param("date") ){
        timeFilter = "timestamp BETWEEN TIMESTAMP(?) AND DATE_ADD( TIMESTAMP(?), INTERVAL 1 DAY ) ";
        valueArray.push( req.param("date") );
        valueArray.push( req.param("date") );
    }

    if ( req.param("dateSince") ){
        var timeSpanOutOfRange = ( req.param("timeSpan") < 1 ) || ( req.param("timeSpan") > timeSpan );
        if ( timeSpanOutOfRange ){
            callback({error: "timeSpan is in units of days. It has to be a number within 1 to 7(inclusive). A non-integer value will be rounded down to the nearest integer."});
            return;
        }
        if ( req.param("timeSpan") <= timeSpan ){
            timeSpan = req.param("timeSpan");
        } // else timeSpan stays as default, 7
        timeFilter = "timestamp BETWEEN TIMESTAMP(?) AND DATE_ADD( TIMESTAMP(?), INTERVAL ? DAY )";
        valueArray.push(req.param("dateSince"));
        valueArray.push(req.param("dateSince"));
        valueArray.push(timeSpan);
    }
    
    if ( req.param("timeSpan") && !req.param("dateSince") ){
        callback({error: "timeSpan param cannot be used alone. Please specify dateSince."});
        return;
    }

    pool.getConnection(function(err,dbConnection){
        if ( valueArray.length > 0 ){
            query = dbConnection.query("SELECT * FROM Connection WHERE " + timeFilter + " ORDER BY source, target ", valueArray );
        }else{
            query = dbConnection.query("SELECT * FROM Connection WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW() ORDER BY source, target " );
        }
        dbAggregateDataQuery(req.param("name"),dbConnection,query,function(data){
            callback(data);
        });
    });
};


exports.getAllTimeAggregate = function(req,pool,callback){
    pool.getConnection(function(err,dbConnection){
        // get data from database
        console.log("========== GET A SITE'S ALLTIME AGGREGATE DATA STARTS ==========");
        // for performance issue, for now set the time range to be the last 24 hours
        dbConnection.query("SELECT * FROM Connection WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW() ")
        // dbConnection.query("SELECT * FROM Connection")
            .on("error", function(err){
                if (err)  console.log("[ ERROR ] getAggregate query execution error: " + err);
            })
            .on("fields", function(fields){})
            .on("result", function(row){
                if ( row ){
                    buildNodemap(nodemapAllTime,row);
                }
            })
            .on("end", function(err){
                if (err) { 
                    console.log("[ ERROR ] end connection error" + err); 
                }
                console.log(req.param("name"));
                var data = filterNodemapData(nodemapAllTime, req.param("name"));
                nodemapAllTime = {};
                callback( data );
            });
    });
};


/**************************************************
*   Get Aggregated Data from Database
*/
function dbAggregateDataQuery(siteName,dbConnection,query,callback){
    // get data from database
    console.log("========== GET AGGREGATE DATA STARTS ==========");
    query
        .on("error", function(err){
            if (err)  console.log("[ ERROR ] getAggregate query execution error: " + err);
        })
        .on("fields", function(fields){})
        .on("result", function(row){
            if ( row ){
                buildNodemap(nodemap,row);
            }
        })
        .on("end", function(err){
            if (err) { 
                console.log("[ ERROR ] end connection error" + err); 
            }
            var data = filterNodemapData(nodemap,siteName);
            nodemap = {};
            callback(data);
        });
}


/**************************************************
*   Build nodemap 
*/
function buildNodemap(theNodemap,connection){
    var site;
    connection.timestamp = connection.timestamp.valueOf();
    // check if the source site is existed in the map, if not create one
    if ( !theNodemap[connection.source] ){
        site = new Site(connection, true);
        theNodemap[connection.source] = site;
    }else{
        site = theNodemap[connection.source];
        site.update(connection, true);
    }
    // check if the target site is existed in the map, if not create one
    if ( !theNodemap[connection.target] ){
        site = new Site(connection, false);
        theNodemap[connection.target] = site;
    }else{
        site = theNodemap[connection.target];
        site.update(connection, false);
    }
}


/**************************************************
*   Apply Filter on nodemap
*/
function filterNodemapData(theNodemap,siteName){
    if ( siteName ) {
        var siteURL = siteName;
        var result = {};
        if ( theNodemap[siteURL] ){
            result[siteURL] = theNodemap[siteURL];
            result = includeLinkedNodes(theNodemap,siteURL,result);
        }
        console.log("========== GET AGGREGATE DATA ENDS ==========");
        // callback( Object.keys(result).length != 0 ? result : {});
        return Object.keys(result).length != 0 ? result : {};
    }else{
        // sort the map by the value of the howMany property
        var arr = Object.keys(theNodemap).map(function(key){
            return [ theNodemap[key].howMany, theNodemap[key] ];
        }).sort(function(a,b){
            return b[0] - a[0];
        });
        // when return, returns the top 50 nodes and their linked nodes
        var top50 = {};
        arr.slice(0,50).forEach(function(item){
            top50[ item[1].name ] = item[1];
        });
        for ( var i in top50 ){
            top50 = includeLinkedNodes(theNodemap,top50[i].name, top50);
        }
    
        console.log("========== GET AGGREGATE DATA(TOP 50) ENDS ==========");
        // callback( Object.keys(top50).length != 0 ? top50 : {});
        return Object.keys(top50).length != 0 ? top50 : {};
    }
}


/**************************************************
*   Helper for function filterNodemapData
*   (include linked nodes to the result)
*/
function includeLinkedNodes(theNodemap,nodeName,result){
    var linkedNodes = theNodemap[nodeName].linkedFrom.concat(theNodemap[nodeName].linkedTo);
    linkedNodes.forEach(function(linkedNodeName){
        // include the node when it hasn't been added to the result map
        if ( !result[linkedNodeName] ){ 
            var clone = {};
            for ( var p in theNodemap[linkedNodeName] ){
                if ( !(p == "linkedFrom" || p == "linkedTo") ){
                    clone[p] = theNodemap[linkedNodeName][p];
                }
            }
            result[linkedNodeName] = clone;
        }
    });
    return result;
}

