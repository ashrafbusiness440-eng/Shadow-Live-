class CampaignPolicy {
 static const audiences={'all','country','vip','agency','userLevel','custom'};
 static void validate({required String audience,required String title,required String body}){
  if(!audiences.contains(audience))throw ArgumentError('unsupported audience');
  if(title.trim().isEmpty||body.trim().isEmpty)throw ArgumentError('campaign content required');
 }
}
