//USE THIS OBJECT TO CONSTRUCT EXTRA LOGIC FOR MESSAGE SERVERS
(function() {

  var LogicExtend = (function(_super){
    LogicExtend.name = 'LogicExtend';

    function LogicExtend(_controler){
      //Controler pointer
        this.controler = _controler;
    }
    
    LogicExtend.prototype.execute = function(action){
      return "fail";
    };

    LogicExtend.prototype.connectionOpen = function(supra, conn){
    };

    LogicExtend.prototype.connectionClose = function(supra, conn){
    };
    
    LogicExtend.prototype.redisOnMessage = function(data){
    };

    exports.logicExt = function(controler){
      return new LogicExtend(controler);
    };
  })(this);

})();