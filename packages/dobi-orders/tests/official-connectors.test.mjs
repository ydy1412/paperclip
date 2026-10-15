import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createOfficialClient,createNaverSignature,createCoupangAuthorization,parseProviderJson} from '../src/integrations/official.mjs';

const clock=()=>new Date('2026-10-13T02:03:04Z');
const coupang={vendorId:'A000SYNTHETIC',accessKey:'test-access-key',secretKey:'test-secret',account:'예제 쿠팡'};
const naver={clientId:'aaaabbbbcccc',clientSecret:'$2a$10$abcdefghijklmnopqrstuv',account:'예제 네이버'};
const cafe={mallId:'syntheticmall',accessToken:'test-token',account:'예제 카페24'};
const period={from:'2026-10-13',to:'2026-10-13'};
const json=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const money=units=>({currencyCode:'KRW',units,nanos:0});
function sheet({status='ACCEPT',box='123456789012345678',item='456789012345678901'}={}) {
  return {shipmentBoxId:box,orderId:'987654321012345678',orderedAt:'2026-10-13T10:00:00+09:00',status,receiver:{name:'예제 수령인',safeNumber:'050-0000-0000',postCode:'01234',addr1:'예제 주소',addr2:'1호'},orderer:{name:'예제 구매자'},parcelPrintMessage:'예제 배송메모',orderItems:[{sequenceNo:'001',vendorItemId:item,vendorItemName:'예제 상품',sellerProductItemName:'파랑',shippingCount:2,salesPrice:money(10000),orderPrice:money(20000),cancelCount:0,holdCountForCancel:1}]};
}
function naverOrder(productOrderId='00001234567890123456') {
  return {order:{orderId:'00009876543210123456',orderDate:'2026-10-01T09:00:00+09:00',ordererName:'예제 구매자'},productOrder:{productOrderId,productOrderStatus:'PAYED',placeOrderStatus:'OK',productName:'예제 상품',productOption:'파랑',quantity:2,unitPrice:10000,totalPaymentAmount:18000,remainQuantity:1,shippingAddress:{name:'예제 수령인',tel1:'010-0000-0000',zipCode:'01234',baseAddress:'예제 주소',detailedAddress:'2호'},shippingMemo:'예제 배송메모',claimStatus:'CANCEL_REQUEST',claimType:'CANCEL'}};
}
function cafeOrder(id='20261013-0000001') {
  return {currency:'KRW',order_id:id,order_date:'2026-10-13T10:00:00+09:00',buyer:{name:'예제 구매자'},receivers:[{shipping_code:'S001',name:'예제 수령인',virtual_phone_no:'050-0000-0000',zipcode:'01234',address1:'예제 주소',address2:'3호',shipping_message:'예제 배송메모'}],items:[{order_item_code:id+'-01',shipping_code:'S001',product_name:'예제 상품',quantity:2,product_price:'10000.00',option_price:'1000.00',payment_amount:'20000.00',order_status:'N20',claim_quantity:0}]};
}
test('쿠팡 HMAC이 실제 URL의 query와 UTC 시간을 사용하고 18자리 JSON 식별자를 보존한다',()=>{
  const path='/v2/providers/openapi/apis/api/v5/vendors/A000SYNTHETIC/ordersheets',query='createdAtFrom=2026-10-13%2B09%3A00&status=ACCEPT';
  const header=createCoupangAuthorization({...coupang,path,query,date:clock()});
  const sig=createHmac('sha256','test-secret').update('261013T020304ZGET'+path+query).digest('hex');
  assert.equal(header,`CEA algorithm=HmacSHA256, access-key=test-access-key, signed-date=261013T020304Z, signature=${sig}`);
  assert.deepEqual(parseProviderJson('{"shipmentBoxId":123456789012345678,"orderId":987654321012345678,"qty":2}'),{shipmentBoxId:'123456789012345678',orderId:'987654321012345678',qty:2});
});
test('쿠팡 페이지와 전체 상태 조회, 숫자로 전달된 18자리 ID 및 수취인 정보 유지',async()=>{
  const calls=[];
  const client=createOfficialClient({provider:'coupang',credentials:coupang,now:clock,fetchImpl:async(url,opts)=>{
    const u=new URL(url);calls.push(u);assert.equal(u.origin,'https://api-gateway.coupang.com');assert.equal(opts.redirect,'error');
    const expected=createCoupangAuthorization({...coupang,path:u.pathname,query:u.search.slice(1),date:clock()});assert.equal(opts.headers.Authorization,expected);
    if(u.searchParams.get('status')!=='ACCEPT')return json({code:200,data:[],nextToken:''});
    const raw=sheet({box:u.searchParams.has('nextToken')?'123456789012345679':'123456789012345678'});
    const body=JSON.stringify({code:200,data:[raw],nextToken:u.searchParams.has('nextToken')?'':'cursor+1'}).replace(/"(12345678901234567[89]|987654321012345678|456789012345678901)"/g,'$1');
    return json(body);
  }});
  const result=await client.collectOrders(period);assert.equal(result.complete,true);assert.equal(result.orders.length,2);assert.equal(calls.length,6);
  const o=result.orders[0];assert.equal(o.orderNo,'987654321012345678');assert.equal(o.sourceIds.shipmentBoxId,'123456789012345678');assert.equal(o.sourceIds.vendorItemId,'456789012345678901');assert.equal(o.sourceIds.fulfillableQty,1);assert.equal(o.quantity,2);assert.equal(o.postcode,'01234');assert.equal(o.claimType,'취소요청');assert.equal(o.address,'예제 주소 1호');
  assert.equal(calls[1].searchParams.get('nextToken'),'cursor+1');assert.equal(calls[0].searchParams.get('createdAtFrom'),'2026-10-13+09:00');
});
test('쿠팡 반복 페이지, 기간 오류 및 뒤 페이지 실패를 성공으로 처리하지 않는다',async()=>{
  const repeating=createOfficialClient({provider:'coupang',credentials:coupang,now:clock,fetchImpl:async()=>json({code:200,data:[],nextToken:'same'})});
  await assert.rejects(()=>repeating.collectOrders(period),e=>e.code==='PAGINATION_ERROR');
  let count=0;const failing=createOfficialClient({provider:'coupang',credentials:coupang,now:clock,fetchImpl:async()=>++count===1?json({code:200,data:[sheet()],nextToken:'second'}):json({code:'DENIED'},403)});
  await assert.rejects(()=>failing.collectOrders(period),e=>e.code==='AUTHENTICATION_ERROR');
  await assert.rejects(()=>failing.collectOrders({from:'2026-09-01',to:'2026-10-13'}),e=>e.code==='INVALID_DATE');
  await assert.rejects(()=>failing.collectOrders({from:'2026-02-30',to:'2026-03-01'}),e=>e.code==='INVALID_DATE');
});
test('네이버 BCrypt 전자서명이 공식 Node.js 예제와 일치한다',async()=>{
  const sign=await createNaverSignature({...naver,timestamp:1643961623299});
  assert.equal(sign,'JDJhJDEwJGFiY2RlZmdoaWprbG1ub3BxcnN0dXVCVldZSk42T0VPdEx1OFY0cDQxa2IuTnpVaUEzbmsy');
});
test('네이버 변경 주문 cursor → 중복 제거 → 상세 조회가 긴 ID, 보류 클레임 및 잔여 수량을 유지한다',async()=>{
  let changedCalls=0,tokenCalls=0,detailCalls=0;
  const client=createOfficialClient({provider:'smartstore',credentials:naver,now:clock,fetchImpl:async(url,opts)=>{
    const u=new URL(url);assert.equal(u.origin,'https://api.commerce.naver.com');
    if(u.pathname.endsWith('/oauth2/token')) {tokenCalls++;const p=new URLSearchParams(opts.body);assert.equal(p.get('type'),'SELF');assert.equal(p.get('client_id'),naver.clientId);assert.ok(p.get('client_secret_sign'));assert.equal(p.has('client_secret'),false);return json({access_token:'mock-token',expires_in:10800});}
    assert.equal(opts.headers.Authorization,'Bearer mock-token');
    if(u.pathname.endsWith('/last-changed-statuses')){changedCalls++;if(changedCalls===1)return json({data:{lastChangeStatuses:[{productOrderId:'00001234567890123456'}],more:{moreFrom:'2026-10-13T12:00:00+09:00',moreSequence:'SEQ0001'}}});assert.equal(u.searchParams.get('moreSequence'),'SEQ0001');assert.equal(u.searchParams.get('lastChangedFrom'),'2026-10-13T12:00:00+09:00');return json({data:{lastChangeStatuses:[{productOrderId:'00001234567890123456'}]}});}
    detailCalls++;assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),{productOrderIds:['00001234567890123456'],quantityClaimCompatibility:true});return json({data:[naverOrder()]});
  }});
  const r=await client.collectOrders(period);assert.equal(r.orders.length,1);assert.equal(r.remoteCount,1);assert.equal(changedCalls,2);assert.equal(tokenCalls,1);assert.equal(detailCalls,1);
  const o=r.orders[0];assert.equal(o.orderNo,'00009876543210123456');assert.equal(o.lineId,'00001234567890123456');assert.equal(o.status,'발송대기');assert.equal(o.sourceIds.remainQuantity,1);assert.equal(o.quantity,2);assert.equal(o.claimType,'취소요청');assert.equal(o.amount,18000);assert.equal(o.orderedAt,'2026-10-01');assert.match(r.notes[0],/최종 변경일/);
});
test('네이버 토큰 만료는 한 번 갱신하고 상세 주문 누락은 수집 중단한다',async()=>{
  let tokens=0,changes=0;
  const client=createOfficialClient({provider:'naver',credentials:{...naver,type:'SELLER',accountId:'SYNTHETIC-SELLER'},now:clock,fetchImpl:async(url,opts)=>{
    if(url.endsWith('/oauth2/token')){tokens++;assert.equal(new URLSearchParams(opts.body).get('account_id'),'SYNTHETIC-SELLER');return json({access_token:'token-'+tokens,expires_in:10800});}
    if(url.includes('/last-changed-statuses')){if(++changes===1)return json({code:'GW.AUTHN'},401);return json({data:{lastChangeStatuses:[{productOrderId:'00001234567890123456'}]}});}
    return json({data:[]});
  }});
  await assert.rejects(()=>client.collectOrders(period),e=>e.code==='INCOMPLETE_RESPONSE');assert.equal(tokens,2);assert.equal(changes,2);
});
test('카페24 공식 bearer·버전·embed 조회와 주문품목 금액/송장/배송 상태를 보존한다',async()=>{
  const client=createOfficialClient({provider:'cafe24',credentials:{...cafe,shopNo:2},now:clock,fetchImpl:async(url,opts)=>{
    const u=new URL(url);assert.equal(u.origin,'https://syntheticmall.cafe24api.com');assert.equal(u.pathname,'/api/v2/admin/orders');assert.equal(u.searchParams.get('shop_no'),'2');assert.equal(u.searchParams.get('embed'),'items,receivers,buyer');assert.equal(opts.headers.Authorization,'Bearer test-token');assert.equal(opts.headers['X-Cafe24-Api-Version'],'2026-09-01');
    const order=cafeOrder();order.items[0].order_status='N30';order.items[0].tracking_no='00001234567890';order.items[0].shipping_company_name='CJ대한통운';return json({orders:[order]});
  }});
  const r=await client.collectOrders(period);assert.equal(r.orders.length,1);const o=r.orders[0];assert.equal(o.amount,20000);assert.equal(o.unitPrice,11000);assert.equal(o.quantity,2);assert.equal(o.status,'배송중');assert.equal(o.tracking,'00001234567890');assert.equal(o.postcode,'01234');assert.equal(o.phone,'050-0000-0000');assert.equal(o.address,'예제 주소 3호');
});
test('카페24 offset 페이지를 끝까지 읽고 매칭되지 않은 여러 배송지는 차단한다',async()=>{
  const offsets=[];const client=createOfficialClient({provider:'cafe24',credentials:cafe,now:clock,fetchImpl:async(url)=>{
    const offset=Number(new URL(url).searchParams.get('offset'));offsets.push(offset);return json({orders:offset===0?Array.from({length:100},(_,i)=>cafeOrder('20261013-'+String(i).padStart(7,'0'))):[cafeOrder('20261013-0000100')]});
  }});const r=await client.collectOrders(period);assert.equal(r.orders.length,101);assert.deepEqual(offsets,[0,100]);
  const unsafe=cafeOrder();unsafe.receivers.push({...unsafe.receivers[0],shipping_code:'S002',name:'다른 예제 수령인'});unsafe.items[0].shipping_code='UNKNOWN';
  const multi=createOfficialClient({provider:'cafe24',credentials:cafe,now:clock,fetchImpl:async()=>json({orders:[unsafe]})});await assert.rejects(()=>multi.collectOrders(period),e=>e.code==='MULTIPLE_RECIPIENTS');
});
test('미지원 공급자·인증 누락·외부 호스트 유도·잘못된 응답·가짜 인증 성공을 거절한다',async()=>{
  assert.throws(()=>createOfficialClient({provider:'unknown',credentials:{}}),e=>e.code==='UNSUPPORTED_PROVIDER');
  assert.throws(()=>createOfficialClient({provider:'coupang',credentials:{}}),e=>e.code==='MISSING_CREDENTIALS');
  assert.throws(()=>createOfficialClient({provider:'cafe24',credentials:{...cafe,mallId:'localhost:9999/path'}}),e=>e.code==='INVALID_CREDENTIALS');
  const malformed=createOfficialClient({provider:'coupang',credentials:coupang,now:clock,fetchImpl:async()=>new Response('<html>login</html>')});await assert.rejects(()=>malformed.testConnection(),e=>e.code==='INVALID_RESPONSE');
  const denied=createOfficialClient({provider:'cafe24',credentials:cafe,now:clock,fetchImpl:async()=>json({error:{message:'token-expired'}},401)});await assert.rejects(()=>denied.testConnection(),e=>e.code==='AUTHENTICATION_ERROR');
  const empty=createOfficialClient({provider:'coupang',credentials:coupang,now:clock,fetchImpl:async()=>json({code:200,data:[],nextToken:''})});assert.equal((await empty.testConnection()).ok,true);
});
