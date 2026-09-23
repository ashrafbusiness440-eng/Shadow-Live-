abstract final class ReportPolicy {
 static const statuses={'new','under_review','actioned','rejected'};
 static const targets={'user','private_message','room_message','room','profile','voice_behavior'};
 static bool canTransition(String from,String to){
  const map=<String,Set<String>>{'new':{'under_review','rejected'},'under_review':{'actioned','rejected'},'actioned':{},'rejected':{}};
  return map[from]?.contains(to)??false;
 }
}
