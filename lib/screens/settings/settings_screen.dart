import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../services/navigation_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});
  static const _gold = Color(0xFFFFD166), _purple = Color(0xFF8B5CF6), _deep = Color(0xFF050814);

  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(context: context,builder:(d)=>Directionality(textDirection:TextDirection.rtl,child:AlertDialog(
      backgroundColor:const Color(0xFF101827),
      title:const Text('تسجيل الخروج',style:TextStyle(color:Colors.white)),
      content:const Text('هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟',style:TextStyle(color:Colors.white70)),
      actions:[TextButton(onPressed:()=>Navigator.pop(d,false),child:const Text('إلغاء')),FilledButton(style:FilledButton.styleFrom(backgroundColor:Colors.redAccent),onPressed:()=>Navigator.pop(d,true),child:const Text('تسجيل الخروج'))],
    )));
    if(confirmed==true&&context.mounted){context.read<AuthBloc>().add(SignOutRequested());NavigationService.navigateToAndRemoveUntil(AppRoutes.authChoice);}
  }

  void _soon(BuildContext c,String n)=>ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text('$n — سيتم تفعيلها لاحقاً')));

  @override
  Widget build(BuildContext context)=>Directionality(textDirection:TextDirection.rtl,child:Scaffold(backgroundColor:_deep,body:SafeArea(child:ListView(padding:const EdgeInsets.all(16),children:[
    Row(children:[IconButton(onPressed:()=>Navigator.maybePop(context),icon:const Icon(Icons.arrow_forward_ios_rounded,color:Colors.white)),const Expanded(child:Column(children:[Icon(Icons.mic_rounded,color:_gold,size:30),Text('SHADOW LIVE',style:TextStyle(color:_gold,fontWeight:FontWeight.w900))])),const SizedBox(width:48)]),
    const SizedBox(height:12),
    Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:const Color(0xCC0B1322),borderRadius:BorderRadius.circular(20),border:Border.all(color:const Color(0x444D67FF))),child:const Row(children:[CircleAvatar(radius:32,backgroundColor:Color(0xFF25124D),child:Icon(Icons.person,color:_gold,size:38)),SizedBox(width:14),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('حسابي',style:TextStyle(color:Colors.white,fontSize:20,fontWeight:FontWeight.bold)),Text('إدارة معلومات الحساب والإعدادات',style:TextStyle(color:Colors.white54))]))])),
    const SizedBox(height:18),
    _menu(Icons.person_rounded,'تعديل الملف الشخصي',()=>NavigationService.navigateTo(AppRoutes.editProfile)),
    _menu(Icons.shield_rounded,'الحساب والأمان',()=>_soon(context,'الحساب والأمان')),
    _menu(Icons.account_balance_wallet_rounded,'محفظتي',()=>_soon(context,'المحفظة')),
    _menu(Icons.notifications_rounded,'الإشعارات',()=>_soon(context,'الإشعارات')),
    _menu(Icons.lock_rounded,'الخصوصية',()=>_soon(context,'الخصوصية')),
    _menu(Icons.language_rounded,'اللغة — العربية',()=>_soon(context,'اللغات')),
    _menu(Icons.help_rounded,'المساعدة',()=>_soon(context,'المساعدة')),
    _menu(Icons.info_rounded,'حول التطبيق',()=>_soon(context,'حول التطبيق')),
    const SizedBox(height:22),
    OutlinedButton.icon(onPressed:()=>_confirmLogout(context),icon:const Icon(Icons.logout),label:const Text('تسجيل الخروج'),style:OutlinedButton.styleFrom(foregroundColor:Colors.redAccent,padding:const EdgeInsets.symmetric(vertical:15),side:const BorderSide(color:Color(0x66FF5252)))),
  ]))));

  Widget _menu(IconData icon,String title,VoidCallback tap)=>Container(margin:const EdgeInsets.only(bottom:8),decoration:BoxDecoration(color:const Color(0xCC0B1322),borderRadius:BorderRadius.circular(15)),child:ListTile(leading:Icon(icon,color:_purple),title:Text(title,style:const TextStyle(color:Colors.white,fontWeight:FontWeight.w700)),trailing:const Icon(Icons.chevron_left,color:Colors.white38),onTap:tap));
}
