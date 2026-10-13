import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main() {
  test('only public and eligible candidates enter a people page', () {
    DiscoveryPerson person(String id, Map<String, dynamic> data) =>
        DiscoveryPerson(id: id, data: data);
    expect(isPublicDiscoveryPerson(person('a', {})), isTrue);
    for (final data in <Map<String, dynamic>>[
      {'isHidden': true},
      {'isPrivate': true},
      {'isSuspended': true},
      {'isDeleted': true},
      {'isBanned': true},
      {'mysteriousEnabled': true},
      {'hideFromDiscovery': true},
    ]) {
      expect(isPublicDiscoveryPerson(person('b', data)), isFalse);
    }
  });

  test('pages are bounded, cursor-based and never read all people', () {
    final service =
        File('lib/features/home/services/discovery_service.dart')
            .readAsStringSync();
    expect(service.contains('Future<DiscoveryPeoplePage> loadPeoplePage('), isTrue);
    expect(service.contains('pageSize > 10 ? 10 : pageSize'), isTrue);
    expect(service.contains("collection('public_profiles')"), isTrue);
    expect(service.contains('.orderBy(FieldPath.documentId)'), isTrue);
    expect(service.contains('.startAfterDocument(after)'), isTrue);
    expect(service.contains('nextCursor: snapshot.docs.isEmpty ? null : snapshot.docs.last'), isTrue);
    expect(service.contains('hasMore: snapshot.docs.length == bounded'), isTrue);
  });

  test('Home and more people only show verified non-followed profiles', () {
    final ui = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    final follow = File('lib/features/profile/services/follow_service.dart')
        .readAsStringSync();
    final backend = File('cloudflare-worker/src/chat-safety-actions.js')
        .readAsStringSync();

    expect(ui.contains("onMore: _showMorePeople"), isTrue);
    expect(ui.contains('class HomeMorePeopleScreen'), isTrue);
    expect(ui.contains('HomeCompactPersonCard('), isTrue);
    expect(ui.contains('SliverGridDelegateWithFixedCrossAxisCount('), isTrue);
    expect(ui.contains('extentAfter < 380'), isTrue);
    expect(ui.contains('eligibleDiscoveryPeopleAmong('), isTrue);
    expect(ui.contains('_eligibleSuggestionIds?.contains(person.id) == true'), isTrue);
    expect(ui.contains('await _followService.setFollowing(person.id, true);'), isTrue);
    expect(ui.contains('await _follow.setFollowing(person.id, true);'), isTrue);
    expect(ui.contains('_people.removeWhere((candidate) => candidate.id == person.id)'), isTrue);
    expect(ui.contains('_eligibleSuggestionIds = <String>{...?_eligibleSuggestionIds}'), isTrue);
    expect(ui.contains('_successfullyFollowed.add(person.id)'), isTrue);
    expect(ui.contains('_generation++;'), isTrue);
    expect(ui.contains('_suggestionRevision++;'), isTrue);
    expect(ui.contains("'تعذر المتابعة. حاول مرة أخرى.'"), isTrue);

    expect(follow.contains("'action': 'filterDiscoveryPeople'"), isTrue);
    expect(backend.contains('case "filterDiscoveryPeople":'), isTrue);
    expect(backend.contains(r'follows/${viewerUid}__${id}'), isTrue);
    expect(backend.contains('outgoingFollow?.exists'), isTrue);
    expect(backend.contains(r'user_blocks/${id}/items/${viewerUid}'), isTrue);
    expect(backend.contains('paths = ids.flatMap'), isTrue);
    expect(backend.contains('const results = await db.getMany(paths);'), isTrue);
  });

  test('no per-person listeners or polling in expanded suggestions', () {
    final ui = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    final moreStart = ui.indexOf('class HomeMorePeopleScreen');
    final moreEnd = ui.indexOf('/// Account and both wallet', moreStart);
    expect(moreStart, greaterThan(0));
    expect(moreEnd, greaterThan(moreStart));
    final section = ui.substring(moreStart, moreEnd);
    expect(section.contains('Timer.periodic'), isFalse);
    expect(section.contains('.snapshots()'), isFalse);
    expect(section.contains(".collection('users')"), isFalse);
    expect(section.contains('followingAmong('), isFalse);
  });
}
