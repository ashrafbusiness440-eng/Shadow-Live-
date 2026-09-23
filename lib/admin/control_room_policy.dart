class RoomControlOverrides {
  const RoomControlOverrides({
    this.seats,
    this.moderators,
    this.bypassLevelCapacity = false,
  });

  final int? seats;
  final int? moderators;
  final bool bypassLevelCapacity;

  factory RoomControlOverrides.fromMap(Map<String, dynamic>? map) {
    final data = map ?? const <String, dynamic>{};
    final seats = (data['seats'] as num?)?.toInt();
    final moderators = (data['moderators'] as num?)?.toInt();
    return RoomControlOverrides(
      seats: seats != null && seats >= 1 && seats <= 50 ? seats : null,
      moderators: moderators != null && moderators >= 0 && moderators <= 30
          ? moderators
          : null,
      bypassLevelCapacity: data['bypassLevelCapacity'] == true,
    );
  }
}

abstract final class RoomPolicy {
  static int seats({required int level, required bool agency}) {
    final table = agency
        ? const [10, 12, 14, 16, 20, 22]
        : const [8, 10, 12, 15, 20, 20];
    if (level < 1 || level > 6) {
      throw ArgumentError('room level must be 1..6');
    }
    return table[level - 1];
  }

  static int moderators({required int level, required bool agency}) {
    final table = agency
        ? const [5, 6, 7, 9, 11, 14]
        : const [3, 4, 5, 7, 9, 12];
    if (level < 1 || level > 6) {
      throw ArgumentError('room level must be 1..6');
    }
    return table[level - 1];
  }

  static bool isOfficial({
    required String roomType,
    required bool systemOwned,
    required bool officialRoom,
  }) {
    return systemOwned ||
        officialRoom ||
        roomType == 'official' ||
        roomType == 'administrative' ||
        roomType == 'customer_service';
  }

  static int effectiveSeats({
    required int level,
    required bool agency,
    required bool official,
    required RoomControlOverrides overrides,
  }) {
    if ((official || overrides.bypassLevelCapacity) &&
        overrides.seats != null) {
      return overrides.seats!;
    }
    if (official && overrides.seats == null) {
      return seats(level: level, agency: agency);
    }
    return seats(level: level, agency: agency);
  }

  static int effectiveModerators({
    required int level,
    required bool agency,
    required bool official,
    required RoomControlOverrides overrides,
  }) {
    if ((official || overrides.bypassLevelCapacity) &&
        overrides.moderators != null) {
      return overrides.moderators!;
    }
    return moderators(level: level, agency: agency);
  }

  static const hiddenRoomCapability = 'canCreateHiddenRoom';
  static const globalControlCapability = 'globalRoomControl';
}
