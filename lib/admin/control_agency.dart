abstract final class AgencyPolicy {
 static const cycleOneStartDay=1,cycleOneEndDay=15,cycleTwoStartDay=16;
 static const removalResponseHours=24, rejoinCooldownHours=24;
 static String cycleForDay(int day){if(day<1||day>31)throw ArgumentError('invalid day');return day<=15?'1-15':'16-end';}
 static bool qualifiesDay(Duration micTime)=>micTime.inMinutes>=120;
}
