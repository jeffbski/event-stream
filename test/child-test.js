'use strict';

var tap = require('tap');
var test = tap.test;

var es = require('../');
var cp = require('child_process');

test('child std out - success', function (t) {
  t.plan(2);
  var stream = es.connect(
    es.child(cp.spawn('echo', ['foo'])),
    es.writeArray(function (err, array) {
      t.equal(array.length, 1);
      t.same(array[0].toString('utf8'), 'foo\n');
    })
  );
});

test('child stdout, failed exit, default options', function (t) {
  t.plan(1);
  var stream = es.connect(
    es.child(cp.spawn('foobarbaz')),
    es.writeArray(function (err, array) {
      t.same(array, []);
    })
  );    
});

test('child stderr merged into output, ignore non-zero exit code', function (t) {
  t.plan(2);
  var stream = es.connect(
    es.child(cp.spawn('foobarbaz'), {includeStdErr: true}),
    es.writeArray(function (err, array) {
      t.equal(array.length, 1);
      t.same(array[0].toString('utf8'), 'execvp(): No such file or directory\n');
    })
  );    
});

test('child stderr merged into output, error event on non-zero exit code', function (t) {
  t.plan(3);
  var stream = es.connect(
    es.child(cp.spawn('foobarbaz'), {includeStdErr: true, errorOnNonZeroExit: true}),
    es.writeArray(function (err, array) {
      t.equal(array.length, 1);
      t.same(array[0].toString('utf8'), 'execvp(): No such file or directory\n');
    })
  );
  stream.on('error', function (err) {
    t.ok((err > 0), 'error should be non-zero');
    t.end();
  });
});
