var devmetrics = require('./../lib/devmetrics')({'app_id': 'lib_test'});

devmetrics.userEvent('hey');
devmetrics.userEvent('hey', ['par_arm1', 'pa98273&*^(%pa2']);
devmetrics.measure(123, 'hey', ['par_arm1', 'pa98273&*^(%pa2']);