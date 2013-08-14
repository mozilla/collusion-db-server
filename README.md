API
===

getData
---
make a GET request to

    hostname: "collusiondb-development.herokuapp.com",
    path: "/getData",

The currently accepted params are:
* `name`: url of the site that you want to search for (eg. www.example.com)
* `date`: date that the connection was set (YYYY-MM-DD eg. 2012-12-31)
* `dateSince`: by default returns connections made from `dateSince` to 6 days onwards. Can be combined with param `timeSpan` if param `timeSpan` is presented.  (YYYY-MM-DD eg. 2013-02-11)
* `timeSpan`: in units of days. It has to be a number within 1 to 7(inclusive). A non-integer value will be rounded down to the nearest integer. Need to be paired with the `dateSince` param.

Note:
* if `name` param is omitted, aggregated data of the top 50 sites are returned
* if `date` and `dateSince` params are omitted, data returned is based on connections made in the last 24 hours

