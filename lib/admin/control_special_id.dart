class SpecialIdPolicy {
 static final RegExp _allowed=RegExp(r'^[A-Za-z0-9_-]{3,24}$');
 static String normalize(String value)=>value.trim();
 static bool valid(String value)=>_allowed.hasMatch(normalize(value));
 static void validate(String value){if(!valid(value))throw ArgumentError('Special ID غير صالح');}
 static bool eligibleByVip(int vipLevel)=>vipLevel>=3;
}
