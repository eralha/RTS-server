var express = require('express');
var sockjs  = require('sockjs');
var broadcaster = require('er-rts');


//Express server
var app = express.createServer();

//Change this secret to invalidate all previous generated api keys.
var secret = "6f553d50e8c383be12550329e8c2ea3a41deb2274762d69d5f6d6919a8f114e4";
var msg_server = broadcaster.createServer(app, '/rpc', secret);

// listen to the PORT given to us in the environment
//var port = 8080;
var port = 8080;//for localhost using


app.listen(port, function() {
  console.log("Listening on " + port);
});

app.get('/', function(req, res){
  //res.sendfile(__dirname + '/index.html');
  res.sendfile('index.html', {root: __dirname})
});

app.get('/scripts/:file', function(req, res){
  var file = req.params.file;
  res.sendfile('/public/scripts/'+file, {root: __dirname})
});

/*
//Listening for update order from client manager
app.get('/update/:object', function(req, res){
    var resp = msg_server.try_call(req.params.object);
    res.send(resp);
    //res.sendfile(__dirname + '/index.html');
});
*/