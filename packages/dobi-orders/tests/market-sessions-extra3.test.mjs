import test from 'node:test';
import assert from 'node:assert/strict';
import {createImwebClient} from '../src/integrations/market-sessions/imweb.mjs';
import {createTossmallClient} from '../src/integrations/market-sessions/tossmall.mjs';
import {createGodo5Client} from '../src/integrations/market-sessions/godo5.mjs';
import {json} from '../src/integrations/market-sessions/common.mjs';
import {normalizeOrder} from '../src/store.mjs';
const NOW=()=>new Date('2026-10-16T03:00:00Z'),RANGE={from:'2026-10-15',to:'2026-10-16'},ORDER='184467440737095511',LINE='184467440737095512';
const response=(v,status=200)=>new Response(typeof v==='string'?v:JSON.stringify(v),{status});
const credentials={sellerId:'synthetic-only',password:'fixture-only-password',account:'합성 계정'};

function imwebFixture(code='OSS01',overrides={}){return {orderNo:ORDER,ordererName:'합성 구매자',orderSectionList:[{orderCode:'oc-fixture',orderSectionCode:'section-fixture',orderSectionNo:'1',statusCd:code,invoice:null,invoiceCode:'',orderSectionItemList:[{orderSectionItemCode:LINE,prodName:'합성 상품',prodSkuNo:'001-SKU',optionSkuNo:'',optionInfo:[{key:'색상',value:'파랑'}],itemPrice:1200,qty:2}]}],orderDeliveryList:[{wtime:'2026-10-16 09:00:00',receiverName:'합성 수취인',receiverCall:'01000000000',zipcode:'01234',addr1:'합성 주소',addr2:'합성 상세',isInput:'Y',memo:'문 앞'}],...overrides};}
function imwebHarness(options={}){
  const calls=[],state=options.state??'OSS01';let cancelled=false;
  const session={getSessionCookies:()=> '[]',cancel(){cancelled=true;},async request(url,init={}){const u=new URL(url);calls.push({u,init});const custom=await options.request?.({u,init,calls});if(custom!==undefined)return custom;
    if(u.pathname.includes('/backpg/login.cm'))return response(options.loginHtml??'정상 로그인');
    if(u.pathname.endsWith('/sign-in/legacy'))return response({accessToken:'fixture-only-token'});
    if(u.pathname==='/admin/v1/order'){const page=Number(u.searchParams.get('page')),code=u.searchParams.get('tOrderSectionStatusCd[]');return response({statusCode:200,data:{list:options.list?.({page,code,calls})??(code===state?[{orderCode:'oc-fixture'}]:[])}});}
    if(u.pathname.startsWith('/admin/v1/order/'))return response({statusCode:200,data:typeof options.detail==='function'?options.detail(u.pathname.split('/').at(-1)):options.detail??imwebFixture(state)});
    throw Error('Unexpected synthetic Imweb request');}};
  const client=createImwebClient({credentials:{...credentials,host:'synthetic.imweb.me',...options.credentials},session,now:NOW});return {client,calls,get cancelled(){return cancelled;}};
}
test('아임웹 정상 ID·비밀번호와 legacy token을 별도 경로로 교환한다',async()=>{
  const {client,calls}=imwebHarness();const result=await client.login();assert.equal(result.identitySource,'credential-login');
  const login=calls.find(c=>c.u.pathname==='/backpg/login.cm');assert.deepEqual(Object.fromEntries(new URLSearchParams(login.init.body)),{uid:credentials.sellerId,passwd:credentials.password});
  const token=calls.find(c=>c.u.pathname.endsWith('/sign-in/legacy'));assert.equal(token.init.method,'POST');assert.equal(token.init.body,' ');assert.equal(token.init.headers['Content-Type'],'application/x-www-form-urlencoded;charset=UTF-8');
  assert.equal(client.getSessionState().sessionData.token,'fixture-only-token');assert.equal(calls.find(c=>c.u.hostname==='api.oms.imweb.me').init.headers.Authorization,'Bearer fixture-only-token');
});
test('아임웹 추가 인증은 정상 로그인창으로 넘기고 잘못된 비밀번호는 실패한다',async()=>{
  assert.equal((await imwebHarness({loginHtml:'location.href="/?mode=admin_two_factor"'}).client.login()).stage,'browser');
  await assert.rejects(imwebHarness({loginHtml:'잘못된 아이디 또는 비밀번호입니다.'}).client.login(),e=>e.code==='SESSION_REQUIRED');
});
test('아임웹 브라우저 쿠키 인증에서 서버 계정 ID를 알아냈다고 주장하지 않는다',async()=>{
  const {client}=imwebHarness();assert.equal((await client.verifyIdentity()).identitySource,'user-confirmation');
  await assert.rejects(imwebHarness({credentials:{identityId:'different'}}).client.verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
});
test('아임웹 품목번호·옵션·수량·가격·우편번호와 12개 상태 전체를 수집한다',async()=>{
  for(const state of Array.from({length:12},(_,i)=>'OSS'+String(i+1).padStart(2,'0'))){const {client,calls}=imwebHarness({state});const {orders}=await client.collectOrders(RANGE);assert.equal(orders.length,1);const row=orders[0];assert.equal(row.orderNo,ORDER);assert.equal(row.lineId,LINE);assert.equal(row.postcode,'01234');assert.equal(row.amount,2400);assert.equal(row.option,'색상: 파랑');assert.doesNotThrow(()=>normalizeOrder(row,{},{remote:true}));assert.equal(new Set(calls.filter(c=>c.u.pathname==='/admin/v1/order').map(c=>c.u.searchParams.get('tOrderSectionStatusCd[]'))).size,12);if(Number(state.slice(3))>=6)assert.equal(row.sourceIds.fulfillableQty,0);}
});
test('아임웹 50개 다음 페이지를 읽으며 반복 페이지를 전체 실패로 처리한다',async()=>{
  const {client,calls}=imwebHarness({list({page,code}){if(code!=='OSS01')return [];return page===1?Array.from({length:50},(_,i)=>({orderCode:'oc-'+i})):[{orderCode:'oc-50'}];},detail(code){const d=imwebFixture();d.orderNo=code;d.orderSectionList[0].orderCode=code;d.orderSectionList[0].orderSectionItemList[0].orderSectionItemCode=code+'-item';return d;}});assert.equal((await client.collectOrders(RANGE)).orders.length,51);assert.ok(calls.some(c=>c.u.searchParams.get('page')==='2'));
  const repeated=imwebHarness({list({page,code}){if(code!=='OSS01')return [];return page===1?Array.from({length:50},()=>({orderCode:'oc-fixture'})):[];}});await assert.rejects(repeated.client.collectOrders(RANGE));
});
test('아임웹 배송지 입력 대기·다중 배송지와 알 수 없는 상태를 안전하게 처리한다',async()=>{
  const fixture=imwebFixture();fixture.orderDeliveryList[0].isInput='N';assert.equal((await imwebHarness({detail:fixture}).client.collectOrders(RANGE)).orders[0].sourceIds.fulfillableQty,0);
  await assert.rejects(imwebHarness({detail:imwebFixture('OSS01',{orderDeliveryList:[{},{}]})}).client.collectOrders(RANGE),e=>e.code==='AMBIGUOUS_DELIVERY');
  await assert.rejects(imwebHarness({detail:imwebFixture('OSS99')}).client.collectOrders(RANGE));
});
test('아임웹 API 오류는 빈 정상 결과로 반환하지 않는다',async()=>{
  const {client}=imwebHarness({request({u}){if(u.hostname==='api.oms.imweb.me')return response({statusCode:401,data:{list:[]}});}});await assert.rejects(client.collectOrders(RANGE),e=>e.code==='REMOTE_ERROR');
});

function tossRow(overrides={}){return {orderId:ORDER,orderProductId:LINE,productId:'111',productName:'합성 상품',price:2400,quantity:2,optionName:'합성 옵션',productManagementCode:'001-SKU',receiverName:'합성 수취인',receiverPhone:'01000000000',zipCode:'01234',address:'합성 주소',detailAddress:'합성 상세',orderedAt:'2026-10-16T09:00:00+09:00',orderProductStatus:'결제완료',...overrides};}
function tossClaim(status='REQUESTED'){return {id:'claim-fixture',status,order:{id:ORDER,orderProductId:LINE,price:2400,receiverName:'합성 수취인',receiverPhoneNumber:'01000000000',zipCode:'01234',address:'합성 주소',createdDt:'2026-10-16T09:00:00+09:00'},product:{id:'111',name:'합성 상품',quantity:2,optionName:'합성 옵션'}};}
function tossHarness(options={}){
  const calls=[];let identities=0;
  const session={getSessionCookies:()=> '[]',cancel(){},async request(url,init={}){const u=new URL(url),body=init.body?json(init.body):undefined;calls.push({u,init,body});const custom=await options.request?.({u,init,body,calls});if(custom!==undefined)return custom;
    if(u.pathname.endsWith('/my-info')){identities++;return response({resultType:'SUCCESS',success:{merchantUser:{id:'merchant-user-fixture'},merchantMappingInfo:options.merchants?.(identities)??[{merchantId:'184467440737095514',merchantName:'합성 판매자'}]}});}
    if(u.pathname.endsWith('/order/histories'))return response({resultType:'SUCCESS',success:options.orders?.(body)??{results:body.orderSearchStatus==='결제완료'?[tossRow()]:[],paging:{nextCursor:null,totalCount:body.orderSearchStatus==='결제완료'?1:0}}});
    if(u.pathname.endsWith('/orders/claims'))return response({resultType:'SUCCESS',success:{claims:options.claims?.(body)??[]}});
    throw Error('Unexpected synthetic Toss request');}};
  const client=createTossmallClient({credentials:{...credentials,...options.credentials},session,now:NOW});return {client,calls};
}
test('토스쇼핑은 로그인창을 사용하고 서버 회원·판매자 번호를 검증한다',async()=>{
  const {client,calls}=tossHarness();assert.equal((await client.login()).stage,'browser');assert.equal(calls.length,0);assert.equal((await client.verifyIdentity()).identityId,'merchant-user-fixture:184467440737095514');
  await assert.rejects(tossHarness({credentials:{identityId:'wrong'}}).client.verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
});
test('토스쇼핑 다점포는 판매자명을 고르고 임의로 첫 계정을 선택하지 않는다',async()=>{
  const merchants=()=>[{merchantId:'1',merchantName:'첫 합성 판매자'},{merchantId:'2',merchantName:'선택 합성 판매자'}];await assert.rejects(tossHarness({merchants}).client.verifyIdentity(),e=>e.code==='STORE_REQUIRED');
  assert.equal((await tossHarness({merchants,credentials:{storeName:'선택 합성 판매자'}}).client.verifyIdentity()).identityId,'merchant-user-fixture:2');
});
test('토스쇼핑 기본 6상태·17클레임 상태를 수집하고 18자리 merchant ID를 반올림하지 않는다',async()=>{
  const {client,calls}=tossHarness();const {orders}=await client.collectOrders(RANGE);assert.equal(orders.length,1);assert.equal(orders[0].lineId,LINE);assert.equal(orders[0].amount,2400);assert.equal(orders[0].unitPrice,1200);assert.equal(orders[0].postcode,'01234');assert.doesNotThrow(()=>normalizeOrder(orders[0],{},{remote:true}));
  assert.equal(calls.filter(c=>c.u.pathname.endsWith('/order/histories')).length,6);assert.equal(calls.filter(c=>c.u.pathname.endsWith('/orders/claims')).length,17);
  const request=calls.find(c=>c.u.pathname.endsWith('/order/histories'));assert.match(request.init.body,/"merchantId":184467440737095514[,}]/);assert.equal(request.init.headers['X-Merchant-ID'],'184467440737095514');
});
test('토스쇼핑 cursor로 모든 페이지를 읽고 반복 cursor와 잘못된 총계를 차단한다',async()=>{
  const {client}=tossHarness({orders(body){if(body.orderSearchStatus!=='결제완료')return {results:[],paging:{totalCount:0,nextCursor:null}};return body.cursor?{results:[tossRow({orderProductId:'501'})],paging:{totalCount:501,nextCursor:null}}:{results:Array.from({length:500},(_,i)=>tossRow({orderProductId:String(i+1)})),paging:{totalCount:501,nextCursor:{after:'fixture'}}};}});assert.equal((await client.collectOrders(RANGE)).orders.length,501);
  const broken=tossHarness({orders(body){return {results:[tossRow()],paging:{totalCount:2,nextCursor:{after:'same'}}};}});await assert.rejects(broken.client.collectOrders(RANGE));
});
test('토스쇼핑 활성 취소·반품·교환은 발송을 차단하고 거부 내역은 정상 주문을 보존한다',async()=>{
  for(const type of ['CANCEL','RETURN','EXCHANGE']){const {client}=tossHarness({claims(body){return body.type===type&&body.statuses[0]==='REQUESTED'?[tossClaim()]:[];}});const {orders}=await client.collectOrders(RANGE);assert.equal(orders.length,1);assert.equal(orders[0].sourceIds.fulfillableQty,0);assert.notEqual(orders[0].claimType,'없음');}
  const {client}=tossHarness({claims(body){return body.type==='CANCEL'&&body.statuses[0]==='REJECTED'?[tossClaim('REJECTED')]:[];}});assert.equal((await client.collectOrders(RANGE)).orders[0].status,'신규');
});
test('토스쇼핑 세션·판매자 변경 또는 실패 응답은 전체 수집을 중단한다',async()=>{
  await assert.rejects(tossHarness({merchants(n){return [{merchantId:n===1?'1':'2',merchantName:'합성 판매자'}];}}).client.collectOrders(RANGE),e=>e.code==='IDENTITY_MISMATCH');
  await assert.rejects(tossHarness({request({u}){if(u.pathname.endsWith('/order/histories'))return response({resultType:'FAIL',success:{results:[]}});}}).client.collectOrders(RANGE),e=>e.code==='REMOTE_ERROR');
});

const GODOSTATES={p1:'합성 결제완료',g1:'합성 준비',d1:'합성 배송중',d2:'합성 배송완료',s1:'합성 확정',r1:'합성 취소요청',b1:'합성 반품요청',e1:'합성 교환요청'};
function godoList(code='p1',order=ORDER,{count=1,next=''}={}){return `<html><body><a href="/base/logout.php">로그아웃</a>${Object.entries(GODOSTATES).map(([v,label])=>`<label><input type="checkbox" name="orderStatus[]" value="${v}">${label}</label>`).join('')}<p>검색 <strong class="text-danger">${count}</strong>개</p>${count?`<input type="checkbox" name="statusCheck[g][]" value="${order}|${LINE}|${code}">`:''}${next?`<a href="${next.replaceAll('&','&amp;')}">다음</a>`:''}</body></html>`;}
function godoBasic(){return `<html><ul><li class="active"><a href="#tab-status-p1" data-toggle="tab">주문</a></li></ul>주문일시 : <span>2026년 10월 16일 09시 00분</span><table><tr><th>주문자명</th><td><span>합성 구매자</span></td></tr></table>${Object.entries({'receiverName':'합성 수취인','receiverCellPhone':'01000000000','receiverZonecode':'01234','receiverAddress':'합성 주소','receiverAddressSub':'합성 상세'}).map(([k,v])=>`<input name="info[${k}]" value="${v}">`).join('')}</html>`;}
function godoItem(code='p1',line=LINE){return `<table><tr><td><input id="statusCheck_g_${line}" name="statusCheck[g][]" value="${ORDER}|${line}"></td><!-- 처리상태 --><td>${GODOSTATES[code]}</td><!-- 수량 --><td><strong>2</strong></td><td>합성</td><td class="text-left"><a title="상품명" href="#">합성 상품</a><div class="info">합성 옵션</div></td><td class="text-center">합성</td><td class="text-right">2,400원</td></tr></table>`;}
function godoHarness(options={}){
  const calls=[];const session={getSessionCookies:()=> '[]',cancel(){},async request(url,init={}){const u=new URL(url),body=init.body?Object.fromEntries(new URLSearchParams(init.body)):undefined;calls.push({u,init,body});const custom=await options.request?.({u,init,body,calls});if(custom!==undefined)return custom;
    if(u.pathname.endsWith('/base/login.php')||u.pathname.endsWith('/base/login_ps.php'))return response(options.login??'정상 로그인');
    if(u.pathname.endsWith('/order/order_list_all.php')){const code=u.searchParams.get('orderStatus[]');return response(options.list?.({u,code})??godoList(code||'p1',ORDER,{count:code===(options.state??'p1')?1:0}));}
    if(u.pathname.endsWith('/order/order_view.php'))return response(options.basic??godoBasic());
    if(u.pathname.endsWith('/order/inc_order_view.php'))return response(options.item??godoItem(options.state));
    throw Error('Unexpected synthetic Godo5 request');}};
  const client=createGodo5Client({credentials:{...credentials,host:'synthetic.godomall.com',...options.credentials},session,now:NOW});return {client,calls};
}
test('고도몰 관리자 form로그인과 보안 인증 분기를 보존한다',async()=>{
  const {client,calls}=godoHarness();assert.equal((await client.login()).identitySource,'credential-login');assert.deepEqual(calls.find(c=>c.u.pathname.endsWith('/login_ps.php')).body,{mode:'login',returnUrl:'',managerId:credentials.sellerId,managerPw:credentials.password});
  assert.equal((await godoHarness({login:'보안 인증 번호 입력'}).client.login()).stage,'browser');
});
test('고도몰은 서버 주문 화면 확인 후에도 계정 ID 검증 수준을 구분한다',async()=>{
  assert.equal((await godoHarness().client.verifyIdentity()).identitySource,'user-confirmation');
  await assert.rejects(godoHarness({credentials:{identityId:'another'}}).client.verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
  await assert.rejects(godoHarness({request({u}){if(u.pathname.endsWith('/order_list_all.php'))return response('<input type="password">');}}).client.verifyIdentity(),e=>e.code==='SESSION_REQUIRED');
});
test('고도몰 모든 서버 상태 라벨과 원본 상세 HTML의 품목·연락처를 읽는다',async()=>{
  for(const state of Object.keys(GODOSTATES)){const {client,calls}=godoHarness({state});const {orders}=await client.collectOrders(RANGE);assert.equal(orders.length,1);const row=orders[0];assert.equal(row.orderNo,ORDER);assert.equal(row.lineId,LINE);assert.equal(row.quantity,2);assert.equal(row.amount,2400);assert.equal(row.postcode,'01234');assert.equal(row.orderedAt,'2026-10-16');assert.equal(row.recipient,'합성 수취인');assert.doesNotThrow(()=>normalizeOrder(row,{},{remote:true}));assert.ok(calls.every(c=>!c.u.pathname.includes('excel_form_ps.php')));}
});
test('고도몰 HTML의 다음 페이지를 따라가며 원격 엑셀 양식을 수정하지 않는다',async()=>{
  const {client}=godoHarness({list({u,code}){if(code!=='p1')return godoList('p1',ORDER,{count:0});if(u.searchParams.get('page')==='2')return godoList('p1','123456789012345678',{count:2});const next=u.pathname+u.search+'&page=2';return godoList('p1',ORDER,{count:2,next});}});assert.equal((await client.collectOrders(RANGE)).orders.length,2);
});
test('고도몰 검색 총계·중복 페이지·모호한 품목 수량·알 수 없는 상태는 부분 수집하지 않는다',async()=>{
  await assert.rejects(godoHarness({list({code}){return godoList(code||'p1',ORDER,{count:code==='p1'?2:0});}}).client.collectOrders(RANGE),e=>e.code==='INCOMPLETE_PAGE');
  await assert.rejects(godoHarness({item:godoItem().replace('<strong>2</strong>','<strong>2</strong><strong>3</strong>')}).client.collectOrders(RANGE),e=>e.code==='AMBIGUOUS_ITEM');
  await assert.rejects(godoHarness({item:godoItem().replace(GODOSTATES.p1,'알 수 없는 미래 상태')}).client.collectOrders(RANGE));
});
