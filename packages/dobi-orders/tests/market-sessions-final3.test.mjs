import test from 'node:test';
import assert from 'node:assert/strict';
import {createNhmarketClient} from '../src/integrations/market-sessions/nhmarket.mjs';
import {createNaverpayClient} from '../src/integrations/market-sessions/naverpay.mjs';
import {createDomeggookClient} from '../src/integrations/market-sessions/domeggook.mjs';
import {normalizeOrder} from '../src/store.mjs';
const NOW=()=>new Date('2026-10-16T03:00:00Z'),RANGE={from:'2026-10-15',to:'2026-10-16'},ORDER='184467440737095511',LINE='184467440737095512';
const credentials={sellerId:'synthetic-only',password:'fixture-only-password',account:'합성 계정'};
const response=(v,status=200)=>new Response(typeof v==='string'?v:JSON.stringify(v),{status,headers:{'Content-Type':typeof v==='string'?'text/html; charset=utf-8':'application/json; charset=utf-8'}});
const xml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

const HEADERS=['주문번호','고유번호','상품명','수량','판매가격','총판매가격','주문일','수령인','핸드폰','우편번호','주소','옵션','판매자상품코드','택배업체','택배번호'];
function nhRow(change={}){return {'주문번호':ORDER,'고유번호':LINE,'상품명':'합성 상품','수량':'2','판매가격':'1200','총판매가격':'2400','주문일':'2026-10-16 09:00:00','수령인':'합성 수취인','핸드폰':'01000000000','우편번호':'01234','주소':'합성 주소','옵션':'합성 옵션','판매자상품코드':'001-SKU','택배업체':'','택배번호':'',...change};}
const nhTable=rows=>'<html><table><tr>'+HEADERS.map(h=>'<th>'+xml(h)+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+HEADERS.map(h=>'<td>'+xml(r[h]??'')+'</td>').join('')+'</tr>').join('')+'</table></html>';
function nhHarness(options={}){
  const calls=[];const session={getSessionCookies:()=> '[]',cancel(){},async request(url,init={}){const u=new URL(url),body=init.body?Object.fromEntries(new URLSearchParams(init.body)):undefined;calls.push({u,init,body});const custom=await options.request?.({u,init,body,calls});if(custom!==undefined)return custom;
    if(u.pathname==='/login.asp')return response('<input type="hidden" name="token" value="fixture-form-token">');
    if(u.pathname==='/dormancy.asp')return response('정상');if(u.pathname==='/loginOk.asp')return response("url = 'https://old.72time.kr/mallinmall/';");
    if(u.pathname==='/mallinmall/')return response('<html><a href="https://seller.72time.kr/">seller.72time.kr</a></html>');
    if(u.pathname.endsWith('/order_list.excel.asp'))return response(nhTable(options.rows?.(body)??(body.menu==='confirm'&&body.sstate==='102'?[nhRow()]:[])));
    throw Error('Unexpected synthetic NHMarket request');}};
  return {client:createNhmarketClient({credentials:{...credentials,...options.credentials},session,now:NOW}),calls};
}
test('NH마켓 토큰·휴면 확인·일반 form로그인 원본 순서를 사용한다',async()=>{
  const {client,calls}=nhHarness();assert.equal((await client.login()).identitySource,'credential-login');
  assert.deepEqual(calls.find(c=>c.u.pathname==='/dormancy.asp').body,{id:credentials.sellerId,pass:credentials.password});const login=calls.find(c=>c.u.pathname==='/loginOk.asp');assert.equal(login.body.token,'fixture-form-token');assert.equal(login.body.pass,credentials.password);
});
test('NH마켓 브라우저 인증의 ID 확인 수준과 잘못된 로그인 화면을 구분한다',async()=>{
  assert.equal((await nhHarness().client.verifyIdentity()).identitySource,'user-confirmation');
  await assert.rejects(nhHarness({request({u}){if(u.pathname==='/mallinmall/')return response('<input type="password">');}}).client.verifyIdentity(),e=>e.code==='SESSION_REQUIRED');
  await assert.rejects(nhHarness({credentials:{identityId:'different'}}).client.verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
});
test('NH마켓 전체 지원 메뉴와 18자리 품목을 수집하고 원본 발주확인 한계를 알린다',async()=>{
  const {client,calls}=nhHarness();const r=await client.collectOrders(RANGE);assert.equal(r.complete,true);assert.equal(r.orders.length,1);const o=r.orders[0];assert.equal(o.orderNo,ORDER);assert.equal(o.lineId,LINE);assert.equal(o.postcode,'01234');assert.equal(o.amount,2400);assert.equal(o.sourceIds.fulfillableQty,0);assert.equal(o.sourceIds.confirmationUnverified,true);assert.doesNotThrow(()=>normalizeOrder(o,{},{remote:true}));assert.ok(r.notes.some(s=>s.includes('배송중')));assert.equal(calls.filter(c=>c.u.pathname.endsWith('excel.asp')).length,14);assert.ok(calls.every(c=>!c.u.pathname.includes('confirm_order')));
});
test('NH마켓 EUC-KR 응답의 한글 셀과 rowspan을 손상하지 않는다',async()=>{
  const {client}=nhHarness({request({u,body}){if(!u.pathname.endsWith('excel.asp')||body.menu!=='confirm'||body.sstate!=='102')return;const raw=nhTable([nhRow({'상품명':'가'})]);const ascii=raw.replace('<td>가</td>','<td>FIXTURE_KR</td>').replace(/[^\x00-\x7f]/gu,c=>'&#'+c.codePointAt(0)+';'),at=ascii.indexOf('FIXTURE_KR'),b=Buffer.concat([Buffer.from(ascii.slice(0,at),'ascii'),Buffer.from([0xb0,0xa1]),Buffer.from(ascii.slice(at+10),'ascii')]);return new Response(b,{headers:{'Content-Type':'text/html; charset=euc-kr'}});}});assert.equal((await client.collectOrders(RANGE)).orders[0].product,'가');
  const two=nhTable([nhRow(),nhRow({'고유번호':'2'})]).replace('<td>'+ORDER+'</td>','<td rowspan="2">'+ORDER+'</td>').replace('<tr><td>'+ORDER+'</td><td>2</td>','<tr><td>2</td>');
  const {client:span}=nhHarness({request({u,body}){if(u.pathname.endsWith('excel.asp')&&body.menu==='confirm'&&body.sstate==='102')return response(two);}});assert.equal((await span.collectOrders(RANGE)).orders.length,2);
});
test('NH마켓 100품목 이후의 페이지를 읽고 반복 페이지·접근 거부를 차단한다',async()=>{
  const {client}=nhHarness({rows(body){if(body.menu!=='confirm'||body.sstate!=='102')return [];return Number(body.page)===1?Array.from({length:100},(_,i)=>nhRow({'고유번호':String(i+1)})):[nhRow({'고유번호':'101'})];}});assert.equal((await client.collectOrders(RANGE)).orders.length,101);
  await assert.rejects(nhHarness({rows(body){return body.menu==='confirm'&&body.sstate==='102'?Array.from({length:100},(_,i)=>nhRow({'고유번호':String(i+1)})):[];}}).client.collectOrders(RANGE));
  await assert.rejects(nhHarness({request({u}){if(u.pathname.endsWith('excel.asp'))return response('잘못된 접근입니다.');}}).client.collectOrders(RANGE),e=>e.code==='SESSION_REQUIRED');
});

function naverRow(change={}){return {orderNo:ORDER,productOrderNo:LINE,orderQuantity:2,productName:'합성 상품',productUnitPrice:1000,productOptionAmt:200,productPayAmt:2300,productOptionContents:'합성 옵션',sellerProductManagementCode:'001-SKU',receiverName:'합성 수취인',receiverTelNo1:'01000000000',receiverZipCode:'01234',receiverAddress:'합성 주소',orderDateTime:'2026-10-16T08:00:00+09:00',payDateTime:'2026-10-16T09:00:00+09:00',productOrderStatus:'NEW_ORDER',...change};}
function naverHarness(options={}){
  const calls=[];let identities=0;const session={getSessionCookies:()=> '[]',cancel(){},async request(url,init={}){const u=new URL(url),body=init.body?(init.headers?.['Content-Type']==='application/json'?JSON.parse(init.body):Object.fromEntries(new URLSearchParams(init.body))):undefined;calls.push({u,init,body});const custom=await options.request?.({u,init,body,calls});if(custom!==undefined)return custom;
    if(u.pathname==='/merchant/managementlist')return response(options.management??'<input name="login_merchantId" value="merchant-fixture"><input id="hid_merchant-fixture" value="SHP">');
    if(u.pathname==='/security_merchant_check')return response('정상');
    if(u.pathname.endsWith('/me/mall')){identities++;return response({body:{merchantNumber:options.merchant?.(identities)??'184467440737095513'}});}
    if(u.pathname==='/o/v3/graphql'){const alias=body.query.match(/\{ (\w+):/)[1],r=options.rows?.(body)??(body.variables.detailedOrderStatus==='NEW_ORDER'?[naverRow()]:[]);if(r instanceof Response)return r;const rows=Array.isArray(r)?r:r.rows,total=Array.isArray(r)?rows.length:r.total;return response({data:{[alias]:{elements:rows,pagination:{page:body.variables.paging_page,size:500,totalElements:total,totalPages:Math.ceil(total/500)}}}});}
    throw Error('Unexpected synthetic NaverPay request');}};
  return {client:createNaverpayClient({credentials:{...credentials,...options.credentials},session,now:NOW}),calls};
}
test('네이버페이는 정상 네이버 로그인창과 서버 merchantNumber 확인을 사용한다',async()=>{
  const {client,calls}=naverHarness();assert.equal((await client.login()).stage,'browser');assert.equal(calls.length,0);const result=await client.verifyIdentity();assert.equal(result.identityId,'184467440737095513');assert.equal(result.identitySource,'server');assert.deepEqual(calls.find(c=>c.u.pathname==='/security_merchant_check').body,{login_merchantId:'merchant-fixture',url:'',merchantTypeCode:'SHP'});
});
test('네이버페이 다중 가맹점은 ID를 요구하며 서버 응답을 설정값으로 대신하지 않는다',async()=>{
  const management='<input name="login_merchantId" value="one"><input name="login_merchantId" value="two"><input id="hid_two" value="SHP">';
  await assert.rejects(naverHarness({management}).client.verifyIdentity(),e=>e.code==='STORE_REQUIRED');
  const {client,calls}=naverHarness({management,credentials:{storeName:'two'}});await client.verifyIdentity();assert.equal(calls.find(c=>c.u.pathname==='/security_merchant_check').body.login_merchantId,'two');
  await assert.rejects(naverHarness({credentials:{identityId:'different'}}).client.verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
});
test('네이버페이 재인증 응답과 잘못된 GraphQL은 전체 수집을 막는다',async()=>{
  await assert.rejects(naverHarness({request({u}){if(u.pathname==='/security_merchant_check')return response('naverAccountTwoAuthInfo');}}).client.verifyIdentity(),e=>e.code==='SESSION_REQUIRED');
  await assert.rejects(naverHarness({rows(){return response({data:null,errors:[{message:'fixture'}]});}}).client.collectOrders(RANGE),e=>e.code==='QUERY_ERROR');
});
test('네이버페이 21개 조회·CHECKOUT enum·결제일 기간과 품목 매핑을 보존한다',async()=>{
  const {client,calls}=naverHarness({rows(body){return body.variables.detailedOrderStatus==='NEW_ORDER'?[naverRow({orderDateTime:'2026-10-14T08:00:00+09:00'})]:[];}});const result=await client.collectOrders(RANGE);assert.equal(result.complete,true);assert.equal(result.orders.length,1);const o=result.orders[0];assert.equal(o.orderNo,ORDER);assert.equal(o.lineId,LINE);assert.equal(o.orderedAt,'2026-10-14');assert.equal(o.sourceIds.paidAt,'2026-10-16');assert.equal(o.amount,2400);assert.equal(o.sourceIds.fulfillableQty,2);assert.doesNotThrow(()=>normalizeOrder(o,{},{remote:true}));
  const queries=calls.filter(c=>c.u.pathname==='/o/v3/graphql');assert.equal(queries.length,21);assert.equal(queries[0].body.variables.serviceType,'CHECKOUT');assert.match(queries[0].body.query,/\$serviceType: ServiceType!/);
});
test('네이버페이 배송중도 page1 고정 없이 501품목 전체를 수집한다',async()=>{
  const {client}=naverHarness({rows(body){if(body.variables.orderStatus!=='DELIVERING')return [];return {total:501,rows:Array.from({length:body.variables.paging_page===1?500:1},(_,i)=>naverRow({productOrderNo:String((body.variables.paging_page-1)*500+i+1)}))};}});assert.equal((await client.collectOrders(RANGE)).orders.length,501);
});
test('네이버페이 활성 클레임·부분 수량은 발송을 막고 중복 페이지는 실패한다',async()=>{
  for(const change of [{claimStatus:'CANCEL_REQUEST'},{quantityClaimYn:'Y'},{productOrderStatus:'UNKNOWN'}]){const {client}=naverHarness({rows(body){return body.variables.detailedOrderStatus==='NEW_ORDER'?[naverRow(change)]:[];}});assert.equal((await client.collectOrders(RANGE)).orders[0].sourceIds.fulfillableQty,0);}
  await assert.rejects(naverHarness({rows(body){return body.variables.detailedOrderStatus==='NEW_ORDER'?{total:501,rows:Array.from({length:body.variables.paging_page===1?500:1},(_,i)=>naverRow({productOrderNo:String(i+1)}))}:[];}}).client.collectOrders(RANGE));
});
test('네이버페이 전체 수집 전후 가맹점 변경을 확인한다',async()=>{
  await assert.rejects(naverHarness({merchant(n){return n===1?'1':'2';}}).client.collectOrders(RANGE),e=>e.code==='IDENTITY_MISMATCH');
});

function domeRow(change={}){return {no:ORDER,status:'합성 상태',buyName:'합성 구매자',dateOrder:'2026-10-16 09:00:00',datePay:'2026-10-16 09:01:00',amt:2400,qty:2,receiveName:'합성 수취인',receiveMobile:'01000000000',receiveAddr:'합성 주소',receiveReq:'문 앞',deliCode:'',deliCompanyName:'',itemNo:'123',itemTitle:'합성 상품',opt:'합성 옵션',ccon:'P000000000000',...change};}
function domeHarness(options={}){
  const calls=[];const session={getSessionCookies:()=> '[]',cancel(){},async request(url,init={}){const u=new URL(url),body=init.body?Object.fromEntries(new URLSearchParams(init.body)):undefined;calls.push({u,init,body});const custom=await options.request?.({u,init,body,calls});if(custom!==undefined)return custom;
    if(u.pathname==='/ssl/member/mem_loginForm.php')return response('<form>합성</form>');if(u.pathname==='/main/member/mem_ing.php')return response(options.login??'정상');if(u.pathname==='/main/mySell/my_sellMain.php')return response('로그아웃');
    if(u.pathname.startsWith('/sc/'))return response({dat:options.rows?.(u)??(u.pathname==='/sc/order/lst'&&u.searchParams.get('st[]')==='waitchk'?[domeRow()]:[])});
    throw Error('Unexpected synthetic Domeggook request');}};
  return {client:createDomeggookClient({credentials:{...credentials,...options.credentials},session,now:NOW}),calls};
}
test('도매꾹 일반 로그인 form과 네이버·추가 인증 로그인창을 구분한다',async()=>{
  const {client,calls}=domeHarness();assert.equal((await client.login()).identitySource,'credential-login');assert.deepEqual(calls.find(c=>c.u.pathname==='/main/member/mem_ing.php').body,{mode:'mongoLogin',encording:'utf8',back:'',extCookie:'',id:credentials.sellerId,pass:credentials.password});
  assert.equal((await domeHarness({credentials:{loginType:'naver'}}).client.login()).stage,'browser');assert.equal((await domeHarness({login:'추가 인증'}).client.login()).stage,'browser');
});
test('도매꾹 비밀번호 변경 캠페인의 설정을 임의로 바꾸지 않는다',async()=>{
  const {client,calls}=domeHarness({login:'mem_requestChangePwd.php'});assert.equal((await client.login()).stage,'browser');assert.ok(calls.every(c=>!c.init.body?.includes('laterReqChangePwd')));
});
test('도매꾹 주문·취소·반품·교환 17개 전체 프로필과 날짜 기준을 보존한다',async()=>{
  const {client,calls}=domeHarness();const result=await client.collectOrders(RANGE);assert.equal(result.complete,true);assert.equal(result.orders.length,1);const o=result.orders[0];assert.equal(o.orderNo,'OR'+ORDER);assert.equal(o.lineId,ORDER);assert.equal(o.amount,2400);assert.equal(o.claimType,'없음');assert.equal(o.sourceIds.customsCode,'P000000000000');assert.equal(o.sourceIds.postcodeUnprovided,true);assert.equal(o.sourceIds.fulfillableQty,0);assert.doesNotThrow(()=>normalizeOrder(o,{},{remote:true}));const queries=calls.filter(c=>c.u.pathname.startsWith('/sc/'));assert.equal(queries.length,17);assert.equal(queries.find(c=>c.u.searchParams.get('st[]')==='waitok').u.searchParams.get('dtbase'),'deli');
});
test('도매꾹 500품목 다음 페이지를 읽으며 반복 응답을 거부한다',async()=>{
  const {client}=domeHarness({rows(u){if(u.pathname!=='/sc/order/lst'||u.searchParams.get('st[]')!=='waitchk')return [];return u.searchParams.get('pg')==='1'?Array.from({length:500},(_,i)=>domeRow({no:String(i+1)})):[domeRow({no:'501'})];}});assert.equal((await client.collectOrders(RANGE)).orders.length,501);
  await assert.rejects(domeHarness({rows(u){return u.pathname==='/sc/order/lst'&&u.searchParams.get('st[]')==='waitchk'?Array.from({length:500},(_,i)=>domeRow({no:String(i+1)})):[];}}).client.collectOrders(RANGE));
});
test('도매꾹 클레임과 철회 내역을 구분하고 로그인 실패·오류를 빈 결과로 취급하지 않는다',async()=>{
  const {client}=domeHarness({rows(u){if(u.pathname==='/sc/returns/lstReturn'&&u.searchParams.get('st[]')==='APPLY')return [domeRow()];return u.pathname==='/sc/order/lst'&&u.searchParams.get('st[]')==='waitchk'?[domeRow()]:[];}});assert.equal((await client.collectOrders(RANGE)).orders[0].claimType,'반품요청');
  await assert.rejects(domeHarness({request({u}){if(u.pathname==='/main/mySell/my_sellMain.php')return response('로그인');}}).client.verifyIdentity(),e=>e.code==='SESSION_REQUIRED');
  await assert.rejects(domeHarness({request({u}){if(u.pathname.startsWith('/sc/'))return response({error:'fixture'});}}).client.collectOrders(RANGE));
});
