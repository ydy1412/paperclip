import test from 'node:test';
import assert from 'node:assert/strict';
import {createEsmClient,validateEsmCookies} from '../src/integrations/esm.mjs';

const clock=()=>new Date('2026-10-14T01:00:00Z');
const auth={name:'ESM_AUTH',value:'synthetic-auth-token',domain:'.esmplus.com',path:'/',hostOnly:false,secure:true,httpOnly:true,expirationDate:clock().getTime()/1000+3600};
const credentials={site:'gmarket',sellerId:'synthetic-seller',account:'예제 지마켓',cookies:JSON.stringify([auth])};
const period={from:'2026-10-13',to:'2026-10-14'};
function json(data,status=200,cookies=[]){const headers=new Headers({'Content-Type':'application/json'});for(const cookie of cookies)headers.append('Set-Cookie',cookie);return new Response(typeof data==='string'?data:JSON.stringify(data),{status,headers});}
const sellers=()=>({gmk:[credentials.sellerId],iac:['synthetic-auction-seller']});
const list=rows=>({data:{list:rows}});
function row(no='123456789012345678',options={}){return {siteOrderNo:no,orderNo:'987654321012345678',sellerId:credentials.sellerId,siteId:'2',cartNo:'111122223333444455',payDate:'2026-10-14T09:00:00+09:00',goodsName:'<b>예제 &amp; 상품</b>',orderQty:'2',sellPrice:'10,000',tradeAmnt:'20,000',selectOptionInfo:'파랑&nbsp;/ L',buyerName:'예제 구매자',rcverName:'예제 수령인',rcverInfoCp:'010-0000-0000',zipCode:'01234',rcverInfoRoadNamAd:'<p>예제 주소 1호</p>',deliveryMemo:'문 앞',invoiceNo:'',...options};}
const make=(fetchImpl,extra={})=>createEsmClient({credentials,now:clock,resolveHost:false,fetchImpl,...extra});
function mockRoutes(handler){return async(url,options)=>{const u=new URL(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);assert.ok(['www.esmplus.com','post-tx.esmplus.com'].includes(u.hostname));assert.match(options.headers.Cookie,/ESM_AUTH=/);if(u.pathname==='/Home/SellerList')return json(sellers());if(u.pathname.includes('/detail'))return json({data:{deliveryTypeCode:'NORMAL'}});return handler(u,options);};}

test('ESM 쿠키 입력은 domain·속성·만료·partition·헤더 오염을 검증하며 비밀값을 오류에 넣지 않는다',()=>{
  assert.equal(validateEsmCookies(credentials.cookies,clock)[0].name,'ESM_AUTH');
  for(const change of [{domain:'.evil.example'},{domain:'.esmplus.com.evil.example'},{value:'synthetic-secret;other=1'},{value:'synthetic-secret\r\nX-Test:yes'},{name:'bad;name'},{path:'/;evil'},{expirationDate:'tomorrow'},{hostOnly:'false'},{partitionKey:{topLevelSite:'https://www.esmplus.com'}},{partitioned:true},{secure:'true'}]){
    assert.throws(()=>validateEsmCookies([{...auth,...change}],clock),e=>!e.message.includes('synthetic-secret'));
  }
  assert.throws(()=>validateEsmCookies([{...auth,expirationDate:clock().getTime()/1000}],clock),e=>e.code==='SESSION_REQUIRED');
  assert.throws(()=>validateEsmCookies([{...auth,name:'OTHER'}],clock),e=>e.code==='SESSION_REQUIRED');
  assert.throws(()=>validateEsmCookies([auth,auth],clock),e=>e.code==='INVALID_COOKIES');
  assert.throws(()=>validateEsmCookies([{...auth,storeId:'0'},{...auth,name:'OTHER',storeId:'1'}],clock),e=>e.code==='INVALID_COOKIES');
  assert.throws(()=>validateEsmCookies(JSON.stringify([{...auth,value:'x'.repeat(30000)}]),clock),e=>e.code==='INVALID_COOKIES');
});
test('URL별 Cookie jar는 hostOnly/path 경계를 적용하고 복수 Set-Cookie 회전·삭제·만료를 유지한다',async()=>{
  const cookies=[auth,{...auth,name:'WWW_ONLY',value:'www-token',domain:'www.esmplus.com',hostOnly:true},{...auth,name:'API_PATH',value:'path-token',domain:'post-tx.esmplus.com',path:'/api/order-integration',hostOnly:true}];
  let sellerCalls=0;
  const client=make(async(url,options)=>{
    const u=new URL(url),header=options.headers.Cookie;
    if(u.hostname==='www.esmplus.com'){
      sellerCalls++;assert.match(header,/WWW_ONLY=www-token/);assert.doesNotMatch(header,/API_PATH/);
      if(sellerCalls===1){assert.match(header,/ESM_AUTH=synthetic-auth-token/);return json(sellers(),200,['ESM_AUTH=rotated-token; Domain=.esmplus.com; Path=/; Secure; HttpOnly','DROP=gone; Domain=.esmplus.com; Path=/','DROP=; Domain=.esmplus.com; Path=/; Max-Age=0','FORGED=secret; Domain=evil.example; Path=/','PAST=; Domain=.esmplus.com; Path=/; Expires=Tue, 13 Oct 2026 00:00:00 GMT']);}
      assert.match(header,/ESM_AUTH=rotated-token/);assert.doesNotMatch(header,/DROP|PAST|FORGED/);return json(sellers());
    }
    assert.doesNotMatch(header,/WWW_ONLY|DROP|PAST|FORGED/);assert.match(header,/ESM_AUTH=rotated-token/);
    if(u.pathname.includes('/detail')){assert.match(header,/API_PATH=path-token/);return json({data:{deliveryTypeCode:'NORMAL'}});}
    assert.doesNotMatch(header,/API_PATH/);return json(list(u.pathname.includes('/new-order/')?[row()]:[]));
  },{credentials:{...credentials,cookies:JSON.stringify(cookies)}});
  assert.equal((await client.testConnection()).ok,true);assert.equal((await client.collectOrders(period)).orders.length,1);
  const saved=JSON.parse(client.getSessionCookies());assert.equal(saved.find(c=>c.name==='ESM_AUTH').value,'rotated-token');assert.equal(saved.some(c=>['DROP','PAST','FORGED'].includes(c.name)),false);
});
test('SellerList의 시장별 판매자 목록과 설정 ID가 다르면 조회를 중단하고 실제 목록을 노출하지 않는다',async()=>{
  let calls=0;const mismatch=make(async()=>{calls++;return json({gmk:['private-other-seller'],iac:[]});});
  await assert.rejects(()=>mismatch.collectOrders(period),e=>e.code==='ACCOUNT_MISMATCH'&&!e.message.includes('private-other-seller')&&!e.message.includes(credentials.sellerId));assert.equal(calls,1);
  const wrongShape=make(async()=>json({gmk:[{id:credentials.sellerId}],iac:[]}));await assert.rejects(()=>wrongShape.testConnection(),e=>e.code==='SESSION_REQUIRED');
  const auction=make(mockRoutes(u=>{assert.equal(u.searchParams.get('sellerSiteId'),'1');assert.equal(u.searchParams.get('sellerId'),'synthetic-auction-seller');return json(list([]));}),{credentials:{...credentials,site:'auction',sellerId:'synthetic-auction-seller'}});
  assert.equal((await auction.collectOrders(period)).complete,true);
});
test('6개 읽기 경로·끝 날짜·구매확정 확장·18자리 숫자 ID·상태 중복·상세 GET 및 HTML 텍스트를 연결한다',async()=>{
  const paths=[],details=[];
  const client=make(async(url,options)=>{
    const u=new URL(url);assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    if(u.pathname==='/Home/SellerList')return json(sellers());
    if(u.pathname.includes('/detail')){details.push(u);return json({data:{deliveryTypeCode:'PARCEL'}});}
    paths.push(u);assert.equal(u.searchParams.get('pageSize'),'500');assert.equal(u.searchParams.get('sellerSiteId'),'2');assert.equal(u.searchParams.get('sellerId'),credentials.sellerId);assert.equal(u.searchParams.get('searchSDT'),'2026-10-13');
    assert.equal(u.searchParams.get('searchEDT'),u.pathname.includes('/buy-decision/')?'2026-10-14':'2026-10-15');
    const value=u.pathname.includes('/new-order/')?row():u.pathname.includes('/buy-decision/')?row(undefined,{settleStatus:'구매확정',invoiceNo:'<input value="00001234567890">',deliveryCompName:'CJ대한통운'}):null;
    if(!value)return json(list([]));
    const raw=JSON.stringify(list([value])).replace(/"(123456789012345678|987654321012345678|111122223333444455)"/g,'$1');return json(raw);
  });
  const r=await client.collectOrders(period);assert.equal(r.complete,true);assert.equal(r.orders.length,1);assert.equal(paths.length,6);assert.deepEqual(paths.filter(u=>u.searchParams.has('shippingStatusCode')).map(u=>u.searchParams.get('shippingStatusCode')),['1040','7010','1050']);assert.equal(details.length,1);assert.equal(details[0].pathname,'/api/order-integration/orders/123456789012345678/detail');assert.equal(details[0].searchParams.get('method'),'GET');
  const o=r.orders[0];assert.equal(o.orderNo,'123456789012345678');assert.equal(o.lineId,'');assert.equal(o.sourceIds.esmOrderNo,'987654321012345678');assert.equal(o.sourceIds.cartNo,'111122223333444455');assert.equal(o.sourceIds.deliveryTypeCode,'PARCEL');assert.equal(o.status,'구매확정');assert.equal(o.sourceIds.fulfillableQty,0);assert.equal(o.product,'예제 & 상품');assert.equal(o.option,'파랑\u00a0/ L');assert.equal(o.quantity,2);assert.equal(o.unitPrice,10000);assert.equal(o.amount,20000);assert.equal(o.tracking,'00001234567890');assert.equal(o.phone,'010-0000-0000');assert.equal(o.postcode,'01234');assert.equal(o.address,'예제 주소 1호');
});
test('구매확정의 원본 검색 범위 확장 후 요청한 주문일 양끝을 포함해 후필터한다',async()=>{
  const client=make(mockRoutes(u=>{
    if(!u.pathname.includes('/buy-decision/'))return json(list([]));
    assert.equal(u.searchParams.get('searchDateType'),'TD');assert.equal(u.searchParams.get('searchEDT'),'2026-10-02');
    return json(list([row('10001',{orderNo:'20001',payDate:'2026-09-01 00:00:00',settleStatus:'구매확정'}),row('10002',{orderNo:'20002',payDate:'2026-09-02 23:59:59',settleStatus:'구매확정'}),row('10003',{orderNo:'20003',payDate:'2026-09-03 00:00:00',settleStatus:'구매확정'})]));
  }));
  const result=await client.collectOrders({from:'2026-09-01',to:'2026-09-02'});assert.deepEqual(result.orders.map(o=>o.orderNo),['10001','10002']);
});
test('500개 가득 찬 페이지는 다음 페이지까지 읽고 동일 페이지/주문 반복은 실패한다',async()=>{
  let pageCount=0,detailCount=0;
  const client=make(async(url)=>{
    const u=new URL(url);if(u.pathname==='/Home/SellerList')return json(sellers());if(u.pathname.includes('/detail')){detailCount++;return json({data:{deliveryTypeCode:'NORMAL'}});}
    if(!u.pathname.includes('/new-order/'))return json(list([]));pageCount++;const page=Number(u.searchParams.get('page'));
    return json(list(page===1?Array.from({length:500},(_,i)=>row(String(10000+i),{orderNo:String(20000+i)})):[row('10500',{orderNo:'20500'})]));
  });assert.equal((await client.collectOrders(period)).orders.length,501);assert.equal(pageCount,2);assert.equal(detailCount,501);
  const repeated=make(mockRoutes(u=>json(list(u.pathname.includes('/new-order/')?Array.from({length:500},(_,i)=>row(String(10000+i),{orderNo:String(20000+i)})):[]))));
  await assert.rejects(()=>repeated.collectOrders(period),e=>e.code==='PAGINATION_ERROR');
});
test('100번째 페이지가 여전히 500개이면 마지막 페이지 미확인 오류를 내고 상세 요청을 시작하지 않는다',async()=>{
  let pages=0,details=0;const client=make(async(url)=>{const u=new URL(url);if(u.pathname==='/Home/SellerList')return json(sellers());if(u.pathname.includes('/detail')){details++;return json({data:{deliveryTypeCode:'NORMAL'}});}pages++;const page=Number(u.searchParams.get('page'));return json(list(Array.from({length:500},(_,i)=>row(String(100000+page*500+i),{orderNo:String(200000+page*500+i),payDate:'2026-10-12T09:00:00+09:00'}))));});
  await assert.rejects(()=>client.collectOrders(period),e=>e.code==='PAGINATION_LIMIT');assert.equal(pages,100);assert.equal(details,0);
});
test('10,000품목 저장 한도를 넘으면 추가 상세 요청을 시작하기 전에 중단한다',async()=>{
  let pages=0,details=0;const client=make(async(url)=>{const u=new URL(url);if(u.pathname==='/Home/SellerList')return json(sellers());if(u.pathname.includes('/detail')){details++;return json({data:{deliveryTypeCode:'NORMAL'}});}pages++;const page=Number(u.searchParams.get('page'));return json(list(Array.from({length:500},(_,i)=>row(String(100000+page*500+i),{orderNo:String(200000+page*500+i)}))));});
  await assert.rejects(()=>client.collectOrders(period),e=>e.code==='RESULT_LIMIT');assert.equal(pages,21);assert.equal(details,0);
});
test('늦은 목록·상세 실패는 전체 수집을 실패시키며 부분 주문 결과를 반환하지 않는다',async()=>{
  let returned;const lateList=make(mockRoutes(u=>u.pathname.includes('/buy-decision/')?json({error:{message:'synthetic-private-error'}}):json(list(u.pathname.includes('/new-order/')?[row()]:[]))));
  await assert.rejects(async()=>{returned=await lateList.collectOrders(period);},e=>e.code==='API_ERROR'&&!e.message.includes('synthetic-private-error'));assert.equal(returned,undefined);
  let details=0;const lateDetail=make(async(url)=>{const u=new URL(url);if(u.pathname==='/Home/SellerList')return json(sellers());if(u.pathname.includes('/detail'))return ++details===1?json({data:{deliveryTypeCode:'NORMAL'}}):json({data:{}});return json(list(u.pathname.includes('/new-order/')?[row('10001',{orderNo:'20001'}),row('10002',{orderNo:'20002'})]:[]));});
  await assert.rejects(async()=>{returned=await lateDetail.collectOrders(period);},e=>e.code==='INCOMPLETE_DETAIL');assert.equal(returned,undefined);assert.equal(details,2);
});
test('누락된 필수 상품·수량·날짜·식별자와 행별 다른 판매자 응답은 가짜 값으로 저장하지 않는다',async()=>{
  for(const change of [{goodsName:''},{orderQty:undefined},{payDate:'',orderDate:undefined},{siteOrderNo:'<b>1234</b>'},{orderNo:'1.234e18'},{sellerId:'another-private-account'},{siteId:'1'},{orderQty:'1,0,0'}]){
    const client=make(mockRoutes(u=>json(list(u.pathname.includes('/new-order/')?[row(undefined,change)]:[]))));await assert.rejects(()=>client.collectOrders(period));
  }
  const conflict=make(mockRoutes(u=>json(list(u.pathname.includes('/new-order/')?[row()]:u.pathname.includes('/send-processing/')?[row(undefined,{orderNo:'999999999999999999'})]:[]))));await assert.rejects(()=>conflict.collectOrders(period),e=>e.code==='INCONSISTENT_ORDER');
});
test('선물·클레임·미확인 상태와 이미 발송된 주문의 발송 가능 수량은 0이며 위험 플래그는 중복 합치기에도 유지된다',async()=>{
  const client=make(mockRoutes(u=>{
    if(u.pathname.includes('/new-order/'))return json(list([row('10001',{orderNo:'20001',giftStatusType:'선물수락대기'}),row('10002',{orderNo:'20002',claimStatus:'CANCEL_REQUEST'}),row('10003',{orderNo:'20003'})]));
    if(u.pathname.includes('/send-processing/'))return json(list([row('10001',{orderNo:'20001'}),row('10003',{orderNo:'20003'})]));
    if(u.searchParams.get('shippingStatusCode')==='1040')return json(list([row('10004',{orderNo:'20004',deliveryStatus:'UNRECOGNIZED'}),row('10005',{orderNo:'20005',deliveryStatus:'배송중'})]));return json(list([]));
  }));const r=await client.collectOrders(period),orders=new Map(r.orders.map(o=>[o.orderNo,o]));
  for(const id of ['10001','10002','10004','10005'])assert.equal(orders.get(id).sourceIds.fulfillableQty,0);
  assert.equal(orders.get('10001').sourceIds.needsReview,true);assert.equal(orders.get('10004').sourceIds.needsReview,true);assert.equal(orders.get('10005').sourceIds.needsReview,false);assert.equal(orders.get('10003').sourceIds.fulfillableQty,2);
});
test('리다이렉트·로그인 HTML·인증 오류·error:null·세션 삭제를 인증 성공으로 취급하지 않는다',async()=>{
  for(const response of [()=>json({},302),()=>new Response('<html>synthetic-login</html>',{status:200}),()=>json({},401),()=>json({error:null}),()=>json(sellers(),200,['ESM_AUTH=; Domain=.esmplus.com; Path=/; Max-Age=0'])]){const c=make(async()=>response());await assert.rejects(()=>c.testConnection());}
  let calls=0;const c=make(async()=>{calls++;return json(sellers());});await assert.rejects(()=>c.collectOrders({from:'2026-02-30',to:'2026-03-01'}),e=>e.code==='INVALID_DATE');assert.equal(calls,0);
});
