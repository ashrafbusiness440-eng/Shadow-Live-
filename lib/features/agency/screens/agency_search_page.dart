import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../shared/widgets/country_selector.dart';
import '../services/public_agency_service.dart';
import 'public_agency_page.dart';

class AgencySearchPage extends StatefulWidget {
  const AgencySearchPage({
    super.key,
    this.embedded = false,
    this.joinEnabled = true,
    this.joinBlockedReason,
  });

  final bool embedded;
  final bool joinEnabled;
  final String? joinBlockedReason;

  @override
  State<AgencySearchPage> createState() => _AgencySearchPageState();
}

class _AgencySearchPageState extends State<AgencySearchPage> {
  final PublicAgencyService _service = PublicAgencyService();
  final TextEditingController _query = TextEditingController();
  final List<PublicAgencyIdentity> _results = <PublicAgencyIdentity>[];

  Timer? _debounce;
  String _mode = 'name';
  ShadowCountryOption? _country;
  String? _cursor;
  bool _hasMore = false;
  bool _truncated = false;
  bool _loading = false;
  String? _error;
  String? _lastRequestKey;
  int _requestSerial = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_loadBrowse());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    _service.close();
    super.dispose();
  }

  String _normalizedQuery() => _query.text.trim().replaceAll(
        RegExp(r'\s+'),
        ' ',
      );

  bool _validQuery(String query) {
    if (_mode == 'id') return RegExp(r'^\d{3,8}$').hasMatch(query);
    if (_mode == 'country') return _country != null;
    return query.length >= 2;
  }

  void _cancelInFlight() {
    _requestSerial += 1;
  }

  void _onQueryChanged(String _) {
    if (_mode == 'country') return;
    _debounce?.cancel();
    _cancelInFlight();
    final query = _normalizedQuery();
    if (query.isEmpty) {
      _debounce = Timer(
        const Duration(milliseconds: 250),
        () => unawaited(_loadBrowse()),
      );
      return;
    }
    if (!_validQuery(query)) {
      setState(() {
        _results.clear();
        _cursor = null;
        _hasMore = false;
        _truncated = false;
        _error = null;
        _loading = false;
      });
      return;
    }
    _debounce = Timer(
      const Duration(milliseconds: 380),
      () => unawaited(_search()),
    );
  }

  Future<void> _loadBrowse({bool more = false}) async {
    final requestKey = 'browse|${more ? _cursor ?? '' : '0'}';
    if (_loading || (!more && _lastRequestKey == requestKey)) return;
    final serial = ++_requestSerial;
    setState(() {
      _loading = true;
      _error = null;
      if (!more) {
        _results.clear();
        _cursor = null;
        _hasMore = false;
        _truncated = false;
      }
    });
    try {
      final page = await _service.browse(
        cursor: more ? _cursor : null,
      );
      if (!mounted || serial != _requestSerial) return;
      final known = _results.map((item) => item.agencyId).toSet();
      setState(() {
        if (!more) _results.clear();
        _results.addAll(
          page.results.where((item) => known.add(item.agencyId)),
        );
        _cursor = page.nextCursor;
        _hasMore = page.hasMore && page.nextCursor != null;
        _truncated = page.truncated;
        _lastRequestKey = requestKey;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || serial != _requestSerial) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _search({bool more = false}) async {
    final query = _mode == 'country'
        ? (_country?.nameAr ?? '')
        : _normalizedQuery();
    if (!_validQuery(query)) return;

    final requestKey =
        '$_mode|$query|${more ? _cursor ?? '' : '0'}';
    if (_loading || (!more && _lastRequestKey == requestKey)) return;

    final serial = ++_requestSerial;
    setState(() {
      _loading = true;
      _error = null;
      if (!more) {
        _results.clear();
        _cursor = null;
        _hasMore = false;
        _truncated = false;
      }
    });

    try {
      final page = await _service.search(
        query: query,
        mode: _mode,
        cursor: more ? _cursor : null,
      );
      if (!mounted || serial != _requestSerial) return;
      final known = _results.map((item) => item.agencyId).toSet();
      setState(() {
        if (!more) _results.clear();
        _results.addAll(
          page.results.where((item) => known.add(item.agencyId)),
        );
        _cursor = page.nextCursor;
        _hasMore = page.hasMore && page.nextCursor != null;
        _truncated = page.truncated;
        _lastRequestKey = requestKey;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || serial != _requestSerial) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _pickCountry() async {
    final selected = await showShadowCountryPicker(
      context,
      selectedName: _country?.nameAr,
    );
    if (selected == null || !mounted) return;
    _debounce?.cancel();
    _cancelInFlight();
    setState(() {
      _country = selected;
      _lastRequestKey = null;
    });
    await _search();
  }

  void _changeMode(String mode) {
    if (_mode == mode) return;
    _debounce?.cancel();
    _cancelInFlight();
    setState(() {
      _mode = mode;
      _query.clear();
      _country = null;
      _results.clear();
      _cursor = null;
      _hasMore = false;
      _truncated = false;
      _error = null;
      _lastRequestKey = null;
    });
    unawaited(_loadBrowse());
  }

  Future<void> _retry() async {
    if (_mode == 'country' && _country != null) {
      _lastRequestKey = null;
      await _search();
      return;
    }
    final query = _normalizedQuery();
    _lastRequestKey = null;
    if (_validQuery(query)) {
      await _search();
    } else {
      await _loadBrowse();
    }
  }

  Future<void> _loadMore() async {
    if (!_hasMore || _cursor == null || _loading) return;
    final hasFilter = _mode == 'country'
        ? _country != null
        : _normalizedQuery().isNotEmpty;
    if (hasFilter) {
      await _search(more: true);
    } else {
      await _loadBrowse(more: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = _content();
    if (widget.embedded) return content;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF070914),
        appBar: AppBar(
          title: const Text('البحث عن وكالة'),
          backgroundColor: const Color(0xFF0B1020),
        ),
        body: content,
      ),
    );
  }

  Widget _content() {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: RefreshIndicator(
        onRefresh: _retry,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'name', label: Text('الاسم')),
                ButtonSegment(value: 'id', label: Text('Agency ID')),
                ButtonSegment(value: 'country', label: Text('الدولة')),
              ],
              selected: {_mode},
              onSelectionChanged: _loading
                  ? null
                  : (value) => _changeMode(value.first),
            ),
            const SizedBox(height: 12),
            if (_mode == 'country')
              OutlinedButton.icon(
                key: const Key('agency-search-country'),
                onPressed: _loading ? null : _pickCountry,
                icon: Text(_country?.flag ?? '🌐'),
                label: Text(
                  _country == null ? 'اختر الدولة' : _country!.nameAr,
                ),
              )
            else
              TextField(
                key: const Key('agency-search-query'),
                controller: _query,
                keyboardType:
                    _mode == 'id' ? TextInputType.number : TextInputType.text,
                inputFormatters: _mode == 'id'
                    ? <TextInputFormatter>[
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(8),
                      ]
                    : null,
                maxLength: _mode == 'id' ? 8 : 80,
                onChanged: _onQueryChanged,
                onSubmitted: (_) => unawaited(_search()),
                decoration: InputDecoration(
                  labelText:
                      _mode == 'id' ? 'Agency ID — من 3 إلى 8 أرقام' : 'اسم الوكالة',
                  helperText: _mode == 'name'
                      ? 'البحث يدعم أي جزء من الاسم.'
                      : null,
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    onPressed:
                        _loading || !_validQuery(_normalizedQuery())
                            ? null
                            : () => unawaited(_search()),
                    icon: const Icon(Icons.search_rounded),
                  ),
                ),
              ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Card(
                color: const Color(0xFF2B1720),
                child: ListTile(
                  leading: const Icon(Icons.error_outline_rounded),
                  title: const Text('تعذر تحميل الوكالات'),
                  trailing: TextButton(
                    onPressed: _loading ? null : _retry,
                    child: const Text('إعادة المحاولة'),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            if (!_loading && _results.isEmpty && _error == null)
              Card(
                color: const Color(0xFF111526),
                child: ListTile(
                  leading: const Icon(Icons.travel_explore_rounded),
                  title: Text(
                    _mode == 'country' && _country != null
                        ? 'لا توجد وكالات نشطة في هذه الدولة.'
                        : _normalizedQuery().isNotEmpty
                            ? 'لا توجد نتائج مطابقة.'
                            : 'وكالات Shadow Live',
                  ),
                  subtitle: _normalizedQuery().isEmpty && _country == null
                      ? const Text('تظهر الوكالات النشطة حسب ترتيب Top Agencies.')
                      : null,
                ),
              ),
            ..._results.map(_agencyCard),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_hasMore)
              OutlinedButton.icon(
                key: const Key('agency-search-load-more'),
                onPressed: _loadMore,
                icon: const Icon(Icons.expand_more_rounded),
                label: const Text('تحميل المزيد'),
              ),
            if (_truncated) ...[
              const SizedBox(height: 8),
              const Text(
                'تم الوصول إلى حد نافذة الاكتشاف الآمنة. استخدم البحث لتحديد الوكالة المطلوبة.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.amberAccent, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _agencyCard(PublicAgencyIdentity agency) {
    final image = (agency.logoUrl ?? agency.coverUrl ?? '').trim();
    final country = shadowCountryByName(agency.country);
    return Card(
      color: const Color(0xFF111526),
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        leading: Stack(
          clipBehavior: Clip.none,
          children: [
            CircleAvatar(
              radius: 27,
              backgroundColor: const Color(0xFF31204F),
              backgroundImage: image.isEmpty ? null : NetworkImage(image),
              child: image.isEmpty
                  ? const Icon(Icons.apartment_rounded, color: Colors.white70)
                  : null,
            ),
            if (agency.rank != null)
              Positioned(
                left: -5,
                top: -5,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF7B2DFF),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '#${agency.rank}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
          ],
        ),
        title: Text(
          agency.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(
          [
            'ID: ${agency.publicId}',
            if (agency.country != null)
              '${country?.flag ?? '🌐'} ${agency.country}',
            'Hosts: ${agency.hostCount} • الأعضاء: ${agency.memberCount}',
          ].join('\n'),
        ),
        isThreeLine: true,
        trailing: const Icon(Icons.chevron_left_rounded),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => PublicAgencyPage(
              agencyId: agency.agencyId,
              joinEnabled: widget.joinEnabled,
              joinBlockedReason: widget.joinBlockedReason,
            ),
          ),
        ),
      ),
    );
  }
}
