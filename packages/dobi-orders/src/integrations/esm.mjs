import {parse as parseLossless} from 'lossless-json';
import he from 'he';
import {publicHttpsFetch} from './recipe.mjs';

// Reconstructed from the shipped ESM_V2 read paths, not a published ESM API.
// Sources: shopmine-esm-analysis.md; esm-orders-disasm.json, esm-login-disasm.json,
// esm-model-helpers.json and esm-http-selected-cil-supplemental.json (2026-10-14).
// Only a user's already authenticated session and fixed read-only GET paths are used.
const WWW='https://www.esmplus.com',POST='https://post-tx.esmplus.com';
const PAGE_SIZE=500,MAX_PAGES=100,MAX_ORDERS=10000,MAX_COOKIE_CHARS=30000,DAY=86400000;
const COOKIE_NAME=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const COOKIE_VALUE=/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;
const CONTROL=/[\x00-\x1f\x7f]/;
const STATUS_MAP={'신규주문':'신규','신규':'신규','발송대기':'발송대기','배송중':'배송중','배송완료':'배송완료','구매확정':'구매확정','취소':'취소'};
export class EsmError extends Error {
  constructor(message,code='ESM_ERROR',status=400){super(message);this.name='EsmError';this.code=code;this.status=status;}
}
const fail=(message,code='INVALID_RESPONSE',status=502)=>{throw new EsmError(message,code,status);};
const expired=()=>fail('ESM 로그인 세션이 만료되었거나 조회 권한이 없습니다. 브라우저에서 다시 로그인해 연결해주세요.','SESSION_REQUIRED',401);
function instant(now){const value=typeof now==='function'?now():now??new Date();const n=new Date(value).getTime();if(!Number.isFinite(n))fail('현재 시각을 확인할 수 없습니다.','INVALID_CLOCK',400);return n;}
const kstDate=now=>new Date(instant(now)+9*3600000).toISOString().slice(0,10);
function domainName(domain){
  if(typeof domain!=='string')fail('ESM 쿠키 도메인 형식을 확인해주세요.','INVALID_COOKIES',400);
  const d=domain.toLowerCase().replace(/^\./,'');
  if(d.length>253||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*esmplus\.com$/.test(d))fail('ESM 도메인의 쿠키만 연결할 수 있습니다.','INVALID_COOKIES',400);
  return d;
}
function canonicalCookie(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('ESM 쿠키 형식을 확인해주세요.','INVALID_COOKIES',400);
  if(Object.hasOwn(input,'partitionKey')||input.partitioned===true||input.partitionKeyOpaque===true)fail('분할 저장된 쿠키는 이 연결에서 지원하지 않습니다.','INVALID_COOKIES',400);
  const {name,value,path='/',hostOnly,secure}=input,d=domainName(input.domain);
  if(typeof name!=='string'||!COOKIE_NAME.test(name)||name.length>256||typeof value!=='string'||!COOKIE_VALUE.test(value)||typeof path!=='string'||!path.startsWith('/')||path.length>1024||CONTROL.test(path)||path.includes(';')||typeof hostOnly!=='boolean'||typeof secure!=='boolean'||input.httpOnly!==undefined&&typeof input.httpOnly!=='boolean'||input.session!==undefined&&typeof input.session!=='boolean')fail('ESM 쿠키 이름·값·경로·보안 속성을 확인해주세요.','INVALID_COOKIES',400);
  if(name.startsWith('__Secure-')&&!secure||name.startsWith('__Host-')&&(!secure||!hostOnly||path!=='/'))fail('ESM 쿠키 보안 속성이 올바르지 않습니다.','INVALID_COOKIES',400);
  const c={name,value,domain:hostOnly?d:'.'+d,path,hostOnly,secure,httpOnly:Boolean(input.httpOnly),session:input.expirationDate===undefined};
  if(input.expirationDate!==undefined){if(typeof input.expirationDate!=='number'||!Number.isFinite(input.expirationDate)||input.expirationDate<0)fail('ESM 쿠키 만료일을 확인해주세요.','INVALID_COOKIES',400);c.expirationDate=input.expirationDate;}
  if(input.sameSite!==undefined){if(!['unspecified','no_restriction','lax','strict'].includes(input.sameSite))fail('ESM 쿠키의 SameSite 형식을 확인해주세요.','INVALID_COOKIES',400);c.sameSite=input.sameSite;}
  if(input.storeId!==undefined){if(typeof input.storeId!=='string'||input.storeId.length>50||CONTROL.test(input.storeId))fail('ESM 쿠키 저장소 형식을 확인해주세요.','INVALID_COOKIES',400);c.storeId=input.storeId;}
  return c;
}
function cookieKey(c){return JSON.stringify([domainName(c.domain),c.path,c.name]);}
function cookieMatches(c,url,now){
  if(c.expirationDate!==undefined&&c.expirationDate*1000<=instant(now))return false;
  const domain=domainName(c.domain),host=url.hostname.toLowerCase();
  if(c.hostOnly?host!==domain:host!==domain&&!host.endsWith('.'+domain))return false;
  return (!c.secure||url.protocol==='https:')&&(url.pathname===c.path||url.pathname.startsWith(c.path)&&(c.path.endsWith('/')||url.pathname[c.path.length]==='/'));
}
export function validateEsmCookies(input,now=new Date()){
  let serialized;
  try{serialized=typeof input==='string'?input:JSON.stringify(input);}catch{fail('ESM 쿠키 형식을 확인해주세요.','INVALID_COOKIES',400);}
  if(typeof serialized!=='string'||serialized.length>MAX_COOKIE_CHARS)fail('ESM 쿠키는 30,000자 이하의 JSON 목록이어야 합니다.','INVALID_COOKIES',400);
  let rows;try{rows=JSON.parse(serialized);}catch{fail('ESM 쿠키는 JSON 목록으로 입력해주세요.','INVALID_COOKIES',400);}
  if(!Array.isArray(rows)||!rows.length||rows.length>200)fail('ESM 쿠키 목록을 확인해주세요.','INVALID_COOKIES',400);
  const result=[],keys=new Set(),stores=new Set();
  for(const row of rows){const c=canonicalCookie(row),key=cookieKey(c);if(keys.has(key))fail('같은 ESM 쿠키가 중복되어 있습니다.','INVALID_COOKIES',400);keys.add(key);if(c.storeId!==undefined)stores.add(c.storeId);if(c.expirationDate===undefined||c.expirationDate*1000>instant(now))result.push(c);}
  if(stores.size>1)fail('서로 다른 브라우저 쿠키 저장소는 함께 연결할 수 없습니다.','INVALID_COOKIES',400);
  if(!result.some(c=>c.name==='ESM_AUTH'&&c.value))expired();return result;
}
function createJar(input,now){
  const entries=new Map();let index=0;
  for(const cookie of validateEsmCookies(input,now))entries.set(cookieKey(cookie),{cookie,index:index++});
  function purge(){for(const [key,{cookie:c}]of entries)if(c.expirationDate!==undefined&&c.expirationDate*1000<=instant(now))entries.delete(key);}
  function matched(url){purge();return [...entries.values()].filter(e=>cookieMatches(e.cookie,url,now)).sort((a,b)=>b.cookie.path.length-a.cookie.path.length||a.index-b.index).map(e=>e.cookie);}
  function header(url){const cookies=matched(url);if(!cookies.some(c=>c.name==='ESM_AUTH'&&c.value))expired();return cookies.map(c=>`${c.name}=${c.value}`).join('; ');}
  function apply(line,url){
    if(typeof line!=='string'||line.length>MAX_COOKIE_CHARS||CONTROL.test(line))fail('ESM 응답 쿠키 형식을 확인할 수 없습니다.','INVALID_COOKIES');
    const parts=line.split(';'),pair=parts.shift().trim(),eq=pair.indexOf('=');if(eq<1)fail('ESM 응답 쿠키 형식을 확인할 수 없습니다.','INVALID_COOKIES');
    const c={name:pair.slice(0,eq),value:pair.slice(eq+1),domain:url.hostname,path:url.pathname.lastIndexOf('/')<=0?'/':url.pathname.slice(0,url.pathname.lastIndexOf('/')),hostOnly:true,secure:false,httpOnly:false};
    let maxAge;
    for(const part of parts){const at=part.indexOf('='),key=(at<0?part:part.slice(0,at)).trim().toLowerCase(),val=at<0?'':part.slice(at+1).trim();
      if(key==='domain'){
        let d;try{d=domainName(val);}catch{return;}if(url.hostname!==d&&!url.hostname.endsWith('.'+d))return;c.domain='.'+d;c.hostOnly=false;
      }else if(key==='path'){if(val.startsWith('/'))c.path=val;}
      else if(key==='secure')c.secure=true;
      else if(key==='httponly')c.httpOnly=true;
      else if(key==='partitioned')return;
      else if(key==='max-age'){if(!/^-?\d+$/.test(val))fail('ESM 응답 쿠키 만료 정보를 확인할 수 없습니다.','INVALID_COOKIES');maxAge=Number(val);if(!Number.isSafeInteger(maxAge))fail('ESM 응답 쿠키 만료 정보를 확인할 수 없습니다.','INVALID_COOKIES');}
      else if(key==='expires'){const time=Date.parse(val);if(!Number.isFinite(time))fail('ESM 응답 쿠키 만료 정보를 확인할 수 없습니다.','INVALID_COOKIES');c.expirationDate=Math.max(0,time/1000);}
      else if(key==='samesite'){c.sameSite={none:'no_restriction',lax:'lax',strict:'strict'}[val.toLowerCase()];if(c.sameSite===undefined)delete c.sameSite;}
    }
    if(maxAge!==undefined)c.expirationDate=Math.max(0,instant(now)/1000+maxAge);
    const cookie=canonicalCookie(c),key=cookieKey(cookie),before=entries.get(key);
    if(cookie.expirationDate!==undefined&&cookie.expirationDate*1000<=instant(now)){entries.delete(key);return;}
    if(before?.cookie.storeId)cookie.storeId=before.cookie.storeId;
    entries.set(key,{cookie,index:before?.index??index++});
    if(entries.size>200||JSON.stringify([...entries.values()].map(e=>e.cookie)).length>MAX_COOKIE_CHARS)fail('ESM 응답 쿠키가 저장 한도를 초과했습니다.','INVALID_COOKIES');
  }
  return {header,update(response,url){const headers=response.headers;let lines=headers?.getSetCookie?.();if(!Array.isArray(lines)||!lines.length){const joined=headers?.get?.('set-cookie');lines=joined?joined.split(/,(?=\s*[^;,\s]+=)/):[];}for(const line of lines)apply(line,url);},serialize(){purge();return JSON.stringify([...entries.values()].sort((a,b)=>a.index-b.index).map(e=>e.cookie));}};
}
function rawText(value){if(value===undefined||value===null)return '';if(typeof value!=='string'&&typeof value!=='number')fail('ESM 주문 필드 형식이 변경되었습니다.');return String(value);}
function text(value,max=4000){const raw=rawText(value);if(raw.length>30000||CONTROL.test(raw.replace(/[\t\r\n]/g,'')))fail('ESM 주문 텍스트 형식을 확인할 수 없습니다.');return he.decode(raw.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'')).trim().slice(0,max);}
function numericId(value){if(typeof value==='number'&&!Number.isSafeInteger(value))fail('ESM 주문번호의 숫자 정밀도를 확인할 수 없습니다.');const s=rawText(value).trim();if(!/^\d{1,40}$/.test(s)||/^0+$/.test(s))fail('ESM 주문번호·내부 식별자 형식이 올바르지 않습니다.');return s;}
function number(value,label,{required=true,minimum=0}={}){const s=rawText(value).trim();if(!s&&!required)return 0;if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(s))fail(`ESM ${label} 응답을 확인할 수 없습니다.`);const n=Number(s.replace(/,/g,''));if(!Number.isSafeInteger(n)||n<minimum||n>1e12)fail(`ESM ${label} 응답을 확인할 수 없습니다.`);return n;}
function validDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('조회 날짜는 YYYY-MM-DD로 입력해주세요.','INVALID_DATE',400);const n=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)fail('조회 날짜를 확인해주세요.','INVALID_DATE',400);return n;}
function addDays(day,amount){return new Date(validDay(day)+amount*DAY).toISOString().slice(0,10);}
function firstValue(row,keys){for(const key of keys)if(row[key]!=null&&rawText(row[key])!=='')return row[key];return '';}
function orderDate(row){const raw=rawText(firstValue(row,['payDate','orderDate'])).trim();if(!/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(raw))fail('ESM 주문일이 누락되었거나 형식이 변경되었습니다.');const day=raw.slice(0,10);validDay(day);return day;}
function trackingText(value){const raw=rawText(value),match=raw.match(/<input\b[^>]*\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/i);const n=text(match?match[1]??match[2]:raw,100);if(n==='알수없음'||!n)return '';if(!/^[A-Za-z0-9 -]{3,60}$/.test(n))fail('ESM 송장번호 형식을 확인할 수 없습니다.');return n;}
const meaningful=v=>!['','없음','NONE','NORMAL','0','false'].includes(text(v));
function normalizeRow(row,scope,credentials){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('ESM 주문 목록 형식이 변경되었습니다.');
  const orderNo=numericId(row.siteOrderNo),esmOrderNo=numericId(row.orderNo),siteId=String(credentials.site==='gmarket'?2:1);
  if(row.sellerId!==undefined&&rawText(row.sellerId)!==credentials.sellerId||row.siteId!==undefined&&rawText(row.siteId)!==siteId)fail('설정한 ESM 판매자 계정과 주문 응답이 일치하지 않습니다.','ACCOUNT_MISMATCH');
  const product=text(row.goodsName,400);if(!product)fail('ESM 상품명이 누락되었습니다.');
  const quantity=number(row.orderQty,'수량',{minimum:1});if(quantity>100000)fail('ESM 수량 응답이 너무 큽니다.');
  const unitPrice=number(row.sellPrice,'단가'),amount=number(row.tradeAmnt,'주문금액');
  const gift=text(row.giftStatusType),sourceStatus=scope.key==='new'||scope.key==='waiting'?(gift||scope.sourceStatus):text(firstValue(row,['deliveryStatus','settleStatus','statusName']))||scope.sourceStatus;
  const status=STATUS_MAP[sourceStatus]||scope.status;
  const risk=Boolean(gift)||!STATUS_MAP[sourceStatus]||/(취소|반품|교환|환불|선물|대기승인|CANCEL|RETURN|EXCHANGE|GIFT|CLAIM)/i.test(sourceStatus)||['claimStatus','claimType','cancelStatus'].some(key=>row[key]!=null&&meaningful(row[key]));
  const claimType=/취소|CANCEL/i.test(sourceStatus)?'취소요청':/반품|환불|RETURN/i.test(sourceStatus)?'반품요청':/교환|EXCHANGE/i.test(sourceStatus)?'교환요청':'없음';
  return {channel:credentials.site==='gmarket'?'지마켓':'옥션',account:credentials.account||credentials.sellerId,orderNo,lineId:'',orderedAt:orderDate(row),product,sku:text(firstValue(row,['sellerMngCode','sellerDetailMngCode']),400),option:text(firstValue(row,['selectOptionInfo','selOption']),400),quantity,unitPrice,amount,buyer:text(row.buyerName,400),recipient:text(row.rcverName,400),phone:text(firstValue(row,['rcverInfoCp','rcverInfoHt']),400),postcode:text(row.zipCode,400),address:text(firstValue(row,['rcverInfoRoadNamAd','rcverInfoAd'])),deliveryMemo:text(row.deliveryMemo),tracking:trackingText(row.invoiceNo),carrier:text(firstValue(row,['deliveryCompName','deliveryComp']),400),status,sourceStatus,claimType,sourceIds:{provider:'esm',site:credentials.site,sellerId:credentials.sellerId,siteId,esmOrderNo,cartNo:text(row.cartNo,400),transNo:text(row.transNo,400),deliveryNo:text(credentials.site==='gmarket'?row.cartNo:row.transNo,400),giftStatusType:gift,claimStatus:text(row.claimStatus,400),claimType:text(row.claimType,400),sourceStatus,queryStatus:scope.key,needsReview:risk,fulfillableQty:!risk&&['신규','발송대기'].includes(status)?quantity:0}};
}
const SCOPES=[
  {key:'new',path:'/api/new-order/orders',dateType:'PD',status:'신규',sourceStatus:'신규주문',extra:{statType:'ALL',searchDistrType:'',shopType:'0',singleGoodsYn:'',transDueDateType:'',transType:'',transPolicyNo:'0',orderStatus:''}},
  {key:'waiting',path:'/api/send-processing/orders',dateType:'DCD',status:'발송대기',sourceStatus:'발송대기',extra:{transType:'',orderStatus:'',shippingType:'',packing:'false',receiverChanged:'false'}},
  {key:'shipping1040',path:'/api/shipping-status/orders',dateType:'DCD',status:'배송중',sourceStatus:'배송중',extra:{shippingStatusCode:'1040'}},
  {key:'shipping7010',path:'/api/shipping-status/orders',dateType:'DCD',status:'배송중',sourceStatus:'배송중',extra:{shippingStatusCode:'7010'}},
  {key:'delivered',path:'/api/shipping-status/orders',dateType:'DCD',status:'배송완료',sourceStatus:'배송완료',extra:{shippingStatusCode:'1050'}},
  {key:'confirmed',path:'/api/buy-decision/orders',dateType:'TD',status:'구매확정',sourceStatus:'구매확정',extra:{settleStatus:'',overseaYn:'',globalShopType:''}},
];
function jsonParse(raw){return parseLossless(raw,undefined,s=>{const n=Number(s);return Number.isSafeInteger(n)||!/^[-]?\d+$/.test(s)?n:s;});}
async function responseText(response){
  if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,raw='';try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>12*1024*1024)fail('ESM 응답이 너무 큽니다. 기간을 줄여주세요.','RESULT_LIMIT');raw+=decoder.decode(chunk.value,{stream:true});}return raw+decoder.decode();}finally{await reader.cancel().catch(()=>{});}}
  const raw=await response.text();if(raw.length>12*1024*1024)fail('ESM 응답이 너무 큽니다. 기간을 줄여주세요.','RESULT_LIMIT');return raw;
}
export function createEsmClient({credentials={},fetchImpl=globalThis.fetch,resolveHost=true,now=()=>new Date()}={}){
  if(!['gmarket','auction'].includes(credentials.site))fail('지마켓 또는 옥션을 선택해주세요.','INVALID_CREDENTIALS',400);
  if(typeof credentials.sellerId!=='string'||credentials.sellerId.length<1||credentials.sellerId.length>100||credentials.sellerId!==credentials.sellerId.trim()||CONTROL.test(credentials.sellerId)||/[<>;]/.test(credentials.sellerId))fail('ESM 판매자 ID를 입력해주세요.','INVALID_CREDENTIALS',400);
  credentials={...credentials};const jar=createJar(credentials.cookies,now);let referer=WWW+'/';
  async function request(url){
    const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.esmplus.com','post-tx.esmplus.com'].includes(u.hostname)||u.origin===WWW&&u.pathname!=='/Home/SellerList'||u.origin===POST&&!SCOPES.some(s=>s.path===u.pathname)&&!/^\/api\/order-integration\/orders\/\d{1,40}\/detail$/.test(u.pathname))fail('허용된 ESM 조회 주소가 아닙니다.','INVALID_ENDPOINT',400);
    const options={method:'GET',headers:{Accept:'application/json','Content-Type':'application/json','Accept-Language':'ko-KR,ko;q=0.9',Referer:referer,Cookie:jar.header(u)},redirect:'error',signal:AbortSignal.timeout(30000)};
    let response;try{response=await (resolveHost?publicHttpsFetch:fetchImpl)(u.href,options);}catch{fail('ESM 조회 응답을 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.','NETWORK_ERROR');}
    if(!response||!Number.isInteger(response.status))fail('ESM 응답 형식을 확인할 수 없습니다.');
    if(response.status>=300&&response.status<400||response.redirected)expired();
    jar.update(response,u);
    if(response.status===401||response.status===403)expired();
    if(!response.ok)fail(response.status===429?'ESM 조회 한도에 도달했습니다. 잠시 후 다시 시도해주세요.':'ESM 주문 조회에 실패했습니다.','HTTP_ERROR');
    jar.header(u);const raw=await responseText(response);let data;try{data=jsonParse(raw);}catch{expired();}
    if(!data||typeof data!=='object'||Array.isArray(data))fail('ESM JSON 응답 형식이 변경되었습니다.');
    if(Object.hasOwn(data,'error'))fail('ESM API가 조회 오류를 반환했습니다. 로그인과 조회 권한을 확인해주세요.','API_ERROR');
    referer=u.href;return data;
  }
  async function verifyIdentity(){
    const data=await request(WWW+'/Home/SellerList');
    if(!Array.isArray(data.gmk)||!Array.isArray(data.iac)||[...data.gmk,...data.iac].some(id=>typeof id!=='string'))expired();
    if(!(credentials.site==='gmarket'?data.gmk:data.iac).includes(credentials.sellerId))fail('선택한 ESM 판매자 계정이 로그인 세션과 일치하지 않습니다. 해당 계정으로 다시 연결해주세요.','ACCOUNT_MISMATCH',401);
    return {ok:true};
  }
  async function testConnection(){await verifyIdentity();return {ok:true};}
  async function collectOrders({from,to}={}){
    const a=validDay(from),b=validDay(to),today=kstDate(now);
    if(a>b||to>today||a<validDay(addDays(today,-365)))fail('ESM 조회 기간은 오늘부터 365일 이내에서 순서대로 지정해주세요.','INVALID_DATE',400);
    await verifyIdentity();const all=new Map();
    for(const scope of SCOPES){
      const scopeSeen=new Set(),end=scope.key==='confirmed'?[addDays(to,30),today].sort()[0]:addDays(to,1);
      for(let page=1;page<=MAX_PAGES;page++){
        const query=new URLSearchParams({page:String(page),pageSize:String(PAGE_SIZE),sellerSiteId:credentials.site==='gmarket'?'2':'1',sellerId:credentials.sellerId,searchDateType:scope.dateType,searchSDT:from,searchEDT:end,searchKey:'ON',searchKeyword:'',normal:'false',smile:'false',gift:'false',giftStatusType:'',install:'false',today:'false',firstOrder:'false',tabSiteId:'0',autoInvoiceSend:'false',...scope.extra,_:String(Math.ceil(instant(now)))});
        const data=await request(POST+scope.path+'?'+query);
        if(!data.data||typeof data.data!=='object'||!Array.isArray(data.data.list)||data.data.list.length>PAGE_SIZE)fail('ESM 주문 목록 또는 페이지 크기를 확인할 수 없습니다.');
        for(const row of data.data.list){const order=normalizeRow(row,scope,credentials),key=order.orderNo;if(scopeSeen.has(key))fail('ESM 주문 페이지에 같은 주문이 반복됩니다. 전체 결과를 확인하지 못해 저장하지 않았습니다.','PAGINATION_ERROR');scopeSeen.add(key);
          if(order.orderedAt<from||order.orderedAt>to)continue;
          const before=all.get(key);if(before){if(before.sourceIds.esmOrderNo!==order.sourceIds.esmOrderNo||before.quantity!==order.quantity||before.product!==order.product)fail('ESM 상태별 응답의 같은 주문 정보가 서로 다릅니다. 다시 수집해주세요.','INCONSISTENT_ORDER');const risk=before.sourceIds.needsReview||order.sourceIds.needsReview;order.sourceIds.needsReview=risk;order.sourceIds.fulfillableQty=risk?0:order.sourceIds.fulfillableQty;order.tracking||=before.tracking;order.carrier||=before.carrier;}all.set(key,order);if(all.size>MAX_ORDERS)fail('ESM 주문 수가 조회 한도를 초과했습니다. 기간을 줄여주세요.','RESULT_LIMIT');
        }
        if(data.data.list.length<PAGE_SIZE)break;
        if(page===MAX_PAGES)fail('ESM 마지막 페이지를 확인하지 못했습니다. 조회 기간을 줄여주세요.','PAGINATION_LIMIT');
      }
    }
    for(const order of all.values()){
      const data=await request(POST+'/api/order-integration/orders/'+order.orderNo+'/detail?method=GET');
      if(!data.data||typeof data.data!=='object'||Array.isArray(data.data)||data.data.deliveryTypeCode===undefined||data.data.deliveryTypeCode===null)fail('ESM 주문 상세의 배송유형을 확인하지 못했습니다.','INCOMPLETE_DETAIL');
      const deliveryTypeCode=text(data.data.deliveryTypeCode,400);if(!deliveryTypeCode)fail('ESM 주문 상세의 배송유형이 비어 있습니다.','INCOMPLETE_DETAIL');order.sourceIds.deliveryTypeCode=deliveryTypeCode;
    }
    return {orders:[...all.values()],complete:true,notes:['정상 로그인한 ESM 세션으로 설치본에서 확인한 읽기 계약을 사용했습니다. 현재 서버 호환성과 주문값은 실제 계정에서 별도 확인이 필요합니다.','구매확정은 발송일 검색 범위를 확장한 뒤 요청한 주문일 범위로 걸러냈습니다.','선물·클레임·알 수 없는 상태는 발송 수량을 0으로 표시하여 확인이 필요합니다.']};
  }
  return {testConnection,collectOrders,getSessionCookies:()=>jar.serialize()};
}
