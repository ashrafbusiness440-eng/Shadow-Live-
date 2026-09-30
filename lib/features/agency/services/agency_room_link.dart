String agencyIdForRoom(Map<String, dynamic> room) {
  final roomType = (room['roomType'] ?? room['type'] ?? '').toString().trim();
  if (roomType != 'agency') return '';

  final agencyId = (room['agencyId'] ?? '').toString().trim();
  return RegExp(r'^\d{3,8}$').hasMatch(agencyId) ? agencyId : '';
}
