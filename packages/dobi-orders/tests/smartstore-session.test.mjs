import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmartstoreSessionClient} from '../src/integrations/smartstore-session.mjs';
import {normalizeOrder} from '../src/store.mjs';

const NOW=()=>new Date('2026-10-16T03:00:00Z'),RANGE={from:'2026-10-15',to:'2026-10-16'};
const ORDER='184467440737095511',LINE='184467440737095512',MERCHANT='184467440737095513',CHANNEL='184467440737095514';
const credentials={sellerId:'synthetic-naver',loginType:'naver',account:'합성 스토어',cookies:'[]'};
const res=(data,headers={},status=200)=>new Response(typeof data==='string'?data:JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
function row(overrides={}){return {orderNo:ORDER,productOrderNo:LINE,orderQuantity:2,productName:'합성 상품',productUnitPrice:1000,productOptionAmt:200,productPayAmt:2300,productOptionContents:'합성 옵션',sellerProductManagementCode:'001-SKU',orderMemberName:'합성 구매자',receiverName:'합성 수취인',receiverTelNo1:'01000000000',receiverZipCode:'01234',receiverDisplayBaseAddress:'합성 주소',receiverDisplayDetailAddress:'합성 상세',payDateTime:'2026-10-16T09:00:00+09:00',orderDateTime:'2026-10-16T08:59:00+09:00',orderStatus:'WAITING_DISPATCH',productOrderStatus:'NEW_ORDER',...overrides};}
function harness(options={}){
  const calls=[];let current=options.current??CHANNEL,identities=0;
  const session={getSessionCookies:()=>JSON.stringify([{name:'synthetic',value:'fixture-only',domain:'.naver.com',path:'/'}]),cancel(){},async request(url,init={}){
    const u=new URL(url);const body=init.body?JSON.parse(init.body):undefined;calls.push({u,init,body});
    const custom=await options.request?.({u,init,body,calls});if(custom!==undefined)return custom;
    if(u.pathname==='/api/login/init'){identities++;return res({},options.initHeaders?.(identities,current)??{'X-NCP-LOGIN-INFO':'{}',user:`synthetic-naver:role:${current}`});}
    if(u.pathname==='/api/login/channels')return res(options.channels??[{channelNo:CHANNEL,roleNo:1,channelName:'합성 스토어',url:'synthetic'}]);
    if(u.pathname==='/api/login/change-channel'){current=String(body.channelNo);return res({}, {'X-NCP-LOGIN-INFO':encodeURIComponent(JSON.stringify({redirectUrl:'https://sell.smartstore.naver.com/#/home/dashboard'}))});}
    if(u.pathname==='/o/v3/n/sale/delivery')return res(options.html??`<script>var data="{\\\"merchantNo\\\":\\\"${MERCHANT}\\\"}";</script>`);
    if(u.pathname==='/api/seller/notification/new-notification')return res(options.notification??{newNotificationYn:'N'});
    if(u.pathname==='/o/v3/graphql'){
      if(body.operationName==='getGraphqlServerTime')return res({data:{currentServerTime:{serverTime:'2026-10-16T12:00:00+09:00'}}});
      const key=body.query.match(/\{ (\w+): /)?.[1];assert.ok(key);const result=await options.orders?.({key,body,calls})??[];if(result instanceof Response)return result;
      const elements=Array.isArray(result)?result:result.elements;const total=Array.isArray(result)?elements.length:result.total;
      return res({data:{[key]:{elements,pagination:{page:body.variables.paging_page,size:500,totalElements:total,totalPages:Math.ceil(total/500),...(result.pagination??{})}}}});
    }
    if(u.hostname==='accounts.commerce.naver.com'&&body.operationName==='foreignCaptcha')return res({data:{foreignCaptcha:{isForeignIp:options.foreign??false,ip:'192.0.2.1',captchaKey:null}}});
    if(u.hostname==='accounts.commerce.naver.com'&&body.operationName==='idLogin')return res({data:{login:options.loginResult??{id:'synthetic-naver',showCaptcha:false}}});
    if(u.pathname==='/'||u.pathname==='/api/login')return res('{}');
    throw Error('Unexpected synthetic endpoint');
  }};
  const client=createSmartstoreSessionClient({credentials:{...credentials,...options.credentials},session,resolveHost:false,now:NOW});
  return {client,calls,session};
}
const isNew=body=>body.variables.detailedOrderStatus==='NEW_ORDER';

test('스마트스토어 네이버 로그인은 정상 브라우저 인증을 요청하며 ID를 전송하지 않는다',async()=>{
  const {client,calls}=harness();assert.deepEqual(await client.login(),{ok:false,pending:true,stage:'browser',summary:{message:'네이버 로그인창에서 로그인과 추가 인증을 완료해주세요.'}});assert.equal(calls.length,0);
});
test('센터 로그인 GraphQL은 원본 변수와 Content-Type으로 보내고 서버 상점 ID를 검증한다',async()=>{
  const password='fixture-"-한글-\\-password';const {client,calls}=harness({credentials:{loginType:'center',password}});
  assert.equal((await client.login()).identityId,MERCHANT+':'+CHANNEL);
  const captcha=calls.find(c=>c.body?.operationName==='foreignCaptcha'),login=calls.find(c=>c.body?.operationName==='idLogin');
  assert.equal(captcha.init.headers['Content-Type'],'application/x-www-form-urlencoded');assert.equal(login.init.headers['Content-Type'],'application/json;charset=UTF-8');
  assert.deepEqual(login.body.variables,{id:'synthetic-naver',password,saveId:false,chkLong:false,captchaKey:null,captcha:'',svcUrl:'https://sell.smartstore.naver.com/#/login-callback'});
  assert.equal(calls.find(c=>c.u.pathname==='/api/login').body.url,'https://sell.smartstore.naver.com/#/home/dashboard');
});
test('센터 해외 접속과 CAPTCHA는 정상 브라우저 인증으로 넘기며 반복하지 않는다',async()=>{
  for(const options of [{foreign:true},{loginResult:{showCaptcha:true}}]){
    const {client,calls}=harness({...options,credentials:{loginType:'center',password:'fixture-only'}});assert.equal((await client.login()).stage,'browser');assert.ok(calls.length<=2);
  }
});
test('인증 헤더와 서버 로그인 ID가 다르면 상점 ID를 반환하지 않는다',async()=>{
  const mismatch=harness({initHeaders:()=>({'X-NCP-LOGIN-INFO':'{}',user:`another-account:role:${CHANNEL}`})});await assert.rejects(mismatch.client.verifyIdentity(),e=>e.code==='ACCOUNT_MISMATCH');
  const expired=harness({initHeaders:()=>({})});await assert.rejects(expired.client.verifyIdentity(),e=>e.code==='SESSION_REQUIRED');
});
test('선택한 스토어의 merchantNo와 channelNo를 결합하여 고유번호를 고정한다',async()=>{
  const {client}=harness({credentials:{identityId:MERCHANT+':'+CHANNEL}});assert.deepEqual(await client.verifyIdentity(),{ok:true,identityId:MERCHANT+':'+CHANNEL,identityLabel:'합성 스토어'});
  assert.equal(client.getSessionState().sessionData.merchantNo,MERCHANT);
  await assert.rejects(harness({credentials:{identityId:'123:456'}}).client.verifyIdentity(),e=>e.code==='ACCOUNT_MISMATCH');
});
test('다중 스토어는 이름을 요구하고 선택한 스토어로 서버 전환한 후 확인한다',async()=>{
  const channels=[{channelNo:'123',roleNo:'1',channelName:'다른 합성 스토어'},{channelNo:'124',roleNo:'2',channelName:'선택 합성 스토어'}];
  await assert.rejects(harness({channels,current:'123'}).client.verifyIdentity(),e=>e.code==='STORE_REQUIRED');
  const {client,calls}=harness({channels,current:'123',credentials:{storeName:'선택 합성 스토어'}});const result=await client.verifyIdentity();assert.equal(result.identityId,MERCHANT+':124');
  const change=calls.find(c=>c.u.pathname==='/api/login/change-channel');assert.equal(change.u.searchParams.get('channelNo'),'124');assert.deepEqual(change.body,{roleNo:2,channelNo:124,url:'https://sell.smartstore.naver.com/#/home/dashboard'});
});
test('다중 스토어 전환 응답에서 타 도메인 redirect 또는 바뀌지 않은 채널을 거부한다',async()=>{
  const channels=[{channelNo:'123',roleNo:1,channelName:'합성 스토어'},{channelNo:'124',roleNo:2,channelName:'다른 합성 스토어'}];
  const {client,calls}=harness({channels,current:'124',credentials:{storeName:'합성 스토어'},request({u}){if(u.pathname==='/api/login/change-channel')return res({}, {'X-NCP-LOGIN-INFO':encodeURIComponent(JSON.stringify({redirectUrl:'https://example.com/steal'}))});}});
  await assert.rejects(client.verifyIdentity());assert.ok(calls.every(c=>c.u.hostname.endsWith('.naver.com')));
});
test('merchantNo가 없거나 여러 개이면 로그인 성공으로 표시하지 않는다',async()=>{
  for(const html of ['<html>로그인 페이지</html>','{"merchantNo":"1","other":{"merchantNo":"2"}}'])await assert.rejects(harness({html}).client.verifyIdentity(),e=>e.code==='IDENTITY_REQUIRED');
});
test('GraphQL 오류 또는 notification 인증 오류를 빈 정상 결과로 취급하지 않는다',async()=>{
  const {client}=harness({request({body}){if(body?.operationName==='getGraphqlServerTime')return res({data:null,errors:[{message:'fixture-only'}]});}});await assert.rejects(client.verifyIdentity(),e=>e.code==='QUERY_ERROR');
  await assert.rejects(harness({notification:{code:'GW.AUTHN'}}).client.verifyIdentity(),e=>e.code==='QUERY_ERROR');
});
test('전체 21개 주문·클레임 프로필을 조회하고 숫자 주문번호·우편번호를 보존한다',async()=>{
  const {client,calls}=harness({orders({body}){return isNew(body)?[row()]:[];}});const result=await client.collectOrders(RANGE);
  assert.equal(result.complete,true);assert.equal(result.orders.length,1);const order=result.orders[0];assert.equal(order.orderNo,ORDER);assert.equal(order.lineId,LINE);assert.equal(order.postcode,'01234');assert.equal(order.quantity,2);assert.equal(order.unitPrice,1200);assert.equal(order.amount,2400);assert.equal(order.sku,'001-SKU');assert.equal(order.sourceIds.productPayAmt,2300);assert.equal(order.sourceIds.fulfillableQty,2);
  const queries=calls.filter(c=>c.body?.variables?.paging_page);assert.equal(queries.length,21);assert.equal(result.summary.readOnly,true);
  assert.ok(queries.every(c=>c.init.method==='POST'&&c.init.headers['Content-Type']==='application/json'));
  assert.equal(queries[0].body.variables.dateRange_from,String(Date.parse('2026-10-15T00:00:00+09:00')));
});
test('숫자로 도착한 18자리 주문번호를 lossless JSON으로 읽는다',async()=>{
  const {client}=harness({orders({body,key}){if(!isNew(body))return [];const r=JSON.stringify(row()).replace('"'+ORDER+'"',ORDER).replace('"'+LINE+'"',LINE);return res(`{"data":{"${key}":{"elements":[${r}],"pagination":{"page":1,"size":500,"totalElements":1,"totalPages":1}}}}`);}});
  const {orders}=await client.collectOrders(RANGE);assert.equal(orders[0].orderNo,ORDER);assert.equal(orders[0].lineId,LINE);
});
test('500개를 넘는 품목은 모든 페이지를 수집한다',async()=>{
  const {client,calls}=harness({orders({body}){if(!isNew(body))return [];const page=body.variables.paging_page;return {total:501,elements:Array.from({length:page===1?500:1},(_,i)=>row({productOrderNo:String(10000+(page-1)*500+i)}))};}});
  const result=await client.collectOrders(RANGE);assert.equal(result.orders.length,501);assert.equal(calls.filter(c=>c.body&&isNew(c.body)).length,2);
});
test('총계 변경·중복 페이지·짧은 중간 페이지는 부분 결과를 반환하지 않는다',async()=>{
  const cases=[({body})=>({total:body.variables.paging_page===1?501:502,elements:Array.from({length:body.variables.paging_page===1?500:2},(_,i)=>row({productOrderNo:String(10000+i)}))}),({body})=>({total:501,elements:Array.from({length:body.variables.paging_page===1?500:1},(_,i)=>row({productOrderNo:String(10000+i)}))}),()=>({total:501,elements:[row()]})];
  for(const fn of cases){const {client}=harness({orders(x){return isNew(x.body)?fn(x):[];}});await assert.rejects(client.collectOrders(RANGE));}
});
test('활성 취소·반품·교환은 기존 신규 주문보다 우선하며 발송 가능 수량을 막는다',async()=>{
  for(const claimStatus of ['CANCEL_REQUEST','RETURN_REQUEST','EXCHANGE_REQUEST']){
    const {client}=harness({orders({body}){return isNew(body)||body.variables.claimStatus===claimStatus?[row({claimStatus})]:[];}});const {orders}=await client.collectOrders(RANGE);assert.equal(orders.length,1);assert.equal(orders[0].sourceIds.fulfillableQty,0);assert.ok(['취소요청','반품요청','교환요청'].includes(orders[0].claimType));
  }
});
test('클레임 철회는 활성 신규 주문을 덮어쓰지 않고 단독이면 보류한다',async()=>{
  const {client}=harness({orders({body}){return isNew(body)||body.variables.claimStatus==='CANCEL_REJECT'?[row({claimStatus:'CANCEL_REJECT'})]:[];}});const {orders}=await client.collectOrders(RANGE);assert.equal(orders[0].status,'신규');assert.equal(orders[0].sourceIds.fulfillableQty,2);
  const only=harness({orders({body}){return body.variables.claimStatus==='CANCEL_REJECT'?[row({claimStatus:'CANCEL_REJECT'})]:[];}});const withdrawn=(await only.client.collectOrders(RANGE)).orders[0];assert.equal(withdrawn.sourceIds.fulfillableQty,0);assert.equal(withdrawn.sourceIds.needsReview,true);
});
test('부분 클레임 또는 배송지 누락은 발송 가능 수량을 만들지 않는다',async()=>{
  for(const change of [{quantityClaimYn:'Y'},{receiverZipCode:''},{receiverTelNo1:''},{receiverTelNo1:'010-****-1234'},{receiverName:'김●●'},{receiverDisplayBaseAddress:'개인정보 보호'},{productOrderStatus:'FUTURE_UNKNOWN_STATUS'},{productOrderStatus:'PAYMENT_WAITING'}]){const {client}=harness({orders({body}){return isNew(body)?[row(change)]:[];}});const {orders}=await client.collectOrders(RANGE);assert.equal(orders[0].sourceIds.fulfillableQty,0);assert.equal(orders[0].sourceIds.needsReview,true);}
});
test('클레임은 조회 종료일 이후 접수도 오늘까지 확인하되 주문일 범위를 지킨다',async()=>{
  const {client,calls}=harness({orders({body}){return body.variables.claimStatus==='RETURN_REQUEST'?[row({payDateTime:'2026-10-15T09:00:00+09:00',orderDateTime:'2026-10-15T09:00:00+09:00'})]:[];}});
  assert.equal((await client.collectOrders({from:'2026-10-15',to:'2026-10-15'})).orders.length,1);
  const claim=calls.find(c=>c.body?.variables?.claimStatus==='RETURN_REQUEST');assert.equal(claim.body.variables.dateRange_to,String(Date.parse('2026-10-17T00:00:00+09:00')-1));
});
test('수집 도중 다른 merchantNo가 확인되면 전체 결과를 반환하지 않는다',async()=>{
  let pages=0;const {client}=harness({request({u}){if(u.pathname==='/o/v3/n/sale/delivery')return res(`{"merchantNo":"${++pages===1?MERCHANT:'123'}"}`);}});await assert.rejects(client.collectOrders(RANGE),e=>e.code==='ACCOUNT_MISMATCH');
});
test('최근 2년 밖·역전·미래 기간을 네트워크 요청 전에 거부한다',async()=>{
  for(const range of [{from:'2024-01-01',to:'2024-01-02'},{from:'2026-10-16',to:'2026-10-15'},{from:'2026-10-16',to:'2026-10-17'}]){const {client,calls}=harness();await assert.rejects(client.collectOrders(range),e=>e.code==='INVALID_RANGE');assert.equal(calls.length,0);}
});
test('실패 응답·네트워크 오류의 원문 인증값은 공개 오류로 되돌리지 않는다',async()=>{
  const {client}=harness({request(){throw Error('fixture-password-and-cookie-secret');}});await assert.rejects(client.verifyIdentity(),e=>!e.message.includes('fixture-password')&&e.code==='NETWORK_ERROR');
});
test('원본 PAY_COMPLETED 기간은 결제일로 적용하고 실제 주문 생성일을 보존한다',async()=>{
  const {client}=harness({orders({body}){return isNew(body)?[row({orderDateTime:'2026-10-14T09:00:00+09:00'})]:[];}});const {orders}=await client.collectOrders(RANGE);assert.equal(orders.length,1);assert.equal(orders[0].orderedAt,'2026-10-14');assert.equal(orders[0].sourceIds.paidAt,'2026-10-16');
});
test('모든 수집 프로필이 기존 주문 저장소의 상태·금액·품목 계약을 만족한다',async()=>{
  for(const target of ['NEW_ORDER','PLACE_ORDER','PLACE_ORDER_RELEASE','DELIVERING','DELIVERED','closed','CANCEL_REQUEST','CANCEL_DONE','CANCEL_REJECT','RETURN_REQUEST','RETURN_DONE','RETURN_REJECT','EXCHANGE_REQUEST','EXCHANGE_DONE','EXCHANGE_REJECT']){
    const {client}=harness({orders({body}){const v=body.variables;return v.detailedOrderStatus===target||v.orderStatus===target||v.claimStatus===target||target==='closed'&&body.operationName.includes('PurchaseDecision')?[row()]:[];}});
    const {orders}=await client.collectOrders(RANGE);assert.equal(orders.length,1);assert.doesNotThrow(()=>normalizeOrder(orders[0],{},{remote:true}));
  }
});
