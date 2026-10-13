import 'dart:convert';
import 'dart:typed_data';

/// Parses a small user-selected word list without a new external service.
/// Supported: one phrase per line (text), or the first column of a table.
List<String> parseImportedFilterWords(
  Uint8List bytes, {
  required String fileName,
}) {
  if (bytes.lengthInBytes > 64 * 1024) {
    throw const FormatException('file_too_large');
  }
  final name = fileName.toLowerCase();
  if (!name.endsWith('.txt') && !name.endsWith('.csv')) {
    throw const FormatException('unsupported_file');
  }
  final text = utf8.decode(bytes, allowMalformed: false)
      .replaceFirst('\uFEFF', '');
  if (name.endsWith('.txt')) {
    return text.split(RegExp(r'\r?\n'))
        .map((word) => word.trim())
        .where((word) => word.isNotEmpty)
        .toList(growable: false);
  }
  final words = <String>[];
  final field = StringBuffer();
  final columns = <String>[];
  var quoted = false;
  var rowIndex = 0;

  void submitField() {
    columns.add(field.toString().trim());
    field.clear();
  }

  void submitRow() {
    submitField();
    if (columns.isNotEmpty && columns.first.isNotEmpty) {
      final first = columns.first;
      final header = rowIndex == 0 &&
          const <String>['word', 'phrase', 'الكلمة', 'العبارة', 'كلمة']
              .contains(first.toLowerCase());
      if (!header) words.add(first);
    }
    rowIndex++;
    columns.clear();
  }

  for (var i = 0; i < text.length; i++) {
    final c = text[i];
    if (c == '"') {
      if (quoted && i + 1 < text.length && text[i + 1] == '"') {
        field.write('"');
        i++;
      } else if (quoted || field.isEmpty) {
        quoted = !quoted;
      } else {
        throw const FormatException('invalid_table');
      }
    } else if (!quoted && c == ',') {
      submitField();
    } else if (!quoted && (c == '\n' || c == '\r')) {
      if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
      submitRow();
    } else {
      field.write(c);
    }
  }
  if (quoted) throw const FormatException('invalid_table');
  if (field.isNotEmpty || columns.isNotEmpty) submitRow();
  return words;
}
