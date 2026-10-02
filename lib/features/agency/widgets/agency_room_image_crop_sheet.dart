import 'dart:typed_data';

import 'package:crop_your_image/crop_your_image.dart';
import 'package:flutter/material.dart';

Future<Uint8List?> showAgencyRoomImageCropSheet(
  BuildContext context, {
  required Uint8List imageBytes,
}) {
  return showModalBottomSheet<Uint8List>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) => FractionallySizedBox(
      heightFactor: 0.9,
      child: _AgencyRoomImageCropSheet(imageBytes: imageBytes),
    ),
  );
}

class _AgencyRoomImageCropSheet extends StatefulWidget {
  const _AgencyRoomImageCropSheet({required this.imageBytes});

  final Uint8List imageBytes;

  @override
  State<_AgencyRoomImageCropSheet> createState() =>
      _AgencyRoomImageCropSheetState();
}

class _AgencyRoomImageCropSheetState
    extends State<_AgencyRoomImageCropSheet> {
  final CropController _cropController = CropController();

  bool _cropping = false;
  String? _error;

  void _applyCrop() {
    if (_cropping) return;
    setState(() {
      _cropping = true;
      _error = null;
    });
    // Important: crop() keeps the real output square. The circular guide below
    // is preview-only and must never change the saved image shape.
    _cropController.crop();
  }

  void _handleCropResult(CropResult result) {
    if (!mounted) return;
    if (result is CropSuccess) {
      Navigator.of(context).pop(result.croppedImage);
      return;
    }

    setState(() {
      _cropping = false;
      _error = 'تعذر قص الصورة. جرّب صورة أخرى.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF090D18),
      borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      clipBehavior: Clip.antiAlias,
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: Column(
          children: [
            const SizedBox(height: 10),
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 6),
              child: Text(
                'قص صورة غرفة الوكالة',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'المربع هو القص الفعلي المحفوظ. الدائرة معاينة فقط لشكل الصورة داخل الروم.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white60,
                  height: 1.45,
                ),
              ),
            ),
            const SizedBox(height: 14),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(18),
                  child: Crop(
                    image: widget.imageBytes,
                    controller: _cropController,
                    aspectRatio: 1,
                    initialRectBuilder:
                        InitialRectBuilder.withSizeAndRatio(
                      size: 0.86,
                      aspectRatio: 1,
                    ),
                    interactive: true,
                    fixCropRect: true,
                    radius: 0,
                    baseColor: const Color(0xFF05070D),
                    maskColor: Colors.black.withValues(alpha: 0.62),
                    filterQuality: FilterQuality.high,
                    overlayBuilder: (overlayContext, cropRect) {
                      return IgnorePointer(
                        child: Padding(
                          padding: const EdgeInsets.all(10),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: const Color(0xFFE8D8FF),
                                width: 2.2,
                              ),
                              boxShadow: const [
                                BoxShadow(
                                  color: Color(0x669E4DFF),
                                  blurRadius: 12,
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                    progressIndicator: const Center(
                      child: CircularProgressIndicator(),
                    ),
                    onCropped: _handleCropResult,
                  ),
                ),
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFFFF8A8A)),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed:
                          _cropping ? null : () => Navigator.of(context).pop(),
                      child: const Text('إلغاء'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: FilledButton.icon(
                      onPressed: _cropping ? null : _applyCrop,
                      icon: _cropping
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(Icons.check_rounded),
                      label: const Text('اعتماد القص'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
