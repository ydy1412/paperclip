import {randomBytes,createHash} from 'node:crypto';
import {parse as parseHtml} from 'parse5';
import {parse as parseCsv} from 'csv-parse/sync';
import {ZipReader,Uint8ArrayReader,Writer} from '@zip.js/zip.js';
import {createSellerSession} from './seller-session.mjs';

// Source: Cafe24 0x0600105b/1067/1069/106e and 0x060004db–4e3.
// The private administrator protocol is reconstructed from static CIL, not a public API.
const MAX_BYTES=20*1024*1024,MAX_ORDERS=10000,DAY=86400000;
const COLUMNS='item_code,place_date,product_name,product_no,payed_amount,opt_str,quantity,r_name,r_zipcode,r_addr,r_phone1,r_phone2,o_message,o_name,member_id,o_phone1,o_phone2,individual_ship_fee,product_price,om_no,invoice_no,prd_model,order_amount,coupon_price,mileage_used,refund_date,exchange_pickup_end_date,pay_date,order_status,is_payed,paymethod,s_mall_code,add_sale_price,delivery_code,ma_product_code,admin_item_code,is_shipped,ship_type,exchange_defer_reason,reason2,exchange_deny_reason,exchange_prepare_reason,exchange_withdraw_reason,return_defer_reason,return_reason,return_deny_reason,return_withdraw_reason,reason1,cancel_deny_reason,cancel_withdraw_reason,hope_shipping_date,shipbegin_date,ship_fee,order_id,opt_price,manage_id2,image_medium,ord_add_item_1,ord_add_item_2,cancel_accept_date,return_request_date,exchange_date,s_order_id,option_add_detail,member_group_price,c_receiver_id_card_key';
const EXPORTS=[
  ['ProductPrepare','product_prepare_list_ord_num','신규',['주문관리 > 상품준비중 관리 > 주문번호별','주문관리 > 배송관리 > 상품준비중 > 주문번호별']],
  ['MarketOrderManagement','openmarket_order_list','신규',['주문관리 > 마켓발주 관리']],
  ['shipped_begin_list','shipped_begin_list','발송대기',['주문관리 > 배송준비중 관리 > 주문번호별','주문관리 > 배송관리 > 배송준비중 > 주문번호별']],
  ['ShippedStandby','shipped_standby_list_ord_num','배송중',['주문관리 > 배송대기 관리 > 주문번호별','주문관리 > 배송관리 > 배송대기 > 주문번호별']],
  ['shipped_end_list','shipped_end_list','배송중',['주문관리 > 배송중 관리 > 주문번호별','주문관리 > 배송관리 > 배송중 > 주문번호별']],
  ['finishShipmentList','shipped_complete_list_ord_num','배송완료',['주문관리 > 배송완료 조회 > 주문번호별','주문관리 > 배송관리 > 배송완료 > 주문번호별']],
  ['order_cancel','order_cancel','취소요청',['주문관리 > 취소/교환/반품/환불 관리 > 취소 관리 > 전체','주문관리 > 취소/교환/반품/환불 > 취소 > 전체']],
  ['order_returns','order_returns','반품요청',['주문관리 > 취소/교환/반품/환불 관리 > 반품 관리 > 전체','주문관리 > 취소/교환/반품/환불 > 반품']],
  ['order_change','order_change','교환요청',['주문관리 > 취소/교환/반품/환불 관리 > 교환 관리 > 전체','주문관리 > 취소/교환/반품/환불 > 교환']],
];
export class Cafe24SessionError extends Error{
  constructor(message,code='INVALID_RESPONSE',status=502){super(message);this.name='Cafe24SessionError';this.code=code;this.status=status;}
}
const fail=(m,c,s)=>{throw new Cafe24SessionError(m,c,s);};
const bad=()=>fail('카페24 관리자 응답 형식이 달라 전체 수집을 중단했습니다.');
const clean=v=>{if(typeof v!=='string'||v.length>10000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))bad();return v.trim();};
const required=v=>{const x=clean(v??'');if(!x)bad();return x;};
function nodes(n,predicate,result=[]){if(predicate(n))result.push(n);for(const child of n.childNodes??[])nodes(child,predicate,result);return result;}
const attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value??'';
const nodeText=n=>n.nodeName==='#text'?n.value:(n.childNodes??[]).filter(c=>!['script','style'].includes(c.tagName)).map(nodeText).join('');
const compact=s=>s.replace(/\s+/g,' ').trim();
function url(value,base){let u;try{u=new URL(value,base);}catch{bad();}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!/(?:^|\.)(?:cafe24\.com|cafe24shop\.com)$/.test(u.hostname)||/[\x00-\x20\\]/.test(value))fail('카페24에서 허용되지 않은 이동 주소를 반환했습니다.','INVALID_REDIRECT');
  return u;
}
function date(v){const s=clean(v??''),d=new Date(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)fail('수집 날짜를 확인해주세요.','INVALID_DATE',400);return s;}
function rowDate(v){const m=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(clean(v??''));if(!m)bad();return date(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);}
function number(v,{positive=false}={}){const s=clean(v??'').replaceAll(',','').replace(/\.00$/,'');if(!/^-?\d+$/.test(s))bad();const n=Number(s);if(!Number.isSafeInteger(n)||positive&&n<1)bad();return n;}
const pending=message=>({ok:false,pending:true,stage:'browser',summary:{message}});
function challenge(html){return /ipblock|보안접속|자동입력방지|captcha|second[_ -]?auth|2차\s*인증|추가\s*인증|비밀번호.{0,10}변경/i.test(html);}
function loginPage(html){return /(?:name|id)\s*=\s*["'](?:mall_id|userpasswd|loginPasswd)["']/i.test(html);}
function token(html){const keys=[...html.matchAll(/\bsTokenKey\s*=\s*["']([A-Za-z][\w-]{0,99})["']/g)].map(x=>x[1]);if(!keys.length||new Set(keys).size!==1)bad();
  const inputs=nodes(parseHtml(html),n=>n.tagName==='input'&&attr(n,'name')===keys[0]);if(inputs.length!==1)bad();const value=required(attr(inputs[0],'value'));if(value.length>4096)bad();return {key:keys[0],value};
}
function exportRows(html){return nodes(parseHtml(html),n=>n.tagName==='tr').map(n=>{
  const cells=(n.childNodes??[]).filter(c=>c.tagName==='td');const ids=nodes(n,c=>Boolean(attr(c,'data-idx'))).map(c=>attr(c,'data-idx'));
  if(attr(n,'data-idx'))ids.push(attr(n,'data-idx'));const unique=[...new Set(ids)];if(unique.length>1)bad();
  return {shop:compact(nodeText(cells[0]??{})),category:compact(nodeText(cells[1]??{})),text:compact(nodeText(n)),id:unique[0]??'',fingerprint:createHash('sha256').update(nodeText(n)).digest('hex')};
}).filter(r=>r.shop&&r.category);}
function decode(bytes,contentType=''){try{const m=/charset\s*=\s*([\w-]+)/i.exec(contentType);if(m&&/^(?:euc-kr|ks_c_5601-1987|cp949)$/i.test(m[1]))return new TextDecoder('euc-kr',{fatal:true}).decode(bytes);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('euc-kr',{fatal:true}).decode(bytes);}
}catch{bad();}}
async function readBytes(response,max=MAX_BYTES){const announced=Number(response.headers?.get('content-length'));if(Number.isFinite(announced)&&announced>max)bad();let out;try{out=new Uint8Array(await response.arrayBuffer());}catch{fail('카페24 응답을 끝까지 받지 못했습니다. 전체 수집을 중단했습니다.','NETWORK_ERROR');}if(out.length>max)bad();return out;}
class BoundedZipWriter extends Writer{
  constructor(){super();this.chunks=[];this.byteCount=0;}
  async writeUint8Array(chunk){if(this.byteCount+chunk.length>MAX_BYTES)bad();this.byteCount+=chunk.length;this.chunks.push(chunk.slice());}
  async getData(){const out=new Uint8Array(this.byteCount);let offset=0;for(const c of this.chunks){out.set(c,offset);offset+=c.length;}return out;}
}
function parseOrders(csv,{account,identity,config,from,to}){
  let rows;try{rows=parseCsv(csv,{bom:true,skip_empty_lines:true,max_record_size:200000,relax_column_count:false});}catch{bad();}
  if(!rows.length)bad();const header=rows.shift().map(clean);if(header.length>150||new Set(header).size!==header.length||rows.length>MAX_ORDERS)bad();
  for(const field of ['품목번호','주문번호','품목별 주문번호','주문 상태','주문상품명','수량','판매가','발주일','수령인','수령인 우편번호','수령인 주소(전체)'])if(!header.includes(field))bad();
  return rows.map(values=>{const r=Object.fromEntries(header.map((k,i)=>[k,clean(values[i]??'')])),orderedAt=rowDate(r['발주일']);
    const orderId=required(r['주문번호']),lineId=required(r['품목번호']),orderNo=required(r['품목별 주문번호']),sourceStatus=required(r['주문 상태']);
    for(const id of [orderId,lineId,orderNo])if(!/^[\w-]{1,100}$/.test(id))bad();const quantity=number(r['수량'],{positive:true}),price=number(r['판매가']),optionPrice=number(r['옵션추가 가격']||'0');
    const unitPrice=price+optionPrice,amount=unitPrice*quantity;if(unitPrice<0||!Number.isSafeInteger(amount))bad();
    const claimType=config[2].endsWith('요청')?config[2]:/취소/.test(sourceStatus)?'취소요청':/반품/.test(sourceStatus)?'반품요청':/교환/.test(sourceStatus)?'교환요청':'없음',unpaid=sourceStatus.includes('입금전'),recipient=r['수령인'],phone=r['수령인 휴대전화']||r['수령인 전화번호']||'',postcode=r['수령인 우편번호'],address=r['수령인 주소(전체)'];
    const status=claimType==='없음'?config[2]:claimType==='교환요청'?'발송대기':'취소';
    const destinationComplete=[recipient,phone,postcode,address].every(v=>v&&!/[*＊●•]|알수없음|정보없음|비공개|조회불가|마스킹|개인정보\s*보호/.test(v))&&/^[+()\d\s.-]+$/.test(phone)&&(phone.match(/\d/g)?.length??0)>=8;
    return {channel:'카페24',account,orderNo,lineId,orderedAt,product:required(r['주문상품명']),sku:r['자체 상품코드']||r['자체품목코드']||'',option:r['상품옵션']||'',quantity,unitPrice,amount,buyer:r['주문자명']||'',recipient,phone,postcode,address,deliveryMemo:r['배송메시지']||'',carrier:'',tracking:r['운송장번호']||'',status,sourceStatus,claimType,sourceIds:{provider:'cafe24-session',identityId:identity.identityId,orderId,itemNo:lineId,shopNo:identity.shopNo,queryStatus:config[2],deliveryNo:r['배송번호']||'',fulfillableQty:claimType==='없음'&&!unpaid&&destinationComplete&&['신규','발송대기'].includes(status)?quantity:0,...(!destinationComplete||unpaid||claimType!=='없음'?{needsReview:true}:{}),...(unpaid?{paymentPending:true}:{})}};
  });
}

export function createCafe24SessionClient({credentials={},session,fetchImpl=fetch,resolveHost=true,now=()=>new Date(),waitImpl=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const sellerId=clean(credentials.sellerId??''),shopNo=String(credentials.shopNo??'1');if(!/^[A-Za-z0-9_-]{1,100}$/.test(sellerId)||!/^\d{1,4}$/.test(shopNo)||Number(shopNo)<1)fail('카페24 관리자 ID와 쇼핑몰 번호를 확인해주세요.','CREDENTIALS_REQUIRED',400);
  let saved={};try{if(credentials.sessionData)saved=typeof credentials.sessionData==='string'?JSON.parse(credentials.sessionData):credentials.sessionData;if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error();}catch{fail('카페24 저장 세션을 다시 연결해주세요.','SESSION_REQUIRED',401);}
  const configuredHost=credentials.host||saved.host||`https://${sellerId}.cafe24.com`;
  let host=url(configuredHost.includes('://')?configuredHost:'https://'+configuredHost).origin;
  const http=session??createSellerSession({providerId:'cafe24',credentials,fetchImpl,resolveHost,now});let cancelled=false,identity,lastQueue=0;
  const check=()=>{if(cancelled)fail('카페24 연결이 취소되었습니다.','CANCELLED',400);};
  async function request(address,options={},redirects=true){check();let u=url(address,host),o=options;const seen=new Set();for(let i=0;i<12;i++){
    if(seen.has(u.href))fail('카페24 이동이 반복되어 중단했습니다.','INVALID_REDIRECT');seen.add(u.href);let response;
    try{response=await http.request(u.href,{...o,followRedirects:false});}catch(e){if(e instanceof Cafe24SessionError)throw e;if(e.code==='SESSION_REQUIRED')fail('카페24 관리자 로그인을 다시 완료해주세요.','SESSION_REQUIRED',401);if(e.code==='CANCELLED')fail('카페24 연결이 취소되었습니다.','CANCELLED',400);fail('카페24 관리자에 연결하지 못했습니다.','NETWORK_ERROR');}
    check();if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');if(!redirects)return {response,address:u};if(!next)bad();u=url(next,u);o={method:'GET'};continue;}
    if(!response.ok){if([401,403].includes(response.status))fail('카페24 관리자 로그인을 다시 완료해주세요.','SESSION_REQUIRED',401);fail('카페24 관리자 요청에 실패했습니다. 전체 수집을 중단했습니다.','HTTP_ERROR');}
    return {response,address:u};
  }fail('카페24 이동 횟수가 너무 많습니다.','INVALID_REDIRECT');}
  async function html(address,options){const {response,address:final}=await request(address,options);return {text:decode(await readBytes(response),response.headers.get('content-type')),address:final};}
  async function verified(){const page=await html(`${host}/disp/admin/shop${shopNo}/shop/multishopList`);if(loginPage(page.text)||challenge(page.text))fail('카페24 관리자에서 로그인을 완료해주세요.','SESSION_REQUIRED',401);
    if(['eclogin.cafe24.com','user.cafe24.com'].includes(page.address.hostname))fail('카페24 관리자 로그인을 다시 완료해주세요.','SESSION_REQUIRED',401);
    const shops=nodes(parseHtml(page.text),n=>attr(n,'data-shop_no')===shopNo||attr(n,'data-shop-no')===shopNo);if(shops.length!==1)fail('카페24 응답에서 선택한 쇼핑몰을 확인할 수 없습니다.','IDENTITY_REQUIRED',401);
    const label=compact(nodeText(shops[0]));if(!label||label.length>200)bad();const current={ok:true,identityId:`${page.address.host}/shop${shopNo}`,identityLabel:label,host:page.address.origin,shopNo};
    if(credentials.identityId&&credentials.identityId!==current.identityId)fail('연결한 카페24 쇼핑몰이 기존 쇼핑몰과 다릅니다.','IDENTITY_MISMATCH',409);
    host=current.host;identity=current;return current;
  }
  async function login(){if(!credentials.password)fail('카페24 관리자 비밀번호를 입력해주세요.','CREDENTIALS_REQUIRED',400);
    const first=await html('https://eclogin.cafe24.com/Shop/?url=MallUseAuth',{method:'POST',body:new URLSearchParams({url:'MallUseAuth',login_mode:'1',mobile:'F',userid:sellerId,EncData:'',EncKey:'',loginId:sellerId,loginPasswd:credentials.password}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}});
    if(challenge(first.text))return pending('카페24 로그인 창에서 보안접속과 추가 인증을 완료해주세요.');let data;try{data=JSON.parse(first.text);}catch{return pending('카페24 로그인 창에서 관리자 로그인을 완료해주세요.');}
    if(!data||typeof data!=='object'||Array.isArray(data))bad();if(data.SECOND_CHECK&&!['F','N','0',false].includes(data.SECOND_CHECK))return pending('카페24 로그인 창에서 추가 인증을 완료해주세요.');
    if(typeof data.sEncData!=='string'||typeof data.sEncKey!=='string'||!data.sEncData||!data.sEncKey||data.sEncData.length>10000||data.sEncKey.length>10000)return pending('카페24 로그인 창에서 관리자 로그인을 완료해주세요.');
    const result=await html('https://user.cafe24.com/comLogin/?action=comLogin',{method:'POST',body:new URLSearchParams({url:'Run',login_mode:'1',mobile:'F',userid:sellerId,loginId:sellerId,loginPasswd:credentials.password,EncData:data.sEncData,EncKey:data.sEncKey}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}});
    if(challenge(result.text)||loginPage(result.text))return pending('카페24 로그인 창에서 보안접속과 추가 인증을 완료해주세요.');
    const redirects=[...result.text.matchAll(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/g)].map(m=>url(m[1],result.address));if(redirects.length){const origins=new Set(redirects.map(u=>u.origin));if(origins.size!==1)bad();host=redirects[0].origin;await html(redirects[0].href);}else if(!['eclogin.cafe24.com','user.cafe24.com'].includes(result.address.hostname))host=result.address.origin;
    try{return await verified();}catch(e){if(['SESSION_REQUIRED','IDENTITY_REQUIRED'].includes(e.code))return pending('카페24 로그인 창에서 관리자 로그인을 완료해주세요.');throw e;}
  }
  const popup=()=>`${host}/admin/php/shop${shopNo}/Excel/ExcelCreateDownloadPopup.php`;
  const ajax=name=>`${host}/admin/php/shop${shopNo}/Excel/ajax/${name}.php`;
  function requestType(config,from,to,encrypted){const claims=config[2].endsWith('요청');const query=new URLSearchParams({rows:'20',searchSorting:'order_desc',realclick:'T',tabclick:'F','MSK[]':'order_id','MSV[]':'',date_type:'order_date',start_date:from,end_date:to,start_time:'00:00:00',end_time:'23:59:59',shop_no_order:shopNo,shipment_type:'all',orderPathType:'A',paymethodType:'A',mkSaleType:'M',inflowPathType:'A',pgListType:'A'});if(claims)query.set('orderStatus[]','all');
    const fields=new URLSearchParams({realclick:'F',tabclick:'F',queryString:query.toString(),mallId:host.split('://')[1].split('.')[0],shopNo,searchPage:config[0],menu_no:claims?'76':'72',searched_shop_no:shopNo,shop_no_order:shopNo,date_type:claims?'order_date':'pay_date',start_date:from,end_date:to,rows:'100',sCheckedListItem:'F',ignore_html:'T',use_excel_config_zip_password:encrypted?'T':'F'});if(claims){fields.set('tabStatus','all');fields.set('orderStatus[]','all');}return fields.toString();
  }
  async function download(config,from,to){const before=await html(popup());if(loginPage(before.text)||challenge(before.text))fail('카페24 관리자 로그인을 다시 완료해주세요.','SESSION_REQUIRED',401);let t=token(before.text);
    const flags=nodes(parseHtml(before.text),n=>n.tagName==='input'&&attr(n,'name')==='sUseExcelConfigZipPassword').map(n=>attr(n,'value'));if(flags.length!==1||!['T','F'].includes(flags[0]))bad();const encrypted=flags[0]==='T',password=encrypted?randomBytes(12).toString('hex')+'aA!':'';
    const previous=new Set(exportRows(before.text).map(r=>r.id||r.fingerprint));const wait=lastQueue?Math.max(0,11000-(Date.now()-lastQueue)):0;if(wait)await waitImpl(wait);check();
    const body=new URLSearchParams({request:'order',start_date:from,end_date:to,request_type:encodeURIComponent(requestType(config,from,to,encrypted)),select_column:encodeURIComponent(`sSaveType=default&sSaveColumn=${COLUMNS}&sSaveSortField=default,default,default&sSaveSortSort=default,default,default`),set_password:password,location:config[1],formname:encodeURIComponent('기본양식(품목번호기준)'),[t.key]:t.value}).toString();lastQueue=Date.now();
    const queued=await html(ajax('ExcelAjaxQueueA'),{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Referer':popup()}});let result;try{result=JSON.parse(queued.text);}catch{bad();}if(result?.passed!==true&&result?.passed!==1)fail('카페24 Excel 생성 요청이 거부되었습니다. 전체 수집을 중단했습니다.','EXPORT_FAILED');
    let target;for(let attempt=0;attempt<25;attempt++){check();const page=await html(popup());if(loginPage(page.text)||challenge(page.text))fail('카페24 관리자 로그인이 만료되었습니다.','SESSION_REQUIRED',401);t=token(page.text);
      const fresh=exportRows(page.text).filter(r=>r.shop===identity.identityLabel&&config[3].includes(r.category)&&!previous.has(r.id||r.fingerprint));if(fresh.length>1)fail('카페24 Excel 작업을 하나로 확인할 수 없습니다. 다른 수집 작업이 끝난 뒤 다시 시도해주세요.','EXPORT_AMBIGUOUS');
      if(fresh.length){const row=fresh[0];if(row.text.includes('추출 대상 없음'))return [];if(!row.text.includes('생성중')){if(!/^\d{1,30}$/.test(row.id))bad();target=row;break;}}
      if(attempt===24)fail('카페24 Excel 생성이 완료되지 않았습니다. 전체 수집을 중단했습니다.','EXPORT_TIMEOUT');await waitImpl(4000);
    }
    const res=await request(ajax('ExcelAjaxDownload'),{method:'POST',body:new URLSearchParams({sModeType:'doDownload',request:'order',sIdx:target.id,sPassword:password,location:'default',menu_no:'11',[t.key]:t.value,reason_for_download:'주문관리'}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Referer':popup()}});
    const bytes=await readBytes(res.response);if(bytes[0]!==0x50||bytes[1]!==0x4b)fail('카페24 Excel ZIP 파일을 받지 못했습니다. 전체 수집을 중단했습니다.','EXPORT_FAILED');let reader;
    try{reader=new ZipReader(new Uint8ArrayReader(bytes),{useWebWorkers:false});const entries=await reader.getEntries();if(entries.length>100)bad();let total=0;const files=entries.filter(e=>!e.directory);for(const e of entries){if(!Number.isSafeInteger(e.uncompressedSize)||e.uncompressedSize<0||e.uncompressedSize>MAX_BYTES||(total+=e.uncompressedSize)>MAX_BYTES||e.filename.includes('..')||e.filename.startsWith('/')||e.filename.includes('\\'))bad();}if(files.length!==1||!files[0].filename.toLowerCase().endsWith('.csv'))bad();const csv=await files[0].getData(new BoundedZipWriter(),{password,useWebWorkers:false,checkSignature:true});if(csv.length>MAX_BYTES)bad();return parseOrders(decode(csv),{account:credentials.account||sellerId,identity,config,from,to});
    }catch(e){if(e instanceof Cafe24SessionError)throw e;fail('카페24 Excel ZIP을 안전하게 읽지 못했습니다. 전체 수집을 중단했습니다.','EXPORT_INVALID');}finally{try{await reader?.close();}catch{bad();}}
  }
  async function collectOrders({from,to}={}){from=date(from);to=date(to);if(from>to||Date.parse(to)-Date.parse(from)>92*DAY)fail('카페24는 한 번에 93일 이내로 수집해주세요.','INVALID_DATE',400);const first=await verified(),out=new Map();
    for(const config of EXPORTS){const rows=await download(config,from,to);for(const order of rows){const key=order.orderNo+'\0'+order.lineId,old=out.get(key);if(old&&(old.product!==order.product||old.quantity!==order.quantity||old.sourceIds.orderId!==order.sourceIds.orderId))bad();if(old?.claimType!=='없음'&&old)continue;out.set(key,order);if(out.size>MAX_ORDERS)fail('카페24는 한 번에 10,000품목까지 수집할 수 있습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);}}
    const after=await verified();if(first.identityId!==after.identityId)fail('수집 도중 카페24 쇼핑몰이 변경되었습니다.','IDENTITY_MISMATCH',409);return {complete:true,orders:[...out.values()],summary:{provider:'카페24 관리자',count:out.size,from,to,identityId:first.identityId,generatedExports:EXPORTS.length},notes:['카페24는 결제일 기준으로 조회합니다. 주문일은 발주일을 보존합니다.','카페24 관리자에서 Excel 생성 작업과 다운로드 이력이 기록됩니다.','취소·반품·교환 이력이 있거나 수령인 정보가 부족한 품목은 발송 대상에서 제외했습니다.']};
  }
  return {login,verifyIdentity:verified,testConnection:async()=>({...await verified(),summary:{message:'카페24 관리자 쇼핑몰을 확인했습니다.'}}),collectOrders,getSessionCookies:()=>http.getSessionCookies(),getSessionState:()=>({cookies:http.getSessionCookies(),sessionData:JSON.stringify({host,shopNo})}),cancel(){cancelled=true;http.cancel?.();},continueLogin:async()=>pending('카페24 로그인 창에서 추가 인증을 완료해주세요.')};
}
