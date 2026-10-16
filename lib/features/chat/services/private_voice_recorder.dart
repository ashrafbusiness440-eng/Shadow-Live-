import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:record/record.dart';

const int privateVoiceSampleRate = 16000;
const int privateVoiceMaxSeconds = 60;
const int privateVoiceMaxBytes = 3 * 1024 * 1024;

@immutable
class PrivateVoiceDraft {
  const PrivateVoiceDraft({required this.bytes, required this.durationSeconds});
  final Uint8List bytes;
  final int durationSeconds;
  String get mimeType => 'audio/wav';
}

Uint8List encodePrivateVoiceWav(Uint8List pcm, {int sampleRate = privateVoiceSampleRate}) {
  if (sampleRate <= 0 || pcm.isEmpty || pcm.length.isOdd ||
      pcm.length + 44 > privateVoiceMaxBytes) {
    throw StateError('invalid_voice_pcm');
  }
  const channels = 1;
  const bytesPerSample = 2;
  final output = Uint8List(pcm.length + 44);
  final header = ByteData.sublistView(output);
  void label(int offset, String value) {
    for (int i = 0; i < value.length; i++) {
      output[offset + i] = value.codeUnitAt(i);
    }
  }
  label(0, 'RIFF');
  header.setUint32(4, pcm.length + 36, Endian.little);
  label(8, 'WAVE');
  label(12, 'fmt ');
  header.setUint32(16, 16, Endian.little);
  header.setUint16(20, 1, Endian.little);
  header.setUint16(22, channels, Endian.little);
  header.setUint32(24, sampleRate, Endian.little);
  header.setUint32(28, sampleRate * channels * bytesPerSample, Endian.little);
  header.setUint16(32, channels * bytesPerSample, Endian.little);
  header.setUint16(34, 16, Endian.little);
  label(36, 'data');
  header.setUint32(40, pcm.length, Endian.little);
  output.setRange(44, output.length, pcm);
  return output;
}

/// Bounded recording with exactly one microphone stream and a one-shot timer.
/// Clients must recheck the authenticated account and mic-seat policy before
/// starting, sending, and displaying any private recording.
class PrivateVoiceRecorder {
  PrivateVoiceRecorder({AudioRecorder? recorder}) : _recorder = recorder ?? AudioRecorder();

  final AudioRecorder _recorder;
  StreamSubscription<Uint8List>? _subscription;
  final BytesBuilder _pcm = BytesBuilder(copy: false);
  final Stopwatch _watch = Stopwatch();
  Timer? _limit;
  bool _recording = false;
  bool _overflow = false;
  bool _disposed = false;
  bool get isRecording => _recording;

  Future<void> start({required void Function() onLimit}) async {
    if (_disposed || _recording || _subscription != null) {
      throw StateError('voice_recorder_busy');
    }
    if (!await _recorder.hasPermission()) {
      throw StateError('microphone_permission_required');
    }
    final stream = await _recorder.startStream(const RecordConfig(
      encoder: AudioEncoder.pcm16bits, numChannels: 1,
      sampleRate: privateVoiceSampleRate,
    ));
    _recording = true;
    _watch
      ..reset()
      ..start();
    _subscription = stream.listen((chunk) {
      if (!_recording || _overflow) return;
      if (_pcm.length + chunk.length + 44 > privateVoiceMaxBytes) {
        _overflow = true;
        onLimit();
        return;
      }
      _pcm.add(chunk);
    });
    _limit = Timer(const Duration(seconds: privateVoiceMaxSeconds), onLimit);
  }

  Future<PrivateVoiceDraft> stop() async {
    if (!_recording) throw StateError('voice_recorder_not_active');
    _limit?.cancel();
    await _recorder.stop();
    _recording = false;
    _watch.stop();
    await _subscription?.cancel();
    _subscription = null;
    if (_overflow) {
      _pcm.clear();
      throw StateError('voice_too_large');
    }
    final bytes = _pcm.takeBytes();
    // Duration is derived from actual PCM samples rather than a client timer.
    final actualSeconds = bytes.length / (privateVoiceSampleRate * 2);
    if (actualSeconds <= 0 || actualSeconds > privateVoiceMaxSeconds + 0.3) {
      throw StateError('voice_duration_invalid');
    }
    final duration = math.max(1, math.min(privateVoiceMaxSeconds, actualSeconds.ceil()));
    return PrivateVoiceDraft(
      bytes: encodePrivateVoiceWav(bytes),
      durationSeconds: duration,
    );
  }

  Future<void> cancel() async {
    _limit?.cancel();
    if (_recording) await _recorder.cancel();
    _recording = false;
    _watch.stop();
    await _subscription?.cancel();
    _subscription = null;
    _pcm.clear();
    _overflow = false;
  }

  Future<void> dispose() async {
    if (_disposed) return;
    await cancel();
    _disposed = true;
    await _recorder.dispose();
  }
}
