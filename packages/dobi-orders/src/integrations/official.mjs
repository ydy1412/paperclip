import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { parse as parseLossless } from 'lossless-json';

// Contracts checked against the providers' official documentation on 2026-10-13.
// No private seller-center endpoints, password scraping, or remote writes are used.
export const OFFICIAL_SOURCES = {
  coupang: [
    'https://developers.coupang.com/ko/getting-started/creating-hmac-signature',
    'https://developers.coupang.com/ko/api/shipments/po-list-query-paging-by-day',
  ],
  smartstore: [
    'https://apicenter.commerce.naver.com/docs/auth',
    'https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth',
    'https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-last-changed-status-pay-order-seller',
    'https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-product-orders-pay-order-seller',
    'https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/상품-주문-정보-구조체',
  ],
  cafe24: [
    'https://apidocs.cafe24.com/en/docs/guide/intro',
    'https://apidocs.cafe24.com/en/docs/admin/get-orders',
    'https://apidocs.cafe24.com/en/docs/admin/get-orders-by-order-id-items',
    'https://apidocs.cafe24.com/en/docs/admin/get-orders-by-order-id-receivers',
  ],
};
export const CREDENTIAL_FIELDS = {
  coupang: [{key:'vendorId',label:'판매자 ID (Vendor ID)',secret:false,required:true},{key:'accessKey',label:'Access Key',secret:true,required:true},{key:'secretKey',label:'Secret Key',secret:true,required:true}],
  smartstore: [{key:'clientId',label:'애플리케이션 ID',secret:false,required:true},{key:'clientSecret',label:'애플리케이션 시크릿',secret:true,required:true},{key:'type',label:'인증 유형 (SELF / SELLER)',secret:false,required:false},{key:'accountId',label:'판매자 ID (SELLER 유형만)',secret:false,required:false}],
  cafe24: [{key:'mallId',label:'쇼핑몰 ID',secret:false,required:true},{key:'accessToken',label:'OAuth Access Token',secret:true,required:true},{key:'shopNo',label:'멀티쇼핑몰 번호 (기본 1)',secret:false,required:false}],
};
export class ConnectorError extends Error {
  constructor(message, code='CONNECTOR_ERROR', status=400) { super(message);this.name='ConnectorError';this.code=code;this.status=status; }
}
const value = v => String(v??'').trim();
const DAY=86400000, LIMIT_ORDERS=50000, LIMIT_PAGES=1000;
const carrierNames={CJGLS:'CJ대한통운',HYUNDAI:'롯데택배',HANJIN:'한진택배',KGB:'로젠택배',EPOST:'우체국택배',DAESIN:'대신택배',KYOUNGDONG:'경동택배'};
function required(credentials,fields) {
  for(const field of fields) if(!value(credentials[field])) throw new ConnectorError(`${CREDENTIAL_FIELDS[credentials.provider]?.find(f=>f.key===field)?.label||field} 인증 정보를 입력해주세요.`, 'MISSING_CREDENTIALS');
}
function integer(v,label,{minimum=0,fallback}={}) {
  if(v===undefined||v===null||v==='') {if(fallback!==undefined)return fallback;throw new ConnectorError(`${label} 정보가 응답에 없습니다.`, 'INVALID_RESPONSE',502);}
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<minimum||n>1e12) throw new ConnectorError(`${label} 응답 값을 확인할 수 없습니다.`, 'INVALID_RESPONSE',502);
  return n;
}
function id(v,label) {
  if(typeof v==='number'&&!Number.isSafeInteger(v)) throw new ConnectorError(`${label}의 숫자 정밀도가 손실되었습니다.`, 'INVALID_RESPONSE',502);
  const s=value(v);if(!s)throw new ConnectorError(`${label} 정보가 응답에 없습니다.`, 'INVALID_RESPONSE',502);return s;
}
function date(v,label) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value(v)))throw new ConnectorError(`${label}은 YYYY-MM-DD 형식으로 입력해주세요.`, 'INVALID_DATE');
  const t=Date.parse(v+'T00:00:00Z');if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==v)throw new ConnectorError(`${label} 날짜를 확인해주세요.`, 'INVALID_DATE');return t;
}
function range(from,to,max=31) {
  const start=date(from,'시작일'),end=date(to,'종료일');
  if(end<start||((end-start)/DAY)+1>max)throw new ConnectorError(`조회 기간은 시작일부터 ${max}일 이내로 지정해주세요.`, 'INVALID_DATE');return {start,end};
}
function orderedDate(v) {
  const d=value(v).slice(0,10);date(d,'원격 주문일');return d;
}
function krw(money,label,fallback=0) {
  if(money==null)return fallback;
  if(money.currencyCode&&money.currencyCode!=='KRW')throw new ConnectorError('현재 주문관리는 원화 주문만 지원합니다.', 'UNSUPPORTED_CURRENCY');
  if(Number(money.nanos||0)!==0)throw new ConnectorError(`${label} 소수 금액을 원화로 변환할 수 없습니다.`, 'UNSUPPORTED_CURRENCY');
  return integer(money.units,label);
}
function ensureArray(array,label) {if(!Array.isArray(array))throw new ConnectorError(`${label} 응답 형식이 변경되었거나 조회 권한이 없습니다.`, 'INVALID_RESPONSE',502);return array;}
function capped(count) {if(count>LIMIT_ORDERS)throw new ConnectorError('조회 결과가 너무 많습니다. 기간을 줄여 다시 수집해주세요.', 'RESULT_LIMIT');}
function asKst(dateObj) {return new Date(dateObj.getTime()+9*3600000).toISOString().slice(0,10);}
export function parseProviderJson(text) {
  return parseLossless(text,undefined,number=> {
    const n=Number(number);return /^-?\d+$/.test(number)&&!Number.isSafeInteger(n)?number:n;
  });
}
export function createCoupangAuthorization({accessKey,secretKey,method='GET',path,query='',date:newDate=new Date()}) {
  const stamp=newDate.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z').slice(2);
  const signature=createHmac('sha256',secretKey).update(stamp+method+path+query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${stamp}, signature=${signature}`;
}
export async function createNaverSignature({clientId,clientSecret,timestamp}) {
  if(!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{22,}$/.test(clientSecret))throw new ConnectorError('네이버 애플리케이션 시크릿 형식을 확인해주세요.', 'INVALID_CREDENTIALS');
  const hash=await bcrypt.hash(`${clientId}_${timestamp}`,clientSecret);
  return Buffer.from(hash,'utf8').toString('base64');
}
function normalizeCoupang(sheet,credentials) {
  const orderNo=id(sheet.orderId,'쿠팡 주문 ID'),box=id(sheet.shipmentBoxId,'쿠팡 배송번호');
  return ensureArray(sheet.orderItems,'쿠팡 주문 품목').map(item=>{
    const vendorItemId=id(item.vendorItemId,'쿠팡 옵션 ID');
    const quantity=integer(item.shippingCount,'수량',{minimum:1});
    const cancelCount=integer(item.cancelCount,'취소 수량',{fallback:0}),holdCount=integer(item.holdCountForCancel,'취소 대기 수량',{fallback:0});
    const status=item.canceled||cancelCount>=quantity?'취소':item.confirmDate?'구매확정':({ACCEPT:'신규',INSTRUCT:'발송대기',DEPARTURE:'배송중',DELIVERING:'배송중',FINAL_DELIVERY:'배송완료',NONE_TRACKING:'배송중'}[sheet.status]);
    if(!status)throw new ConnectorError('알 수 없는 쿠팡 주문 상태입니다.', 'INVALID_RESPONSE',502);
    const receiver=sheet.receiver||{};
    return {channel:'쿠팡',account:value(credentials.account)||credentials.vendorId,orderNo,lineId:`${box}:${vendorItemId}:${value(item.sequenceNo)}`,orderedAt:orderedDate(sheet.orderedAt),product:value(item.sellerProductName||item.vendorItemName),sku:value(item.externalVendorSkuCode),option:value(item.sellerProductItemName),quantity,qty:quantity,unitPrice:krw(item.salesPrice,'판매 단가'),amount:krw(item.orderPrice,'주문 금액'),buyer:value(sheet.orderer?.name),recipient:value(receiver.name),phone:value(receiver.safeNumber||receiver.receiverNumber),postcode:value(receiver.postCode),address:[receiver.addr1,receiver.addr2].filter(Boolean).join(' '),deliveryMemo:value(sheet.parcelPrintMessage),status,carrier:value(sheet.deliveryCompanyName).replace('CJ 대한통운','CJ대한통운'),tracking:value(sheet.invoiceNumber),claimType:holdCount?'취소요청':'없음',sourceStatus:value(sheet.status),sourceIds:{provider:'coupang',vendorId:credentials.vendorId,orderId:orderNo,shipmentBoxId:box,vendorItemId,sequenceNo:value(item.sequenceNo),shippingCount:quantity,cancelCount,holdCountForCancel:holdCount,fulfillableQty:Math.max(0,quantity-cancelCount-holdCount)}};
  });
}
function normalizeNaver(row,credentials) {
  const o=row.order||{},p=row.productOrder||{},address=p.shippingAddress||{},delivery=row.delivery||{};
  const sourceStatus=value(p.productOrderStatus);
  const status={PAYMENT_WAITING:'신규',PAYED:p.placeOrderStatus==='OK'?'발송대기':'신규',DELIVERING:'배송중',DELIVERED:'배송완료',PURCHASE_DECIDED:'구매확정',EXCHANGED:'배송완료',CANCELED:'취소',RETURNED:'취소',CANCELED_BY_NOPAYMENT:'취소'}[sourceStatus];
  if(!status)throw new ConnectorError('알 수 없는 네이버 주문 상태입니다.', 'INVALID_RESPONSE',502);
  const quantity=integer(p.quantity??p.initialQuantity,'수량',{minimum:1}),claimStatus=value(p.claimStatus);
  const claimType=claimStatus.endsWith('_DONE')?'처리완료':claimStatus.endsWith('_REJECT')?'없음':(['CANCEL','ADMIN_CANCEL'].includes(p.claimType)?'취소요청':p.claimType==='RETURN'?'반품요청':p.claimType==='EXCHANGE'?'교환요청':'없음');
  return {channel:'스마트스토어',account:value(credentials.account)||credentials.accountId||credentials.clientId,orderNo:id(o.orderId,'네이버 주문번호'),lineId:id(p.productOrderId,'네이버 상품주문번호'),orderedAt:orderedDate(o.orderDate||o.paymentDate),product:value(p.productName),sku:value(p.optionManageCode||p.sellerProductCode),option:value(p.productOption),quantity,qty:quantity,unitPrice:integer(p.unitPrice,'단가',{fallback:0}),amount:integer(p.totalPaymentAmount??p.initialPaymentAmount,'결제 금액',{fallback:0}),buyer:value(o.ordererName),recipient:value(address.name),phone:value(address.tel1||address.tel2),postcode:value(address.zipCode),address:[address.baseAddress,address.detailedAddress].filter(Boolean).join(' '),deliveryMemo:value(p.shippingMemo),status,carrier:carrierNames[delivery.deliveryCompany]||value(delivery.deliveryCompany),tracking:value(delivery.trackingNumber),claimType,sourceStatus,sourceIds:{provider:'smartstore',orderId:value(o.orderId),productOrderId:value(p.productOrderId),productId:value(p.productId),placeOrderStatus:value(p.placeOrderStatus),remainQuantity:p.remainQuantity==null?quantity:integer(p.remainQuantity,'잔여 수량'),claimStatus,claimType:value(p.claimType)}};
}
function normalizeCafe24(order,credentials) {
  if(order.currency&&order.currency!=='KRW')throw new ConnectorError('현재 주문관리는 원화 카페24 주문만 지원합니다.', 'UNSUPPORTED_CURRENCY');
  const receivers=ensureArray(order.receivers,'카페24 수령자'),items=ensureArray(order.items,'카페24 주문 품목');
  return items.map(item=>{
    const receiver=receivers.find(r=>r.shipping_code&&r.shipping_code===item.shipping_code)||(receivers.length===1?receivers[0]:null);
    if(!receiver&&receivers.length>1)throw new ConnectorError('여러 배송지의 품목별 수령자를 확인할 수 없습니다. 카페24 관리자에서 확인해주세요.', 'MULTIPLE_RECIPIENTS');
    const r=receiver||{},sourceStatus=value(item.order_status),quantity=integer(item.quantity,'수량',{minimum:1});
    let status={N00:'신규',N02:'신규',N10:'신규',N20:'발송대기',N21:'발송대기',N22:'발송대기',N30:'배송중',N40:'배송완료',N50:'구매확정'}[sourceStatus];
    if(!status) {if(/^(C4[0-9]|R4[0-9])$/.test(sourceStatus))status='취소';else if(sourceStatus.startsWith('C'))status='신규';else if(/^[RE]/.test(sourceStatus))status='배송완료';}
    if(!status)throw new ConnectorError('알 수 없는 카페24 주문 상태입니다.', 'INVALID_RESPONSE',502);
    const unitPrice=integer(Number(item.product_price||0)+Number(item.option_price||0),'단가');
    // payment_amount is the amount for the order item (품목별 결제금액).
    // Preserve the provider's line amount; multiplying it again doubles multi-unit lines.
    const amount=integer(item.payment_amount==null?unitPrice*quantity:item.payment_amount,'결제 금액');
    const buyer=Array.isArray(order.buyer)?order.buyer[0]:order.buyer;
    return {channel:'카페24',account:value(credentials.account)||credentials.mallId,orderNo:id(order.order_id,'카페24 주문번호'),lineId:id(item.order_item_code,'카페24 품목번호'),orderedAt:orderedDate(order.order_date||item.ordered_date),product:value(item.product_name||item.internal_product_name),sku:value(item.custom_variant_code||item.custom_product_code||item.product_code),option:value(item.option_value),quantity,qty:quantity,unitPrice,amount,buyer:value(buyer?.name||order.billing_name),recipient:value(r.name),phone:value(r.virtual_phone_no||r.cellphone||r.phone),postcode:value(r.zipcode),address:value(r.address_full)||[r.address1,r.address2].filter(Boolean).join(' '),deliveryMemo:value(r.shipping_message),status,carrier:value(item.shipping_company_name),tracking:value(item.tracking_no),claimType:/^C/.test(sourceStatus)&&status!=='취소'?'취소요청':/^R/.test(sourceStatus)?'반품요청':/^E/.test(sourceStatus)?'교환요청':'없음',sourceStatus,sourceIds:{provider:'cafe24',mallId:credentials.mallId,shopNo:integer(credentials.shopNo||1,'멀티쇼핑몰 번호',{minimum:1}),orderId:value(order.order_id),orderItemCode:value(item.order_item_code),shippingCode:value(item.shipping_code),claimQuantity:integer(item.claim_quantity,'클레임 수량',{fallback:0})}};
  });
}
export function createOfficialClient({provider,credentials={},fetchImpl=globalThis.fetch,now=()=>new Date()}) {
  if(provider==='naver')provider='smartstore';
  if(!OFFICIAL_SOURCES[provider])throw new ConnectorError('아직 구현되지 않은 공식 API 연결입니다.', 'UNSUPPORTED_PROVIDER');
  credentials={...credentials,provider};
  required(credentials,provider==='coupang'?['vendorId','accessKey','secretKey']:provider==='smartstore'?['clientId','clientSecret']:['mallId','accessToken']);
  if(provider==='coupang'&&!/^[A-Za-z0-9_-]{1,80}$/.test(credentials.vendorId))throw new ConnectorError('쿠팡 판매자 ID 형식을 확인해주세요.', 'INVALID_CREDENTIALS');
  if(provider==='cafe24'&&!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(credentials.mallId))throw new ConnectorError('카페24 쇼핑몰 ID 형식을 확인해주세요.', 'INVALID_CREDENTIALS');
  if(provider==='smartstore'&&!['SELF','SELLER'].includes(credentials.type||'SELF'))throw new ConnectorError('네이버 인증 유형은 SELF 또는 SELLER입니다.', 'INVALID_CREDENTIALS');
  if(provider==='smartstore'&&credentials.type==='SELLER')required(credentials,['accountId']);
  let accessToken='',tokenExpires=0;
  async function http(url,options={}) {
    let response;
    try {response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});} catch {throw new ConnectorError('연결 응답을 받지 못했습니다. 인터넷 연결과 API 접속 허용 IP를 확인해주세요.', 'NETWORK_ERROR',502);}
    let data;
    try {const body=await response.text();if(body.length>10*1024*1024)throw new Error();data=parseProviderJson(body);} catch {throw new ConnectorError('API가 유효한 JSON 응답을 반환하지 않았습니다.', 'INVALID_RESPONSE',502);}
    if(!response.ok) {
      const reason=response.status===401||response.status===403?'인증 정보, API 권한과 접속 허용 IP를 확인해주세요.':response.status===429?'API 조회 한도에 도달했습니다. 잠시 후 다시 수집해주세요.':'조회 요청에 실패했습니다.';
      const e=new ConnectorError(`HTTP ${response.status}: ${reason}`,response.status===429?'RATE_LIMIT':response.status===401||response.status===403?'AUTHENTICATION_ERROR':'REMOTE_ERROR',502);e.remoteStatus=response.status;e.remoteCode=value(data?.code);throw e;
    }
    return data;
  }
  async function coupangPage({from,to,status,token='',limit=50}) {
    const path=`/v2/providers/openapi/apis/api/v5/vendors/${credentials.vendorId}/ordersheets`;
    const params=new URLSearchParams({createdAtFrom:from+'+09:00',createdAtTo:to+'+09:00',status,maxPerPage:String(limit)});
    if(token)params.set('nextToken',token);
    const query=params.toString(),Authorization=createCoupangAuthorization({...credentials,path,query,date:now()});
    const result=await http(`https://api-gateway.coupang.com${path}?${query}`,{headers:{Authorization,Accept:'application/json'}});
    if(String(result?.code)!=='200')throw new ConnectorError('쿠팡 API가 주문 조회를 거부했습니다. 인증 권한과 조회 기간을 확인해주세요.', 'REMOTE_ERROR',502);
    ensureArray(result.data,'쿠팡 주문');return result;
  }
  async function naverToken(force=false) {
    const time=now().getTime();if(!force&&accessToken&&time<tokenExpires)return accessToken;
    const signature=await createNaverSignature({...credentials,timestamp:time});
    const params=new URLSearchParams({client_id:credentials.clientId,timestamp:String(time),grant_type:'client_credentials',client_secret_sign:signature,type:credentials.type||'SELF'});
    if(credentials.type==='SELLER')params.set('account_id',credentials.accountId);
    const data=await http('https://api.commerce.naver.com/external/v1/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:params.toString()});
    if(!value(data?.access_token)||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0)throw new ConnectorError('네이버 인증 토큰을 발급받지 못했습니다.', 'INVALID_RESPONSE',502);
    accessToken=data.access_token;tokenExpires=time+Math.max(1,Number(data.expires_in)-60)*1000;return accessToken;
  }
  async function naverRequest(path,options={},retry=true) {
    const token=await naverToken();
    try {return await http('https://api.commerce.naver.com/external'+path,{...options,headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${token}`}});} catch(e) {if(retry&&e.remoteStatus===401&&e.remoteCode==='GW.AUTHN'){await naverToken(true);return naverRequest(path,options,false);}throw e;}
  }
  async function cafePage(from,to,offset=0,limit=100,embed=true) {
    const params=new URLSearchParams({shop_no:String(integer(credentials.shopNo||1,'멀티쇼핑몰 번호',{minimum:1})),start_date:from,end_date:to,offset:String(offset),limit:String(limit)});
    if(embed)params.set('embed','items,receivers,buyer');
    const response=await http(`https://${credentials.mallId}.cafe24api.com/api/v2/admin/orders?${params}`,{headers:{Authorization:`Bearer ${credentials.accessToken}`,'X-Cafe24-Api-Version':'2026-09-01',Accept:'application/json'}});
    ensureArray(response.orders,'카페24 주문');return response.orders;
  }
  async function testConnection() {
    const today=asKst(now());
    if(provider==='coupang')await coupangPage({from:today,to:today,status:'ACCEPT',limit:1});
    else if(provider==='smartstore') {
      const params=new URLSearchParams({lastChangedFrom:today+'T00:00:00+09:00',lastChangedTo:today+'T23:59:59.999+09:00',limitCount:'1'});
      const response=await naverRequest('/v1/pay-order/seller/product-orders/last-changed-statuses?'+params);
      ensureArray(response?.data?.lastChangeStatuses,'네이버 변경 주문');
    } else await cafePage(today,today,0,1,false);
    return {ok:true,provider,checkedAt:now().toISOString(),message:'공식 API 인증과 주문 조회 권한을 확인했습니다.'};
  }
  async function collectOrders({from,to}) {
    const {start,end}=range(from,to,provider==='cafe24'?90:31),orders=[];let remoteCount=0;
    if(provider==='coupang') {
      for(const status of ['ACCEPT','INSTRUCT','DEPARTURE','DELIVERING','FINAL_DELIVERY']) {
        const seen=new Set();let token='',page=0;
        do {
          if(++page>LIMIT_PAGES||seen.has(token))throw new ConnectorError('쿠팡 페이지 조회가 반복됩니다. 기간을 줄여 다시 시도해주세요.', 'PAGINATION_ERROR',502);seen.add(token);
          const result=await coupangPage({from,to,status,token});remoteCount+=result.data.length;
          for(const sheet of result.data)orders.push(...normalizeCoupang(sheet,credentials));capped(orders.length);
          token=value(result.nextToken);
        }while(token);
      }
    } else if(provider==='smartstore') {
      const ids=new Set();
      for(let day=start;day<=end;day+=DAY) {
        const dateString=new Date(day).toISOString().slice(0,10),seen=new Set();let cursor=dateString+'T00:00:00+09:00',sequence='',page=0;
        while(true) {
          const key=cursor+'|'+sequence;if(++page>LIMIT_PAGES||seen.has(key))throw new ConnectorError('네이버 페이지 조회가 반복됩니다. 기간을 줄여 다시 시도해주세요.', 'PAGINATION_ERROR',502);seen.add(key);
          const params=new URLSearchParams({lastChangedFrom:cursor,lastChangedTo:dateString+'T23:59:59.999+09:00',limitCount:'300'});if(sequence)params.set('moreSequence',sequence);
          const response=await naverRequest('/v1/pay-order/seller/product-orders/last-changed-statuses?'+params);
          const changed=ensureArray(response?.data?.lastChangeStatuses,'네이버 변경 주문');
          for(const item of changed)ids.add(id(item.productOrderId,'네이버 상품주문 ID'));capped(ids.size);
          const more=response.data.more;if(!more)break;
          cursor=value(more.moreFrom);sequence=value(more.moreSequence);
          if(!cursor||!sequence)throw new ConnectorError('네이버 다음 페이지 정보가 불완전합니다.', 'PAGINATION_ERROR',502);
        }
      }
      const uniqueIds=[...ids];remoteCount=uniqueIds.length;
      for(let i=0;i<uniqueIds.length;i+=300) {
        const chunk=uniqueIds.slice(i,i+300),response=await naverRequest('/v1/pay-order/seller/product-orders/query',{method:'POST',body:JSON.stringify({productOrderIds:chunk,quantityClaimCompatibility:true})});
        const details=ensureArray(response?.data,'네이버 상세 주문'),returned=new Set();
        for(const row of details){const order=normalizeNaver(row,credentials);if(!chunk.includes(order.lineId))throw new ConnectorError('네이버 상세 주문이 요청한 주문과 일치하지 않습니다.', 'INVALID_RESPONSE',502);returned.add(order.lineId);orders.push(order);}
        if(returned.size!==chunk.length)throw new ConnectorError('일부 네이버 상세 주문을 받지 못했습니다. 누락을 방지하기 위해 수집을 중단했습니다.', 'INCOMPLETE_RESPONSE',502);
      }
    } else {
      const limit=100,seen=new Set();let offset=0;
      while(true) {
        const page=await cafePage(from,to,offset,limit);remoteCount+=page.length;
        for(const order of page){const key=id(order.order_id,'카페24 주문번호');if(seen.has(key))throw new ConnectorError('카페24 주문 페이지가 반복됩니다. 다시 수집해주세요.', 'PAGINATION_ERROR',502);seen.add(key);orders.push(...normalizeCafe24(order,credentials));}capped(orders.length);
        if(page.length<limit)break;offset+=limit;
        if(offset>15000)throw new ConnectorError('카페24 조회 위치 한도에 도달했습니다. 날짜 범위를 줄여 다시 수집해주세요.', 'RESULT_LIMIT');
      }
    }
    // A moving order can be present in two status queries; keep its latest snapshot.
    const unique=new Map();for(const order of orders)unique.set(JSON.stringify([order.channel,order.account,order.orderNo,order.lineId]),order);
    return {orders:[...unique.values()],complete:true,remoteCount,notes:provider==='smartstore'?['조회 기간은 주문 생성일이 아닌 최종 변경일 기준입니다.']:provider==='coupang'?['주문 발주서의 5개 상태를 조회합니다. 반품·교환 상세 API와 직접배송 전용 조회는 포함되지 않습니다.']:['카페24 Access Token이 만료되면 새 토큰을 입력해주세요.']};
  }
  return {testConnection,collectOrders};
}
