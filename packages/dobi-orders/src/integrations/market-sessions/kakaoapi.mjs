import {addDays,array,bad,baseOrder,credentialIdentity,fail,id,integer,mergeOrders,newTransport,object,orderDate,range,scalar,text,token} from './common.mjs';
const API='https://kapi.kakao.com';
// Read-only reconstruction. No ShopMine app key, partner ID or channel-ids constant is copied.
// Source 0x060005c4/c5/b7, 0x060010e8/f4/f6. Registration is deliberately not performed here.
const NORMAL={ShippingRequest:'신규',ShippingWaiting:'발송대기',ShippingProgress:'배송중',ShippingComplete:'배송완료',BuyDecision:'구매확정'};
const CANCEL=['PayCancelRequest','RefundRequest','ShippingCancelRequest','ShippingCancelRequestBuyer','RefundWaiting','ShippingRefundWaiting','ShippingCancelRequestSeller','ShippingRefundRequest','PayCancelComplete','RefundComplete','ShippingCancelComplete','ShippingRefundComplete'];
const RETURN=['ReturnRequest','ReturnShippingProgress','ReturnCancelRequest','ReturnRefundRequest','ReturnRefundWaiting','ReturnRefundFailed','ReturnShippingComplete','ReturnCancelComplete','ReturnRefundComplete','ReturnPending','ReturnRequestRetract'];
const EXCHANGE=['ExchangeRequest','ExchangeReturning','ExchangeReturnComplete','ExchangeShippingProgress','ExchangeShippingComplete','ExchangePending','ExchangeRequestRetract'];
const ALL=[...Object.keys(NORMAL),...CANCEL,...RETURN,...EXCHANGE];
function statusOf(status){if(NORMAL[status])return [NORMAL[status],'없음'];if(CANCEL.includes(status))return ['취소','취소요청'];if(RETURN.includes(status))return ['취소','반품요청'];if(EXCHANGE.includes(status))return ['발송대기','교환요청'];bad();}
export function createKakaoApiClient({credentials={},session,now=()=>new Date()}){
 const request=newTransport(session);
 function headers(){if(!credentials.appKey||!credentials.sellerAppKey)fail('카카오 API는 본인 앱 키와 판매자 앱 키가 필요합니다.','MISSING_CREDENTIALS',400);const h={Authorization:'KakaoAK '+token(credentials.appKey),'Target-Authorization':'KakaoAK '+token(credentials.sellerAppKey)};if(credentials.channelIds)h['channel-ids']=token(credentials.channelIds);return h;}
 async function api(path){const body=await request(API+path,{headers:headers()});if(String(body.code)==='-401')fail('카카오 API 자체 발급 키의 인증 권한을 확인해주세요.','SESSION_REQUIRED',401);if(body.code!==undefined&&String(body.code)!=='0')fail('카카오 API 조회가 거절되었습니다. 자체 발급 키의 권한과 사용량을 확인해주세요.','REMOTE_ERROR');return body;}
 const today=()=>new Date(new Date(now()).getTime()+9*3600000).toISOString().slice(0,10);
 async function verifyIdentity(){const day=today().replaceAll('-',''),q=new URLSearchParams({from:day+'000000',to:day+'235959',orderStatus:'ShippingRequest',size:'100'}),body=await api('/v2/shopping/orders/paidAt?'+q);array(body.contents);return {...credentialIdentity(credentials,'user-confirmation'),summary:{message:'자체 발급 키의 주문 읽기 권한을 확인했습니다. 계정 소유자는 사용자 확인이 필요합니다.'}};}
 async function idsFor(day,status){
  const q=new URLSearchParams({from:day.replaceAll('-','')+'000000',to:day.replaceAll('-','')+'235959',orderStatus:status,size:'100'}),ids=[],seen=new Set();let next;
  for(let page=0;page<100;page++){
   const path='/v2/shopping/orders/paidAt?'+q+(next?'&token='+encodeURIComponent(next):''),body=await api(path),rows=array(body.contents);
   for(const row of rows){const orderId=id(object(row).orderId);if(seen.has(orderId))bad();seen.add(orderId);ids.push(orderId);if(ids.length>10000)bad();}
   if(body.token===undefined||body.token===null)return ids;const cursor=token(body.token);if(cursor===next||!rows.length)bad();next=cursor;if(page===99)fail('카카오 API 페이지 제한에 도달했습니다.','LIMIT_EXCEEDED',400);
  }
 }
 function normalize(row){
  object(row);const b=object(row.orderBase),p=object(row.orderProduct),d=row.orderDelivery==null?{}:object(row.orderDelivery),r=row.orderDeliveryRequest==null?{}:object(row.orderDeliveryRequest),orderNo=id(b.id),quantity=integer(p.quantity,{positive:true}),[status,claimType]=statusOf(scalar(b.status));
  const additional=text(p.additionalProductName),amount=additional&&additional!=='알수없음'?integer(p.additionalProductPrice):integer(p.productPrice)+integer(p.optionPrice??0,{signed:true});if(!Number.isSafeInteger(amount))bad();
  return baseOrder('카카오API',credentials.account||credentials.sellerId,{providerId:'kakaoapi',orderNo,lineId:orderNo,orderedAt:orderDate(b.createdAt??b.paidAt),product:text(p.name),option:text(p.optionContent),sku:text(p.sellerItemNo),quantity,amount,buyer:'',recipient:text(d.receiverName),phone:text(d.receiverMobileNumber)||text(d.receiverPhoneNumber),postcode:text(d.roadZipCode)||text(d.zipcode),address:text(d.receiverAddress),deliveryMemo:text(r.requirement),carrier:text(d.deliveryServiceCompanyName)||text(d.deliveryCompanyCode),tracking:text(d.invoiceNumber),status,sourceStatus:b.status,claimType,sourceIds:{goodsId:id(p.id),paymentId:text(b.paymentId),deliveryOriginId:text(b.deliveryAmountOriginId),orderLevelClaim:claimType!=='없음'}});
 }
 async function collectOrders(input){
  const {from,to}=range(input),nowDay=today();if(from<addDays(nowDay,-365)||to>nowDay)fail('카카오 API 조회는 오늘부터 최근 365일 이내로 지정해주세요.','INVALID_DATE',400);await verifyIdentity();const all=new Set();
  for(let day=from;day<=to;day=addDays(day,1))for(const status of ALL)for(const orderId of await idsFor(day,status)){all.add(orderId);if(all.size>10000)fail('카카오 API는 한 번에 10,000품목까지 수집할 수 있습니다.','LIMIT_EXCEEDED',400);}
  const ids=[...all],orders=new Map();for(let at=0;at<ids.length;at+=300){const batch=ids.slice(at,at+300),rows=array((await api('/v1/shopping/orders/bulk?order_ids='+batch.map(encodeURIComponent).join(','))).content),wanted=new Set(batch);
   for(const row of rows){const order=normalize(row);if(!wanted.delete(order.orderNo))bad();mergeOrders(orders,order);}if(wanted.size)bad();
  }await verifyIdentity();return {complete:true,notes:['타사 프로그램의 인증 상수를 복제하지 않고 본인 앱 키·판매자 앱 키의 읽기 권한만 사용합니다.','판매자 등록 API는 호출하지 않으며 API 키 소유자·사용 권한 확인은 별도로 필요합니다.'],orders:[...orders.values()],summary:{message:'자체 발급 카카오 API 키로 주문·클레임 상태 및 상세 조회 완료',count:orders.size,registrationPerformed:false,identitySource:'user-confirmation'}};
 }
 return {login:verifyIdentity,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel:()=>session.cancel?.()};
}
