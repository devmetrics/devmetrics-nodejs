module.exports = function(options) {
    var token = options['token'];
    var host = options['host'];


    ///// LOGS
    var winston = require('winston'); require('winston-logstash');
    winston.emitErrs = true;
    var loggerObj = new winston.Logger({
        transports: [
            new winston.transports.Logstash({
                level: 'info',
                port: 5545,
                node_name: token,
                host: host,
                handleExceptions: true
            }),
            new winston.transports.Console({
                level: 'debug',
                handleExceptions: true,
                json: false,
                colorize: true,
            })
        ],
        exitOnError: false
    });


    ///// STATSD SENDER
    var lynx = require('lynx');
    var metrics = new lynx(host, 5546, {scope:token});


    ///// REQUEST LOGS
    var logsStream  = {
        write: function(message, encoding){
            loggerObj.info('webrequest: ' + message);
        }
    };
    var requestLogHandler = require('morgan')('tiny', { 'stream': logsStream })


    ///// REQUEST METRICS
    var expressStatsd = require('express-statsd');
    var requestMetricHandler = expressStatsd({'client': metrics, 'requestKey': 'url'})

    return {'logger': loggerObj, 'metrics': metrics, 'requestLogs': requestLogHandler, 'requestMetrics': requestMetricHandler};
}

