String agencyIdForRoom(Map<String, dynamic> room) {
  final roomType = (room['roomType'] ?? room['type'] ?? '').toString().trim();
  if (roomType != 'agency') return '';

  final agencyRoomId = (
    room['agencyRoomId'] ??
    room['agencyPublicId'] ??
    room['agencyId'] ??
    ''
  ).toString().trim();
  return RegExp(r'^\d{3,8}$').hasMatch(agencyRoomId) ? agencyRoomId : '';
}
