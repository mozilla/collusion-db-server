Lightbeam for Firefox Database
===

Querying aggregated data
---
sending a GET request to

    hostname: "lightbeamdb.org",
    path: "getData",

##### The currently accepted params are: #####
Required:
* `name`: Domain of the requested site. (eg. www.example.com)

Timestamp related params, optional:
* `date`: Return connection data initiated on the date specified (YYYY-MM-DD eg. 2013-03-26) 
* `dateSince`: Return connection data initiated since the date specified (YYYY-MM-DD eg. 2013-03-26); Pair with
`timeSpan` or a default time span 7 days will be used. 
* `timeSpan`: Has to be paired with `dateSince`. In units of days. It has to be a number within 1 to 7(inclusive). A non-integer value will be rounded down to the nearest integer.

Note that
* if `date` and `dateSince` params are omitted, data returned is based on connections made in the last 24 hours





*****

Last updated: January 6, 2014 

For more information: visit [mozilla.org/lightbeam] (//mozilla.org/lightbeam)

