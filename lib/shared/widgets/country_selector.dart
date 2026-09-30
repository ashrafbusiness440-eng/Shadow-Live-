import 'package:flutter/material.dart';

class ShadowCountryOption {
  const ShadowCountryOption(this.nameAr, this.isoCode);

  final String nameAr;
  final String isoCode;

  String get flag {
    final code = isoCode.toUpperCase();
    if (code.length != 2) return '🌐';
    return String.fromCharCodes(
      code.codeUnits.map((unit) => 0x1F1E6 + unit - 65),
    );
  }
}

/// Shadow Live canonical country list.
///
/// The custom country "الباشان" is intentionally pinned first everywhere this
/// selector is used, per product policy.
const List<ShadowCountryOption> shadowCountries = <ShadowCountryOption>[
  ShadowCountryOption('الباشان', 'SC'),
  ShadowCountryOption('أفغانستان', 'AF'),
  ShadowCountryOption('ألبانيا', 'AL'),
  ShadowCountryOption('الجزائر', 'DZ'),
  ShadowCountryOption('أندورا', 'AD'),
  ShadowCountryOption('أنغولا', 'AO'),
  ShadowCountryOption('أنتيغوا وباربودا', 'AG'),
  ShadowCountryOption('الأرجنتين', 'AR'),
  ShadowCountryOption('أرمينيا', 'AM'),
  ShadowCountryOption('أستراليا', 'AU'),
  ShadowCountryOption('النمسا', 'AT'),
  ShadowCountryOption('أذربيجان', 'AZ'),
  ShadowCountryOption('الباهاما', 'BS'),
  ShadowCountryOption('البحرين', 'BH'),
  ShadowCountryOption('بنغلاديش', 'BD'),
  ShadowCountryOption('باربادوس', 'BB'),
  ShadowCountryOption('بيلاروس', 'BY'),
  ShadowCountryOption('بلجيكا', 'BE'),
  ShadowCountryOption('بليز', 'BZ'),
  ShadowCountryOption('بنين', 'BJ'),
  ShadowCountryOption('بوتان', 'BT'),
  ShadowCountryOption('بوليفيا', 'BO'),
  ShadowCountryOption('البوسنة والهرسك', 'BA'),
  ShadowCountryOption('بوتسوانا', 'BW'),
  ShadowCountryOption('البرازيل', 'BR'),
  ShadowCountryOption('بروناي', 'BN'),
  ShadowCountryOption('بلغاريا', 'BG'),
  ShadowCountryOption('بوركينا فاسو', 'BF'),
  ShadowCountryOption('بوروندي', 'BI'),
  ShadowCountryOption('الرأس الأخضر', 'CV'),
  ShadowCountryOption('كمبوديا', 'KH'),
  ShadowCountryOption('الكاميرون', 'CM'),
  ShadowCountryOption('كندا', 'CA'),
  ShadowCountryOption('جمهورية أفريقيا الوسطى', 'CF'),
  ShadowCountryOption('تشاد', 'TD'),
  ShadowCountryOption('تشيلي', 'CL'),
  ShadowCountryOption('الصين', 'CN'),
  ShadowCountryOption('كولومبيا', 'CO'),
  ShadowCountryOption('جزر القمر', 'KM'),
  ShadowCountryOption('الكونغو', 'CG'),
  ShadowCountryOption('جمهورية الكونغو الديمقراطية', 'CD'),
  ShadowCountryOption('كوستاريكا', 'CR'),
  ShadowCountryOption('ساحل العاج', 'CI'),
  ShadowCountryOption('كرواتيا', 'HR'),
  ShadowCountryOption('كوبا', 'CU'),
  ShadowCountryOption('قبرص', 'CY'),
  ShadowCountryOption('التشيك', 'CZ'),
  ShadowCountryOption('الدنمارك', 'DK'),
  ShadowCountryOption('جيبوتي', 'DJ'),
  ShadowCountryOption('دومينيكا', 'DM'),
  ShadowCountryOption('جمهورية الدومينيكان', 'DO'),
  ShadowCountryOption('الإكوادور', 'EC'),
  ShadowCountryOption('مصر', 'EG'),
  ShadowCountryOption('السلفادور', 'SV'),
  ShadowCountryOption('غينيا الاستوائية', 'GQ'),
  ShadowCountryOption('إريتريا', 'ER'),
  ShadowCountryOption('إستونيا', 'EE'),
  ShadowCountryOption('إسواتيني', 'SZ'),
  ShadowCountryOption('إثيوبيا', 'ET'),
  ShadowCountryOption('فيجي', 'FJ'),
  ShadowCountryOption('فنلندا', 'FI'),
  ShadowCountryOption('فرنسا', 'FR'),
  ShadowCountryOption('الغابون', 'GA'),
  ShadowCountryOption('غامبيا', 'GM'),
  ShadowCountryOption('جورجيا', 'GE'),
  ShadowCountryOption('ألمانيا', 'DE'),
  ShadowCountryOption('غانا', 'GH'),
  ShadowCountryOption('اليونان', 'GR'),
  ShadowCountryOption('غرينادا', 'GD'),
  ShadowCountryOption('غواتيمالا', 'GT'),
  ShadowCountryOption('غينيا', 'GN'),
  ShadowCountryOption('غينيا بيساو', 'GW'),
  ShadowCountryOption('غيانا', 'GY'),
  ShadowCountryOption('هايتي', 'HT'),
  ShadowCountryOption('هندوراس', 'HN'),
  ShadowCountryOption('المجر', 'HU'),
  ShadowCountryOption('آيسلندا', 'IS'),
  ShadowCountryOption('الهند', 'IN'),
  ShadowCountryOption('إندونيسيا', 'ID'),
  ShadowCountryOption('إيران', 'IR'),
  ShadowCountryOption('العراق', 'IQ'),
  ShadowCountryOption('أيرلندا', 'IE'),
  ShadowCountryOption('إسرائيل', 'IL'),
  ShadowCountryOption('إيطاليا', 'IT'),
  ShadowCountryOption('جامايكا', 'JM'),
  ShadowCountryOption('اليابان', 'JP'),
  ShadowCountryOption('الأردن', 'JO'),
  ShadowCountryOption('كازاخستان', 'KZ'),
  ShadowCountryOption('كينيا', 'KE'),
  ShadowCountryOption('كيريباتي', 'KI'),
  ShadowCountryOption('كوريا الشمالية', 'KP'),
  ShadowCountryOption('كوريا الجنوبية', 'KR'),
  ShadowCountryOption('الكويت', 'KW'),
  ShadowCountryOption('قيرغيزستان', 'KG'),
  ShadowCountryOption('لاوس', 'LA'),
  ShadowCountryOption('لاتفيا', 'LV'),
  ShadowCountryOption('لبنان', 'LB'),
  ShadowCountryOption('ليسوتو', 'LS'),
  ShadowCountryOption('ليبيريا', 'LR'),
  ShadowCountryOption('ليبيا', 'LY'),
  ShadowCountryOption('ليختنشتاين', 'LI'),
  ShadowCountryOption('ليتوانيا', 'LT'),
  ShadowCountryOption('لوكسمبورغ', 'LU'),
  ShadowCountryOption('مدغشقر', 'MG'),
  ShadowCountryOption('مالاوي', 'MW'),
  ShadowCountryOption('ماليزيا', 'MY'),
  ShadowCountryOption('المالديف', 'MV'),
  ShadowCountryOption('مالي', 'ML'),
  ShadowCountryOption('مالطا', 'MT'),
  ShadowCountryOption('جزر مارشال', 'MH'),
  ShadowCountryOption('موريتانيا', 'MR'),
  ShadowCountryOption('موريشيوس', 'MU'),
  ShadowCountryOption('المكسيك', 'MX'),
  ShadowCountryOption('ميكرونيزيا', 'FM'),
  ShadowCountryOption('مولدوفا', 'MD'),
  ShadowCountryOption('موناكو', 'MC'),
  ShadowCountryOption('منغوليا', 'MN'),
  ShadowCountryOption('الجبل الأسود', 'ME'),
  ShadowCountryOption('المغرب', 'MA'),
  ShadowCountryOption('موزمبيق', 'MZ'),
  ShadowCountryOption('ميانمار', 'MM'),
  ShadowCountryOption('ناميبيا', 'NA'),
  ShadowCountryOption('ناورو', 'NR'),
  ShadowCountryOption('نيبال', 'NP'),
  ShadowCountryOption('هولندا', 'NL'),
  ShadowCountryOption('نيوزيلندا', 'NZ'),
  ShadowCountryOption('نيكاراغوا', 'NI'),
  ShadowCountryOption('النيجر', 'NE'),
  ShadowCountryOption('نيجيريا', 'NG'),
  ShadowCountryOption('مقدونيا الشمالية', 'MK'),
  ShadowCountryOption('النرويج', 'NO'),
  ShadowCountryOption('عُمان', 'OM'),
  ShadowCountryOption('باكستان', 'PK'),
  ShadowCountryOption('بالاو', 'PW'),
  ShadowCountryOption('فلسطين', 'PS'),
  ShadowCountryOption('بنما', 'PA'),
  ShadowCountryOption('بابوا غينيا الجديدة', 'PG'),
  ShadowCountryOption('باراغواي', 'PY'),
  ShadowCountryOption('بيرو', 'PE'),
  ShadowCountryOption('الفلبين', 'PH'),
  ShadowCountryOption('بولندا', 'PL'),
  ShadowCountryOption('البرتغال', 'PT'),
  ShadowCountryOption('قطر', 'QA'),
  ShadowCountryOption('رومانيا', 'RO'),
  ShadowCountryOption('روسيا', 'RU'),
  ShadowCountryOption('رواندا', 'RW'),
  ShadowCountryOption('سانت كيتس ونيفيس', 'KN'),
  ShadowCountryOption('سانت لوسيا', 'LC'),
  ShadowCountryOption('سانت فنسنت والغرينادين', 'VC'),
  ShadowCountryOption('ساموا', 'WS'),
  ShadowCountryOption('سان مارينو', 'SM'),
  ShadowCountryOption('ساو تومي وبرينسيب', 'ST'),
  ShadowCountryOption('السعودية', 'SA'),
  ShadowCountryOption('السنغال', 'SN'),
  ShadowCountryOption('صربيا', 'RS'),
  ShadowCountryOption('سيشل', 'SC'),
  ShadowCountryOption('سيراليون', 'SL'),
  ShadowCountryOption('سنغافورة', 'SG'),
  ShadowCountryOption('سلوفاكيا', 'SK'),
  ShadowCountryOption('سلوفينيا', 'SI'),
  ShadowCountryOption('جزر سليمان', 'SB'),
  ShadowCountryOption('الصومال', 'SO'),
  ShadowCountryOption('جنوب أفريقيا', 'ZA'),
  ShadowCountryOption('جنوب السودان', 'SS'),
  ShadowCountryOption('إسبانيا', 'ES'),
  ShadowCountryOption('سريلانكا', 'LK'),
  ShadowCountryOption('السودان', 'SD'),
  ShadowCountryOption('سورينام', 'SR'),
  ShadowCountryOption('السويد', 'SE'),
  ShadowCountryOption('سويسرا', 'CH'),
  ShadowCountryOption('سوريا', 'SY'),
  ShadowCountryOption('طاجيكستان', 'TJ'),
  ShadowCountryOption('تنزانيا', 'TZ'),
  ShadowCountryOption('تايلاند', 'TH'),
  ShadowCountryOption('تيمور الشرقية', 'TL'),
  ShadowCountryOption('توغو', 'TG'),
  ShadowCountryOption('تونغا', 'TO'),
  ShadowCountryOption('ترينيداد وتوباغو', 'TT'),
  ShadowCountryOption('تونس', 'TN'),
  ShadowCountryOption('تركيا', 'TR'),
  ShadowCountryOption('تركمانستان', 'TM'),
  ShadowCountryOption('توفالو', 'TV'),
  ShadowCountryOption('أوغندا', 'UG'),
  ShadowCountryOption('أوكرانيا', 'UA'),
  ShadowCountryOption('الإمارات العربية المتحدة', 'AE'),
  ShadowCountryOption('المملكة المتحدة', 'GB'),
  ShadowCountryOption('الولايات المتحدة', 'US'),
  ShadowCountryOption('أوروغواي', 'UY'),
  ShadowCountryOption('أوزبكستان', 'UZ'),
  ShadowCountryOption('فانواتو', 'VU'),
  ShadowCountryOption('الفاتيكان', 'VA'),
  ShadowCountryOption('فنزويلا', 'VE'),
  ShadowCountryOption('فيتنام', 'VN'),
  ShadowCountryOption('اليمن', 'YE'),
  ShadowCountryOption('زامبيا', 'ZM'),
  ShadowCountryOption('زيمبابوي', 'ZW'),
  ShadowCountryOption('كوسوفو', 'XK'),
  ShadowCountryOption('تايوان', 'TW'),
];

ShadowCountryOption? shadowCountryByName(String? name) {
  final value = (name ?? '').trim();
  if (value.isEmpty) return null;
  for (final country in shadowCountries) {
    if (country.nameAr == value) return country;
  }
  return null;
}

Future<ShadowCountryOption?> showShadowCountryPicker(
  BuildContext context, {
  String? selectedName,
}) {
  return showModalBottomSheet<ShadowCountryOption>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) {
      var query = '';
      return StatefulBuilder(
        builder: (context, setSheetState) {
          final normalized = query.trim().toLowerCase();
          final rows = normalized.isEmpty
              ? shadowCountries
              : shadowCountries
                  .where(
                    (country) =>
                        country.nameAr.toLowerCase().contains(normalized) ||
                        country.isoCode.toLowerCase().contains(normalized),
                  )
                  .toList(growable: false);
          return Directionality(
            textDirection: TextDirection.rtl,
            child: FractionallySizedBox(
              heightFactor: .86,
              child: Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                    child: Align(
                      alignment: Alignment.centerRight,
                      child: Text(
                        'اختر دولة',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: TextField(
                      autofocus: true,
                      onChanged: (value) =>
                          setSheetState(() => query = value),
                      decoration: const InputDecoration(
                        hintText: 'بحث باسم الدولة',
                        prefixIcon: Icon(Icons.search_rounded),
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Expanded(
                    child: ListView.builder(
                      itemCount: rows.length,
                      itemBuilder: (context, index) {
                        final country = rows[index];
                        final selected = country.nameAr == selectedName;
                        return ListTile(
                          leading: Text(
                            country.flag,
                            style: const TextStyle(fontSize: 28),
                          ),
                          title: Text(country.nameAr),
                          trailing: selected
                              ? const Icon(
                                  Icons.check_circle_rounded,
                                  color: Colors.greenAccent,
                                )
                              : null,
                          onTap: () => Navigator.pop(context, country),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

class ShadowCountryField extends StatelessWidget {
  const ShadowCountryField({
    super.key,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.optional = true,
  });

  final ShadowCountryOption? value;
  final ValueChanged<ShadowCountryOption?> onChanged;
  final bool enabled;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: enabled
          ? () async {
              final selected = await showShadowCountryPicker(
                context,
                selectedName: value?.nameAr,
              );
              if (selected != null) onChanged(selected);
            }
          : null,
      borderRadius: BorderRadius.circular(4),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: optional ? 'الدولة (اختياري)' : 'الدولة *',
          border: const OutlineInputBorder(),
          prefixIcon: const Icon(Icons.public_rounded),
          suffixIcon: value == null
              ? const Icon(Icons.arrow_drop_down_rounded)
              : IconButton(
                  tooltip: 'مسح الدولة',
                  onPressed: enabled ? () => onChanged(null) : null,
                  icon: const Icon(Icons.close_rounded),
                ),
        ),
        child: Row(
          children: [
            Text(
              value?.flag ?? '🌐',
              style: const TextStyle(fontSize: 22),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                value?.nameAr ?? 'اختر دولة',
                style: TextStyle(
                  color: value == null ? Colors.white54 : null,
                  fontWeight:
                      value == null ? FontWeight.normal : FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
