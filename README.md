[![devmetrics Logo](http://www.devmetrics.io/images/npmjs/logo.png)](http://www.devmetrics.io)

#Opensource Usage Analytic for Web.

Build on top of StatsD - InfluxDB - Grafana stack.

We provide usage tracking and analytics solution, production-ready, scalable and opensource. Make smart product decisions timely with accurate usage data.

It will take just few minutes to start seeing your users behavior.

```js
devmetrics = require('devmetrics')
	({'app_id': 'my_app_id'});
devmetrics.userEvent('page_loaded_event');
devmetrics.userEvent('button_click', ['red_button', 'android']);
devmetrics.measure(123, 'page_load_time', ['index_page']);
```

See [devmetrics.io](http://www.devmetrics.io) for documentation, app_id and great dashboards.