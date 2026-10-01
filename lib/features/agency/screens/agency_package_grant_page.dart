import 'package:flutter/material.dart';

import '../services/agency_package_service.dart';

class AgencyPackageGrantPage extends StatefulWidget {
  const AgencyPackageGrantPage({super.key, this.initialAgencyId});

  final String? initialAgencyId;

  @override
  State<AgencyPackageGrantPage> createState() => _AgencyPackageGrantPageState();
}

class _AgencyPackageGrantPageState extends State<AgencyPackageGrantPage> {
  final AgencyPackageService _service = AgencyPackageService();
  late final TextEditingController _agencyId;
  List<AgencyPackageTemplate> _templates = const [];
  AgencyPackageTemplate? _selected;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _agencyId = TextEditingController(text: widget.initialAgencyId ?? '');
    _load();
  }

  @override
  void dispose() {
    _agencyId.dispose();
    _service.close();
    super.dispose();
  }

  String _key() =>
      'agency_package_grant_' + DateTime.now().microsecondsSinceEpoch.toString();

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final templates = await _service.loadTemplates();
      final active =
          templates.where((item) => item.status == 'active').toList();
      if (!mounted) return;
      setState(() {
        _templates = active;
        _selected = active.isEmpty ? null : active.first;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _grant() async {
    final agencyId = _agencyId.text.trim();
    final template = _selected;
    if (_busy ||
        template == null ||
        !RegExp(r'^\d{3,8}$').hasMatch(agencyId)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تحقق من Agency ID والباكيج.')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      final grantId = await _service.grantPackage(
        templateId: template.templateId,
        agencyId: agencyId,
        idempotencyKey: _key(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تم منح الباكيج للوكالة. Grant ID: ' + grantId,
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      final code = error.toString().replaceFirst('Bad state: ', '');
      final message = code.contains('forbidden')
          ? 'لا تملك صلاحية Grant Agency Package.'
          : code.contains('agency_not_found')
              ? 'لم يتم العثور على الوكالة.'
              : 'تعذر منح الباكيج: ' + code;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          appBar: AppBar(title: const Text('منح باكيج وكالة')),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(
                      child: FilledButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('تعذر تحميل الباكيجات'),
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        const Card(
                          child: ListTile(
                            leading: Icon(Icons.verified_user_outlined),
                            title: Text('Grant Agency Package'),
                            subtitle: Text(
                              'المنح يتم من التطبيق فقط. المستلم هو مالك الوكالة الحالي، والتوزيع يبقى حصريًا له.',
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _agencyId,
                          keyboardType: TextInputType.number,
                          maxLength: 8,
                          decoration: const InputDecoration(
                            labelText: 'Agency ID',
                            hintText: '3–8 أرقام',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          initialValue: _selected?.templateId,
                          decoration: const InputDecoration(
                            labelText: 'الباكيج',
                            border: OutlineInputBorder(),
                          ),
                          items: _templates
                              .map(
                                (item) => DropdownMenuItem(
                                  value: item.templateId,
                                  child: Text(item.name),
                                ),
                              )
                              .toList(growable: false),
                          onChanged: (value) {
                            setState(() {
                              _selected = _templates
                                  .where((item) => item.templateId == value)
                                  .firstOrNull;
                            });
                          },
                        ),
                        if (_selected != null) ...[
                          const SizedBox(height: 12),
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                    _selected!.name,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w900,
                                      fontSize: 17,
                                    ),
                                  ),
                                  Text(
                                    'مدة المخزون: ' +
                                        _selected!.packageDurationHours
                                            .toString() +
                                        ' ساعة',
                                  ),
                                  const SizedBox(height: 8),
                                  for (final item in _selected!.lineItems)
                                    Text(
                                      '• ' +
                                          (item.nameAr.isEmpty
                                              ? item.assetKey
                                              : item.nameAr) +
                                          ' ×' +
                                          item.quantity.toString() +
                                          ' — ' +
                                          item.entitlementDurationHours
                                              .toString() +
                                          ' ساعة',
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed:
                              _busy || _templates.isEmpty ? null : _grant,
                          icon: _busy
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.card_giftcard_rounded),
                          label: const Text('منح الباكيج'),
                        ),
                      ],
                    ),
        ),
      );
}
