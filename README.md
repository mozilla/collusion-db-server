API
===

getData
---
make a GET request to

    hostname: "collusiondb-development.herokuapp.com",
    path: "/getData",

The currently accepted params are:

* `aggregateData`: whether or not you want the returned data to be aggregate (true/false)

- - -

When `aggregateData` is `true`, the additional params you can pass in are:
* `name`: url of the site that you want to search for (eg. www.example.com)
* `date`: date that the connection was set (YYYY-MM-DD eg. 2012-12-31)
* `dateSince`: (if param dataBefore is not presented), returns connections that were set between dateSince and now (YYYY-MM-DD eg. 2013-02-11)
* `dateBefore`: (if param dataSince is not presented), returns connections that were set up to and including dateBefore (YYYY-MM-DD eg. 2013-03-01)

Note:
* only the top 50 sites are returned
* if date/dateSince/dateBefore params are omitted, data returned is based on connections made in the last 24 hours
    
- - -
When `aggregateData` is `false`, the additional params you can pass in are
* `source`: domain of the requested site. (eg. www.example.com, *.example.com)
* `target`: domain of the target site. (eg. www.example.com, *.example.com)
* `date`: date that the connection was set (YYYY-MM-DD eg. 2012-12-31)
* `dateSince`: (if param dataBefore is not presented), returns connections that were set between dateSince and now (YYYY-MM-DD eg. 2013-02-11)
* `dateBefore`: (if param dataSince is not presented), returns connections that were set up to and including dateBefore (YYYY-MM-DD eg. 2013-03-01)
* `cookie`: whether or not any cookies were set. (true/false)
* `sourcevisited`: whether or not the source was loaded by the user in a page or tab. (true/false)
* `secure`: whether or not content loaded via the HTTPS protocol. (true/false)
