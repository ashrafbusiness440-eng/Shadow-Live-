import 'dart:typed_data';
import 'package:crop_your_image/crop_your_image.dart';
import 'package:flutter/material.dart';

class ProfileImageCropScreen extends StatefulWidget {
  final Uint8List imageData;
  const ProfileImageCropScreen({super.key, required this.imageData});

  @override
  State<ProfileImageCropScreen> createState() => _ProfileImageCropScreenState();
}

class _ProfileImageCropScreenState extends State<ProfileImageCropScreen> {
  final _controller = CropController();
  bool _cropping = false;

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      backgroundColor: const Color(0xFF050814),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        title: const Text('ضبط الصورة'),
        centerTitle: true,
      ),
      body: Column(children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(20, 8, 20, 14),
          child: Text('حرّك الصورة وكبّرها أو صغّرها حتى تظهر بالشكل المناسب داخل صورة الملف الشخصي.',textAlign:TextAlign.center,style:TextStyle(color:Colors.white70,height:1.5)),
        ),
        Expanded(child: Padding(
          padding: const EdgeInsets.all(16),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: Crop(
              image: widget.imageData,
              controller: _controller,
              aspectRatio: 1,
              withCircleUi: true,
              interactive: true,
              fixCropRect: true,
              baseColor: const Color(0xFF050814),
              maskColor: Colors.black.withValues(alpha: .65),
              onCropped: (result) {
                if (!mounted) return;
                switch (result) {
                  case CropSuccess(:final croppedImage): Navigator.pop(context, croppedImage);
                  case CropFailure():
                    setState(() => _cropping = false);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('تعذر قص الصورة، حاول مرة أخرى')));
                }
              },
            ),
          ),
        )),
        Padding(
          padding: const EdgeInsets.all(18),
          child: SizedBox(width:double.infinity,child:FilledButton.icon(
            onPressed: _cropping ? null : () { setState(() => _cropping = true); _controller.crop(); },
            style: FilledButton.styleFrom(backgroundColor:const Color(0xFF8B5CF6),padding:const EdgeInsets.symmetric(vertical:16)),
            icon: const Icon(Icons.crop_rounded),
            label: Text(_cropping ? 'جارٍ تجهيز الصورة...' : 'اعتماد الصورة'),
          )),
        ),
      ]),
    ),
  );
}
