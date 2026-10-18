import {parse as parseLossless} from 'lossless-json';
import JSZip from 'jszip';
import he from 'he';
import {createCoupangSession} from './coupang-auth.mjs';

// Bounded reconstruction of CoupangNew's read paths, not a public Wing API.
// Evidence: coupang-wing-orders-disasm.json, SHA f5c36c69…f42b (2026-10-16).
const WING='https://wing.coupang.com',DAY=86400000,MAX_ORDERS=10000,MAX_PAGES=600;
const SEARCH='/tenants/sfl-portal/delivery/management/dashboard/search';
const DOWNLOAD='/fcc/download-manager/';
const STATUS={'결제완료':'신규','상품준비중':'발송대기','배송지시':'배송중','배송중':'배송중','배송완료':'배송완료','판매자 직접배송':'배송중'};
const CLAIMS=[
  {path:'stop-shipment',key:'shipmentStopSearchType',codes:['SHIPMENT_STOP_REQUEST','SHIPMENT_STOP_COMPLETE'],type:'취소요청'},
  {path:'return-delivery',key:'refundStatus',codes:['REQUEST','WAIT_REFUND','REFUND_COMPLETED'],type:'반품요청'},
  {path:'exchange',key:'exchangeStatusType',codes:['RECEIPT','PROGRESS','SUCCESS','CANCEL'],type:'교환요청'},
];
export class CoupangWingError extends Error {
  constructor(message,code='INVALID_RESPONSE',status=502){super(message);this.name='CoupangWingError';this.code=code;this.status=status;}
}
const fail=(message,code,status)=>{throw new CoupangWingError(message,code,status);};
const bad=()=>fail('쿠팡 Wing 주문 응답 형식을 확인할 수 없습니다. 전체 수집을 중단했습니다.');
function str(value){if(value===null||value===undefined)return '';if(typeof value==='string')return value.trim();if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);bad();}
function text(value){const s=str(value);if(s.length>10000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s))bad();return he.decode(s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<[^>]*>/g,'')).trim();}
function id(value){const s=str(value);if(!/^[1-9]\d{0,29}$/.test(s))bad();return s;}
function number(value,{positive=false}={}){const s=str(value).replaceAll(',','');if(!/^\d+$/.test(s))bad();const n=Number(s);if(!Number.isSafeInteger(n)||positive&&n<1)bad();return n;}
function date(value){const s=str(value),parsed=new Date(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==s)bad();return s;}
const addDays=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
function kstDay(now){const n=new Date(typeof now==='function'?now():now??new Date()).getTime();if(!Number.isFinite(n))bad();return new Date(n+9*3600000).toISOString().slice(0,10);}
function orderedDate(value){
  const s=str(value);if(/^\d{12,14}$/.test(s)){const n=Number(s);if(!Number.isSafeInteger(n))bad();return new Date(n+9*3600000).toISOString().slice(0,10);}
  // Raw Excel serials are converted only in known date columns.
  if(/^\d{5}(?:\.\d+)?$/.test(s)){const n=Number(s);if(n<20000||n>100000)bad();return new Date(Date.UTC(1899,11,30)+Math.floor(n)*DAY).toISOString().slice(0,10);}
  const match=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);if(!match)bad();return date(`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`);
}
function* periods(from,to,days){for(let start=from;start<=to;start=addDays(start,days)){const end=addDays(start,days-1);yield {from:start,to:end>to?to:end};}}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))bad();return value;}
function array(value){if(!Array.isArray(value)||value.length>MAX_ORDERS)bad();return value;}
function parseJson(raw){try{return parseLossless(raw,undefined,n=>{if(/^-?\d+$/.test(n)&&!Number.isSafeInteger(Number(n)))return n;return Number(n);});}catch{bad();}}
function nonempty(value){const s=text(value);if(!s)bad();return s;}
function pairName(value,excel=false){
  const name=nonempty(value);
  if(!excel){const at=name.indexOf(',');return at<0?[name,'']:[name.slice(0,at).trim(),name.slice(at+1).trim()];}
  let depth=0,start=-1,last='';for(let i=0;i<name.length;i++){if(name[i]==='('){if(depth===0)start=i+1;depth++;}else if(name[i]===')'&&depth>0){depth--;if(!depth)last=name.slice(start,i);}}
  if(!last||!name.includes(' ('))return [name,''];return [name.replace(', '+last,'').replace(' ('+last+')','').trim(),last.trim()];
}
function baseOrder({account,orderNo,shipmentBoxId,vendorItemId,orderedAt,product,option,quantity,amount,unitPrice,status,sourceStatus,...fields}){
  if(!product||!quantity||!orderedAt)bad();
  const destinationComplete=Boolean(fields.recipient&&fields.phone&&fields.postcode&&fields.address);
  const sourceIds={provider:'coupang-wing',shipmentBoxId,vendorItemId,fulfillableQty:['신규','발송대기'].includes(status)?quantity:0,...fields.sourceIds};
  if(!destinationComplete){sourceIds.fulfillableQty=0;sourceIds.needsReview=true;}
  return {channel:'쿠팡',account,orderNo,lineId:`${shipmentBoxId}:${vendorItemId}`,orderedAt,product,sku:'',option,quantity,amount,unitPrice,buyer:'',recipient:'',phone:'',postcode:'',address:'',deliveryMemo:'',carrier:'',tracking:'',status,sourceStatus,claimType:'없음',...fields,
    sourceIds};
}

// Read OOXML cell values directly. In particular, numeric IDs never enter Number.
// No formulas, external entities, remote links, or workbook scripts are evaluated.
async function xlsxRows(bytes){
  if(bytes.length>12*1024*1024||bytes[0]!==0x50||bytes[1]!==0x4b)bad();
  let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false});}catch{bad();}
  const entries=Object.values(zip.files);let total=0;
  if(entries.length>1000)bad();
  for(const entry of entries){const n=entry._data?.uncompressedSize??0;if(!Number.isSafeInteger(n)||n>20*1024*1024||(total+=n)>40*1024*1024)bad();if(/(?:vbaProject|externalLinks)/i.test(entry.name))bad();}
  async function xml(path,required=true){const f=zip.file(path);if(!f){if(required)bad();return ''; }const s=await f.async('string');if(s.length>20*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(s))bad();return s;}
  const unescape=s=>he.decode(s,{isAttributeValue:false});
  const attr=(s,key)=>{const m=new RegExp(`(?:^|\\s)${key}=(?:"([^"]*)"|'([^']*)')`).exec(s);return m?unescape(m[1]??m[2]):'';};
  const texts=s=>[...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t\s*>/g)].map(m=>unescape(m[1])).join('');
  const workbook=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
  const sheets=[...workbook.matchAll(/<sheet\s([^>]*?)(?:\/?>)/g)];if(sheets.length!==1)bad();
  const relId=attr(sheets[0][1],'r:id');let target;
  for(const r of rels.matchAll(/<Relationship\s([^>]*?)\/?\s*>/g)){if(attr(r[1],'Id')===relId){if(attr(r[1],'TargetMode')==='External')bad();target=attr(r[1],'Target');}}
  if(!target||target.includes('..')||target.includes('\\'))bad();const path=target.startsWith('/')?target.slice(1):'xl/'+target;
  if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path))bad();
  const shared=await xml('xl/sharedStrings.xml',false),strings=[];
  for(const si of shared.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si\s*>/g)){strings.push(texts(si[1]));if(strings.length>500000)bad();}
  const sheet=await xml(path),rows=[];
  for(const row of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row\s*>/g)){
    const values=[];for(const cell of row[1].matchAll(/<c\s([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c\s*>)/g)){
      const ref=attr(cell[1],'r'),type=attr(cell[1],'t'),body=cell[2]??'';if(!/^[A-Z]{1,3}\d+$/.test(ref)||/<f(?:\s|>)/.test(body))bad();
      let col=0;for(const letter of ref.match(/^[A-Z]+/)[0])col=col*26+letter.charCodeAt(0)-64;if(col>200)bad();
      const v=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v\s*>/.exec(body);let value='';
      if(type==='s'){const n=v?.[1];if(!/^\d+$/.test(n??'')||!Number.isSafeInteger(Number(n))||Number(n)>=strings.length)bad();value=strings[Number(n)];}
      else if(type==='inlineStr')value=texts(body);
      else if(['','n','str','d'].includes(type))value=v?unescape(v[1]):'';
      else if(type==='b')value=v?.[1]??'';
      else bad();
      if(values[col-1]!==undefined||value.length>10000)bad();values[col-1]=value;
    }
    if(values.some(v=>v!==''&&v!==undefined))rows.push(values);if(rows.length>MAX_ORDERS+1)fail('쿠팡 Wing은 한 번에 10,000품목까지 수집할 수 있습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
  }
  if(!rows.length)bad();const header=rows.shift().map(text),seen=new Set();
  for(const name of header){if(name&&seen.has(name))bad();seen.add(name);}
  for(const name of ['주문번호','묶음배송번호','옵션ID','구매수(수량)','결제액','주문일','배송완료일','구매확정일자'])if(!seen.has(name))bad();
  if(!seen.has('현재 노출상품명(옵션명)')&&!seen.has('노출상품명(옵션명)'))bad();
  return rows.map(values=>{if(values.length>header.length)bad();return Object.fromEntries(header.map((key,i)=>[key,values[i]??'']).filter(([key])=>key));});
}

export function createCoupangWingClient({credentials={},fetchImpl=fetch,resolveHost=true,now=()=>new Date(),session}={}){
  const account=text(credentials.account||credentials.sellerId);
  if(!str(credentials.sellerId)||!account)fail('쿠팡 Wing 로그인 ID를 설정해주세요.','CREDENTIALS_REQUIRED',400);
  const http=session??createCoupangSession({credentials,fetchImpl,resolveHost,now});
  let busy=false;
  async function request(path,options={}){
    let response;try{response=await http.request(WING+path,options);}catch(error){if(error?.code)throw error;fail('쿠팡 Wing 조회에 실패했습니다. 전체 수집을 중단했습니다.','REQUEST_FAILED');}
    if(!response||response.status>=300&&response.status<400||response.redirected)fail('쿠팡 Wing 로그인 세션을 다시 연결해주세요.','SESSION_REQUIRED',401);
    if(!response.ok)fail('쿠팡 Wing 조회에 실패했습니다. 전체 수집을 중단했습니다.','REQUEST_FAILED');return response;
  }
  async function json(path,body){const response=await request(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json;charset=UTF-8'},body:JSON.stringify(body)});const raw=await response.text();if(raw.length>12*1024*1024||/^\s*</.test(raw))bad();const value=parseJson(raw);if(value?.error||value?.success===false)bad();return value;}
  async function identity(){const found=object(await http.verifyIdentity());if(found.ok!==true||str(found.sellerId)!==str(credentials.sellerId)||!/^[A-Za-z0-9_-]{1,100}$/.test(str(found.vendorId)))fail('연결한 쿠팡 Wing 계정이 설정한 ID와 일치하지 않습니다.','ACCOUNT_MISMATCH',401);return found;}
  function mapDetail(orderNo,raw,metadata={},claim){
    const root=object(raw);if(root.orderId!==undefined&&id(root.orderId)!==orderNo)bad();
    const orderedAt=orderedDate(root.createdAt),result=[],keys=new Set();
    for(const box of array(root.shipmentBoxes)){object(box);const shipmentBoxId=id(box.shipmentBoxId),sourceStatus=nonempty(box.deliveryStatusName),status=STATUS[sourceStatus];
      if(!status&&!claim)bad();for(const item of array(box.items)){object(item);const vendorItemId=id(item.vendorItemId),key=`${shipmentBoxId}:${vendorItemId}`;if(keys.has(key))bad();keys.add(key);
        const originalQty=number(item.quantity,{positive:true}),canceled=number(item.cancelCount);if(!Number.isSafeInteger(canceled)||canceled>originalQty)bad();
        const total=number(item.price),unitPrice=Math.floor(total/originalQty);if(!Number.isFinite(unitPrice))bad();
        const remaining=originalQty-canceled,[product,option]=pairName(item.vendorItemName),fullyCanceled=remaining===0;
        const protectedOrder=Boolean(claim)||canceled>0||fullyCanceled;
        result.push(baseOrder({account,orderNo,shipmentBoxId,vendorItemId,orderedAt,product,option,quantity:remaining||originalQty,unitPrice,amount:total,status:fullyCanceled?'취소':status??'취소',sourceStatus,
          buyer:text(metadata.memberName),recipient:text(root.receiverName),phone:text(metadata.safeNumberDto?.safeNumber||root.safeNumber).replaceAll('--','-'),postcode:text(root.postCode),address:[text(root.addr1),text(root.addr2)].filter(Boolean).join(' '),deliveryMemo:text(root.message),carrier:text(box.deliverName),tracking:text(box.invoiceNumber),
          claimType:claim?.type??(canceled?'취소요청':'없음'),sourceIds:{originalQty,canceledQty:canceled,originalAmount:total,fulfillableQty:protectedOrder?0:['신규','발송대기'].includes(status)?remaining:0,needsReview:protectedOrder,claimCodes:claim?.codes?.join(',')??'',...(item.productId!==undefined?{productId:id(item.productId)}:{})}}));
      }
    }
    if(!result.length)bad();return result;
  }
  function mapExcel(row,code,claims){
    const orderNo=id(row['주문번호']),shipmentBoxId=id(row['묶음배송번호']),vendorItemId=id(row['옵션ID']);
    const orderedAt=orderedDate(row['주문일']),quantity=number(row['구매수(수량)'],{positive:true}),amount=number(row['결제액']);
    const delivered=text(row['배송완료일']),confirmed=text(row['구매확정일자']),claim=claims.get(orderNo);
    if(confirmed&&!delivered)bad();if(delivered)orderedDate(row['배송완료일']);if(confirmed)orderedDate(row['구매확정일자']);
    const status=confirmed?'구매확정':delivered?'배송완료':code==='INSTRUCT'?'발송대기':'배송중';
    if(code==='INSTRUCT'&&(delivered||confirmed))bad();
    const [product,option]=pairName(row['노출상품명(옵션명)']||row['현재 노출상품명(옵션명)'],true);
    return baseOrder({account,orderNo,shipmentBoxId,vendorItemId,orderedAt,product,option,quantity,amount,unitPrice:Math.floor(amount/quantity),status,sourceStatus:code,sku:text(row['업체상품코드']),buyer:text(row['구매자']),recipient:text(row['수취인이름']),phone:text(row['수취인전화번호']),postcode:text(row['우편번호']),address:text(row['수취인 주소']),deliveryMemo:text(row['배송메세지']),carrier:text(row['택배사']),tracking:text(row['운송장번호']),claimType:claim?.type??'없음',sourceIds:{barcode:text(row['바코드']),buyConfirmDate:confirmed,deliveryCompletedDate:delivered,fulfillableQty:claim?0:status==='발송대기'?quantity:0,needsReview:Boolean(claim),claimCodes:claim?.codes.join(',')??''}});
  }
  return {
    async testConnection(){await identity();return {ok:true};},
    getSessionCookies(){return http.getSessionCookies();},
    async collectOrders({from,to}={}){
      if(busy)fail('이 쿠팡 Wing 계정의 수집이 이미 진행 중입니다.','BUSY',409);busy=true;
      try{
        try{date(from);date(to);}catch{fail('수집 시작일·종료일을 확인해주세요.','INVALID_DATE',400);}
        const today=kstDay(now),earliest=`${Number(today.slice(0,4))-2}${today.slice(4)}`;
        if(from>to||to>today||from<earliest)fail('쿠팡 Wing은 오늘부터 최근 2년의 주문을 수집할 수 있습니다.','INVALID_DATE',400);
        const owner=await identity(),orders=new Map(),details=new Map(),metadata=new Map(),claims=new Map();let requests=0,rawRows=0;
        const within=order=>order.orderedAt>=from&&order.orderedAt<=to;
        const count=()=>{if(++requests>6000)fail('쿠팡 Wing 조회 한도를 초과했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);};
        const read=async(path,body)=>{count();return json(path,body);};
        const detail=async orderNo=>{if(!details.has(orderNo))details.set(orderNo,object(await read(`/tenants/sfl-portal/order/detail/${orderNo}/order`)));return details.get(orderNo);};
        const insert=order=>{
          if(!within(order))return;const key=`${order.orderNo}:${order.lineId}`,previous=orders.get(key);
          if(previous){if(previous.quantity!==order.quantity||previous.product!==order.product||Math.abs(previous.amount-order.amount)>0.01)bad();const rank={'신규':0,'발송대기':1,'배송중':2,'배송완료':3,'구매확정':4,'취소':5};if(rank[order.status]<rank[previous.status])return;}
          orders.set(key,order);if(orders.size>MAX_ORDERS)fail('쿠팡 Wing은 한 번에 10,000품목까지 수집할 수 있습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
        };
        // Claims are checked through today, including claims raised after the chosen order period.
        // One extra boundary day and a local order-date filter avoid dropping an inclusive end date.
        for(const p of periods(from,today,27))for(const spec of CLAIMS)for(const code of spec.codes){
          const fingerprints=new Set(),rowFingerprints=new Set();let ended=false,total,received=0;
          for(let page=spec.path==='exchange'?1:0,n=0;n<100;n++,page++){
            const body=spec.path==='exchange'?{exchangeStatusType:code,coupangConfirmSearchCondtionType:null,from:p.from,to:addDays(p.to,1),searchType:'orderId',email:null,orderId:null,searchKeywordValue:null,totalElements:0,page}:{[spec.key]:code,from:p.from+'T00:00:00+09:00',to:addDays(p.to,1)+'T00:00:00+09:00',searchKeywordValue:null,orderId:null,cancelId:null,...(spec.path==='return-delivery'?{wingCoupangConfirmStatus:null}:{}),pagePredicate:{currentPage:page}};
            const result=object(await read(`/tenants/sfl-portal/${spec.path}/search`,body)),rows=array(result.content);
            if(result.totalElements!==undefined){const reported=number(result.totalElements);if(!Number.isSafeInteger(reported)||total!==undefined&&reported!==total)fail('쿠팡 Wing 클레임 수가 조회 중 변경되었습니다. 다시 수집해주세요.','INCOMPLETE');total=reported;}
            if(!rows.length){if(total!==undefined&&received!==total)fail('쿠팡 Wing 클레임 항목이 전체 개수와 일치하지 않습니다.','INCOMPLETE');ended=true;break;}received+=rows.length;if(total!==undefined&&received>total)bad();const fingerprint=JSON.stringify(rows);if(fingerprints.has(fingerprint))fail('쿠팡 Wing 클레임 페이지가 반복되어 전체 수집을 중단했습니다.','REPEATED_PAGE');fingerprints.add(fingerprint);
            if((rawRows+=rows.length)>50000)fail('쿠팡 Wing 조회 한도를 초과했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
            for(const row of rows){const rowFingerprint=JSON.stringify(row);if(rowFingerprints.has(rowFingerprint))fail('쿠팡 Wing 클레임 항목이 다음 페이지에서 반복되었습니다.','REPEATED_PAGE');rowFingerprints.add(rowFingerprint);const orderNo=id(object(row).orderId),old=claims.get(orderNo),active=!['SHIPMENT_STOP_COMPLETE','REFUND_COMPLETED','SUCCESS','CANCEL'].includes(code);claims.set(orderNo,{type:old?.active?old.type:active?spec.type:'처리완료',active:old?.active||active,codes:[...new Set([...(old?.codes??[]),`${spec.path}:${code}`])]});if(claims.size>MAX_ORDERS)fail('쿠팡 Wing 클레임 한도를 초과했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);}
          }
          if(!ended)fail('쿠팡 Wing 클레임 페이지 끝을 확인하지 못했습니다.','INCOMPLETE');
        }
        const newIds=new Set();
        for(const p of periods(from,to,29)){let cursor=null,ended=false;const cursors=new Set(),pages=new Set(),boxes=new Set();
          for(let page=1;page<=MAX_PAGES;page++){
            const condition={nextShipmentBoxId:cursor,startDate:p.from,endDate:addDays(p.to,1),deliveryStatus:'ACCEPT',deliveryMethod:null,detailConditionKey:'NAME',detailConditionValue:null,selectedComplexConditionKey:null,countPerPage:50,page};
            // The shipped format inserts this cursor as a JSON integer, not a quoted string.
            const encoded=JSON.stringify(condition).replace(/"nextShipmentBoxId":"([1-9]\d*)"/,'"nextShipmentBoxId":$1');
            const rows=array(await read(`${SEARCH}?${new URLSearchParams({condition:encoded,mockingTestMode:'false'})}`));
            if(!rows.length){ended=true;break;}if(rows.length>50)bad();const fingerprint=rows.map(r=>`${id(r.shipmentBoxId)}:${id(r.orderId)}`).join(',');if(pages.has(fingerprint))fail('쿠팡 Wing 주문 페이지가 반복되어 수집을 중단했습니다.','REPEATED_PAGE');pages.add(fingerprint);
            for(const row of rows){const orderNo=id(object(row).orderId),boxId=id(row.shipmentBoxId);if(boxes.has(boxId))fail('쿠팡 Wing 주문 항목이 다음 페이지에서 반복되었습니다.','REPEATED_PAGE');boxes.add(boxId);metadata.set(orderNo,row);newIds.add(orderNo);if(newIds.size>MAX_ORDERS)fail('쿠팡 Wing 주문 한도를 초과했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);}
            const next=id(rows.at(-1).shipmentBoxId);if(cursors.has(next))fail('쿠팡 Wing 주문 페이지 커서가 반복되었습니다.','REPEATED_PAGE');cursors.add(next);cursor=next;
          }
          if(!ended)fail('쿠팡 Wing 주문 페이지 끝을 확인하지 못했습니다.','INCOMPLETE');
        }
        for(const orderNo of newIds)for(const order of mapDetail(orderNo,await detail(orderNo),metadata.get(orderNo),claims.get(orderNo)))insert(order);
        // Download each status only once; completion/confirmation dates split the final statuses.
        for(const p of periods(from,to,29))for(const code of ['INSTRUCT','DEPARTURE','DELIVERING','NONE_TRACKING','FINAL_DELIVERY']){
          const predicate={page:1,deliveryStatus:code,deliveryMethod:null,from:p.from,to:addDays(p.to,1),detailConditionKey:'NAME',detailConditionValue:null,vendorId:str(owner.vendorId)};
          const stamp=today.replaceAll('-',''),body=new URLSearchParams({type:'WING_DELIVERY',comment:`배송검색결과(${stamp})`,description:`DeliveryList(${stamp})`,predicate:JSON.stringify(predicate)}).toString();count();
          const response=await request(DOWNLOAD+'request-auto-download',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const ack=object(parseJson(await response.text())),requestId=str(ack.requestedDownloadId);
          if(!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))bad();let ids;
          for(let attempt=0;attempt<15;attempt++){
            const state=object(await read(DOWNLOAD+'check-downloadable?'+new URLSearchParams({requestId})));if(state.status==='FAILED')fail('쿠팡 Wing 엑셀 생성에 실패했습니다. 전체 수집을 중단했습니다.','EXPORT_FAILED');
            const current=array(state.downloadIds);if(current.length){ids=current.map(str);break;}
            if(attempt<14)await new Promise(resolve=>setTimeout(resolve,resolveHost?5000:0));
          }
          if(!ids)fail('쿠팡 Wing 엑셀 생성 완료를 확인하지 못했습니다.','INCOMPLETE');if(new Set(ids).size!==ids.length||ids.length>100||ids.some(value=>!/^[A-Za-z0-9_-]{1,100}$/.test(value)))bad();
          const fileRows=new Set();
          for(const downloadId of ids){count();const file=await request(DOWNLOAD+`download/${requestId}/${downloadId}`),rows=await xlsxRows(Buffer.from(await file.arrayBuffer()));for(const row of rows){if(++rawRows>100000)fail('쿠팡 Wing 조회 한도를 초과했습니다.','LIMIT_EXCEEDED',400);const mapped=mapExcel(row,code,claims),key=mapped.orderNo+':'+mapped.lineId;if(fileRows.has(key))fail('쿠팡 Wing 엑셀에 같은 주문 품목이 반복되어 수집을 중단했습니다.','REPEATED_PAGE');fileRows.add(key);
            // For claimed orders the detailed snapshot below supplies cancelCount and
            // the remaining quantity; the export can still contain the original quantity.
            if(!claims.has(mapped.orderNo))insert(mapped);
          }}
        }
        for(const [orderNo,claim]of claims){const raw=await detail(orderNo);for(const order of mapDetail(orderNo,raw,metadata.get(orderNo),claim))insert(order);}
        // A final identity check rejects a changed account before the caller can commit the snapshot.
        const finalOwner=await identity();if(str(finalOwner.vendorId)!==str(owner.vendorId))fail('수집 중 쿠팡 Wing 계정이 변경되었습니다.','ACCOUNT_MISMATCH',401);
        return {orders:[...orders.values()],complete:true,notes:['취소·반품·교환 이력이 있거나 수신자 정보가 부족한 주문은 발송 대상에서 제외했습니다.']};
      }finally{busy=false;}
    },
  };
}
