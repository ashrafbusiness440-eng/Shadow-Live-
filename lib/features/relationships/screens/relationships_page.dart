import 'package:flutter/material.dart';

import '../../profile/screens/public_profile_screen.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../services/relationship_service.dart';

class RelationshipsPage extends StatefulWidget {
  const RelationshipsPage({super.key});

  @override
  State<RelationshipsPage> createState() => _RelationshipsPageState();
}

class _RelationshipsPageState extends State<RelationshipsPage> {
  final RelationshipService _service = RelationshipService();
  RelationshipOverview? _overview;
  bool _loading = true;
  String? _error;
  String? _endingId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final overview = await _service.listMine();
      if (!mounted) return;
      setState(() {
        _overview = overview;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = relationshipErrorMessage(error);
        _loading = false;
      });
    }
  }

  RelationshipItem? _itemFor(String type) {
    final items = _overview?.items ?? const <RelationshipItem>[];
    for (final item in items) {
      if (item.relationshipType == type) return item;
    }
    return null;
  }

  Future<void> _end(RelationshipItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('إنهاء العلاقة'),
        content: Text(
          'هل تريد إنهاء علاقة ${item.relationshipTypeLabel} مع ${item.partnerName}؟',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('إنهاء'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _endingId = item.relationshipId);
    try {
      await _service.endRelationship(item.relationshipId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إنهاء العلاقة.')),
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(relationshipErrorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _endingId = null);
    }
  }

  ImageProvider? _avatar(RelationshipItem item) {
    if (item.partnerProfileImageUrl.isNotEmpty) {
      return NetworkImage(item.partnerProfileImageUrl);
    }
    if (item.partnerProfileAvatarAsset.isNotEmpty) {
      return AssetImage(item.partnerProfileAvatarAsset);
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final overview = _overview;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF050814),
        appBar: AppBar(
          backgroundColor: const Color(0xFF050814),
          foregroundColor: Colors.white,
          title: const Text('العلاقات'),
        ),
        body: _loading && overview == null
            ? const Center(
                child: CircularProgressIndicator(
                  color: Color(0xFF8A3DFF),
                ),
              )
            : _error != null && overview == null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.favorite_border_rounded,
                            size: 52,
                            color: Colors.white30,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            _error!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white60),
                          ),
                          const SizedBox(height: 14),
                          FilledButton(
                            onPressed: _load,
                            child: const Text('إعادة المحاولة'),
                          ),
                        ],
                      ),
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
                      children: [
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: const Color(0xFF111827),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: const Text(
                            'يمكنك امتلاك علاقة نشطة واحدة من كل نوع. '
                            'الطلبات الجديدة تصل عبر الإشعارات.',
                            style: TextStyle(
                              color: Colors.white70,
                              height: 1.5,
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        for (final type
                            in overview?.types ??
                                const <RelationshipTypeOption>[])
                          _relationshipCard(type, _itemFor(type.key)),
                      ],
                    ),
                  ),
      ),
    );
  }

  Widget _relationshipCard(
    RelationshipTypeOption type,
    RelationshipItem? item,
  ) {
    final active = item != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0E1524),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: active
              ? const Color(0xFF7B2DFF).withValues(alpha: .45)
              : Colors.white10,
        ),
      ),
      child: Row(
        children: [
          if (active)
            ProfileAvatarWithFrame(
              diameter: 56,
              userId: item.partnerUid,
              backgroundColor: const Color(0xFF25183F),
              placeholderColor: const Color(0xFFFFD54A),
              fallbackProfile: <String, dynamic>{
                'profileImageUrl': item.partnerProfileImageUrl,
                'profileAvatarAsset': item.partnerProfileAvatarAsset,
              },
            )
          else
            const CircleAvatar(
              radius: 28,
              backgroundColor: Color(0xFF25183F),
              child: Icon(
                Icons.favorite_border_rounded,
                color: Colors.white38,
              ),
            ),
          const SizedBox(width: 12),
          Expanded(
            child: active
                ? InkWell(
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            PublicProfileScreen(userId: item.partnerUid),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          type.labelAr,
                          style: const TextStyle(
                            color: Color(0xFFFFD54A),
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item.partnerName,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                            fontSize: 16,
                          ),
                        ),
                        if (item.partnerPublicId.isNotEmpty)
                          Text(
                            'ID: ${item.partnerPublicId}',
                            textDirection: TextDirection.ltr,
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        type.labelAr,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        type.enabled
                            ? 'لا توجد علاقة نشطة'
                            : 'النوع متوقف حالياً',
                        style: const TextStyle(
                          color: Colors.white54,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
          ),
          if (active)
            IconButton(
              tooltip: 'إنهاء العلاقة',
              onPressed: _endingId == item.relationshipId
                  ? null
                  : () => _end(item),
              icon: _endingId == item.relationshipId
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(
                      Icons.link_off_rounded,
                      color: Colors.redAccent,
                    ),
            ),
        ],
      ),
    );
  }
}
