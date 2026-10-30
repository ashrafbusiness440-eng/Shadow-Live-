import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Owner-only read-only posting-day refund evidence: no money movement.
class StoreRefundPostingDayPanel extends StatefulWidget {
  const StoreRefundPostingDayPanel({required this.day,super.key});
  final String day;
  @override
  State<StoreRefundPostingDayPanel> createState() =>
    _StoreRefundPostingDayPanelState();
}

class _StoreRefundPostingDayPanelState
    extends State<StoreRefundPostingDayPanel> {
  bool _loading = false;
  String? _error;
  String? _cursor;
  int _pageNumber = 0;
  int _generation = 0;
  Map<String,dynamic>? _page;

  @override
  void dispose(){
    _generation++;
    super.dispose();
  }

  Future<void> _load({bool next=false}) async {
    if(_loading || (next && _cursor==null))return;
    final day=widget.day;
    final requestedCursor=next?_cursor:null;
    final generation=++_generation;
    setState((){
      _loading=true;
      _error=null;
      if(!next){_page=null;_cursor=null;_pageNumber=0;}
    });
    try{
      final user=controlAuth.currentUser;
      if(user==null)throw StateError('unauthorized');
      final token=await user.getIdToken();
      if(token==null||token.isEmpty)throw StateError('unauthorized');
      final response=await http.post(
        shadowApiEndpoint('manage-store-purchases'),
        headers:{'authorization':'Bearer $token',
          'content-type':'application/json'},
        body:jsonEncode({
          'action':'global_refund_posting_day_page',
          'day':day,
          if(requestedCursor!=null)'cursor':requestedCursor,
        }),
      ).timeout(const Duration(seconds:40));
      final body=jsonDecode(response.body);
      final counts=body is Map?body['sourceCounts']:null;
      if(response.statusCode!=200 || body is! Map ||
          body['ok']!=true ||
          body['scope']!='all_buyers_one_utc_refund_posting_day_page' ||
          body['accountingBasis']!='refund_posting_day_cohort' ||
          body['day']!=day || body['pageLimit']!=20 ||
          counts is! Map || counts.length!=3 ||
          !['receipts','ledger','audit'].every((key)=>
            counts[key] is int && counts[key]>=0 && counts[key]<=21) ||
          !['reviewed','blocked'].contains(body['reviewStatus']) ||
          body['inspected'] is! int || body['verified'] is! int ||
          body['inspected']<0 || body['inspected']>20 ||
          body['verified']!=body['inspected'] ||
          body['hasMore'] is! bool ||
          body['perOperationRefundPostingProof']!=true ||
          body['independentRefundSourceCoverageCertified']!=false ||
          body['snapshotIsolationCertified']!=false ||
          body['cursorSnapshotCertified']!=false ||
          body['allPagesReviewed']!=false ||
          body['historicalDateCoverageCertified']!=false ||
          body['externalChargebacksCertified']!=false ||
          body['fullPeriodSettlementCertified']!=false ||
          body['financialReportComplete']!=false ||
          body['netRevenueCertified']!=false ||
          body['refundSettlementCertified']!=false ||
          body['productionFinancialWritesPerformed']!=false ||
          ((body['reviewStatus']=='reviewed')!=
             (body['pageAmountsAvailable']==true)) ||
          (body['reviewStatus']=='reviewed' &&
            (body['pageRefundedCoins'] is! int ||
             body['pageRefundedCoins']<0)) ||
          (body['reviewStatus']=='blocked' &&
            body['pageRefundedCoins']!=null) ||
          (body['hasMore']==true &&
            (body['nextCursor'] is! String ||
             (body['nextCursor'] as String).isEmpty)) ||
          (body['hasMore']==false && body['nextCursor']!=null))
        throw const FormatException('invalid_refund_page');
      if(!mounted || generation!=_generation || day!=widget.day ||
         (next && requestedCursor!=_cursor))return;
      setState((){
        _page=Map<String,dynamic>.from(body);
        _cursor=body['nextCursor'] is String &&
          (body['nextCursor'] as String).isNotEmpty
          ?body['nextCursor'] as String:null;
        _pageNumber=next?_pageNumber+1:1;
      });
    }catch(_){
      if(!mounted||generation!=_generation)return;
      setState(()=>_error=
        'تعذّر تدقيق استردادات هذا اليوم، ولم يُعدّل أي رصيد.');
    }finally{
      if(mounted&&generation==_generation){
        setState(()=>_loading=false);
      }
    }
  }

  @override
  Widget build(BuildContext context){
    return Column(
      crossAxisAlignment:CrossAxisAlignment.stretch,
      children:[
        Text('استردادات يوم ${widget.day} — كل الحسابات',
          style:Theme.of(context).textTheme.titleMedium),
        const Text('مراجعة مستقلة ليوم إرجاع الكوينز، عبر الإيصالات '
          'والقيود وسجل الموافقات؛ 20 عملية في الصفحة. '
          'النتيجة تخص الصفحة فقط وليست إيرادات أو تسوية نهائية.'),
        const SizedBox(height:8),
        OutlinedButton.icon(
          onPressed:_loading?null:()=>_load(),
          icon:const Icon(Icons.fact_check_outlined),
          label:Text(_loading?'جارٍ تدقيق الاستردادات...':
            'فحص أول 20 استردادًا'),
        ),
        if(_loading)const LinearProgressIndicator(),
        if(_error!=null)
          Text(_error!,style:const TextStyle(
            color:Colors.orangeAccent)),
        if(_page!=null)...[
          if(_page!['reviewStatus']=='reviewed')...[
            Text('الصفحة: $_pageNumber • '
              'مطابق: ${_page!['verified']}'),
            Text('كوينز مستردة بهذه الصفحة فقط: '
              '${_page!['pageRefundedCoins']}'),
            if(_page!['hasMore']==true&&_cursor!=null)
              OutlinedButton.icon(
                onPressed:_loading?null:()=>_load(next:true),
                icon:const Icon(Icons.navigate_next),
                label:const Text('تدقيق 20 استردادًا إضافيًا'),
              ),
            if(_page!['hasMore']==false)
              const Text('انتهت السجلات المفهرسة المتاحة عند الفحص. '
                'هذا لا يثبت اكتمال سجلات الفترة تاريخيًا.'),
          ]else const Text('توجد سجلات ناقصة أو متعارضة. '
            'تم حجب جميع مبالغ الصفحة.'),
          const Text('هذا الفحص يعتمد تاريخ قيد الاسترداد، وليس '
            'تاريخ الشراء. لا يوجد تثبيت مشترك بين الصفحات، '
            'ولا تغطية مضمونة للاعتراضات أو القيود المتأخرة.'),
        ],
      ],
    );
  }
}
