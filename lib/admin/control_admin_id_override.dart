abstract final class AdminIdOverridePolicy {
  static final RegExp _allowed = RegExp(r'^\d{3,12}$');

  static String normalize(String value) {
    var text=value.trim();
    const arabic='٠١٢٣٤٥٦٧٨٩';
    const persian='۰۱۲۳۴۵۶۷۸۹';
    for(var i=0;i<10;i++){
      text=text.replaceAll(arabic[i],'$i').replaceAll(persian[i],'$i');
    }
    return text;
  }

  static bool valid(String value)=>_allowed.hasMatch(normalize(value));

  static void validate(String value){
    if(!valid(value))throw ArgumentError('الـID يجب أن يكون رقمياً من 3 إلى 12 خانة');
  }

  static void validateChange(String currentId,String newId){
    final before=normalize(currentId),after=normalize(newId);
    validate(before);validate(after);
    if(before==after)throw ArgumentError('الـID الجديد يجب أن يختلف عن الحالي');
  }
}
