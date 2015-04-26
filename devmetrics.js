(function() {

  module.exports = function(app, options) {
    var mode = null;
    if (options && options['mode']) {
      mode = options['mode'];
    }

    if (global.devmetrics) {
      if (mode == 'logger') {
        return global.devmetrics.logger;
      }
      return global.devmetrics;
    }

    if (!global.dmdata) {
      global.dmdata = {};
    }

    var os = require("os");
    var hostname = os.hostname();
    if (!hostname) {
      hostname = 'undefined_host';
    }

    var version = options['code_version'] ? options['software_version'] : 1;
    var host = options['host'];

    var app_id = options['token'] ? options['token'] : hostname.replace(/[\W_]+/g," "); // only alphanum for token

    ///// LOGS
    var winston = require('winston'); require('winston-logstash');
    winston.emitErrs = true;
    var loggerObj = new winston.Logger({
      transports: [
        new winston.transports.Logstash({
          level: 'debug',
          port: 5545,
          node_name: app_id,
          host: host,
          handleExceptions: true
        }),
        new winston.transports.Console({
          level: 'debug',
          handleExceptions: true,
          json: false,
          colorize: true
        })
      ],
      exitOnError: false
    });

    loggerObj['app_event'] = function(event_name) {
      loggerObj.info('App Event: ' + event_name); // change event_type field
      metrics.increment('application.' + event_name);
    }

    loggerObj.info('Checkout dashboards @ http://devmetrics.io/dashboard/' + app_id);

    ///// STATSD SENDER
    var lynx = require('lynx');
    var metrics = new lynx(host, 5546, {scope:app_id});

    ///// REQUEST LOGS
    var logsStream  = {
      write: function(message, encoding) {
        loggerObj.info(message);
      }
    };

    var morgan = require('morgan');
    morgan.token('statsdKey', function getStatsdKey(req) {
      return req.statsdKey
    });
    morgan.token('sessionId', function(req, res) {
      if (!global.dmdata['session']) {
        global.dmdata['session'] = req.session ? req.session.id : 'N/A';
      }
      return global.dmdata['session'];
    });



    var requestLogHandler = morgan('{'+
      '"app_id":"' + app_id + '" ,' +
      '"event_type":"http_request",' +
      '"host":"' + host + '" ,' +
      '"session":":sessionId",' +
      '"correlation":":sessionId",' + //better correlation?
      '"request_uri":":statsdKey",' +
      '"message":"client - :remote-addr  [:date] :method :url HTTP/:http-version :status :res[content-length] :referrer :user-agent ",' +
      '"version":"' + version + '" ,' +
      '"timestamp":"' + (new Date().getTime()) + '" ,' +
      //end of common
      '"status_code":":status",' +
      '"uri":":statsdKey",' +
      '"status_code":":status" ,' +
      '"response_time":":response-time" ,' +
      '}', { 'stream': logsStream });

    var statsdURL = function (req, res, next) {
      req.statsdKey = ['http', req.path.replace(/[\/\.]/g, "-")].join('-');
      next();
    };

    ///// REQUEST METRICS
    var expressStatsd = require('express-statsd');
    var requestMetricHandler = expressStatsd({'client': metrics})

    if (app) {
      app.use(function (req, res, next) {
        global.dmdata['session'] = req.session ? req.session.id : 'N/A';
        global.dmdata['request_uri'] = ['http', req.path.replace(/[\/\.]/g, "-")].join('-');
        next();
      });


      app.use(statsdURL);
      app.use(requestLogHandler);
      app.use(requestMetricHandler);
    }

    ///// Mongoose instrumentation
    function instrumentModel(obj) {
      for (var k in obj) {
        if (typeof(obj[k]) === 'function' && ['find', 'findById', 'findOne'].indexOf(k) > -1) {
          if (k != obj[k].name) {
            return;
          }
          obj[k] = dmWrapModelFunction(obj[k]);
        }
      }
    }

    var dmWrapModelFunction = function (fn, funcName) {
      return function () {
        global.starttime = new Date().getTime();

        for (var i in arguments) {
          if (arguments[i] && typeof(arguments[i]) === 'function') {
            arguments[i] = dmMongooseInstrumentedExec(arguments[i], this.op, this.model.modelName);
          }
        }
        var res = fn.apply(this, arguments);
        var end = new Date().getTime();
        return res;
      };
    };

    var dmMongooseInstrumentedExec = function (fn, funcName, modelName) {
      return function () {
        var res = fn.apply(this, arguments);
        var end = new Date().getTime();
        var duration = end - global.starttime;

        var collectionName = modelName;
        var method = funcName;
        var query = '?';
        var doc = '?';
        var statsdKey = 'db--' + collectionName + '-' + method;

        loggerObj.info(JSON.stringify({
          "app_id": app_id,
          "event_type": "db_call",
          "host": host,
          "session": global.dmdata['session'],
          "correlation": global.dmdata['session'],
          "request_uri": global.dmdata['request_uri'],
          "message": "database request",
          "version": version,
          "timestamp": new Date().getTime(),

          "uri": statsdKey,
          "method": method,
          "return": 'N/A',
          "response_time": duration,
          "error": 0
        })
        );

        return res;
      };
    };

    var dmExecWrapper = function (fn) {
      return function () {
        arguments['0'] = dmMongooseInstrumentedExec(arguments['0']);
        return fn.apply(this, arguments);
      };
    };

    try {
      var mongoose = require('mongoose');
//      mongoose.Query.prototype.exec = dmExecWrapper(mongoose.Query.prototype.exec, 'exec');
      mongoose.Query.prototype.findOne = dmWrapModelFunction(mongoose.Query.prototype.findOne, 'findOne');
      mongoose.Query.prototype.find = dmWrapModelFunction(mongoose.Query.prototype.find, 'find');
      mongoose.Query.prototype.count = dmWrapModelFunction(mongoose.Query.prototype.count, 'distinct');
      mongoose.Query.prototype.update = dmWrapModelFunction(mongoose.Query.prototype.update, 'update');
      mongoose.Query.prototype.remove = dmWrapModelFunction(mongoose.Query.prototype.update, 'remove');
    } catch (e) {
      loggerObj.info("mongoose not found, no db instrumentation");
    }

    if (options && options['uncaughtException'] == true) {
      process.on('uncaughtException', function(err) {
        loggerObj.error(err);
        metrics.increment('application.uncaughtException');
      })
    }

    global.devmetrics = {'logger': loggerObj, 'metrics': metrics, 'requestLogs': requestLogHandler,
      'requestMetrics': requestMetricHandler, 'instrumentModel': instrumentModel};

    if (mode == 'logger') {
      return global.devmetrics.logger;
    }
    return global.devmetrics;
  }

})();
