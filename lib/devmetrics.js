(function() {

  var http = require("http");

  module.exports = function(options) {
    if (!options) {
      options = {};
    }
    var app = options['app'];

    if (global.devmetrics) {
      return global.devmetrics;
    }

    var os = require("os");
    var hostname = os.hostname();
    if (!hostname) {
      hostname = 'undefined_host';
    }

    var host = options['host'] ? options['host'] : 'devmetrics.io';
    var app_id = options['app_id'] ? options['app_id'] : hostname.replace(/[\W_]+/g, "_"); // only alphanum for token

    var dm = {};
    dm._genUid = function () {
      function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
          .toString(16)
          .substring(1);
      }

      return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
    };

    dm._registerUser = function (explicit_id) {
      var uid = explicit_id || global.dm_uid;
      if (!uid) {
        uid = this._genUid();
      }
      global.dm_uid = uid;
    };

    dm.setUserId = function (user_id) {
      this._registerUser(user_id);
    }

    global.dm_app_id = app_id;
    dm._registerUser();

    dm.sendData = function (event_name, event_tags, gauge) {
      var options = {
        host: 'www.devmetrics.io',
//        host: 'localhost',
        port: 80,
//        port: 3000,
        path: '/api/event',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      var url = '?app_id=' + global.dm_app_id;
      url += '&event_name=' + event_name;
      url += '&user_id=' + global.dm_uid;
      url += '&gauge=' + (gauge || 0);
      if (event_tags && Object.prototype.toString.call( event_tags ) === '[object Array]') {
        for (var i = 0; i < event_tags.length; ++i) {
          event_tags[i] = event_tags[i].replace(/[\W_]+/g, "_");
        }
        var tags_str = event_tags.join();
        url += '&tags=' + tags_str;
      }
      options['path'] += url;

      var req = http.request(options, function(res) {
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
        });

        res.on('end', function() {
        });
      });

      req.on('error', function(err) {
      });

      req.end();
    };

    /**
     * Send user event data
     * @param event_name
     * @param event_tags
     */
    dm.userEvent = function (event_name, event_tags) {
      event_name = event_name.replace(/[\W_]+/g, "_");
      this.sendData(event_name, event_tags);
    };

    /**
     * Measure custom data
     * @param event_name
     * @param event_tags
     */
    dm.measure = function (value, event_name, event_tags) {
      event_name = event_name.replace(/[\W_]+/g, "_");
      this.sendData(event_name, event_tags, value);
    };

    global.devmetrics = dm;

    return global.devmetrics;
  }

})();