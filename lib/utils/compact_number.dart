String formatCompactAmount(dynamic value) {
  final n = num.tryParse('${value ?? 0}') ?? 0;

  String trim(double v) {
    final s = v.toStringAsFixed(v.truncateToDouble() == v ? 0 : 1);
    return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
  }

  if (n.abs() >= 1000000) return '${trim(n / 1000000)}M';
  if (n.abs() >= 1000) return '${trim(n / 1000)}K';
  return n.truncateToDouble() == n ? n.toInt().toString() : n.toString();
}
