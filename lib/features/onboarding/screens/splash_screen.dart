import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../../services/navigation_service.dart';
import '../../auth/setup_route.dart';

class SplashScreen extends StatefulWidget { const SplashScreen({super.key}); @override State<SplashScreen> createState()=>_SplashScreenState(); }
class _SplashScreenState extends State<SplashScreen>{
 @override void initState(){super.initState();_startSplash();}
 Future<void> _startSplash()async{await Future<void>.delayed(const Duration(seconds:3));if(!mounted)return;final destination=await _destinationAfterSplash();if(!mounted)return;Navigator.of(context).pushNamedAndRemoveUntil(destination,(route)=>false);}
 Future<String> _destinationAfterSplash()async{
  final user=FirebaseAuth.instance.currentUser;if(user==null)return AppRoutes.onboarding;
  if(user.isAnonymous)return AppRoutes.main;
  try{
   final snapshot=await FirebaseFirestore.instance.collection('users').doc(user.uid).get().timeout(const Duration(seconds:10));
   return setupDestination(snapshot.data());
  }catch(_){return AppRoutes.profileSetup;}
 }
 @override Widget build(BuildContext context)=>Scaffold(backgroundColor:Colors.black,body:Stack(fit:StackFit.expand,children:[Image.asset('assets/images/splash_bg.png',fit:BoxFit.fill,gaplessPlayback:true),Positioned(left:70,right:70,bottom:28,child:TweenAnimationBuilder<double>(tween:Tween(begin:0,end:1),duration:const Duration(seconds:3),builder:(context,value,child)=>Container(height:5,decoration:BoxDecoration(color:Colors.white24,borderRadius:BorderRadius.circular(20)),alignment:Alignment.centerLeft,child:FractionallySizedBox(widthFactor:value,child:Container(decoration:BoxDecoration(borderRadius:BorderRadius.circular(20),gradient:const LinearGradient(colors:[Color(0xFFFFD84D),Color(0xFFFF3BD4),Color(0xFF7B2CFF)]),boxShadow:const[BoxShadow(color:Color(0xAAFF3BD4),blurRadius:8)]))))))]));
}
