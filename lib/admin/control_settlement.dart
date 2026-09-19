abstract final class AgencySettlementPolicy {
 static const qualifiedMicMinutesPerDay=120;
 static int payoutPercent(int qualifiedDays){
  if(qualifiedDays>=9)return 100;
  switch(qualifiedDays){case 8:return 90;case 7:return 80;case 6:return 70;case 5:return 55;case 4:return 40;case 3:return 25;default:return 0;}
 }
 static num payable(num gross,int qualifiedDays)=>gross*payoutPercent(qualifiedDays)/100;
}
