abstract final class MissionPolicy {
 static const loginStreakCoins=[100,150,200,300,400,500,1000];
 static int rewardForLoginDay(int day){if(day<1||day>7)throw ArgumentError('day must be 1..7');return loginStreakCoins[day-1];}
 static int get fullStreakTotal=>loginStreakCoins.fold(0,(a,b)=>a+b);
}
