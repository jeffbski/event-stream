'use strict';

var tap = require('tap');
var test = tap.test;

var es = require('../');

test('wait for stream events to finish then cb', function (t) {
  t.plan(1);
  var reader = es.readArray([1, 2, 3]);

  var mapData = [];
  function mapFunc(data, cb) {
    mapData.push(data);
    cb(null, data);
  }

  function doneCallback() {
    t.deepEqual(mapData, [1, 2, 3], 'map should have seen all the events');
  }

  var stream = es.connect(
    reader,
    es.map(mapFunc),
    es.wait(doneCallback)
  ).on('error', function (err) {
    t.fail('no error events should have been received');
    t.end();
  });
});


test('error in stream fires error event', function (t) {
  t.plan(1);
  var reader = es.readArray([1, 2, 3]);

  var mapData = [];
  function mapFunc(data, cb) {
    mapData.push(data);
    cb(100, data); //causing error with error value 100
  }

  function doneCallback(err) {
    t.fail('should not be here since error fired');
    t.end();
  }

  var stream = es.connect(
    reader,
    es.map(mapFunc),
    es.wait(doneCallback)
  ).on('error', function (err) {
    t.equal(err, 100, 'should have received error from callback');
  });
});





