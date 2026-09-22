abstract final class CustomBackgroundPolicy {
 static const statuses={'pending','approved','rejected'};
 static const durationsDays={3,7,30};
 static bool refundOnRejection=true;
 static void validateDuration(int days){if(!durationsDays.contains(days))throw ArgumentError('unsupported duration');}
}
