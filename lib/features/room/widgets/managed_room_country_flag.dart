/// Render a country flag only for a recognized *country* value saved on the
/// room. City/free-form locations never get a guessed national identity.
String managedRoomCountryFlag(String rawCountry) {
  const aliases = <String, String>{
    'سوريا':'SY', 'سورية':'SY', 'syrian arab republic':'SY', 'syria':'SY',
    'الإمارات':'AE', 'الإمارات العربية المتحدة':'AE', 'الامارات':'AE',
    'united arab emirates':'AE', 'uae':'AE',
    'السعودية':'SA', 'المملكة العربية السعودية':'SA', 'saudi arabia':'SA',
    'لبنان':'LB', 'lebanon':'LB', 'الأردن':'JO', 'jordan':'JO',
    'العراق':'IQ', 'iraq':'IQ', 'الكويت':'KW', 'kuwait':'KW',
    'قطر':'QA', 'qatar':'QA', 'البحرين':'BH', 'bahrain':'BH',
    'عمان':'OM', 'سلطنة عمان':'OM', 'oman':'OM',
    'مصر':'EG', 'egypt':'EG', 'فلسطين':'PS', 'palestine':'PS',
    'تركيا':'TR', 'turkey':'TR', 'türkiye':'TR',
    'الولايات المتحدة':'US', 'united states':'US',
    'المملكة المتحدة':'GB', 'united kingdom':'GB',
    'فرنسا':'FR', 'france':'FR', 'ألمانيا':'DE', 'germany':'DE',
  };
  final value = rawCountry.trim().toLowerCase();
  final iso = aliases[value];
  if (iso == null || iso.length != 2) return '';
  return String.fromCharCode(0x1F1E6 + iso.codeUnitAt(0) - 65) +
      String.fromCharCode(0x1F1E6 + iso.codeUnitAt(1) - 65);
}
