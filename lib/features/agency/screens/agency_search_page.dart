import 'package:flutter/material.dart';

import '../services/public_agency_service.dart';
import 'public_agency_page.dart';

class AgencySearchPage extends StatefulWidget {
  const AgencySearchPage({super.key});

  @override
  State<AgencySearchPage> createState() => _AgencySearchPageState();
}

class _AgencySearchPageState extends State<AgencySearchPage> {
  final PublicAgencyService _service = PublicAgencyService();
  final TextEditingController _query = TextEditingController();
  final List<PublicAgencyIdentity> _results = [];
  String _mode = 'name';
  String? _cursor;
  bool _hasMore = false;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _query.dispose();
    _service.close();
    super.dispose();
  }

  Future<void> _search({bool more = false}) async {
    final query = _query.text.trim();
    if (_loading || query.isEmpty || (_mode != 'id' && query.length < 2)) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      if (!more) {
        _results.clear();
        _cursor = null;
        _hasMore = false;
      }
    });
    try {
      final page = await _service.search(
        query: query,
        mode: _mode,
        cursor: more ? _cursor : null,
      );
      if (!mounted) return;
      setState(() {
        _results.addAll(page.results);
        _cursor = page.nextCursor;
        _hasMore = page.hasMore && page.nextCursor != null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('البحث عن وكالة')),
        body: ListView(
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
                  : (value) => setState(() {
                        _mode = value.first;
                        _results.clear();
                        _cursor = null;
                        _hasMore = false;
                      }),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _query,
              keyboardType:
                  _mode == 'id' ? TextInputType.number : TextInputType.text,
              maxLength: _mode == 'id' ? 6 : 80,
              onSubmitted: (_) => _search(),
              decoration: InputDecoration(
                labelText: _mode == 'id'
                    ? 'Agency ID'
                    : _mode == 'country'
                        ? 'الدولة'
                        : 'اسم الوكالة',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  onPressed: _loading ? null : _search,
                  icon: const Icon(Icons.search),
                ),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!, style: const TextStyle(color: Colors.redAccent)),
              ),
            if (!_loading && _results.isEmpty && _error == null)
              const Card(
                child: ListTile(
                  leading: Icon(Icons.travel_explore),
                  title: Text('ابحث بالاسم أو Agency ID أو الدولة'),
                  subtitle: Text('تظهر الوكالات النشطة فقط.'),
                ),
              ),
            ..._results.map(
              (agency) => Card(
                child: ListTile(
                  leading: const CircleAvatar(child: Icon(Icons.apartment)),
                  title: Text(agency.name),
                  subtitle: Text(
                    'ID: ${agency.publicId}'
                    '${agency.country == null ? '' : ' • ${agency.country}'}'
                    '\nHosts: ${agency.hostCount} • الأعضاء: ${agency.memberCount}',
                  ),
                  isThreeLine: true,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => PublicAgencyPage(agencyId: agency.agencyId),
                    ),
                  ),
                ),
              ),
            ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_hasMore)
              OutlinedButton(
                onPressed: () => _search(more: true),
                child: const Text('تحميل المزيد'),
              ),
          ],
        ),
      ),
    );
  }
}
