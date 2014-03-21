Realtime Node.js message server.

With this you can send messages to connected users in realtime using Node.js and sockjs: https://github.com/sockjs

File: web.js
```Javascript
var express = require('express');
var sockjs  = require('sockjs');
var broadcaster = require('broadcast');


//Express server
var app = express.createServer(
  express.static(__dirname + '/public')
);

//Change this secret to invalidate all previous generated api keys.
var secret = "YOUR SECRET";
var msg_server = broadcaster.createServer(app, '/rpc', secret);

// listen to the PORT given to us in the environment
//var port = 8080;
var port = 3030;//for localhost using
app.listen(port, function() {
  console.log("Listening on " + port);
});

app.get('/', function (req, res) {
    res.sendfile(__dirname + '/index.html');
});

app.get('/genkey', function(req, res){
    var resp = msg_server.genKey([req.param("domain")]);
    res.send(resp);
});

//Listening for update order from client manager
app.get('/update/:object', function(req, res){
    var resp = msg_server.try_call(req.params.object);
    res.send(resp);
});
```

File:index.html
```html
<script src="http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min.js"></script>
<script src="/scripts/tracker.js"></script>
<script>
  var connection = new tracker({
	  			url:'http://er-ejr.jit.su/rpc', //Node server
                keys:{
                  "YOUR DOMAIN" : "DOMAIN KEY"
                }});
      
      //Event handler, for when the connection is done and we can start to send messages
	  connection.addEventListener("open", function(e){

	  	$("#users").html("Connected");

	  	  //This event fire when you subscribe a chanel with success
	  	  connection.addEventListener("chanelSubscribed", function(e){
	  	  	//alert(e.data);
	  	  });

	  	  //This event fire when you unsubscribe a chanel with success
	  	  connection.addEventListener("chanelUnSubscribed", function(e){
	  	  	//alert(e.data);
	  	  });

	  	  //This event fire when we receive a shared object for all connections on the chanel
	  	  connection.addEventListener("SOReceived", function(e){
	  	  	alert("Canal:"+e.data.chanel+"  Num So´s:"+e.data.so.length);
	  	  });

	  	  //This functions are used to subscribe chanel's with the permission to read or write
			  connection.subscribeChanel("chat", "write", function(e){
			  	if($("#users").html() == "Connected"){$("#users").html("");}
			  	$("#users").html($("#users").html()+e.data.c+": "+e.data.msg+"<br />");
			  });
			  connection.subscribeChanel("connConnected", "write", function(e){
			  	//alert(e.data.msg);
			  });
			  connection.subscribeChanel("connDisconnected", "write", function(e){
			  	//alert(e.data.msg);
			  });

		  //Register a shared object
		  	connection.setSharedObject({user:"Nome de utilizador", rand:Math.random()*50});


	  });

	  (function($) {
        $(document).ready(function() {
            $("#send").click(function(){
            	connection.send("chat", $("#txtMsg").val());
            });
            $("#getSo").click(function(){
            	//Faz um request ao shared object de um canal
            	connection.getChanelSO("chat");
            });
	    });
	   })(jQuery);
</script>
<div>
	Mensagem: <input type="text" id="txtMsg" name="txtMsg" /> <input type="submit" id="send" name="send" value="enviar" />
	<input type="submit" id="getSo" name="getSo" value="Get SO" />
</div>
<div id="users" style="margin-top:10px;width:280px;background-color:#fff;border:solid 1px;padding:5px;">Connecting</div>
```