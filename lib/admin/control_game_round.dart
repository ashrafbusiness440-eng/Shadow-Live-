class GameRoundPolicy {
 static const terminalStatuses={'settled','cancelled'};
 static const statuses={'created','open','locked','settled','cancelled'};
 static bool canTransition(String from,String to){
  const m=<String,Set<String>>{
   'created':{'open','cancelled'},'open':{'locked','cancelled'},'locked':{'settled','cancelled'},'settled':{},'cancelled':{},
  };
  return m[from]?.contains(to)??false;
 }
 static bool mayDebit(String status)=>status=='open';
 static bool maySettle(String status)=>status=='locked';
}
