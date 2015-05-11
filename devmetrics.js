(function() {

  module.exports = function(options) {
    var mode = null;
    if (!options) {
      options = {};
    }
    var app = options['app'];
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
    var host = options['host'] ? options['host'] : 'service.devmetrics.io';

    var app_id = options['token'] ? options['token'] : hostname.replace(/[\W_]+/g, "_"); // only alphanum for token

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
        })
      ],
      exitOnError: false
    });

    var stdLogger = new winston.Logger({
      transports: [
        new winston.transports.Console({
          level: 'info',
          handleExceptions: true,
          json: false,
          colorize: true
        })
      ],
      exitOnError: false
    });

    var dmUserLogger = function(level, text) {
      var obj2send = JSON.stringify({
        "app_id": app_id,
        "event_type": "user_event",
        "host": hostname,
        "session": global.dmdata['session'],
        "correlation": global.dmdata['session'],
        "request_uri": global.dmdata['request_uri'],
        "message": "user event: " + text,
        "version": version,
        "timestamp": new Date().getTime(),

        "severity": level,
        "uri": 'N/A'
      });

      if (loggerObj[level] && typeof loggerObj[level] == 'function') {
        loggerObj[level](obj2send);
      } else {
        loggerObj.info(obj2send);
      }

      if (stdLogger[level] && typeof stdLogger[level] == 'function') {
        stdLogger[level](text);
      }
    };
//
//    loggerObj['app_event'] = function(event_name) {
//      loggerObj.info('App Event: ' + event_name); // change event_type field
//      metrics.increment('application.' + event_name);
//    }

    var dmExceptionLogger = function(e) {
      loggerObj.error(
        JSON.stringify({
          "app_id": app_id,
          "event_type": "exception",
          "host": hostname,
          "session": global.dmdata['session'],
          "correlation": global.dmdata['session'],
          "request_uri": global.dmdata['request_uri'],
          "message": "exception: " + e.message,
          "version": version,
          "timestamp": new Date().getTime(),

          "domain": 'N/A',
          "uri": global.dmdata['request_uri'],
          "error": 1,
          "exception_stack": e.stack,
          "exception_class": "N/A",
          "exception_text": e.message,
          "exception_critical": false
        })
      );

      dmUserLogger('error', e);
    };

    var dmApplicationLogger = function(text) {
      loggerObj.warn(
        JSON.stringify({
          "app_id": app_id,
          "event_type": "user_event",
          "host": hostname,
          "session": global.dmdata['session'],
          "correlation": global.dmdata['session'],
          "request_uri": '_global',
          "message": "application event: " + text,
          "version": version,
          "timestamp": new Date().getTime(),

          "severity": 'info',
          "uri": 'N/A'
        })
      );

      stdLogger.warn("application event: " + text);
    };

    dmUserLogger('info', 'Checkout dashboards @ http://devmetrics.io/dashboard/' + app_id);

    ///// STATSD SENDER
    var lynx = require('lynx');
    var metrics = new lynx(host, 5546, {scope:app_id});

    ///// REQUEST LOGS
    var logsStream  = {
      write: function(message, encoding) {
        // @todo, check that stdout enabled
        var obj = JSON.parse(message);
        var msg = 'http request: ' + obj['status_code'] + ' ' + obj['uri'] + ' took ' + Math.round(obj['response_time']) + ' ms';
        if (obj['status_code'] >= 400) {
          loggerObj.error(message);
          stdLogger.error(msg);
        } else {
          loggerObj.info(message);
          stdLogger.info(msg);
        }
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
      '"host":"' + hostname + '" ,' +
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
      '"response_time":":response-time"' +
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
        global.dmstarttime = new Date().getTime();

        for (var i in arguments) {
          if (arguments[i] && typeof(arguments[i]) === 'function') {
            arguments[i] = dmMongooseInstrumentedExec(arguments[i], this.op, this.model.modelName);
          }
        }
        var res = fn.apply(this, arguments);
        return res;
      };
    };

    var dmMongooseInstrumentedExec = function (fn, funcName, modelName) {
      return function () {
        var res = fn.apply(this, arguments);
        var end = new Date().getTime();
        var duration = end - global.dmstarttime;

        var collectionName = modelName;
        var method = funcName ? funcName : 'saved'; //@todo temp save bad supported hack
        var query = '?';
        var doc = '?';
        var statsdKey = 'db--' + collectionName + '-' + method;

        var event = {
          "app_id": app_id,
          "event_type": "db_call",
          "host": hostname,
          "session": global.dmdata['session'],
          "correlation": global.dmdata['session'],
          "request_uri": global.dmdata['request_uri'],
          "message": 'MongoDB:' + statsdKey + ' took ' + duration + ' ms',
          "version": version,
          "timestamp": new Date().getTime(),

          "uri": statsdKey,
          "method": method,
          "return": 'N/A',
          "response_time": duration,
          "error": arguments[0] ? 1 : 0 // if err obj is defined
        };
        if (event['error']) {
          stdLogger.error(event.message);
          loggerObj.error(JSON.stringify(event));
        } else {
          stdLogger.info(event.message);
          loggerObj.info(JSON.stringify(event));
        }

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
      var mongoose = global.mongoose_instance ? global.mongoose_instance : require('mongoose');
//      mongoose.Query.prototype.exec = dmExecWrapper(mongoose.Query.prototype.exec, 'exec');

      mongoose.Query.prototype.findOne = dmWrapModelFunction(mongoose.Query.prototype.findOne, 'findOne');
      mongoose.Query.prototype.find = dmWrapModelFunction(mongoose.Query.prototype.find, 'find');
      mongoose.Query.prototype.count = dmWrapModelFunction(mongoose.Query.prototype.count, 'distinct');
      mongoose.Query.prototype.update = dmWrapModelFunction(mongoose.Query.prototype.update, 'update');
      mongoose.Model.prototype.save = dmWrapModelFunction(mongoose.Model.prototype.save, 'save');
      mongoose.Query.prototype.remove = dmWrapModelFunction(mongoose.Query.prototype.remove, 'remove');
    } catch (e) {
      dmUserLogger('warn', "mongoose not found, no db instrumentation");
      dmExceptionLogger(e);
    }

    if (options && options['uncaughtException'] == true) {
      process.on('uncaughtException', function(err) {
        dmExceptionLogger(err);
        stdLogger.error(err);
      })
    }

    var dmFunctionName = function(fun) {
      var ret = fun.toString();
      ret = ret.substr('function '.length);
      ret = ret.substr(0, ret.indexOf('('));
      return ret;
    }

    var dmFunctionWrap = function (fn, funcName) {
      return function () {
        var dmFuncStart = new Date().getTime();
        var res = fn.apply(this, arguments);
        var duration = new Date ().getTime() - dmFuncStart;
        funcName = funcName ? funcName : dmFunctionName(fn);
        var obj = {
          "app_id": app_id,
          "event_type": "user_call",
          "host": hostname,
          "session": global.dmdata['session'],
          "correlation": global.dmdata['session'],
          "request_uri": global.dmdata['request_uri'],
          "message": "function call: " + funcName + ' took ' + duration + ' ms',
          "version": version,
          "timestamp": new Date().getTime(),

          "method": funcName,
          "request_uri": funcName,
          "return": 'N/A',
          "domain": 'functions',
          "response_time": duration,
          "error": 0
        };
        loggerObj.info(JSON.stringify(obj));
        stdLogger.info(obj['message']);
        return res;
      };
    };

    global.devmetrics = {'morganLogger': loggerObj, 'metrics': metrics, 'requestLogs': requestLogHandler,
      'requestMetrics': requestMetricHandler, 'instrumentModel': instrumentModel, 'funcWrap': dmFunctionWrap,
      'exception': dmExceptionLogger, 'logger': dmUserLogger, 'appEvent': dmApplicationLogger};

    if (mode == 'logger') {
      return global.devmetrics.logger;
    }
    return global.devmetrics;
  }

})();
