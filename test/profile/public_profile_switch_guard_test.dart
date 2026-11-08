import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  late String source;
  setUpAll(() {
    source = File('lib/features/profile/screens/public_profile_screen.dart')
        .readAsStringSync();
  });

  test('public user and dependent futures are keyed to their target UID', () {
    expect(
      source,
      contains(r"key: ValueKey<String>('public-profile-${widget.userId}')"),
    );
    expect(
      source,
      contains(r"key: ValueKey<String>('public-level-${widget.userId}')"),
    );
    expect(
      source,
      contains(r"key: ValueKey<String>('public-follow-counts-${widget.userId}')"),
    );
    expect(
      source,
      contains(r"key: ValueKey<String>('public-follow-state-${widget.userId}')"),
    );
    expect(source, contains('stream: _followStateStream,'));
    expect(source, contains('onPressed: _changingFollow || (!_guest && !followReady)'));
    expect(source, contains('await _follow.setFollowing(targetUserId, !following);'));
    expect(source, contains('if (mounted && widget.userId == targetUserId)'));
  });

  test('previous async profile values cannot be rendered while switching', () {
    expect(
      source,
      contains('if (snapshot.connectionState != ConnectionState.done)'),
    );
    expect(
      source.split('snapshot.connectionState == ConnectionState.done').length - 1,
      greaterThanOrEqualTo(2),
    );
  });

  test('relationship and report actions use the identity selected at tap time', () {
    final relationship = source.substring(
      source.indexOf('Future<void> _requestRelationship'),
      source.indexOf('Future<void> _reportProfile'),
    );
    expect(relationship, contains('final targetUserId = widget.userId;'));
    expect(
      relationship,
      contains('if (selected == null || !mounted || widget.userId != targetUserId) return;'),
    );
    expect(relationship, contains('targetUserId: targetUserId,'));
    expect(relationship, isNot(contains('targetUserId: widget.userId,')));

    final report = source.substring(
      source.indexOf('Future<void> _reportProfile'),
      source.indexOf('void _openLevel'),
    );
    expect(report, contains('final targetUserId = widget.userId;'));
    expect(report, contains('targetUserId: targetUserId,'));
    expect(report, isNot(contains('targetUserId: widget.userId,')));
  });
}
