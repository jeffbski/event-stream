'use strict';

var t = require('assert');
var EXIT = (require.main === module) ? 'exit' : 'beforeExit';

var es = require('../');

exports['wait for stream events to finish then cb'] = function () {

  var reader = es.readArray([1, 2, 3]);

  var mapData = [];
  function mapFunc(data, cb) {
    mapData.push(data);
    cb(null, data);
  }

  var waitCbCalled = false;
  function doneCallback(err) {
    t.equal(err, undefined, 'error should be undefined');
    t.equal(waitCbCalled, false, 'callback should only be called once');
    t.deepEqual(mapData, [1, 2, 3], 'map should have seen all the events'); 
    waitCbCalled = true;
  }

  var errCalled = false;
  var stream = es.connect(
    reader,
    es.map(mapFunc),
    es.wait(doneCallback)
  ).on('error', function (err) {
    errCalled = true;
  });
  

  process.on(EXIT, function () {
    t.ok(!errCalled, 'no error events should have been received');
    t.ok(waitCbCalled, 'callback from wait should have been called after events were received');
    console.log('success');
  });
  
};




// if run directly from node execute all the exports
if (require.main === module) Object.keys(exports).forEach(function (f) { exports[f](); });


