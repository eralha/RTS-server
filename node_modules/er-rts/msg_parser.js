//USE THIS OBJECT TO CONSTRUCT EXTRA LOGIC FOR MESSAGE SERVERS
(function() {

  var MSGParser = (function(_super){
    MSGParser.name = 'MSGParser';

    function MSGParser(_server) {
      this.server = _server;
    }

    MSGParser.prototype.connectionOpen = function(conn){

    };

    MSGParser.prototype.connectionClose = function(conn){

    };

    MSGParser.prototype.parse = function(data){
      //var msg = JSON.parse(data.msg);
      return true;
    };

    exports.msgParser = function(server){

      return new MSGParser(server);
    };
  })(this);

})();