import {array,bad,baseOrder,credentialIdentity,fail,id,integer,jsonState,mergeOrders,newTransport,object,range,scalar,text,token} from './common.mjs';
const API='https://alwayz-seller-back.ilevit.com';
// Source 0x06000b7d/80/81/82, 0x0600158c/8e/a8/ac. No remote seller ID was read by ShopMine.
const STATES={
 'pre-shipping-pre-excel':['신규','없음','/pre-excel','pre-shipping'],
 'pre-shipping-post-excel':['발송대기','없음','/post-excel','pre-shipping'],
 'shipping-sending':['배송중','없음','','shipping-sending'],'shipping':['배송중','없음','','shipping'],
 'arrived':['구매확정','없음','','arrived'],'refunding':['취소','반품요청','','refunding'],
 'refunded':['취소','반품요청','','refunded'],'canceling-shipping':['취소','취소요청','','canceling-shipping'],
 'canceled-shipping':['취소','취소요청','','canceled-shipping'],'canceled-pre-shipping':['취소','취소요청','','canceled-pre-shipping'],
 'canceling-pre-shipping':['취소','취소요청','','canceling-pre-shipping'],
 'canceling-pre-shipping-pre-excel':['취소','취소요청','','canceling-pre-shipping-pre-excel'],
 'canceling-pre-shipping-post-excel':['취소','취소요청','','canceling-pre-shipping-post-excel'],
};
function utc(value){const s=scalar(value),t=Date.parse(s);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)||!Number.isFinite(t))bad();return t;}
const kst=value=>new Date(utc(value)+9*3600000).toISOString().slice(0,10);
function optionName(row){
 const selected=object(row.selectedOption),options=object(object(row.itemInfo).optionsInfo),names=array(options.optionNames),all=array(options.totalOptions);if(!names.length)return '';
 if(names.length>20||all.length<names.length)bad();return names.map((name,index)=>{
  if(selected[String(index)]===undefined)return `${index+1}. ${text(name)}:`;
  const choice=integer(selected[String(index)]),axis=array(all[index]);if(choice>=axis.length)bad();return `${index+1}. ${text(name)}: ${text(object(axis[choice]).name)}`;
 }).join('   ');
}
export function createAlwayzClient({credentials={},session}){
 const request=newTransport(session);let accessToken=jsonState(credentials).token||'',submitted=false;
 const headers=()=>({'x-access-token':token(accessToken),Origin:'https://alwayzseller.ilevit.com',Referer:'https://alwayzseller.ilevit.com/','Content-Type':'application/json'});
 const api=(path,options={})=>request(API+path,{...options,headers:{...headers(),...options.headers}});
 async function verifyIdentity(){if(!accessToken)fail('올웨이즈에 먼저 로그인해주세요.','SESSION_REQUIRED',401);const body=await api('/sellers');if(String(body.status)!=='200')fail('올웨이즈 인증 세션을 확인할 수 없습니다.','SESSION_REQUIRED',401);return credentialIdentity(credentials,submitted?'credential-login':'user-confirmation');}
 async function login(){
  if(!credentials.sellerId||!credentials.password)fail('올웨이즈 판매자 아이디와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);accessToken='';submitted=false;
  const body=await request(API+'/sellers/login',{method:'POST',body:JSON.stringify({sellerName:credentials.sellerId,password:credentials.password}),headers:{Origin:'https://alwayzseller.ilevit.com',Referer:'https://alwayzseller.ilevit.com/','Content-Type':'application/json'}});
  if(String(body.status)!=='200'||object(body.data).success!==true)fail('올웨이즈 로그인을 확인할 수 없습니다. 아이디와 비밀번호를 확인해주세요.','LOGIN_FAILED',401);
  accessToken=token(body.data.token);submitted=true;return verifyIdentity();
 }
 function normalize(row,bucket){
  object(row);const state=STATES[scalar(row.status)];if(!state||row.status!==bucket)bad();const item=object(row.itemInfo),selected=object(row.selectedOption),address=object(row.addressInfo),shipping=row.shippingInfo==null?{}:object(row.shippingInfo);
  if(row.isTeamDeal!==undefined&&typeof row.isTeamDeal!=='boolean')bad();const priceKey=row.isTeamDeal?'teamPurchasePrice':'individualPurchasePrice',price=integer(selected[priceKey]??item[priceKey]),quantity=integer(row.quantity,{positive:true}),amount=price*quantity;if(!Number.isSafeInteger(amount))bad();
  return baseOrder('올웨이즈',credentials.account||credentials.sellerId,{providerId:'alwayz',orderNo:id(row._id),lineId:id(row._id),orderedAt:kst(row.createdAt??row.payedAt),product:text(item.itemTitle),option:optionName(row),sku:text(selected.optionCode),quantity,amount,unitPrice:price,buyer:text(address.recipient),recipient:text(address.recipient),phone:text(address.recipientPhoneNumber),postcode:text(address.postcode),address:[text(address.postcodeAddress),text(address.detailAddress)].filter(Boolean).join(' '),deliveryMemo:text(address.frontDoorPassword),tracking:text(shipping.shippingNumber),carrier:text(shipping.shippingCompanyCode),status:state[0],sourceStatus:row.status,claimType:state[1],sourceIds:{itemId:id(item.itemId),paidAt:scalar(row.payedAt)}});
 }
 async function collectOrders(input){
  const {from,to}=range(input);await verifyIdentity();const body=await api('/sellers/orders/status-recent'),orders=new Map(),seenStatuses=new Set();
  // ShopMine treats 4010 as a no-orders response. Authentication is checked independently before AND after it.
  if(String(body.status)==='4010'){await verifyIdentity();return {complete:true,notes:['원본의 4010 주문 없음 판정과 전후 별도 인증 검사를 적용했습니다.'],orders:[],summary:{message:'올웨이즈 서버가 주문 없음(4010)을 반환했습니다.',count:0}};}
  if(!['200','2000'].includes(String(body.status)))fail('올웨이즈 주문 조회가 실패했습니다.','REMOTE_ERROR');
  for(const bucket of array(body.data)){
   object(bucket);const status=scalar(bucket.status),state=STATES[status];if(!state||seenStatuses.has(status))bad();seenStatuses.add(status);
   let page=array(bucket.topKOrders),lastCursor=Infinity;const seen=new Set();
   for(let pageNo=0;pageNo<500;pageNo++){
    if(!page.length)break;let cursor=Infinity;
    for(const row of page){object(row);const current=utc(row.payedAt),rowId=id(row._id);if(seen.has(rowId)||current>cursor)bad();seen.add(rowId);cursor=current;const paidDate=kst(row.payedAt);if(paidDate>=from&&paidDate<=to)mergeOrders(orders,normalize(row,status));}
    if(cursor>=lastCursor)bad();lastCursor=cursor;if(kst(new Date(cursor).toISOString())<from)break;
    if(pageNo===499)fail('올웨이즈 페이지 수집 제한에 도달했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
    const next=await api('/sellers/orders/status'+state[2]+'/info-request',{method:'POST',body:JSON.stringify({status:state[3],payedAt:new Date(cursor).toISOString()})});
    if(!['200','2000'].includes(String(next.status)))fail('올웨이즈 다음 주문 페이지 조회가 실패했습니다.','REMOTE_ERROR');page=array(next.data);
   }
  }
  await verifyIdentity();return {complete:true,notes:['원본 서버 응답에서 판매자 ID는 확인되지 않아 계정 소유자 확인이 필요합니다.'],orders:[...orders.values()],summary:{message:'올웨이즈 상태별 주문·클레임 조회 완료',count:orders.size,identitySource:submitted?'credential-login':'user-confirmation'}};
 }
 return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:JSON.stringify({token:accessToken})}),cancel:()=>{accessToken='';session.cancel?.();}};
}
