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
exports.getAggregate = function(req, pool, callback){
    var nodemap = {};
    
    // include linked nodes to the result
    function includeLinkedNodes(nodeName, result){
        var linkedNodes = nodemap[nodeName].linkedFrom.concat(nodemap[nodeName].linkedTo);
        linkedNodes.forEach(function(linkedNodeName){
            // include the node when it hasn't been added to the result map
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
    
        console.log("========== GET AGGREGATE DATA STARTS ==========");
        if ( valueArray.length > 0 ){
            var getAllquery = dbConnection.query("SELECT * FROM Connection WHERE " + timeFilter + " ORDER BY source, target ", valueArray );
        }else{
            var getAllquery = dbConnection.query("SELECT * FROM Connection WHERE timestamp BETWEEN DATE_SUB( NOW(), INTERVAL 1 DAY ) AND NOW() ORDER BY source, target " );
        }
        getAllquery
            .on("error", function(err){
                if (err)  console.log("[ ERROR ] getAggregate query execution error: " + err);
            })
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
            .on("end", function(err){
                if (err) { console.log("[ ERROR ] end connection error" + err); }
                if ( req.param("name") ) {
                    var result = {};
                    if ( nodemap[req.param("name")] ){
                        result[req.param("name")] = nodemap[req.param("name")];
                        includeLinkedNodes(req.param("name"), result);
                    }
                    console.log("========== GET AGGREGATE DATA ENDS ==========");
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
                
                    console.log("========== GET AGGREGATE DATA(TOP 50) ENDS ==========");
                    callback( Object.keys(top50).length != 0 ? top50 : {});
                }
            });
    });

};
