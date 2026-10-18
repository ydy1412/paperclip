import test from 'node:test';
import assert from 'node:assert/strict';
import {ZipWriter,Uint8ArrayWriter,TextReader} from '@zip.js/zip.js';
import {createCafe24SessionClient,Cafe24SessionError} from '../src/integrations/cafe24-session.mjs';
import {normalizeOrder} from '../src/store.mjs';

const host='https://fixture.cafe24.com',identityId='fixture.cafe24.com/shop2';
const credentials={sellerId:'fixture',password:'SYNTHETIC-only &+한글',shopNo:'2',account:'합성 상점'};
const label='테스트 상점';
const categories=['주문관리 > 상품준비중 관리 > 주문번호별','주문관리 > 마켓발주 관리','주문관리 > 배송준비중 관리 > 주문번호별','주문관리 > 배송대기 관리 > 주문번호별','주문관리 > 배송중 관리 > 주문번호별','주문관리 > 배송완료 조회 > 주문번호별','주문관리 > 취소/교환/반품/환불 관리 > 취소 관리 > 전체','주문관리 > 취소/교환/반품/환불 관리 > 반품 관리 > 전체','주문관리 > 취소/교환/반품/환불 관리 > 교환 관리 > 전체'];
const fields=['품목번호','주문번호','품목별 주문번호','주문 상태','주문상품명','수량','판매가','옵션추가 가격','발주일','수령인','수령인 휴대전화','수령인 우편번호','수령인 주소(전체)','상품옵션','자체 상품코드','운송장번호'];
const row=['000000000000000001','202610160000000001','202610160000000001-01','상품준비중','합성 상품','2','10,000','500.00','2026-10-16 09:00:00','테스트 수령인','010-0000-0000','00123','합성 주소','파랑','SKU-1','000000000000000099'];
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const response=(text,status=200,headers={})=>new Response(text,{status,headers});
function csv(rows=[row],header=fields){return [header,...rows].map(r=>r.map(s=>'"'+String(s).replaceAll('"','""')+'"').join(',')).join('\r\n');}
async function zipped(text,password='',other={}){const writer=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});await writer.add(other.name||'order.csv',new TextReader(text),{password:password||undefined,zipCrypto:other.zipCrypto||false,useWebWorkers:false});return writer.close();}
function popup(index=-1,{encrypted=false,processing=false,id,extra='',shop=label,category}={}){return `<script>var sTokenKey = "csrfKey";</script><input name="csrfKey" value="synthetic-token"><input name="sUseExcelConfigZipPassword" value="${encrypted?'T':'F'}"><table>${index<0?'':`<tr><td>${escape(shop)}</td><td>${escape(category||categories[index])}</td><td>2026-10-16</td><td></td><td></td><td></td><td>${processing?'생성중':id?`<a data-idx="${id}">완료되었습니다.</a>`:'추출 대상 없음'}</td></tr>`}${extra}</table>`;}
function fixture(options={}){
  let active=-1,queued=0,polls=0,verified=0,currentPassword='';const calls=[];
  const session={getSessionCookies:()=>JSON.stringify([{name:'GMCC',value:'synthetic',domain:'fixture.cafe24.com',path:'/',secure:true,hostOnly:true}]),cancel(){},async request(address,init={}){
    const u=new URL(address);calls.push({address,init});
    if(u.pathname.includes('multishopList')){verified++;return response(options.identityHtml??`<a data-shop_no="2">${label}</a>`);}
    if(u.hostname==='eclogin.cafe24.com')return response(options.firstLogin??JSON.stringify({sEncData:'server-enc-data',sEncKey:'server-enc-key',SECOND_CHECK:'F'}));
    if(u.hostname==='user.cafe24.com')return response(options.comLogin??`<script>location.href="${host}/disp/admin/shop2/main/dashboard"</script>`);
    if(u.pathname.endsWith('/main/dashboard'))return response('<main>관리자</main>');
    if(u.pathname.endsWith('/ExcelCreateDownloadPopup.php')){
      if(active<0)return response(options.beforePopup??popup(-1,{encrypted:options.encrypted}));polls++;
      if(options.processing||polls<=options.processingCount)return response(popup(active,{encrypted:options.encrypted,processing:true}));
      const hasRows=(options.rows?.[active]??(active===0?[row]:[])).length>0;
      const page=popup(active,{encrypted:options.encrypted,id:hasRows?String(active+1):'',shop:options.exportShop||label});
      return response(options.mutatePopup?options.mutatePopup(page,active,polls):page);
    }
    if(u.pathname.endsWith('/ExcelAjaxQueueA.php')){const b=new URLSearchParams(init.body);active=queued++;polls=0;currentPassword=b.get('set_password');if(options.failQueue===active)return response('{"passed":false}');return response(options.queueResponse??'{"passed":true}');}
    if(u.pathname.endsWith('/ExcelAjaxDownload.php')){
      if(options.failDownload===active)return response('failure',500);
      if(options.downloadResponse)return options.downloadResponse(active);
      const bytes=await zipped(csv(options.rows?.[active]??[row],options.header||fields),options.encrypted?currentPassword:'',{zipCrypto:options.zipCrypto});
      return response(bytes,200,{'Content-Type':'application/zip'});
    }
    throw Error('Unexpected fixture URL '+address);
  }};
  return {client:createCafe24SessionClient({credentials:{...credentials,...options.credentials},session,waitImpl:async()=>{}}),session,calls,counts:()=>({queued,verified})};
}
test('Cafe24 normal HTTP sends original ID/password and server encryption values without bypass fields',async()=>{
  const f=fixture();const result=await f.client.login();assert.equal(result.ok,true);assert.equal(result.identityId,identityId);assert.equal(result.identityLabel,label);
  const first=new URLSearchParams(f.calls[0].init.body),second=new URLSearchParams(f.calls[1].init.body);
  assert.equal(first.get('loginPasswd'),credentials.password);assert.equal(first.get('loginId'),'fixture');assert.equal(second.get('url'),'Run');assert.equal(second.get('EncData'),'server-enc-data');assert.equal(second.get('EncKey'),'server-enc-key');assert.equal(second.get('loginPasswd'),credentials.password);
  for(const b of [first,second])for(const k of ['use_second_auth','second_auth_method','second_check'])assert.equal(b.has(k),false);
  assert.deepEqual(JSON.parse(f.client.getSessionState().sessionData),{host,shopNo:'2'});
});
test('Cafe24 required second authentication stops normal HTTP and asks for user browser authentication',async()=>{
  for(const firstLogin of [JSON.stringify({sEncData:'a',sEncKey:'b',SECOND_CHECK:'T'}),'<h1>보안접속</h1>','<form><input name="mall_id"></form>']){
    const f=fixture({firstLogin});assert.equal((await f.client.login()).stage,'browser');assert.equal(f.calls.length,1);
  }
});
test('Cafe24 password-change/security form never triggers force-skip endpoints',async()=>{
  const f=fixture({comLogin:'비밀번호 변경 <input name="userpasswd">'});assert.equal((await f.client.login()).pending,true);assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>!c.address.includes('comForceSkip')));
});
test('Cafe24 authenticated shop binding uses actual host and server shop membership, not configured ID',async()=>{
  const f=fixture({credentials:{identityId:'other.cafe24.com/shop2'}});await assert.rejects(f.client.verifyIdentity(),{code:'IDENTITY_MISMATCH'});
  for(const identityHtml of ['<input name="mall_id">','<main>로그인 성공</main>','<a data-shop_no="1">다른 상점</a>','<a data-shop_no="2">A</a><a data-shop_no="2">B</a>'])await assert.rejects(fixture({identityHtml}).client.verifyIdentity(),Cafe24SessionError);
});
test('Cafe24 blocks foreign redirects before any credential follow-up',async()=>{
  const f=fixture({comLogin:'<script>location.href="https://evil.example/admin"</script>'});await assert.rejects(f.client.login(),{code:'INVALID_REDIRECT'});assert.equal(f.calls.length,2);
});
test('Cafe24 orders cover nine source status exports, preserve IDs/postcodes and map price plus option',async()=>{
  const f=fixture();const result=await f.client.collectOrders({from:'2026-10-16',to:'2026-10-16'});assert.equal(result.complete,true);assert.equal(result.orders.length,1);assert.deepEqual(f.counts(),{queued:9,verified:2});const o=result.orders[0];assert.equal(o.orderNo,row[2]);assert.equal(o.lineId,row[0]);assert.equal(o.postcode,'00123');assert.equal(o.tracking,row.at(-1));assert.equal(o.unitPrice,10500);assert.equal(o.amount,21000);assert.equal(o.sourceIds.fulfillableQty,2);assert.equal(o.sourceIds.identityId,identityId);
  const queue=f.calls.filter(c=>c.address.endsWith('ExcelAjaxQueueA.php'));assert.deepEqual(queue.map(c=>new URLSearchParams(c.init.body).get('location')),['product_prepare_list_ord_num','openmarket_order_list','shipped_begin_list','shipped_standby_list_ord_num','shipped_end_list','shipped_complete_list_ord_num','order_cancel','order_returns','order_change']);
  const q=new URLSearchParams(queue[6].init.body),rt=new URLSearchParams(decodeURIComponent(q.get('request_type')));assert.equal(rt.get('orderStatus[]'),'all');assert.equal(rt.get('searchPage'),'order_cancel');assert.equal(rt.get('shop_no_order'),'2');assert.match(decodeURIComponent(q.get('select_column')),/sSaveColumn=item_code,/);
});
test('Cafe24 encrypted AES and legacy ZipCrypto CSV exports use per-job random password',async()=>{
  const passwords=[];for(const zipCrypto of [false,true]){const f=fixture({encrypted:true,zipCrypto});const result=await f.client.collectOrders({from:'2026-10-16',to:'2026-10-16'});assert.equal(result.orders.length,1);const queue=f.calls.find(c=>c.address.endsWith('ExcelAjaxQueueA.php')),download=f.calls.find(c=>c.address.endsWith('ExcelAjaxDownload.php'));const password=new URLSearchParams(queue.init.body).get('set_password');assert.ok(password.length>20);assert.equal(new URLSearchParams(download.init.body).get('sPassword'),password);assert.equal(new URLSearchParams(download.init.body).get('reason_for_download'),'주문관리');passwords.push(password);}assert.notEqual(passwords[0],passwords[1]);
});
test('Cafe24 later active/completed claims override earlier fulfillment candidates',async()=>{
  for(const i of [6,7,8]){const f=fixture({rows:{[i]:[[...row.slice(0,3),'완료',...row.slice(4)]]}});const result=await f.client.collectOrders({from:'2026-10-16',to:'2026-10-16'});assert.equal(result.orders.length,1);assert.equal(result.orders[0].sourceIds.fulfillableQty,0);assert.equal(result.orders[0].claimType,['취소요청','반품요청','교환요청'][i-6]);}
});
test('Cafe24 missing destination and unpaid orders cannot be fulfilled',async()=>{
  const r=[...row];r[10]='';const f=fixture({rows:{0:[r]}});const o=(await f.client.collectOrders({from:'2026-10-16',to:'2026-10-16'})).orders[0];assert.equal(o.sourceIds.needsReview,true);assert.equal(o.sourceIds.fulfillableQty,0);
  const unpaid=[...row];unpaid[3]='입금전 취소';const o2=(await fixture({rows:{0:[unpaid]}}).client.collectOrders({from:'2026-10-16',to:'2026-10-16'})).orders[0];assert.equal(o2.sourceIds.fulfillableQty,0);assert.equal(o2.status,'취소');assert.equal(o2.claimType,'취소요청');assert.equal(normalizeOrder(o2,{}, {remote:true}).sourceStatus,'입금전 취소');
});
test('Cafe24 later export failure rejects the whole result without returning earlier orders',async()=>{
  for(const options of [{failQueue:8},{rows:{8:[row]},failDownload:8}])await assert.rejects(fixture(options).client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),Cafe24SessionError);
});
test('Cafe24 unexpected dates, duplicate header, missing critical columns and malformed quantities reject whole result',async()=>{
  const changed=(index,value)=>{const r=[...row];r[index]=value;return r;};
  for(const options of [{rows:{0:[changed(8,'2026-02-30')]}},{rows:{0:[changed(5,'2.5')]}},{rows:{0:[changed(0,'')]}},{header:fields.map((h,i)=>i===0?'주문번호':h)},{header:fields.map((h,i)=>i===0?'알수없음':h)}])await assert.rejects(fixture(options).client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),Cafe24SessionError);
});
test('Cafe24 exporter never reuses an old completed file or another shop file',async()=>{
  const stale=popup(0,{id:'1'});const f=fixture({beforePopup:stale,mutatePopup:()=>stale});
  // Repeated rows lacking a matching new server identifier must time out, not become empty success.
  await assert.rejects(f.client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),{code:'EXPORT_TIMEOUT'});
  const other=fixture({exportShop:'다른 상점'});await assert.rejects(other.client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),{code:'EXPORT_TIMEOUT'});
});
test('Cafe24 simultaneous matching export rows fail as ambiguous',async()=>{
  const f=fixture({mutatePopup:(page,i)=>i===0?page.replace('</table>',popup(0,{id:'999'}).match(/<tr>[\s\S]*<\/tr>/)[0]+'</table>'):page});await assert.rejects(f.client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),{code:'EXPORT_AMBIGUOUS'});
});
test('Cafe24 incomplete export polling fails and cancellation blocks new calls',async()=>{
  const f=fixture({processing:true});await assert.rejects(f.client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),{code:'EXPORT_TIMEOUT'});const f2=fixture();f2.client.cancel();await assert.rejects(f2.client.verifyIdentity(),{code:'CANCELLED'});assert.equal(f2.calls.length,0);
});
test('Cafe24 ZIP non-CSV/traversal/corrupt and HTML download responses fail safely',async()=>{
  for(const downloadResponse of [async()=>response(await zipped(csv(),' ',{name:'../order.csv'})),async()=>response(await zipped(csv(),'',{name:'order.exe'})),async()=>response(new Uint8Array([0x50,0x4b,0,0])),()=>response('<html>로그인</html>')])await assert.rejects(fixture({downloadResponse}).client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),Cafe24SessionError);
});
test('Cafe24 date/host/credential inputs fail before transport',async()=>{
  for(const changed of [{sellerId:'../../bad'},{shopNo:'0'},{host:'http://fixture.cafe24.com'},{host:'https://cafe24.com.evil.example'},{host:'https://fixture.cafe24.com:444'},{host:'https://user:pass@fixture.cafe24.com'}])assert.throws(()=>fixture({credentials:changed}),Cafe24SessionError);
  const f=fixture();for(const dates of [{from:'2026-02-30',to:'2026-10-16'},{from:'2026-10-17',to:'2026-10-16'},{from:'2026-01-01',to:'2026-10-16'}])await assert.rejects(f.client.collectOrders(dates),{code:'INVALID_DATE'});assert.equal(f.calls.length,0);
});
test('Cafe24 normal login works through shared cookie transport and restores encrypted session metadata',async()=>{
  const f=fixture();const client=createCafe24SessionClient({credentials,resolveHost:false,fetchImpl:async(address,init)=>{
    const result=await f.session.request(address,init);if(new URL(address).hostname==='eclogin.cafe24.com')result.headers.set('Set-Cookie','GMCC=synthetic-transport; Domain=.cafe24.com; Path=/; Secure; HttpOnly');
    if(address.includes('multishopList'))assert.match(init.headers.Cookie,/GMCC=synthetic-transport/);return result;
  }});assert.equal((await client.login()).identityId,identityId);const state=client.getSessionState();assert.match(state.cookies,/synthetic-transport/);
  const restored=createCafe24SessionClient({credentials:{...credentials,sessionData:JSON.parse(state.sessionData)},session:f.session});assert.equal((await restored.verifyIdentity()).identityId,identityId);
  const bareHost=createCafe24SessionClient({credentials:{...credentials,host:'fixture.cafe24.com'},session:f.session});assert.equal((await bareHost.verifyIdentity()).identityId,identityId);
});
test('Cafe24 transport/session/body failures use bounded messages and preserve expired-session classification',async()=>{
  for(const code of ['SESSION_REQUIRED','CANCELLED','UNEXPECTED']){const session={request:async()=>{const e=new Error('SYNTHETIC-SECRET-reflected');e.code=code;throw e;},getSessionCookies:()=> '[]'};const c=createCafe24SessionClient({credentials,session});await assert.rejects(c.verifyIdentity(),e=>e instanceof Cafe24SessionError&&!e.message.includes('SYNTHETIC-SECRET')&&e.code===(code==='UNEXPECTED'?'NETWORK_ERROR':code));}
});
test('Cafe24 decompression enforces limits even when a ZIP header lies about expanded size',async()=>{
  const bytes=new Uint8Array(await zipped('a'.repeat(20*1024*1024+1)));const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let i=0;i<bytes.length-46;i++){if(view.getUint32(i,true)===0x02014b50)view.setUint32(i+24,1,true);if(view.getUint32(i,true)===0x04034b50)view.setUint32(i+22,1,true);}
  await assert.rejects(fixture({downloadResponse:()=>response(bytes)}).client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),Cafe24SessionError);
});
test('Cafe24 payment-date selection preserves an earlier valid original order date',async()=>{
  const r=[...row];r[8]='2026-10-01 09:00:00';const result=await fixture({rows:{0:[r]}}).client.collectOrders({from:'2026-10-16',to:'2026-10-16'});assert.equal(result.orders[0].orderedAt,'2026-10-01');assert.ok(result.notes.some(n=>n.includes('결제일 기준')));
});
test('Cafe24 unpaid and all claim states use valid store statuses while keeping fulfillment blocked',async()=>{
  for(const [index,expectedStatus,expectedClaim]of [[0,'신규','없음'],[6,'취소','취소요청'],[7,'취소','반품요청'],[8,'발송대기','교환요청']]){const r=[...row];r[3]=index===0?'입금전':'처리완료';const result=await fixture({rows:{0:[],[index]:[r]}}).client.collectOrders({from:'2026-10-16',to:'2026-10-16'}),o=result.orders[0];assert.equal(o.status,expectedStatus);assert.equal(o.claimType,expectedClaim);assert.equal(o.sourceIds.fulfillableQty,0);assert.equal(o.sourceIds.needsReview,true);assert.equal(normalizeOrder(o,{}, {remote:true}).status,expectedStatus);}
});
test('Cafe24 masked/private or malformed destination never enables fulfillment',async()=>{
  for(const [index,value]of [[9,'수**'],[10,'010-****-0000'],[10,'010XXXX0000'],[10,'123'],[11,'00＊23'],[12,'개인정보 보호'],[12,'조회불가'],[9,'정보없음']]){const r=[...row];r[index]=value;const result=await fixture({rows:{0:[r]}}).client.collectOrders({from:'2026-10-16',to:'2026-10-16'});assert.equal(result.orders[0].sourceIds.fulfillableQty,0);assert.equal(result.orders[0].sourceIds.needsReview,true);}
});
