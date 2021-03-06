//filter will reemit the data if cb(err,pass) pass is truthy
// reduce is more tricky
// maybe we want to group the reductions or emit progress updates occasionally
// the most basic reduce just emits one 'data' event after it has recieved 'end'


var Stream = require('stream').Stream
  , es = exports

es.Stream = Stream //re-export Stream from core

// writable stream, collects all events into an array 
// and calls back when 'end' occurs
// mainly I'm using this to test the other functions

es.writeArray = function (done) {
  if ('function' !== typeof done)
    throw new Error('function writeArray (done): done must be function')

  var a = new Stream ()
    , array = []
  a.write = function (l) {
    array.push(l)
  }
  a.end = function () {
    done(null, array)
  }
  a.writable = true
  a.readable = false
  return a
}

/**
   Wait for all of the events to finish, then call the cb
  */
es.wait = function (cb) {
  if ('function' !== typeof(cb))
    throw new Error('function wait (cb): cb must be function');

  var a = new Stream();
  a.write = function (l) { };
  a.end = function () {
    cb();
  };
  a.writable = true;
  a.readable = false;
  return a;
};  

//return a Stream that reads the properties of an object
//respecting pause() and resume()

es.readArray = function (array) {
  var stream = new Stream()
    , i = 0
    , paused = false
 
  stream.readable = true  
  stream.writable = false
 
  if(!Array.isArray(array))
    throw new Error('event-stream.read expects an array')
  
  stream.resume = function () {
    paused = false
    var l = array.length
    while(i < l && !paused) {
      stream.emit('data', array[i++])
    }
    if(i == l)
      stream.emit('end'), stream.readible = false
  }
  process.nextTick(stream.resume)
  stream.pause = function () {
     paused = true
  }
  return stream
}

//
// readable (asyncFunction)
// return a stream that calls an async function while the stream is not paused.
//
// the function must take: (count, callback) {...
//
es.readable = function (func, continueOnError) {
  var stream = new Stream()
    , i = 0
    , paused = false
    , ended = false
    , reading = false

  stream.readable = true  
  stream.writable = false
 
  if('function' !== typeof func)
    throw new Error('event-stream.readable expects async function')
  
  stream.on('end', function () { ended = true })
  
  function get (err, data) {
    
    if(err) {
      stream.emit('error', err)
      if(!continueOnError) stream.emit('end')
    } else if (arguments.length > 1)
      stream.emit('data', data)

    process.nextTick(function () {
      if(ended || paused || reading) return
      try {
        reading = true
        func.call(stream, i++, function () {
          reading = false
          get.apply(null, arguments)
        })
      } catch (err) {
        stream.emit('error', err)    
      }
    })
  
  }
  stream.resume = function () {
    paused = false
    get()
  }
  process.nextTick(get)
  stream.pause = function () {
     paused = true
  }
  return stream
}


//create an event stream and apply function to each .write
//emitting each response as data
//unless it's an empty callback

es.map = function (mapper) {
  var stream = new Stream()
    , inputs = 0
    , outputs = 0
    , ended = false
    , paused = false
  stream.writable = true
  stream.readable = true
   
  stream.write = function () {
    inputs ++
    var args = [].slice.call(arguments)
      , r
      , inNext = false 
    function next (err) {
      inNext = true
      outputs ++
      var args = [].slice.call(arguments)
      if(err) {
        args.unshift('error')
        return inNext = false, stream.emit.apply(stream, args)
      }
      args.shift() //drop err
    
      if (args.length){
        args.unshift('data')
        r = stream.emit.apply(stream, args)
      }
      if(inputs == outputs) {
        if(paused) stream.emit('drain') //written all the incoming events
        paused = false
        if(ended)
          stream.end()
      }
      inNext = false
    }
    args.push(next)
    
    try {
      //catch sync errors and handle them like async errors
      var written = mapper.apply(null,args)
      if(written === false) paused = true
      return written
    } catch (err) {
      //if the callback has been called syncronously, and the error
      //has occured in an listener, throw it again.
      if(inNext)
        throw err
      next(err)
      return true
    }
  }

  stream.end = function () {
    var args = [].slice.call(arguments)
    //if end was called with args, write it, 
    ended = true //write will emit 'end' if ended is true
    if(args.length)
      return stream.write.apply(emitter, args)
    else if (inputs == outputs) //wait for processing
      stream.emit('end')
  }

  return stream
}

//
// map sync
//

es.mapSync = function (sync) {
  
  return es.map(function () {
    var args = [].slice.call(arguments)
      , callback = args.pop()
      
      callback(null, sync.apply(null, args))
  })
}

//
// log just print out what is coming through the stream, for debugging
//

es.log = function (name) {
  return es.map(function () {
    var args = [].slice.call(arguments)
    var cb = args.pop()
    if(name) args.slice().unshift(name)
    console.error.apply(null, args)
    args.unshift(null)
    cb.apply(null, args)
  })
}

//
// combine multiple streams together so that they act as a single stream
//

es.pipe = es.connect = function () {

  var streams = [].slice.call(arguments)
    , first = streams[0]
    , last = streams[streams.length - 1]
    , thepipe = es.duplex(first, last)

  if(streams.length == 1)
    return streams[0]
  else if (!streams.length)
    throw new Error('connect called with empty args')

  //pipe all the streams together

  function recurse (streams) {
    if(streams.length < 2)
      return
    streams[0].pipe(streams[1])
    recurse(streams.slice(1))  
  }
  
  recurse(streams)
 
  function onerror () {
    var args = [].slice.call(arguments)
    args.unshift('error')
    thepipe.emit.apply(thepipe, args)
  }
  
  streams.forEach(function (stream) {
    stream.on('error', onerror)
  })

  return thepipe
}


/**
  Create a through stream from a child process which pipes stdin and stdout.
  By default, it does not generate an error event if the child process
  returns non-zero exit code.

  By specifying an options object you may alter this behaviour:

  @param child process
  @param [options={}] - optional options object
  @param [options.includeStdErr=true]       # will include stderr in the forward output (merged with stdout)
  @param [options.errorOnNonZeroExit=true]  # emit 'error' event if child process exits with non-zero exit code
 */  
es.child = function (child, options) {
  options = options || {};
  var stream = es.duplex(child.stdin, child.stdout);

  // if includeStdErr then pipe stdErr also into stream
  // otherwise emit error_data event with the stdErr info
  var err_data_evt = (options.includeStdErr) ? 'data' : 'error_data'; 
  child.stderr.on('data', function (err) {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(err_data_evt);
    stream.emit.apply(stream, args);
  });
  if (options.errorOnNonZeroExit) {
    child.on('exit', function(code, signal) {
      if (code !== 0) {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('error');
        stream.emit.apply(stream, args);
      }
    });
  }
  return stream;
};


//
// duplex -- pipe into one stream and out another
//

es.duplex = function (writer, reader) {
  var thepipe = new Stream()

  thepipe.__defineGetter__('writable', function () { return writer.writable })
  thepipe.__defineGetter__('readable', function () { return reader.readable })

  ;['write', 'end', 'close'].forEach(function (func) {
    thepipe[func] = function () {
      return writer[func].apply(writer, arguments)
    }
  })

  ;['resume', 'pause'].forEach(function (func) {
    thepipe[func] = function () { 
      thepipe.emit(func)
      if(reader[func])
        return reader[func].apply(reader, arguments)
      else
        reader.emit(func)
    }
  })

  ;['data', 'close'].forEach(function (event) {
    reader.on(event, function () {
      var args = [].slice.call(arguments)
      args.unshift(event)
      thepipe.emit.apply(thepipe, args)
    })
  })
  //only emit end once
  var ended = false
  reader.on('end', function () {
    if(ended) return
    ended = true
    var args = [].slice.call(arguments)
    args.unshift('end')
    thepipe.emit.apply(thepipe, args)
  })

  return thepipe
}

/**
   Split a stream on new lines. This assumes utf8 encoding.

   @example
   es.split()   // split on newline, output '\n' at end of each line

   @example
   es.split('\n', '')   // split on newline, but do not add '\n' to each line

   @param {String|RegExp} [matcher='\n']    string or regex to split on, default is '\n'
   @param {String}        [separator='\n']  appended to each line, default '\n'. Use '' to skip appending
  */ 
es.split = function (matcher, separator) {
  var stream = new Stream();
  if (!matcher) matcher = '\n';  //setup default matcher if none specified
  if (undefined === separator) separator = '\n';  //default separator '\n'

  stream.writable = true
  stream.readable = true;  //necessary for reading more than one data event
  var remnants = [];       //array of partial lines
  
  stream.write = function (buffer) {
    var data = buffer.toString(); // utf8
    var lines = data.split(matcher);
    if (lines.length === 1) { //only partial match, save it in remnant array
      remnants.push(lines.shift());
      return true;
    }
    
    //otherwise, we have some data to emit and a new partial line
    remnants.push(lines.shift());     //shift first line which is partial and add to remnants
    lines.unshift(remnants.join('')); //join all remnants into single line and unshift to front
    remnants.length = 0;              //clear the array
    remnants.push(lines.pop());       //last data is partial, wait for split match
    lines.forEach(function (line) {
      if (separator) line = line + separator;  // null or empty string will skip this
      stream.emit('data', line);
    });
    return true;
  }

  stream.end = function () {
    stream.emit('data', remnants.join(''));  
    stream.emit('end');
  }

  return stream;
}

//
// gate 
//
// while the gate is shut(), buffer incoming. 
// 
// if gate is open() stream like normal.
//
// currently, when opened, this will emit all data unless it is shut again
// if downstream pauses it will still write, i'd like to make it respect pause, 
// but i'll need a test case first.

es.gate = function (shut) {

  var stream = new Stream()
    , queue = []
    , ended = false

    shut = (shut === false ? false : true) //default to shut

  stream.writable = true
  stream.readable = true

  stream.isShut = function () { return shut }
  stream.shut   = function () { shut = true }
  stream.open   = function () { shut = false; maybe() }
  
  function maybe () {
    while(queue.length && !shut) {
      var args = queue.shift()
      args.unshift('data')
      stream.emit.apply(stream, args)
    }
    stream.emit('drain')
    if(ended && !shut) 
      stream.emit('end')
  }
  
  stream.write = function () {
    var args = [].slice.call(arguments)
  
    queue.push(args)
    if (shut) return //false //pause up stream pipes  

    maybe()
  }

  stream.end = function () {
    ended = true
    if (!queue.length)
      stream.emit('end')
  }

  return stream
}

//
// parse
//

es.parse = function () { 
  return es.mapSync(function (e){
    return JSON.parse(e.toString())
  }) 
}
//
// stringify
//

es.stringify = function () { 
  return es.mapSync(function (e){
    return JSON.stringify(e) + '\n'
  }) 
}

//
// replace a string within a stream.
//
// warn: just concatenates the string and then does str.split().join(). 
// probably not optimal.
// for smallish responses, who cares?
// I need this for shadow-npm so it's only relatively small json files.

es.replace = function (from, to) {
  var stream = new Stream()
  var body = ''
  stream.readable = true
  stream.writable = true
  stream.write = function (data) { body += data }
  stream.end = function (data) {
    if(data)
      body += data

    stream.emit('data', body.split(from).join(to))
    stream.emit('end')
  }
  return stream
} 

es.join = function (callback) {
  var stream = new Stream()
  var body = ''
  stream.readable = true
  stream.writable = true
  stream.write = function (data) { body += data }
  stream.end = function (data) {
    if(data)
      body += data
    if(callback)
      callback(null, body)
    stream.emit('data', body)
    stream.emit('end')
  }
  return stream
}

//
// helper to make your module into a unix pipe
// simply add 
// 
// if(!module.parent)
//  require('event-stream').pipable(asyncFunctionOrStreams)
// 
// asyncFunctionOrStreams may be one or more Streams or if it is a function, 
// it will be automatically wrapped in es.map
//
// then pipe stuff into from the command line!
// 
// curl registry.npmjs.org/event-stream | node hello-pipeable.js | grep whatever
//
// etc!
//
// also, start pipeable running as a server!
//
// > node hello-pipeable.js --port 44444
// 

var setup = function (args) {
  return args.map(function (f) {
    if (f instanceof Stream) return f;
    var x = f()
      if('function' === typeof x)
        return es.map(x)
      return x
    })
}

es.pipeable = function () {
  var opts = require('optimist').argv
  var args = [].slice.call(arguments)
  
  if(opts.h || opts.help) {
    var name = process.argv[1]
    console.error([
      'Usage:',
      '',
      'node ' + name + ' [options]',
      '  --port PORT        turn this stream into a server',
      '  --host HOST        host of server (localhost is default)',
      '  --protocol         protocol http|net will require(protocol).createServer(...',
      '  --help             display this message',
      '',
      ' if --port is not set, will stream input from stdin',
      '',
      'also, pipe from or to files:',
      '',
      ' node '+name+ ' < file    #pipe from file into this stream',
      ' node '+name+ ' < infile > outfile    #pipe from file into this stream',     
      '',
    ].join('\n'))
  
  } else if (!opts.port) {
    var streams = setup(args)
    streams.unshift(es.split())
    //streams.unshift()
    streams.push(process.stdout)
    var c = es.connect.apply(null, streams)
    process.openStdin().pipe(c) //there
    return c

  } else {
  
    opts.host = opts.host || 'localhost'
    opts.protocol = opts.protocol || 'http'
    
    var protocol = require(opts.protocol)
        
    var server = protocol.createServer(function (instream, outstream) {  
      var streams = setup(args)
      streams.unshift(es.split())
      streams.unshift(instream)
      streams.push(outstream || instream)
      es.pipe.apply(null, streams)
    })
    
    server.listen(opts.port, opts.host)

    console.error(process.argv[1] +' is listening for "' + opts.protocol + '" on ' + opts.host + ':' + opts.port)  
  }
}
