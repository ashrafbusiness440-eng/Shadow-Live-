String roomSurfaceImageUrl(Map<String, dynamic> room) {
  final roomType = (room['roomType'] ?? room['type'] ?? '')
      .toString()
      .trim()
      .toLowerCase();

  final candidates = roomType == 'agency'
      ? <dynamic>[
          room['agencyRoomImageUrl'],
          room['roomImageUrl'],
        ]
      : <dynamic>[
          room['roomImageUrl'],
          room['roomPhotoUrl'],
          room['coverImageUrl'],
          room['imageUrl'],
          room['photoUrl'],
        ];

  for (final candidate in candidates) {
    final value = (candidate ?? '').toString().trim();
    if (value.isNotEmpty) return value;
  }
  return '';
}
