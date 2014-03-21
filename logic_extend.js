//USE THIS OBJECT TO CONSTRUCT EXTRA LOGIC FOR MESSAGE SERVERS
(function() {

  var LogicExtend = (function(_super){
    LogicExtend.name = 'LogicExtend';

    function LogicExtend(_controler){
      var hashtable = require ("hashtable_manager");

      //SQL CONNECTION
        this.connection = {
          host     : '',
          user     : '',
          password : '',
          database : '',
          insecureAuth : true
        };
        this.objectsQuery = "SELECT so.*, sc.vchClientName, sc.bStatus AS bClientStatus FROM `supportobject` AS so INNER JOIN supportclient AS sc WHERE so.iIDClient = sc.iIDClient";

      //Controler pointer
        this.controler = _controler;

      //Analytics Data Tables
          this.acessos = hashtable.hashTableManager();
          this.acessos.loadFromSQL(this.connection, "supportsessions", this.parseSqlSessions.bind(this));

          this.users = hashtable.hashTableManager();
          this.users.loadFromSQL(this.connection, "supportuser", this.parseSqlUsers.bind(this));

          //this.permissions = hashtable.hashTableManager();
          //this.permissions.loadFromSQL(this.connection, "SupportUserPermissions", this.parseSqlPermissions.bind(this));

          this.objects = hashtable.hashTableManager();
          this.objects.loadQueryFromSQL(this.connection, this.objectsQuery, this.parseSqlObjects.bind(this));

        var supra = this;

        setInterval(function(){
          //var time = String(new Date("2012/07/06").getTime());
              //time = String(time).substring(0, time.length-3);
              //console.log(time);
          try{
            supra.acessos.saveToSQL(supra.connection, "supportsessions", "id");
          }catch(e){
            console.log(e);
          }
        }, 5000);


    }
    //Reload SQL after order from external scource
    LogicExtend.prototype.execute = function(action){
      if(action == "objects"){
        this.objects.loadQueryFromSQL(this.connection, this.objectsQuery, this.parseSqlObjects.bind(this));
        this.controler.redisPub.publish("broadcast", JSON.stringify({
          pid: this.controler.pid, 
          a: "execute", 
          _action: "objects"
        }));
        return "200 ok";
      }
      if(action == "users"){
        this.users.loadFromSQL(this.connection, "supportuser", this.parseSqlUsers.bind(this));
        this.controler.redisPub.publish("broadcast", JSON.stringify({
          pid: this.controler.pid, 
          a: "execute", 
          _action: "users"
        }));
        return "200 ok";
      }
      return "fail";
    };


    LogicExtend.prototype.connectionOpen = function(supra, conn){
    };

    LogicExtend.prototype.connectionClose = function(supra, conn){
      if(conn.sharedObject != null){
        //Tell all clients that an admin is online now
        if(conn.sharedObject.perms == "store_admin"){
          //we should check here if this store has more than one admin
          var req = {};
              req.a = "status";
              req.msg = this.adminOnline(conn.sharedObject.iIDObject, supra);//This will be dinamic
          this.broadcast(conn.sharedObject.iIDObject, req, "client");

          this.controler.redisPub.publish("broadcast", JSON.stringify({
              pid: this.controler.pid, 
              a: "status", 
              chanel: "client", 
              iIDObject: conn.sharedObject.iIDObject,
              _req: req
          }));
        }

        //Tell admin that a client as disconnected
        if(conn.sharedObject.perms == "client"){
          var req = {};
              req.a = "connectionClosed";
              req.msg = conn.sharedObject;
          this.broadcast(conn.sharedObject.iIDObject, req, "store_admin");

          this.controler.redisPub.publish("broadcast", JSON.stringify({
              pid: this.controler.pid, 
              iIDObject: conn.sharedObject.iIDObject,
              a: "connectionClosed", 
              so: conn.sharedObject,
              _req: req
          }));
        }
      }
    };

    LogicExtend.prototype.getClients = function(supra, iIDObject){
       var conns = this.getConnections(supra);

       var conns_array = new Array();

       for(i in conns){
        if(conns[i].sharedObject){
         if(conns[i].sharedObject.perms == "client" && iIDObject == conns[i].sharedObject.iIDObject && conns[i].sharedObject.dummy == false){
           conns_array.push(conns[i].sharedObject);
         }
        }
       }

       return conns_array;
    };

    LogicExtend.prototype.broadcast = function(iIDObject, req, perms){
      var conns = this.getConnections(this.controler);

      for(i in conns){
        if(conns[i].sharedObject){
          if(iIDObject == conns[i].sharedObject.iIDObject && conns[i].sharedObject.perms == perms && conns[i] != null){
             conns[i].write(JSON.stringify(req));
          }
        }
      }
    };

    LogicExtend.prototype.parse = function(data, supra, conn){
      //Login connection
        //data.c = Chanel
        //data.msg = Message
        if(data.c == "login" && data.msg != null){

           //Checking if the object that this connection is trying to access is a valid object.
            if(data.msg != null){
              var obj = this.objects.get(data.msg.iIDClient+"_"+data.msg.iIDObject);
              if(obj == null){
                //if this object doenst exist in our data base we disconnect the user.
                  this.controler.closeSession(conn, "1: Invalid Object!");
                  return;
              }

              //if Object is valid then we check if the client or Object is active
              if(obj.bStatus == 0 || obj.bClientStatus == 0 || obj.iIDClient != data.msg.iIDClient || obj.iIDObject != data.msg.iIDObject){
                //The client or the object has been deactivated
                  this.controler.closeSession(conn, "2: Invalid Object!");
                  return;
              }
            }

          //a segunda fase deste if valida se as permissões que foram enviadas são permissões válidas de aplicação, se não for
          //coloca-se uma permissão básica para este pedido de autenticação
          if(data.msg.perms == null || (data.msg.perms != "client" && data.msg.perms != "store_admin")){
            data.msg.perms = "client";
          }

          if(data.msg.perms == "client"){
            //We need to check here if user name is valid if not we set one to be valid

            conn.sharedObject = data.msg;

            //here we process the user name
              conn.sharedObject.name =  this.dataFilter(conn.sharedObject.name);
              conn.sharedObject.id =  this.dataFilter(conn.sharedObject.id);
              conn.sharedObject.dummy = false;

            var req = {};
              req.a = "loginResponse";
              req.msg = true;
            conn.write(JSON.stringify(req));

            //We tell all admins connected to the object that this user is online
              var req = {};
                  req.a = "connectionOpen";
                  req.msg = conn.sharedObject;
              this.broadcast(conn.sharedObject.iIDObject, req, "store_admin");
              this.storeAcessData(conn, "client");

              this.controler.redisPub.publish("broadcast", JSON.stringify({
                  pid: this.controler.pid, 
                  iIDObject: conn.sharedObject.iIDObject,
                  a: "connectionOpen", 
                  so: conn.sharedObject,
                  _req: req
              }));

            return;
          }

          //We have data we will check if its good data to work
            if(data.msg.perms == "store_admin" && data.msg.iIDClient != null 
            && data.msg.iIDObject != null && data.msg.token != null 
            && data.msg.date != null && data.msg.iIDUser != null){

              var user = this.users.get(data.msg.iIDUser+"_"+data.msg.iIDClient);
              if(user == null){
                this.controler.closeSession(conn, "Invalid User!");
                return;
              }

              //Validating inserted token for authsub
              if(this.controler.genKey([String(data.msg.iIDUser), String(data.msg.date), String(data.msg.iIDObject)]) == data.msg.token){
                //Validating auth token expire date
                var nowTime = String(new Date().getTime());
                    nowTime = Number(String(nowTime).substring(0, nowTime.length-3));
                var tokenTime = String(new Date(data.msg.date).getTime());
                    tokenTime = Number(String(tokenTime).substring(0, tokenTime.length-3));

                if(nowTime > (tokenTime + 10800)){//Expires in 3 hours
                  this.controler.closeSession(conn, "Session Expire!");
                  return;
                }

                conn.sharedObject = data.msg;

                var clients = this.getClients(supra, conn.sharedObject.iIDObject);
                var uid = Math.random()*999999999999999;

               //Sending all users to store admin
                var req = {};
                    req.a = "userList";
                    req.msg = clients;
                conn.sharedObject.uid = uid;

                conn.write(JSON.stringify(req));

                this.controler.redisPub.publish("broadcast", JSON.stringify({
                    pid: this.controler.pid, 
                    iIDObject: conn.sharedObject.iIDObject,
                    a: "userList", 
                    _uid: uid
                }));

              }else{
                this.controler.closeSession(conn, "Bad Login!");
                return;
              }
            }

          //Tell all clients that an admin is online now
            if(conn.sharedObject.perms == "store_admin"){
              var req = {};
                  req.a = "status";
                  req.msg = true;
              this.broadcast(conn.sharedObject.iIDObject, req, "client");
              this.storeAcessData(conn, "store_admin");

              //Updating all clientes in other drones about new status
              this.controler.redisPub.publish("broadcast", JSON.stringify({
                  pid: this.controler.pid, 
                  a: "status", 
                  chanel: "client", 
                  iIDObject: conn.sharedObject.iIDObject,
                  _req: req
              }));

              return;
            }
        }
      
      //Checking if store admin is online
       if(data.c == "checkState" && data.msg.iIDObject != null){
         var online = this.adminOnline(data.msg.iIDObject, supra);

         //We tell the connection the status of our admin
          var req = {};
              req.a = "status";
              req.msg = online;
          conn.write(JSON.stringify(req));

          if(online == false){
            //If conn shared object doesn´t exists we create it
            if(conn.sharedObject == null){
              conn.sharedObject = {};
              /* Isto aqui permite que o cliente saiba se existe ou não um administrador online.*/
              conn.sharedObject.iIDObject = data.msg.iIDObject;
              conn.sharedObject.perms = "client";
              conn.sharedObject.dummy = true;
              
            }
            //Setting cheking state for thsi conn
            conn.sharedObject.checkState = true;
            this.controler.redisPub.publish("broadcast", JSON.stringify({
                pid: this.controler.pid, 
                a: "checkState", 
                iIDObject: data.msg.iIDObject
            }));
          }
          return;
       }

       /*
          Colocar dentro deste IF uma validação, que irá apenas enviar menssagem para outros processos se
          o id da ligação que está a tentar enviar não existir neste processo, desta forma vamos poupar 
          envio de menssagens.
       */
       //Send message from client to admin
       if(data.c == "sendMessage" && data.msg != null && conn.sharedObject){
          if(conn.sharedObject.perms == "client"){
            this.sendMessageToAdmin(conn.sharedObject.iIDObject, conn.sharedObject.name, conn.sharedObject.id, data);

            this.controler.redisPub.publish("broadcast", JSON.stringify({
                pid: this.controler.pid, 
                a: "sendMessage", 
                perms: "client", 
                so: conn.sharedObject, 
                _data: data
            }));

            return;
          }

          if(conn.sharedObject.perms == "store_admin"){
            this.sendMessageToUser(conn.sharedObject.iIDObject, conn.sharedObject.iIDUser, conn.sharedObject.iIDClient, data);
            this.notifyAdmins(conn.sharedObject, data);

            this.controler.redisPub.publish("broadcast", JSON.stringify({
                pid: this.controler.pid, 
                a: "sendMessage", 
                perms: "store_admin", 
                so: conn.sharedObject, 
                _data: data
            }));

            return;
          }
       }

    };
    LogicExtend.prototype.dataFilter = function(data){
       //data = "processed";
         data = String(data).replace("<", "");
         data = String(data).replace(">", "");
         data = String(data).replace("/>", "");
       return data;
    };
    LogicExtend.prototype.notifyAdmins = function(so, data){
       //Envia a menssagem que um admin a todos os admins ligados a este objecto
       var admin = this.users.get(so.iIDUser+"_"+so.iIDClient);
        var req = {};
            req.a = "onMessage";
            //we need to filter here the message name and msg data to not include html chars
            req.msg = {name:admin.vchName, id:data.msg.id, text:this.dataFilter(data.msg.text), src:"admin"};

        var conns = this.getConnections(this.controler);
        for(i in conns){
          if(conns[i].sharedObject){
            if(so.iIDObject == conns[i].sharedObject.iIDObject && conns[i].sharedObject.perms == "store_admin" && conns[i].sharedObject.iIDUser != so.iIDUser){
              conns[i].write(JSON.stringify(req));
            }
          }
        }
    };
    LogicExtend.prototype.sendMessageToAdmin = function(iIDObject, _name, _id, data){
       //Sending all users to store admin
        var req = {};
            req.a = "onMessage";
            //we need to filter here the message name and msg data to not include html chars
            req.msg = {name:_name, id:_id,  text: this.dataFilter(data.msg)};
        this.broadcast(iIDObject, req, "store_admin");
    };
    LogicExtend.prototype.sendMessageToUser = function(iIDObject, iIDUser, iIDClient, data){
       var conns = this.getConnections(this.controler);
            
        for(i in conns){
          if(conns[i].sharedObject){
            if(iIDObject == conns[i].sharedObject.iIDObject && conns[i].sharedObject.perms == "client" && conns[i].sharedObject.id == data.msg.id){
                if(conns[i].sharedObject.id == data.msg.id){
                  var admin = this.users.get(iIDUser+"_"+iIDClient);
                  var req = {};
                      req.a = "onMessage";
                      //Possible we need to format here the message name and stuff
                      req.msg = {name:admin.vchName, text: this.dataFilter(data.msg.text)};
                  conns[i].write(JSON.stringify(req));
                }
            }
          }
        }
        return;
    };
    LogicExtend.prototype.redisOnMessage = function(data){
      console.log("PR: "+this.controler.pid+"  PS:"+data.pid+"    a:"+data.a);

      if(data.a == "sendState" && data._req != null && data.iIDObject != null && data.pid != this.controler.pid && data.receiverPid == this.controler.pid){
        var conns = this.getConnections(this.controler);

        for(i in conns){
          if(conns[i].sharedObject){
            //Aqui ve quais as ligações que estão ligadas ao objecto, e envia a informação que existe um administrador ligado ao canal.
            if(conns[i].sharedObject.perms == "client" && data.iIDObject == conns[i].sharedObject.iIDObject && conns[i].sharedObject.checkState == true){
              //Sending all users to store admin
                conns[i].sharedObject.checkState = false;
                conns[i].write(JSON.stringify(data._req));
                delete conns[i].sharedObject.checkState;
            }
          }
        }
      }
      
      if(data.a == "checkState" && data.iIDObject != null && data.pid != this.controler.pid){
         var online = this.adminOnline(data.iIDObject, this.controler);

         if(online == true){
          var req = {};
              req.a = "status";
              req.msg = online;
           this.controler.redisPub.publish("broadcast", JSON.stringify({
                pid: this.controler.pid, 
                receiverPid: data.pid,
                iIDObject: data.iIDObject,
                a: "sendState", 
                _req: req
            }));
         }

         return;
       }

      if(data.a == "connectionOpen" && data.iIDObject != null && data._req != null && data.pid != this.controler.pid){
         this.broadcast(data.iIDObject, data._req, "store_admin");
         return;
       }

       if(data.a == "connectionClosed" && data.iIDObject != null && data._req != null && data.pid != this.controler.pid){
         this.broadcast(data.iIDObject, data._req, "store_admin");
         return;
       }

      if(data.a == "sendMessage" && data.perms == "client" && data._data.msg != null && data.pid != this.controler.pid){
         this.sendMessageToAdmin(data.so.iIDObject, data.so.name, data.so.id, data._data);
         return;
       }

       if(data.a == "sendMessage" && data.perms == "store_admin" && data._data.msg != null && data.pid != this.controler.pid){
         this.sendMessageToUser(data.so.iIDObject, data.so.iIDUser, data.so.iIDClient, data._data);
         this.notifyAdmins(data.so, data._data);
         return;
       }

       if(data.a == "status" && data._req != null && data.pid != this.controler.pid){
        if(this.adminOnline(data.iIDObject, this.controler) == true){return;}
        this.broadcast(data.iIDObject, data._req, "client");
        return;
       }

       if(data.a == "userList" && data.iIDObject != null && data.pid != this.controler.pid){
         var clients = this.getClients(this.controler, data.iIDObject);

         if(clients.length > 0){
           this.controler.redisPub.publish("broadcast", JSON.stringify({
              pid: this.controler.pid, 
              iIDObject: data.iIDObject,
              a: "sendUserList", 
              _uid: data._uid,
              _clients: clients
           }));
         }
       }

      if(data.a == "sendUserList" && data.iIDObject != null && data.pid != this.controler.pid){
        var conns = this.getConnections(this.controler);

        for(i in conns){
          if(conns[i].sharedObject){
            if(conns[i].sharedObject.perms == "store_admin" && data.iIDObject == conns[i].sharedObject.iIDObject && conns[i].sharedObject.uid == data._uid){
              //Sending all users to store admin
                var req = {};
                    req.a = "userList";
                    req.msg = data._clients;
                conns[i].write(JSON.stringify(req));
            }
          }
        }
      }

      //Actualiza utilizadores e objectos quando há alterações em backoffice, e este pedido chegou primeiro a outro processo
      if(data.a == "execute" && data.pid != this.controler.pid){
        if(data._action == "objects"){
          this.objects.loadQueryFromSQL(this.connection, this.objectsQuery, this.parseSqlObjects.bind(this));
          return "200 ok";
        }
        if(data._action == "users"){
          this.users.loadFromSQL(this.connection, "supportuser", this.parseSqlUsers.bind(this));
          return "200 ok";
        }
        return;
      }
    };
    LogicExtend.prototype.adminOnline = function(iIDObject, supra){
       var conns = this.getConnections(supra);
       var online = false;

       for(i in conns){
          if(conns[i].sharedObject){
           if(conns[i].sharedObject.perms == "store_admin" && iIDObject == conns[i].sharedObject.iIDObject){
             online = true;
           }
          }
       }

       return online;
    };
    LogicExtend.prototype.getConnections = function(supra){
      var conns = {};
      //get all connections ignore domain sandbox rule
        var domains = supra.domains;
        for(i in domains){
          var cs = domains[i].conns;
          for(j in cs){
            conns[j] = cs[j];
          }
        }
      return conns;
    };
    LogicExtend.prototype.parseSqlObjects = function(hash, row){
      hash.set(row.iIDClient+"_"+row.iIDObject, row);
    };
    LogicExtend.prototype.parseSqlSessions = function(hash, row){
      hash.set(row.vchUser+"_"+row.iIDClient+"_"+row.iIDObject+"_"+row.vchDate, row);
    };
    LogicExtend.prototype.parseSqlUsers = function(hash, row){
      hash.set(row.id+"_"+row.iIDClient, row);
    };
    LogicExtend.prototype.parseSqlPermissions = function(hash, row){
      hash.set("permission_"+row.id, row);
    };
    LogicExtend.prototype.storeAcessData = function(conn, userType){
      var _key = userType+"_"+conn.sharedObject.iIDClient+"_"+conn.sharedObject.iIDObject+"_"+this.dateFormat(new Date(), "%Y/%m/%d", false);
      var supra = this;

      //Store some data to analyse - HASH TABLE EXAMPLE
        var acess = this.acessos.get(_key);
        if(acess != null){
          acess.iCount ++;
          acess.changed = true;
        }else{
          acess = {iIDClient:conn.sharedObject.iIDClient, 
                   iIDObject:conn.sharedObject.iIDObject, 
                   iCount:1, 
                   vchUser:userType, 
                   vchDate:this.dateFormat(new Date(), "%Y/%m/%d", false),
                   _new: true
                  };
        }
        this.acessos.set(_key, acess);
    };
    LogicExtend.prototype.dateFormat = function(date, fstr, utc){
      utc = utc ? 'getUTC' : 'get'; 
      return fstr.replace (/%[YmdHMS]/g, function (m) { 
        switch (m) { 
        case '%Y': return date[utc + 'FullYear'] (); // no leading zeros required 
        case '%m': m = 1 + date[utc + 'Month'] (); break; 
        case '%d': m = date[utc + 'Date'] (); break; 
        case '%H': m = date[utc + 'Hours'] (); break; 
        case '%M': m = date[utc + 'Minutes'] (); break; 
        case '%S': m = date[utc + 'Seconds'] (); break; 
        default: return m.slice (1); // unknown code, remove % 
        } 
        // add leading zero if required 
        return ('0' + m).slice (-2); 
      }); 
    };

    exports.logicExt = function(controler){
      return new LogicExtend(controler);
    };
  })(this);

})();