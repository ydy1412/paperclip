import {addDays,array,bad,baseOrder,browserRequired,fail,id,identity,integer,mergeOrders,newTransport,object,orderDate,range,scalar,text} from './common.mjs';
const SELLER='https://shopping-seller.kakao.com',PARTNER='https://shopping-sell.kakao.com';
const NORMAL={ShippingRequest:'신규',ShippingWaiting:'발송대기',ShippingProgress:'배송중',ShippingComplete:'배송완료',BuyDecision:'구매확정'};
const CLAIMS=[['SELLER_CANCEL','cancelRequestedAt',['203','205','302','310','206','306','307','311','204','208','303','309'],'취소요청'],['SELLER_RETURN','returnRequestedAt',['501','504','505','506','508','509','510','507','511','503'],'반품요청'],['SELLER_EXCHANGE','exchangeRequestedAt',['401','404','405','406','407','403'],'교환요청']];
// Source: authenticated stores/me identity 0x0600112a, OMS/CMS read paths 0x06001138..5a.
export function createKakaoClient({credentials={},session}){
 const request=newTransport(session),headers={'Content-Type':'application/json',Origin:SELLER,Referer:SELLER+'/api/oms/v2/claims/searched','x-requested-with':'XMLHttpRequest'};let storeId;
 async function verifyIdentity(){
  const partner=await request(PARTNER+'/api/bizseller/v1/main',{headers});if(partner.isKakaoLoggedIn!==true)fail('카카오 계정 로그인을 완료해주세요.','SESSION_REQUIRED',401);
  const me=await request(SELLER+'/api/tstore/stores/me',{headers});storeId=id(me.storeId);const main=await request(SELLER+'/api/tstore/main',{headers}),domain=id(object(main.store).domain);
  return identity(credentials,storeId,domain);
 }
 const login=async()=>browserRequired('카카오 판매자 로그인창에서 비즈그룹·상점 선택과 관리자 추가 인증까지 완료해주세요.');
 function normalize(row,{status,claimType='없음'}={}){
  object(row);const orderNo=id(row.orderId),quantity=integer(row.quantity,{positive:true}),additional=row.isAdditionalItemOrder===true||row.isAdditionalItemOrder==='true',amount=additional?integer(row.additionalItemPrice):integer(row.standardPriceAmount)+integer(row.optionPriceAmount??0,{signed:true});if(!Number.isSafeInteger(amount))bad();
  const sourceStatus=text(row.statusName??row.orderStatusLabel??row.statusCode),result=baseOrder('카카오톡스토어',credentials.account||credentials.sellerId,{providerId:'kakao',orderNo,lineId:orderNo,orderedAt:orderDate(row.orderCreatedAt??row.orderPaidAt),product:text(row.itemName),option:text(row.optionTitle),sku:text(row.sellerItemNo),quantity,amount,buyer:text(row.ORDER_ORDER_MEMBER_NAME)||text(row.receiverName),recipient:text(row.receiverName),phone:text(row.receiverMobileNumber),postcode:text(row.zoneCode)||text(row.postNo),address:text(row.address),deliveryMemo:text(row.requestMessage),carrier:text(row.deliveryServiceCompanyName)||text(row.shippingMethodLabel),tracking:text(row.invoiceNumber),status,sourceStatus,claimType,sourceIds:{storeId,goodsId:id(row.itemId),deliveryOriginId:text(row.deliveryOriginId),paymentId:text(row.paymentId),claimId:text(row.claimId),orderLevelClaim:claimType!=='없음'}});
  if(/취소|반품|교환/.test(sourceStatus)){result.claimType=/반품/.test(sourceStatus)?'반품요청':/교환/.test(sourceStatus)?'교환요청':'취소요청';result.status=result.claimType==='교환요청'?'발송대기':'취소';result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;result.sourceIds.orderLevelClaim=true;}return result;
 }
 async function collectOrders(input){
  const {from,to}=range(input);await verifyIdentity();const orders=new Map();
  async function pages(path,base,state){
   const seen=new Set();for(let page=0;page<200;page++){
    const body=await request(SELLER+path,{method:'POST',headers,body:JSON.stringify({...base,size:'50',page:String(page)})}),rows=array(body.contents);if(rows.length>50)bad();if(!rows.length)break;
    for(const row of rows){const order=normalize(row,state),key=order.orderNo+'\0'+(state.claimType&&state.claimType!=='없음'?id(row.claimId):order.lineId);if(seen.has(key))bad();seen.add(key);mergeOrders(orders,order);}
    if(rows.length<50)break;if(page===199)fail('카카오 주문 조회 제한에 도달했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
   }
  }
  for(let start=from;start<=to;start=addDays(start,28)){
   const end=addDays(start,27)>to?to:addDays(start,27),period={from:start.replaceAll('-','')+'000000',to:end.replaceAll('-','')+'235959'};
   for(const [remote,status] of Object.entries(NORMAL))await pages('/api/oms/v2/orders/_search/SELLER_DELIVERY_ORDER/101',{statuses:[remote],deliveryAcceptedAt:period,sortProperty:'orderId',sortDirection:'desc'},{status});
   for(const [listType,searchPeriodKeyword,codes,claimType] of CLAIMS)for(const remote of codes)await pages('/api/cms/v2/claims/searched',{searchPeriod:period,searchPeriodKeyword,orderStatuses:[remote],sortProperty:'claimId',sortDirection:'asc',listType},{status:claimType==='교환요청'?'발송대기':'취소',claimType});
  }await verifyIdentity();return {complete:true,notes:[],orders:[...orders.values()],summary:{message:'카카오톡스토어 주문·취소·반품·교환 전체 페이지 조회 완료',count:orders.size}};
 }
 return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel:()=>session.cancel?.()};
}
