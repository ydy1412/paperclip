import test from 'node:test';import assert from 'node:assert/strict';
import {createSellerHubClient} from '../src/integrations/market-sessions/sellerhub.mjs';
const headers=['주문번호','주문아이템번호','상품번호','상품명','수량','상품가격','쇼핑몰판매가','등록판매가','주문일자','주문상태','옵션1','옵션2','상품코드','주문자명','받는분이름','받는분핸드폰','받는분전화번호','우편번호','주소','배송메세지','택배사코드','송장번호'];
const source=(rows=[])=>'<html><table><tr>'+headers.map(v=>'<th>'+v+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+headers.map(k=>'<td>'+(r[k]??'')+'</td>').join('')+'</tr>').join('')+'</table></html>';
const row=(extra={})=>({'주문번호':'900719925474099312','주문아이템번호':'900719925474099313','상품번호':'SE901','상품명':'합성 상품','수량':'2','상품가격':'10,000','쇼핑몰판매가':'11,000','등록판매가':'12,000','주문일자':'2026-10-01 10:00:00','주문상태':'신규주문','옵션1':'검정','상품코드':'SKU-01','받는분이름':'합성 수령인','받는분핸드폰':'010-0000-0000','우편번호':'00123','주소':'합성 주소','송장번호':'가송장 입력시 건당 3000원',...extra});
function harness(handler,{credentials={}}={}){const calls=[],session={request:async(url,opts)=>{const u=new URL(url);calls.push({url:u,opts});if(u.pathname.endsWith('chk.cafe24.php'))return new Response('true');if(u.pathname.endsWith('list_v2.php'))return new Response('<html><script>client_id = "900719925474099399";</script></html>');return handler(u,opts);},getSessionCookies:()=>'[]'};return {calls,client:createSellerHubClient({credentials:{sellerId:'synthetic-seller',password:'synthetic-password',...credentials},session})};}
test('SellerHub exact login form and server client ID are checked',async()=>{
 const {client,calls}=harness((u,o)=>{assert.equal(u.pathname,'/shop/member/login_ok.php');const q=new URLSearchParams(o.body);assert.equal(q.get('m_id'),'synthetic-seller');assert.equal(q.get('password'),'synthetic-password');assert.equal(q.getAll('returnUrl').length,2);return new Response('<html>ok</html>');});const result=await client.login();assert.equal(result.identityId,'900719925474099399');assert.equal(result.identitySource,'server');assert.equal(calls.length,3);
});
test('SellerHub all normal and claim types export separately with large ID preservation',async()=>{
 const {client,calls}=harness(u=>new Response(source(u.searchParams.get('step[]')==='1'?[row()]:[]),{headers:{'Content-Type':'application/vnd.ms-excel; charset=UTF-8'}}));const {orders}=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'}).then(result=>(assert.equal(result.complete,true),result));
 assert.equal(orders.length,1);assert.equal(orders[0].orderNo,'900719925474099312');assert.equal(orders[0].lineId,'900719925474099313');assert.equal(orders[0].unitPrice,12000);assert.equal(orders[0].amount,24000);assert.equal(orders[0].postcode,'00123');assert.equal(orders[0].tracking,'');assert.equal(calls.filter(c=>c.url.pathname.endsWith('dnXls_excel.php')).length,8);
});
test('SellerHub claims replace normal status and block fulfillment',async()=>{
 const {client}=harness(u=>new Response(source(u.searchParams.get('step[]')==='1'||u.searchParams.get('step2[]')==='2'?[row()]:[])));const {orders}=await client.collectOrders({from:'2026-10-01',to:'2026-10-02'}).then(result=>(assert.equal(result.complete,true),result));assert.equal(orders[0].status,'취소');assert.equal(orders[0].claimType,'취소요청');assert.equal(orders[0].sourceIds.fulfillableQty,0);
});
test('SellerHub mismatched client ID rejects without importing orders',async()=>{const {client}=harness(()=>new Response(''),{credentials:{identityId:'different'}});await assert.rejects(client.collectOrders({from:'2026-10-01',to:'2026-10-02'}),e=>e.code==='IDENTITY_MISMATCH');});
test('SellerHub missing required sheet fields or dates outside query fail full collection',async()=>{
 for(const body of ['<html>download failed</html>',source([row({'주문일자':'2026-09-01'})])]){const {client}=harness(()=>new Response(body));await assert.rejects(client.collectOrders({from:'2026-10-01',to:'2026-10-02'}),e=>e.code==='INVALID_RESPONSE');}
});
