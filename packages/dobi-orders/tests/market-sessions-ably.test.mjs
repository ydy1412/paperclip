import test from 'node:test';
import assert from 'node:assert/strict';
import {createAblyClient} from '../src/integrations/market-sessions/ably.mjs';
const SELLER='seller@example.invalid',ID='900719925474099312';
const tokenFor=id=>'e30.'+Buffer.from(JSON.stringify({seller_id:id})).toString('base64url')+'.c2ln';
const cookie='[{"name":"session","value":"synthetic","domain":"a-bly.com","path":"/"}]';
const response=o=>new Response(JSON.stringify(o),{headers:{'Content-Type':'application/json'}});
function harness(handler,{credentials={}}={}){
 const calls=[],session={request:async(url,opts)=>{calls.push({url,opts});return handler(new URL(url),opts,calls);},getSessionCookies:()=>cookie,cancel(){}};
 const client=createAblyClient({credentials:{sellerId:SELLER,password:'synthetic-password',sessionData:JSON.stringify({token:tokenFor(ID)}),...credentials},session,now:()=>new Date('2026-10-16T00:00:00Z')});return {client,calls};
}
const row=(sno='900719925474099314',extra={})=>({sno,order_sno:'900719925474099313',goods_sno:'900719925474099315',goods_name:'합성 상품',goods_custom_code:'SKU-01',option_info:'검정',ea:2,price:19999,buyer_name:'합성 구매자',receiver_name:'합성 수령인',receiver_tel:'010-0000-0000',receiver_postcode:'00123',receiver_addr:'합성 주소',memo:'합성 메모',delivery:{name:'합성 택배'},invoice:'001234567890123456',ordered_at:'2026-10-01 10:00:00',checked_at:'2026-10-01 10:10:00',status:'신규주문',...extra});
const meta=()=>response({sno:ID,email:SELLER});
function empty(url){
 if(url.pathname.endsWith('/meta/'))return meta();
 if(url.pathname==='/seller/order_items/')return response({order_items:[],window_max_page_number:0,has_more_window:false});
 if(url.pathname==='/seller/order_cancels/')return response({order_cancels:[],max_page_number:0});
 if(url.pathname==='/seller/exchanges/')return response({exchanges:[],max_page_number:0});
 throw Error('unexpected synthetic URL '+url.pathname);
}
test('ABLY login sends JSON credentials and verifies JWT-selected server sno and exact email',async()=>{
 const {client,calls}=harness((url,opts)=>url.pathname==='/seller/login/'?(assert.deepEqual(JSON.parse(opts.body),{email:SELLER,password:'synthetic-password'}),response({access_token:tokenFor(ID)})):meta(),{credentials:{sessionData:undefined}});
 const result=await client.login();assert.equal(result.identityId,ID);assert.equal(result.identitySource,'server');assert.equal(calls[1].opts.headers.Authorization,'JWT '+tokenFor(ID));assert.equal(client.getSessionState().cookies,cookie);assert.equal(JSON.parse(client.getSessionState().sessionData).token,tokenFor(ID));
});
test('ABLY token payload is not accepted as account verification',async()=>{
 for(const badMeta of [{sno:'99',email:SELLER},{sno:ID,email:'other@example.invalid'}]){
  const {client}=harness(()=>response(badMeta));await assert.rejects(client.verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
 }
});
test('ABLY bound seller number cannot silently change on relogin',async()=>{
 const {client}=harness(()=>meta(),{credentials:{identityId:'another-seller'}});await assert.rejects(client.verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
});
test('ABLY reads every order page, each status and claims, preserving large and leading-zero IDs',async()=>{
 const {client,calls}=harness(url=>{
  if(url.pathname==='/seller/order_items/'&&url.searchParams.get('processing_status[]')==='1'){
   const page=Number(url.searchParams.get('page'));return response({order_items:[{sno:page===1?'900719925474099314':'900719925474099316'}],window_max_page_number:2,has_more_window:false});
  }
  if(/^\/seller\/order_items\/\d+\/$/.test(url.pathname))return response({order_item:row(url.pathname.split('/')[3])});return empty(url);
 });
 const {orders}=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'}).then(result=>(assert.equal(result.complete,true),result));assert.equal(orders.length,2);assert.equal(orders[0].lineId,'900719925474099314');assert.equal(orders[0].orderNo,'900719925474099313');assert.equal(orders[0].postcode,'00123');assert.equal(orders[0].tracking,'001234567890123456');assert.equal(orders[0].unitPrice,9999);assert.equal(orders[0].amount,19999);
 assert.equal(new Set(calls.filter(c=>new URL(c.url).pathname==='/seller/order_items/').map(c=>new URL(c.url).searchParams.get('processing_status[]'))).size,5);
 assert.equal(calls.filter(c=>new URL(c.url).pathname==='/seller/order_cancels/').length,6);assert.equal(calls.filter(c=>new URL(c.url).pathname==='/seller/exchanges/').length,6);
});
test('ABLY a later claim overrides a normal row and blocks fulfillment',async()=>{
 const sno='900719925474099314';const {client,calls}=harness(url=>{
  if(url.pathname==='/seller/order_items/'&&url.searchParams.get('processing_status[]')==='1')return response({order_items:[{sno}],window_max_page_number:1,has_more_window:false});
  if(url.pathname==='/seller/order_items/'+sno+'/')return response({order_item:row(sno)});
  if(url.pathname==='/seller/order_cancels/'&&url.searchParams.get('cancel_type')==='cancel'&&url.searchParams.getAll('processing_sub_status[]').includes('44'))return response({order_cancels:[{order_items:[{sno}]}],max_page_number:1});return empty(url);
 });
 const {orders}=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'}).then(result=>(assert.equal(result.complete,true),result));assert.equal(orders.length,1);assert.equal(orders[0].claimType,'취소요청');assert.equal(orders[0].status,'취소');assert.equal(orders[0].sourceIds.fulfillableQty,0);
 assert.equal(new URL(calls.find(c=>new URL(c.url).pathname==='/seller/order_cancels/').url).searchParams.get('end_date'),'2026-10-16');
});
test('ABLY unknown detail status is retained for review without fulfillment',async()=>{
 const {client}=harness(url=>url.pathname==='/seller/order_items/'&&url.searchParams.get('processing_status[]')==='1'?response({order_items:[{sno:'20'}],window_max_page_number:1,has_more_window:false}):url.pathname==='/seller/order_items/20/'?response({order_item:row('20',{status:'새로운 상태'})}):empty(url));
 const {orders}=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'}).then(result=>(assert.equal(result.complete,true),result));assert.equal(orders[0].sourceIds.fulfillableQty,0);assert.equal(orders[0].sourceIds.needsReview,true);
});
test('ABLY failed or incomplete pages reject the whole collection',async()=>{
 const {client}=harness(url=>url.pathname==='/seller/order_items/'?response({order_items:[],window_max_page_number:2,has_more_window:false}):empty(url));await assert.rejects(client.collectOrders({from:'2026-10-01',to:'2026-10-02'}),e=>e.code==='INVALID_RESPONSE');
});
test('ABLY conventional empty first page may report window page one while explicitly complete',async()=>{
 const {client}=harness(url=>url.pathname==='/seller/order_items/'?response({order_items:[],window_max_page_number:1,has_more_window:false}):empty(url));const result=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'});assert.equal(result.complete,true);assert.deepEqual(result.orders,[]);
});
test('ABLY details must match requested item ID and preserve numeric JSON precision',async()=>{
 const {client}=harness(url=>url.pathname==='/seller/order_items/'?response({order_items:[{sno:'20'}],window_max_page_number:1,has_more_window:false}):url.pathname==='/seller/order_items/20/'?response({order_item:row('21')}):empty(url));await assert.rejects(client.collectOrders({from:'2026-10-01',to:'2026-10-02'}),e=>e.code==='INVALID_RESPONSE');
});
test('ABLY missing token and HTML login responses never become successful empty collections',async()=>{
 const missing=harness(()=>meta(),{credentials:{sessionData:undefined}});await assert.rejects(missing.client.verifyIdentity(),e=>e.code==='SESSION_REQUIRED');
 const {client}=harness(()=>new Response('<form><input type="password"></form>'));await assert.rejects(client.collectOrders({from:'2026-10-01',to:'2026-10-02'}),e=>e.code==='SESSION_REQUIRED');
});
test('ABLY network failures redact low-level errors and authentication failures can open native login',async()=>{
 const {client}=harness(()=>{throw Error('synthetic-password RAW-RESPONSE');});await assert.rejects(client.verifyIdentity(),e=>!e.message.includes('RAW-RESPONSE')&&!e.message.includes('synthetic-password'));
 const auth=harness(()=>response({code:1,message:'private server message'}));const result=await auth.client.login();assert.equal(result.stage,'browser');assert.ok(!JSON.stringify(result).includes('private server message'));
});
