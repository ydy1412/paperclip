import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlwayzClient} from '../src/integrations/market-sessions/alwayz.mjs';
const response=o=>new Response(JSON.stringify(o));
const row=(id='large-order-900719925474099312',extra={})=>({_id:id,status:'pre-shipping-pre-excel',isTeamDeal:true,payedAt:'2026-10-01T00:00:00.000Z',createdAt:'2026-09-30T15:00:00.000Z',quantity:2,itemInfo:{itemId:'900719925474099313',itemTitle:'합성 상품',teamPurchasePrice:12000,individualPurchasePrice:15000,optionsInfo:{optionNames:['색상'],totalOptions:[[{name:'검정'}]]}},selectedOption:{0:0,optionCode:'SKU-01',teamPurchasePrice:10000},addressInfo:{recipient:'합성 수령인',recipientPhoneNumber:'010-0000-0000',postcode:'00123',postcodeAddress:'합성 도로',detailAddress:'합성 주소',frontDoorPassword:'합성 메모'},shippingInfo:{shippingNumber:'000012345678901234',shippingCompanyCode:'CJ'},...extra});
function harness(handler,{credentials={}}={}){const calls=[],session={request:async(url,opts)=>{calls.push({url,opts});return handler(new URL(url),opts,calls);},getSessionCookies:()=>'[]'};return {calls,client:createAlwayzClient({credentials:{sellerId:'synthetic-seller',password:'synthetic-password',sessionData:JSON.stringify({token:'synthetic-token'}),...credentials},session})};}
test('Alwayz reproduces JSON credential login and declares credential identity source',async()=>{
 const {client,calls}=harness((url,opts)=>url.pathname==='/sellers/login'?(assert.deepEqual(JSON.parse(opts.body),{sellerName:'synthetic-seller',password:'synthetic-password'}),response({status:200,data:{success:true,token:'new-synthetic-token'}})):response({status:200}));
 const result=await client.login();assert.equal(result.identitySource,'credential-login');assert.equal(result.identityId,'login:synthetic-seller');assert.ok(result.identityLabel.includes('사용자 확인'));assert.equal(calls[1].opts.headers['x-access-token'],'new-synthetic-token');
});
test('Alwayz every status bucket paginates by strictly decreasing paid timestamp',async()=>{
 const first=row(),second=row('second',{payedAt:'2026-09-30T23:00:00.000Z'});let pages=0;
 const {client,calls}=harness((url,opts)=>url.pathname==='/sellers'?response({status:200}):url.pathname.endsWith('status-recent')?response({status:2000,data:[{status:first.status,topKOrders:[first]}]}):(pages++,assert.equal(url.pathname,'/sellers/orders/status/pre-excel/info-request'),assert.equal(JSON.parse(opts.body).status,'pre-shipping'),response({status:2000,data:pages===1?[second]:[]})));
 const {orders}=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'}).then(result=>(assert.equal(result.complete,true),result));assert.equal(orders.length,2);assert.equal(orders[0].amount,20000);assert.equal(orders[0].orderedAt,'2026-10-01');assert.equal(orders[0].postcode,'00123');assert.equal(orders[0].tracking,'000012345678901234');assert.match(orders[0].option,/검정/);assert.equal(calls.filter(c=>new URL(c.url).pathname==='/sellers').length,2);
});
test('Alwayz cancellation and refund buckets block fulfillment including completed claims',async()=>{
 const {client}=harness(url=>url.pathname==='/sellers'?response({status:200}):url.pathname.endsWith('status-recent')?response({status:2000,data:[{status:'refunded',topKOrders:[row('refund',{status:'refunded'})]},{status:'canceled-shipping',topKOrders:[row('cancel',{status:'canceled-shipping'})]}]}):response({status:2000,data:[]}));
 const {orders}=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'}).then(result=>(assert.equal(result.complete,true),result));assert.equal(orders.length,2);assert.equal(orders[0].claimType,'반품요청');assert.equal(orders[1].claimType,'취소요청');assert.ok(orders.every(o=>o.sourceIds.fulfillableQty===0));
});
test('Alwayz cursor repetition, unknown status and malformed data reject full collection',async()=>{
 for(const mode of ['repeat','unknown','malformed']){
  const {client}=harness(url=>url.pathname==='/sellers'?response({status:200}):url.pathname.endsWith('status-recent')?response({status:2000,data:mode==='malformed'?{}:[{status:mode==='unknown'?'new-unsupported-status':'pre-shipping-pre-excel',topKOrders:[row()]}]}):response({status:2000,data:[row()]}));
  await assert.rejects(client.collectOrders({from:'2026-10-01',to:'2026-10-02'}),e=>e.code==='INVALID_RESPONSE');
 }
});
test('Alwayz explicit no-orders code still requires valid authentication before and after',async()=>{
 let checks=0;const {client}=harness(url=>url.pathname==='/sellers'?response({status:++checks===2?401:200}):response({status:4010}));await assert.rejects(client.collectOrders({from:'2026-10-01',to:'2026-10-02'}),e=>e.code==='SESSION_REQUIRED');assert.equal(checks,2);
});
test('Alwayz authenticated no-orders response explicitly marks complete collection',async()=>{
 const {client}=harness(url=>response(url.pathname==='/sellers'?{status:200}:{status:4010}));const result=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'});assert.equal(result.complete,true);assert.deepEqual(result.orders,[]);
});
test('Alwayz server error and missing token cannot become authenticated empty result',async()=>{
 const bad=harness(()=>response({status:401,data:{success:false},msg:'synthetic-password secret'}));await assert.rejects(bad.client.login(),e=>e.code==='LOGIN_FAILED'&&!e.message.includes('secret'));
 const absent=harness(()=>response({status:200}),{credentials:{sessionData:undefined}});await assert.rejects(absent.client.verifyIdentity(),e=>e.code==='SESSION_REQUIRED');
});
test('Alwayz saved session metadata is recoverable without making token public',async()=>{
 const {client}=harness(()=>response({status:200}));assert.equal(JSON.parse(client.getSessionState().sessionData).token,'synthetic-token');const result=await client.testConnection();assert.equal(result.serverAuthenticated,true);assert.equal(result.identitySource,'user-confirmation');
});
