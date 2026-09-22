class RankingPeriod {
 const RankingPeriod({required this.kind,required this.startsAt,required this.endsAt});
 final String kind; final DateTime startsAt,endsAt;
 void validate(){
  if(!{'daily','weekly','monthly'}.contains(kind))throw ArgumentError('unsupported ranking period');
  if(!endsAt.isAfter(startsAt))throw ArgumentError('invalid ranking window');
 }
}
