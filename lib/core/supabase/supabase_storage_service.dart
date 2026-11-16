import 'dart:typed_data';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Private user media is stored under <auth-user-uuid>/<filename>.
class SupabaseStorageService {
  SupabaseStorageService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  static const String bucket = 'shadow-live-media';

  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<String> uploadUserFile({
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final safeName = fileName.replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
    final path = '$_uid/${DateTime.now().microsecondsSinceEpoch}_$safeName';
    await _client.storage.from(bucket).uploadBinary(
      path,
      bytes,
      fileOptions: FileOptions(contentType: contentType, upsert: false),
    );
    return path;
  }

  Future<String> createSignedUrl(String path, {int expiresInSeconds = 3600}) =>
      _client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);

  Future<void> deleteUserFile(String path) async {
    if (!path.startsWith('$_uid/')) {
      throw StateError('storage_path_not_owned');
    }
    await _client.storage.from(bucket).remove([path]);
  }
}
