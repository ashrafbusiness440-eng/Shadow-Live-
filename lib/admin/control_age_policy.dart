abstract final class AgePolicy {
 static const minimumAge=18;
 static bool eligible(DateTime birthDate,DateTime today){
  var age=today.year-birthDate.year;
  if(today.month<birthDate.month||(today.month==birthDate.month&&today.day<birthDate.day))age--;
  return age>=minimumAge;
 }
}
