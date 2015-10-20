var devmetrics = require('./../lib/devmetrics')({'app_id': 'lib_test'});
devmetrics.userEvent('hey');
devmetrics.userEvent('hey', ['par_arm1', 'pa98273&*^(%pa2']);
devmetrics.userEvent('hey', {'hey1': 'par_arm1', 'hey2': 'pa98273&*^(%pa2'});
devmetrics.measure(12.2, 'hey', ['par_arm1', 'pa98273&*^(%pa2']);
devmetrics.measure('as', 'hey', ['par_arm1', 'pa98273&*^(%pa2']);