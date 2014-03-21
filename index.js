(function() {

  var RPCServer = (function(_super){
    RPCServer.name = 'RPCServer';
    var util = require('util'),
        events = require('events');

    function RPCServer(config) {
      var sockjs  = require('sockjs');
      //Bind eventEmiter
        events.EventEmitter.call(this);

      //Crypto
        this.crypto = require('crypto');
        this.secret = config._secret;

      //SOCKET AND CONNECTIONS
        this.sockConn = sockjs.createServer();
        this.domains = {};

      //redis database -notify all drones when we want to send messages
        this.pid = Math.random()*999999999999;
        this.redis = require("redis");
        this.connectToRedis();

      
      //SOCKET EVENTS
        this.sockConn.installHandlers(config.s, {prefix:config.p});
        this.sockConn.on('connection', this.onconnection.bind(this));

      //ADICIONAL MSG LOGIC
        this.parser = require('./msg_parser');
        this.parser = this.parser.msgParser();

        this.msgExtend = require('./logic_extend');
        this.msgExtend = this.msgExtend.logicExt(this);
    }
    util.inherits(RPCServer, events.EventEmitter);

    RPCServer.prototype.connectToRedis = function(){
      supra = this;

      if(this.redisDB != null){this.redisDB.end();console.log("Closing redisDB - pub/sub");}
      if(this.redisPub != null){this.redisPub.end();console.log("Closing redisPublisher");}
            
      this.redisDB = this.redis.createClient(9891, 'REDIS SERVER');
      this.redisPub = this.redis.createClient(9891, 'REDIS SERVER');

      this.redisDB.auth('REDIS AUTH TOKEN', function(err){
        if(err){throw err;}
        supra.redisDB.subscribe("broadcast");
        supra.redisDB.on("message", supra.onRedisMessage.bind({_supra:supra}));
      });
      this.redisPub.auth('REDIS AUTH TOKEN', function(err){
        if(err){throw err;}
      });

      this.redisDB.on("end", this.connectToRedis.bind(this));
      this.redisPub.on("end", this.connectToRedis.bind(this));
    };

    RPCServer.prototype.onconnection = function(conn){
      if(conn != null){
        conn.on('data', this.ondata.bind({_supra:this, socket:conn}));
        //HEROKU HACK - Checking connection satatus
          var t = setInterval(function(){
            try{
              //conn._session.recv.didClose();
            }catch(x){}
          }, 10000);
        //END
        conn.on('close', this.onclose.bind({_supra:this, socket:conn, _t:t}));
      }
    };
    RPCServer.prototype.ondata = function(data){
      data = JSON.parse(data);
      //Bind
        var _this = this._supra;
        var conn = this.socket;

      //Acept a Broadcasting to all connection on the same chanel and domain
        if(data.msg != null && _this.getConnection(conn) != null && data.c != null && conn.chanels[data.c] != null){
            var send = _this.parser.parse(data);
            if(send == true && conn.chanels[data.c] == "write"){
              data.msg = _this.msgExtend.dataFilter(data.msg);
              _this.broadcast(data.c, conn._domain, data.msg);//Broadcast to internal connections
              _this.redisPub.publish("broadcast", JSON.stringify({pid:this.pid, _chanel:data.c, _domain:conn._domain, _msg:data.msg}));//Broadcast to external connections
            }
            return;
        }

      //sending private message -- This will send a private message to a connection that have data.prop in his sharedobject props
        if(data.a == "private" && data.msg != null && _this.getConnection(conn) != null && data.prop != null && data.value != null){
          _this.sendPrivate(conn._domain, data.prop, data.value, data.msg);
          return;
        }

      //Connection trys to subscribe a chanel
        if(data.a == "subscribe" && data.c != null && data.p != null && _this.getConnection(conn) != null){
          //if is reserved chanel set proper permission.
          var permissions = _this.isChanelReserved(data.c, data.p);
          var req = _this.subscribeChanel(conn, data.c, permissions);
          if(req != null){conn.write(JSON.stringify(req));}
          return;
        }

      //trys to unsubscribe chanel
        if(data.a == "unsubscribe" && data.c != null && _this.getConnection(conn) != null){
          var req = _this.unSubscribeChanel(conn, data.c);
          if(req != null){conn.write(JSON.stringify(req));}
          return;
        }

      //Get all connections shared objects that has on specific chanel
        if(data.a == "getChanelSO" && data.c != null && _this.getConnection(conn) != null){
          if(conn.chanels[data.c] != null){
            var soCollection = _this.getChanelSO(conn._domain, data.c);
            var req = {};
                req.a = "getChanelSO";
                req.c = data.c;
                req.s = 1;//Status ok
                req.id = Math.random()*9999999999;
                req.so = soCollection;
            conn.write(JSON.stringify(req));
            //We ask other drones to tell their chanels SO
              //we set status object for this connections
                conn.statusObj = {soId:req.id};
              //we tell all drones
                _this.redisPub.publish("broadcast", JSON.stringify({
                      pid:_this.pid, 
                      a:"getChanelSO", 
                      _chanel:data.c, 
                      _domain:conn._domain, 
                      soId:req.id
                }));
          }
          return;
        }

      //Register Shared object
        if(data.a == "setSO" && data.so != null){
          conn.sharedObject = data.so;
          return;
        }

      //If every thing fails we check extra logic
        _this.msgExtend.parse(data, _this, conn);

      //this need to be at the end
      //Connection try to login into rpc Server, we check for key validation
        if(data.k == null){data.k = "";}
        if(data.k != null && data.a == "login" && _this.getConnection(conn) == null){
          //If we are here we have a chanel, we should validate
          //chanel referer in order to avoid hacking from other domains
          if(data.k != _this.genKey([data.d])){
            //Auth Credentials are invalid, we send the error back to client
            //that should disconnect the connection to release trafic.
            _this.closeSession(conn, "Invalid Acess");
            return;
          }

          //CREATE INTERNAL CONNECTION OBJECT
            _this.addConnection(conn, data.d);
        }
    };
    RPCServer.prototype.onclose = function(){
      //Bind
        var _this = this._supra;
        var conn = this.socket;
        var t = this._t;

      if(_this.getConnection(conn) == null){
        //If we are here then this event have been fired twice
          clearInterval(t);
          return;
      }

      //Tells msg parser that a new connection has been disconnected
        _this.parser.connectionClose(conn);

      //Remove Connection
        _this.removeConnection(conn);

        clearInterval(t);
    };
    RPCServer.prototype.getConnection = function(conn){
      if(conn._domain == null){return null;}
      return this.domains[conn._domain].conns[conn.id];
    };
    RPCServer.prototype.addConnection = function(conn, domain){
      if(this.domains[domain] == null){
        this.domains[domain] = {};
        this.domains[domain].conns = {};
      }
      //DOMAIN EXIST ADD CONNECTION
        this.domains[domain].conns[conn.id] = conn;
        this.domains[domain].conns[conn.id].chanels = {};
        this.domains[domain].conns[conn.id]._domain = domain;
      //Tells msg parser that a new connection has been created
        this.parser.connectionOpen(conn);
      //Tells all connections subcribed to connectionJoined chanel
        var msg = {};
            msg.numCons = this.countProps(this.domains[conn._domain].conns);
        this.broadcast("connConnected", conn._domain, msg);
        this.redisPub.publish("broadcast", JSON.stringify({pid:this.pid, _chanel:"connConnected", _domain:conn._domain, _msg:msg}));
        this.msgExtend.connectionOpen(this, conn);
    };
    RPCServer.prototype.removeConnection = function(conn){
      if(conn._domain == null){return null;}
        delete this.domains[conn._domain].conns[conn.id];

        //Tells all connections that a conn has bean terminated
          var msg = {};
            msg.numCons = this.countProps(this.domains[conn._domain].conns);
            //Send sharedObject to listening Clientes
              if(conn.sharedObject != null){msg.so = conn.sharedObject;}
          this.broadcast("connDisconnected", conn._domain, msg);
          this.redisPub.publish("broadcast", JSON.stringify({pid:this.pid, _chanel:"connDisconnected", _domain:conn._domain, _msg:msg}));
          this.msgExtend.connectionClose(this, conn);

      //IF DOMAIN DONT HAVE CONNECTIONS REMOVE IT
        if(this.countProps(this.domains[conn._domain].conns) == 0){
          delete this.domains[conn._domain];
        }
    };
    RPCServer.prototype.subscribeChanel = function(conn, chanel, permission){
      if(conn._domain == null){return null;}
      if(permission == "denied"){return null;}
      if(this.domains[conn._domain].conns[conn.id].chanels[chanel] != null){return null;}
      //Register chanel to connection
        this.domains[conn._domain].conns[conn.id].chanels[chanel] = permission;
      //return the subscribed chanel and status 1 == ok subscribed
        return {a:"subscribe", c:chanel, s:1};
    };
    RPCServer.prototype.unSubscribeChanel = function(conn, chanel){
      if(conn._domain == null){return null;}
      //Delete connection chanel
        delete this.domains[conn._domain].conns[conn.id].chanels[chanel];
      ///return the unsubscribed chanel and status 1 == ok unsubscribed
        return {a:"unsubscribe", c:chanel, s:1};
    };
    RPCServer.prototype.closeSession = function(conn, _msg){
      console.log("Closing Client, reason: "+_msg+" conn:"+conn.id);
      conn.write(JSON.stringify({s:0, msg:_msg}));
      conn._session.recv.didClose();
    };
    RPCServer.prototype.genKey = function(data){
      var hash = this.crypto.createHash('sha256');
      hash.update(this.secret);
      for(var i=0; i < data.length; i++){
        if(data[i] != null && data[i] != ""){
          hash.update(data[i]);
        }
      }
      return hash.digest("hex");
    };
    RPCServer.prototype.getChanelSO = function(domain, chanel){
      var soArr = new Array();
      if(this.domains[domain] == null){return soArr;}
      for(c in this.domains[domain].conns){
        var con = this.domains[domain].conns[c];
        if(con.chanels[chanel] != null && con.sharedObject != null){
          soArr.push(con.sharedObject);
        }
      }
      return soArr;
    }
    RPCServer.prototype.isChanelReserved = function(chanel, permission){
      if(chanel == "connConnected"){
        return "read";
      }
      if(chanel == "connDisconnected"){
        return "read";
      }
      if(chanel == "login"){
        return "denied";
      }
      return permission;
    };
    RPCServer.prototype.countProps = function(obj){
      var count = 0;
      for(i in obj){
        if(obj[i] != null){
          count ++;
        }
      }
      return count;
    };
    RPCServer.prototype.onRedisMessage = function(channel, message){
      var _this = this._supra
      //console.log("Process receiver ID:"+_this.pid+"   Message: "+message);

      data = JSON.parse(message);

      //console.log("PR:"+_this.pid+" PS:"+data.pid+"  Message: "+data.a);

      if(data != null && channel == "broadcast"){
        //When a drone needs sharedObjects that this drone may have
        if(data.a == "getChanelSO" && data._chanel != null && data._domain != null && data.pid != _this.pid){
          var soCollection = _this.getChanelSO(data._domain, data._chanel);
          //var soCollection = _this.getChanelSO("localhost", data._chanel);
          //Sending SO to caller Drone
          if(soCollection.length > 0){
            console.log("sending so from: "+_this.pid+"  to: "+data.pid);
            _this.redisPub.publish("broadcast", JSON.stringify({
                pid:_this.pid, a:"sendChanelSO", 
                receiverPid:data.pid, 
                so:soCollection, 
                soId:data.soId, 
                _chanel:data._chanel, 
                _domain:data._domain
            }));
          }
          return;
        }

        //Reciving chanel SO
        if(data.a == "sendChanelSO" && data.receiverPid == _this.pid){
          //data._domain = "localhost";
          //console.log("Receiving chanel Shared Object "+data._domain);
          //we have chanel so here we need to tell it to our connection
          if(_this.domains[data._domain] == null){return;}

          for(c in _this.domains[data._domain].conns){
            var con = _this.domains[data._domain].conns[c];
            if(con.statusObj.soId == data.soId){
              var req = {};
                  req.a = "getChanelSO";
                  req.c = data._chanel;
                  req.s = 1;//Status ok
                  req.id = data.soId;
                  req.so = data.so;
              //console.log("Connection found containing the id:"+con.statusObj.soId);
              con.write(JSON.stringify(req));
              delete con.statusObj;
            }
          }
          return;
        }

        //When a broadcast message arrive
        if(data.pid != null && data.pid != _this.pid && data._chanel != null && data._domain != null && data._msg != null){
          _this.broadcast(data._chanel, data._domain, data._msg);
          return;
        }
      }

      //Sending this message to extra logic
        _this.msgExtend.redisOnMessage(data);
    };
    RPCServer.prototype.broadcast = function(chanel, domain, msg){
      var req = {};
        req.c = chanel;
        req.msg = msg;
        req = JSON.stringify(req);

      //No connections are available for current domain return
        if(this.domains[domain] == null){return;}

        for(c in this.domains[domain].conns){
          var con = this.domains[domain].conns[c];
          if(con.chanels[chanel] != null){
            con.write(req);
          }
        }
    };
    RPCServer.prototype.sendPrivate = function(domain, prop, value, msg){
      var req = {};
        req.a = "private";
        req.prop = prop;
        req.value = value;
        req.msg = msg;
        req = JSON.stringify(req);

      //No connections are available for current domain return
        if(this.domains[domain] == null){return;}

      for(c in this.domains[domain].conns){
        var con = this.domains[domain].conns[c];
        if(con.sharedObject[prop] != null){
          if(con.sharedObject[prop] == value){
            con.write(req);
          }
        }
      }
    };
    RPCServer.prototype.try_call = function(object){
      return this.msgExtend.execute(object);
    };

    exports.createServer = function(httpServer, connPerfix, secret){
      return new RPCServer({s:httpServer, p:connPerfix, _secret:secret});
    };
  })(this);

})();