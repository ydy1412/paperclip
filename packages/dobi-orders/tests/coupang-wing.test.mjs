import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {createCoupangWingClient} from '../src/integrations/coupang-wing.mjs';

const NOW=()=>new Date('2026-10-16T03:00:00Z'),RANGE={from:'2026-10-15',to:'2026-10-16'};
const ORDER='184467440737095511',BOX='184467440737095512',ITEM='184467440737095513';
const credentials={sellerId:'synthetic-wing',account:'합성 계정',cookies:'[]'};
const headers=['주문번호','묶음배송번호','옵션ID','구매수(수량)','결제액','주문일','배송완료일','구매확정일자','노출상품명(옵션명)','업체상품코드','구매자','수취인이름','수취인전화번호','우편번호','수취인 주소','배송메세지','택배사','운송장번호','바코드'];
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function column(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
async function workbook(rows=[],{formula=false,numericIds=false}={}){
  const zip=new JSZip();
  zip.file('xl/workbook.xml','<workbook><sheets><sheet name="합성" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  const matrix=[headers,...rows.map(row=>headers.map(h=>row[h]??''))];
  zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData>'+matrix.map((row,r)=>'<row r="'+(r+1)+'">'+row.map((value,c)=>`<c r="${column(c)}${r+1}"${numericIds&&r&&c<3?'':' t="inlineStr"'}>${formula&&r&&c===4?'<f>1+1</f>':''}${numericIds&&r&&c<3?`<v>${xml(value)}</v>`:`<is><t>${xml(value)}</t></is>`}</c>`).join('')+'</row>').join('')+'</sheetData></worksheet>');
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
function excel(overrides={}){return {'주문번호':ORDER,'묶음배송번호':BOX,'옵션ID':ITEM,'구매수(수량)':'2','결제액':'10,000','주문일':'2026-10-16 09:01:00','배송완료일':'','구매확정일자':'','노출상품명(옵션명)':'합성 상품 (파랑, 2개)','업체상품코드':'SKU-01','구매자':'합성 구매자','수취인이름':'합성 수취인','수취인전화번호':'01000000000','우편번호':'01234','수취인 주소':'테스트 주소','배송메세지':'문 앞','택배사':'합성택배','운송장번호':'000123456789','바코드':'001234',...overrides};}
function detail(overrides={}){return {orderId:ORDER,createdAt:'2026-10-16 09:01:00',receiverName:'합성 수취인',safeNumber:'05000000000',postCode:'01234',addr1:'테스트 주소',addr2:'상세',message:'문 앞',shipmentBoxes:[{shipmentBoxId:BOX,deliveryStatusName:'결제완료',deliverName:'',invoiceNumber:'',items:[{vendorItemId:ITEM,vendorItemName:'<b>합성 상품</b>, 파랑, 2개',quantity:2,cancelCount:0,price:10000,productId:'1234'}]}],...overrides};}
const response=value=>new Response(typeof value==='string'?value:JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
function harness(options={}){
  const calls=[],jobs=new Map();let jobNo=0,identityCalls=0;
  const session={
    async verifyIdentity(){identityCalls++;return options.identity?.(identityCalls)??{ok:true,sellerId:credentials.sellerId,vendorId:'A12345'};},
    getSessionCookies(){return '[{"name":"synthetic"}]';},
    async request(url,init={}){
      const u=new URL(url),body=init.body?(init.headers?.['Content-Type']?.startsWith('application/json')?JSON.parse(init.body):Object.fromEntries(new URLSearchParams(init.body))):undefined;
      calls.push({url:u,init,body});
      if(options.request){const custom=await options.request({u,init,body,calls});if(custom!==undefined)return custom;}
      if(/\/(stop-shipment|return-delivery|exchange)\/search$/.test(u.pathname))return response(options.claims?.({u,body,calls})??{content:[]});
      if(u.pathname.endsWith('/delivery/management/dashboard/search'))return response(options.dashboard?.({condition:u.searchParams.get('condition'),calls})??[]);
      if(/\/order\/detail\/\d+\/order$/.test(u.pathname))return response(options.detail?.(u.pathname.split('/').at(-2))??detail());
      if(u.pathname.endsWith('/request-auto-download')){assert.equal(init.method,'POST');assert.equal(body.type,'WING_DELIVERY');const predicate=JSON.parse(body.predicate),key=String(++jobNo);jobs.set(key,predicate.deliveryStatus);return response(options.ack?.(predicate)??{requestedDownloadId:key});}
      if(u.pathname.endsWith('/check-downloadable'))return response(options.state?.(jobs.get(u.searchParams.get('requestId')))??{status:'SUCCESS',downloadIds:['part1']});
      if(u.pathname.includes('/download-manager/download/')){const parts=u.pathname.split('/'),code=jobs.get(parts.at(-2)),bytes=await(options.file?.(code,parts.at(-1))??workbook(options.rows?.(code)??[]));return new Response(bytes,{status:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});}
      throw new Error('Unexpected mock path');
    },
  };
  const client=createCoupangWingClient({credentials,now:NOW,resolveHost:false,session});
  return {client,calls,session,get identityCalls(){return identityCalls;}};
}
function firstNew(){let page=0;return ()=>++page===1?`[{"orderId":${ORDER},"shipmentBoxId":${BOX},"memberName":"합성 구매자","safeNumberDto":{"safeNumber":"050--0000--0000"}}]`:[];}

test('Wing 신규 cursor의 숫자 원문과 18자리 품목 ID·연락처·단가를 보존합니다',async()=>{
  const h=harness({dashboard:firstNew(),detail:()=>JSON.stringify(detail()).replace(`"${ORDER}"`,ORDER).replace(`"${BOX}"`,BOX).replace(`"${ITEM}"`,ITEM)});
  const result=await h.client.collectOrders(RANGE);assert.equal(result.complete,true);assert.equal(result.orders.length,1);
  const o=result.orders[0];assert.equal(o.orderNo,ORDER);assert.equal(o.lineId,BOX+':'+ITEM);assert.equal(o.product,'합성 상품');assert.equal(o.option,'파랑, 2개');assert.equal(o.quantity,2);assert.equal(o.unitPrice,5000);assert.equal(o.amount,10000);assert.equal(o.phone,'050-0000-0000');assert.equal(o.postcode,'01234');assert.equal(o.sourceIds.fulfillableQty,2);
  const pages=h.calls.filter(c=>c.url.pathname.endsWith('dashboard/search'));assert.match(pages[1].url.searchParams.get('condition'),new RegExp('"nextShipmentBoxId":'+BOX+','));assert.equal(JSON.parse(pages[0].url.searchParams.get('condition')).endDate,'2026-10-17');assert.equal(h.identityCalls,2);assert.equal(h.client.getSessionCookies(),'[{"name":"synthetic"}]');
});
test('XLSX 숫자 셀의 긴 ID를 원문으로 읽고 모든 downloadIds를 수집합니다',async()=>{
  const h=harness({state:code=>({status:'SUCCESS',downloadIds:code==='INSTRUCT'?['part1','part2']:['part1']}),file:async(code,part)=>workbook(code==='INSTRUCT'?[excel(part==='part2'?{'옵션ID':'184467440737095514'}:{})]:[],{numericIds:true})});
  const {orders}=await h.client.collectOrders(RANGE);assert.equal(orders.length,2);assert.deepEqual(orders.map(o=>o.orderNo),[ORDER,ORDER]);assert.equal(orders[1].lineId,BOX+':184467440737095514');assert.equal(orders[0].postcode,'01234');assert.equal(orders[0].tracking,'000123456789');assert.equal(orders[0].sku,'SKU-01');
  const exportCall=h.calls.find(c=>c.url.pathname.endsWith('request-auto-download'));assert.equal(JSON.parse(exportCall.body.predicate).vendorId,'A12345');
});
test('표준 XLSX의 sharedStrings·날짜 셀과 문자 ID를 읽습니다',async()=>{
  const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('합성');sheet.addRow(headers);const row=excel({'주문일':new Date('2026-10-16T00:00:00Z')});sheet.addRow(headers.map(h=>row[h]??''));sheet.getCell('F2').numFmt='yyyy-mm-dd';const bytes=Buffer.from(await wb.xlsx.writeBuffer());
  const h=harness({file:code=>code==='INSTRUCT'?bytes:workbook()});const {orders}=await h.client.collectOrders(RANGE);assert.equal(orders[0].orderedAt,'2026-10-16');assert.equal(orders[0].sourceIds.vendorItemId,ITEM);assert.equal(orders[0].postcode,'01234');
});
test('공유 세션을 통과해도 export는 form, 클레임은 JSON·CSRF 헤더를 유지합니다',async()=>{
  const h=harness();const cookies=JSON.stringify([{name:'XSRF-TOKEN',value:'synthetic-xsrf',domain:'wing.coupang.com',path:'/',hostOnly:true,secure:true}]);
  const client=createCoupangWingClient({credentials:{...credentials,cookies,vendorId:'A12345'},now:NOW,resolveHost:false,fetchImpl:async(url,init)=>{
    const path=new URL(url).pathname;assert.match(init.headers.Cookie,/XSRF-TOKEN=synthetic-xsrf/);
    if(path.includes('/winglayout/bell/'))return response({code:'OK'});
    if(path==='/tenants/sfl-portal/delivery/management')return response("<html><script>var data={vendorId: 'A12345'};</script></html>");
    if(init.method==='POST'){assert.equal(init.headers['X-XSRF-TOKEN'],'synthetic-xsrf');assert.match(init.headers['Content-Type'],path.endsWith('request-auto-download')?/^application\/x-www-form-urlencoded/:/^application\/json/);}
    return h.session.request(url,init);
  }});
  assert.equal((await client.collectOrders(RANGE)).complete,true);
});
test('배송완료일·구매확정일로 직접배송과 완료·구매확정을 구분합니다',async()=>{
  const h=harness({rows:code=>code==='FINAL_DELIVERY'?[excel({'배송완료일':'2026-10-16'}),excel({'옵션ID':'12345','배송완료일':'2026-10-16','구매확정일자':'2026-10-16'})]:code==='NONE_TRACKING'?[excel({'옵션ID':'12346','배송완료일':'2026-10-16'})]:[]});
  const {orders}=await h.client.collectOrders(RANGE);assert.deepEqual(orders.map(o=>o.status),['배송완료','배송완료','구매확정']);assert.ok(orders.every(o=>o.sourceIds.fulfillableQty===0));
});
test('클레임 조회의 page 기준·상태 코드를 따르며 부분 취소 주문을 발송 차단합니다',async()=>{
  let served=false;const raw=detail();raw.shipmentBoxes[0].items[0].cancelCount=1;
  const h=harness({dashboard:firstNew(),detail:()=>raw,rows:code=>code==='INSTRUCT'?[excel()]:[],claims:({u,body})=>{if(u.pathname.includes('stop-shipment')&&body.shipmentStopSearchType==='SHIPMENT_STOP_REQUEST'&&!served){served=true;assert.equal(body.pagePredicate.currentPage,0);return {content:[{orderId:ORDER}]} ;}return {content:[]};}});
  const {orders}=await h.client.collectOrders(RANGE);assert.equal(orders[0].quantity,1);assert.equal(orders[0].unitPrice,5000);assert.equal(orders[0].amount,10000);assert.equal(orders[0].claimType,'취소요청');assert.equal(orders[0].sourceIds.fulfillableQty,0);assert.equal(orders[0].sourceIds.canceledQty,1);
  const exchange=h.calls.find(c=>c.url.pathname.includes('/exchange/search'));assert.equal(exchange.body.page,1);assert.equal(exchange.body.exchangeStatusType,'RECEIPT');
});
test('기존 신규 목록에 없는 전체 취소 주문도 정상 발송 가능한 주문으로 만들지 않습니다',async()=>{
  let served=false;const raw=detail();raw.shipmentBoxes[0].items[0].cancelCount=2;
  const h=harness({detail:()=>raw,claims:({body})=>body.shipmentStopSearchType==='SHIPMENT_STOP_COMPLETE'&&!served?(served=true,{content:[{orderId:ORDER}]}):{content:[]}});
  const {orders}=await h.client.collectOrders(RANGE);assert.equal(orders[0].status,'취소');assert.equal(orders[0].quantity,2);assert.equal(orders[0].sourceIds.fulfillableQty,0);
});
test('선택 종료일 다음 날의 조회 결과를 로컬 주문일 필터에서 제외합니다',async()=>{
  const h=harness({rows:code=>code==='INSTRUCT'?[excel({'주문일':'2026-10-17 00:00:00'})]:[]});assert.equal((await h.client.collectOrders(RANGE)).orders.length,0);
});
test('새 주문 뒤 엑셀 생성 실패가 있으면 부분 결과를 반환하지 않습니다',async()=>{
  const h=harness({dashboard:firstNew(),state:code=>code==='DELIVERING'?{status:'FAILED',downloadIds:[]}:{status:'SUCCESS',downloadIds:['part1']}});
  await assert.rejects(h.client.collectOrders(RANGE),{code:'EXPORT_FAILED'});assert.ok(h.calls.some(c=>c.url.pathname.includes('/order/detail/')));
});
test('시작 시 계정 불일치는 주문 요청 전에 차단하고 종료 시 계정 변경도 거부합니다',async()=>{
  const start=harness({identity:()=>({ok:true,sellerId:'other',vendorId:'A12345'})});await assert.rejects(start.client.collectOrders(RANGE),{code:'ACCOUNT_MISMATCH'});assert.equal(start.calls.length,0);
  const end=harness({identity:n=>({ok:true,sellerId:credentials.sellerId,vendorId:n===1?'A12345':'A54321'})});await assert.rejects(end.client.collectOrders(RANGE),{code:'ACCOUNT_MISMATCH'});
});
test('반복된 신규 커서·클레임 페이지·분할 Excel 품목을 성공으로 처리하지 않습니다',async()=>{
  const repeated=harness({dashboard:()=>[{orderId:ORDER,shipmentBoxId:BOX}]});await assert.rejects(repeated.client.collectOrders(RANGE),{code:'REPEATED_PAGE'});
  const claims=harness({claims:({body})=>body.refundStatus==='REQUEST'?{content:[{orderId:ORDER}]}:{content:[]}});await assert.rejects(claims.client.collectOrders(RANGE),{code:'REPEATED_PAGE'});
  const files=harness({state:code=>({status:'SUCCESS',downloadIds:code==='INSTRUCT'?['one','two']:['one']}),rows:code=>code==='INSTRUCT'?[excel()]:[]});await assert.rejects(files.client.collectOrders(RANGE),{code:'REPEATED_PAGE'});
});
test('HTTP 실패·로그인 HTML·스키마 누락은 빈 정상 결과가 아닙니다',async()=>{
  for(const responseFactory of [()=>new Response('unavailable',{status:503}),()=>response('<html>login</html>'),()=>response({rows:[]})]){
    const h=harness({request:({u})=>u.pathname.includes('stop-shipment')?responseFactory():undefined});await assert.rejects(h.client.collectOrders(RANGE));
  }
});
test('비어 있는 마지막 클레임 페이지도 보고된 전체 수와 다르면 실패합니다',async()=>{
  const h=harness({claims:()=>({content:[],totalElements:1})});await assert.rejects(h.client.collectOrders(RANGE),{code:'INCOMPLETE'});
});
test('엑셀 완료를 확인하지 못하거나 request ID가 경로 형식에 어긋나면 실패합니다',async()=>{
  const pending=harness({state:()=>({status:'PROCESSING',downloadIds:[]})});await assert.rejects(pending.client.collectOrders(RANGE),{code:'INCOMPLETE'});
  const invalid=harness({ack:()=>({requestedDownloadId:'../private'})});await assert.rejects(invalid.client.collectOrders(RANGE),{code:'INVALID_RESPONSE'});
});
test('수량·상품명·주문일 누락, 숫자 형식이 손상된 ID, 수식 XLSX를 거부합니다',async()=>{
  for(const row of [excel({'구매수(수량)':''}),excel({'노출상품명(옵션명)':''}),excel({'주문일':''}),excel({'주문번호':'1.844674407370955e17'})]){
    const h=harness({rows:code=>code==='INSTRUCT'?[row]:[]});await assert.rejects(h.client.collectOrders(RANGE),{code:'INVALID_RESPONSE'});
  }
  const formula=harness({file:code=>workbook(code==='INSTRUCT'?[excel()]:[],{formula:true})});await assert.rejects(formula.client.collectOrders(RANGE),{code:'INVALID_RESPONSE'});
});
test('10,000품목 상한과 겹친 동일 계정 수집을 차단합니다',async()=>{
  const limited=harness({file:code=>workbook(code==='INSTRUCT'?Array.from({length:10001},(_,i)=>excel({'옵션ID':String(i+1)})):[])});await assert.rejects(limited.client.collectOrders(RANGE),{code:'LIMIT_EXCEEDED'});
  const h=harness(),first=h.client.collectOrders(RANGE);await assert.rejects(h.client.collectOrders(RANGE),{code:'BUSY'});await first;
});
test('잘못된 날짜·오래된 날짜·빈 로그인 ID를 요청 없이 거부합니다',async()=>{
  for(const range of [{from:'2026-02-30',to:'2026-10-16'},{from:'2024-01-01',to:'2026-10-16'},{from:'2026-10-17',to:'2026-10-18'}]){const h=harness();await assert.rejects(h.client.collectOrders(range),{code:'INVALID_DATE'});assert.equal(h.calls.length,0);}
  assert.throws(()=>createCoupangWingClient({credentials:{sellerId:''},session:{}}),{code:'CREDENTIALS_REQUIRED'});
});
test('수신자 정보가 빠진 주문은 발송 가능한 정상 주문으로 표시하지 않습니다',async()=>{
  const h=harness({dashboard:firstNew(),detail:()=>detail({receiverName:'',postCode:''})});const {orders}=await h.client.collectOrders(RANGE);assert.equal(orders[0].sourceIds.fulfillableQty,0);assert.equal(orders[0].sourceIds.needsReview,true);
});
test('페이지 상한 도달을 완결로 오인하지 않습니다',async()=>{
  const h=harness({dashboard:({condition})=>{const page=JSON.parse(condition).page;return [{orderId:String(page),shipmentBoxId:String(page)}];}});await assert.rejects(h.client.collectOrders(RANGE),{code:'INCOMPLETE'});assert.equal(h.calls.filter(c=>c.url.pathname.includes('/order/detail/')).length,0);
});
