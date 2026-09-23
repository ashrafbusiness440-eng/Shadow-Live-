import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_admin_id_override.dart';

void main(){
  test('owner override accepts short numeric IDs such as 1111',(){
    expect(AdminIdOverridePolicy.valid('1111'),isTrue);
    expect(AdminIdOverridePolicy.valid('48470239'),isTrue);
  });

  test('normalizes Arabic and Persian digits',(){
    expect(AdminIdOverridePolicy.normalize('١١١١'),'1111');
    expect(AdminIdOverridePolicy.normalize('۱۲۳۴'),'1234');
  });

  test('rejects letters, too short and too long IDs',(){
    expect(AdminIdOverridePolicy.valid('ab12'),isFalse);
    expect(AdminIdOverridePolicy.valid('11'),isFalse);
    expect(AdminIdOverridePolicy.valid('1234567890123'),isFalse);
  });

  test('rejects no-op ID changes',(){
    expect(()=>AdminIdOverridePolicy.validateChange('1111','١١١١'),throwsArgumentError);
  });
}
