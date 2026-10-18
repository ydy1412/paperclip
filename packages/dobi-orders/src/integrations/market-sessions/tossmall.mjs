import {array,bad,baseOrder,browserRequired,fail,id,identity,integer,jsonState,mergeOrders,newTransport,object,orderDate,range,scalar,text,addDays} from './common.mjs';
const MERCHANT='https://shopping-merchant-api.toss.im/api-public/v3/shopping-merchant',API='https://api-public.toss.im';
const STATES=[['결제완료','신규'],['상품준비중','발송대기'],['발송지연','발송대기'],['배송중','배송중'],['배송완료','배송완료'],['구매확정','구매확정']];
const CLAIMS=[['CANCEL','취소요청',['REQUESTED','COMPLETED','REJECTED_REQUEST','REJECTED']],['RETURN','반품요청',['REQUESTED','COLLECTING','COLLECTED','COMPLETED','REJECTED_REQUEST','REJECTED']],['EXCHANGE','교환요청',['REQUESTED','COLLECTING','COLLECTED','DELIVERING','COMPLETED','REJECTED_REQUEST','REJECTED']]];
function* periods(from,to){for(let a=from;a<=to;a=addDays(a,28))yield [a,[addDays(a,27),to].sort()[0]];}

// TossMall read paths: selected IL 0x060015ed, 0x0600160b/0f/1f/21.
export function createTossmallClient({credentials={},session,now=()=>new Date()}){
  const request=newTransport(session),saved=jsonState(credentials);let merchantId='',merchantUserId='';
  const userAgent=saved.userAgent?scalar(saved.userAgent,{max:1000}):'';
  const headers=()=>({'Content-Type':'application/json',Referer:'https://shopping-seller.toss.im/',...(userAgent?{'User-Agent':userAgent}:{}),...(merchantId?{'X-Merchant-ID':merchantId}:{})});
  async function api(url,options={}){const d=await request(url,{...options,headers:{...headers(),...options.headers}});if(d.resultType!==undefined&&String(d.resultType).toUpperCase()!=='SUCCESS')fail('토스쇼핑 인증 또는 조회가 실패했습니다. 전체 수집을 중단했습니다.','REMOTE_ERROR');return object(d.success);}
  async function verifyIdentity(){
    const d=await api(MERCHANT+'/my-info'),user=object(d.merchantUser),list=array(d.merchantMappingInfo);merchantUserId=id(user.id);
    if(!list.length)fail('토스쇼핑 판매자 계정을 확인할 수 없습니다.','IDENTITY_REQUIRED',409);
    const target=credentials.storeName?list.filter(x=>text(object(x).merchantName)===credentials.storeName):list.length===1?list:[];
    if(target.length!==1)fail('토스쇼핑에 연결할 판매자명을 정확하게 입력해주세요.','STORE_REQUIRED',409);
    merchantId=id(target[0].merchantId);if(!/^\d+$/.test(merchantId))bad();
    return identity(credentials,merchantUserId+':'+merchantId,text(target[0].merchantName));
  }
  async function login(){return browserRequired('토스쇼핑 로그인창에서 로그인과 추가 인증을 완료해주세요.');}
  function normal(row,status){
    object(row);const quantity=integer(row.quantity,{positive:true}),amount=integer(row.price); // Original divides this total by quantity for the displayed unit price.
    const sourceStatus=text(row.orderProductStatus),known=STATES.find(([name])=>name===sourceStatus);
    const result=baseOrder('토스쇼핑',credentials.account||credentials.sellerId,{providerId:'tossmall',orderNo:id(row.orderId),lineId:id(row.orderProductId),orderedAt:orderDate(row.orderedAt),product:text(row.productName||row.tacaName),option:text(row.optionName),sku:text(row.productManagementCode||row.productItemManagementCode),quantity,amount,buyer:text(row.ordererName),recipient:text(row.receiverName),phone:text(row.receiverPhone),postcode:text(row.zipCode),address:[text(row.address),text(row.detailAddress)].filter(Boolean).join(' '),deliveryMemo:text(row.shippingNote),tracking:text(row.shippingTrackingNumber),carrier:text(row.deliveryCompanyCode),status:known?.[1]??status,sourceStatus,claimType:'없음',sourceIds:{merchantId,merchantUserId,productId:id(row.productId)}});
    if(!known){result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;}if(row.refundInfo||row.cancelInfo){result.claimType=row.refundInfo?'반품요청':'취소요청';result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;}return result;
  }
  function claim(row,type,claimType){
    object(row);const order=object(row.order),product=object(row.product),status=scalar(row.status),rejected=['REJECTED','REJECTED_REQUEST'].includes(status);
    if(!CLAIMS.find(x=>x[0]===type)[2].includes(status))bad();
    const result=baseOrder('토스쇼핑',credentials.account||credentials.sellerId,{providerId:'tossmall',orderNo:id(order.id),lineId:id(order.orderProductId),orderedAt:orderDate(order.createdDt),product:text(product.name),option:text(product.optionName),quantity:integer(product.quantity,{positive:true}),amount:integer(order.price),buyer:text(order.ordererName),recipient:text(order.receiverName),phone:text(order.receiverPhoneNumber),postcode:text(order.zipCode),address:[text(order.address),text(order.detailAddress)].filter(Boolean).join(' '),carrier:text(order.deliveryCompany),status:type==='CANCEL'?'취소':type==='EXCHANGE'&&status==='DELIVERING'?'배송중':'배송완료',sourceStatus:type+'/'+status,claimType:rejected?'없음':claimType,sourceIds:{merchantId,merchantUserId,claimId:id(row.id),claimStatus:status,productId:id(product.id),fulfillableQty:0,needsReview:true}});
    return {order:result,rejected};
  }
  async function collectOrders(input){
    const {from,to}=range(input),before=await verifyIdentity(),orders=new Map();
    for(const [search,status] of STATES)for(const [startDate,endDate] of periods(from,to)){
      const seen=new Set(),cursors=new Set();let cursor,total,finished=false;
      for(let page=1;page<=20;page++){
        const body={pageType:'ORDER_MANAGEMENT',orderSearchStatus:search,masking:false,startDate,endDate,pageSize:500,menuName:'shopping-seller-toss-im.주문배송관리.'+search,...(page===1?{merchantId:JSON.rawJSON(merchantId)}:{cursor,cursorDirection:'NEXT',totalCount:total})};
        const d=await api(API+'/api-public/v3/shopping-order/order/histories',{method:'POST',body:JSON.stringify(body)}),rows=array(d.results);if(rows.length>500)bad();
        const paging=d.paging===undefined?undefined:object(d.paging),count=paging?.totalCount===undefined?undefined:integer(paging.totalCount);if(count!==undefined){if(total!==undefined&&count!==total)fail('토스쇼핑 조회 중 총 주문 수가 변경되었습니다. 다시 수집해주세요.','UNSTABLE_PAGINATION',409);total=count;}if(total>10000)fail('토스쇼핑 조회는 한 번에 10,000품목까지 가능합니다.','LIMIT_EXCEEDED',400);
        for(const row of rows){const line=id(object(row).orderProductId);if(seen.has(line))bad();seen.add(line);const order=normal(row,status);if(order.orderedAt>=from&&order.orderedAt<=to)mergeOrders(orders,order);}
        const next=paging?.nextCursor;if(next===null||next===undefined||next===''){if(total!==undefined&&seen.size!==total||rows.length===500&&total===undefined)bad();finished=true;break;}
        const key=JSON.stringify(next);if(key.length>2000||cursors.has(key)||!rows.length)bad();cursors.add(key);cursor=next;
      }
      if(!finished)fail('토스쇼핑 전체 페이지 수집 한도에 도달했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
    }
    // Claims use the same paid-date range as the shipped API, not the claim date.
    for(const [type,claimType,statuses] of CLAIMS)for(const status of statuses)for(const [startDate,endDate]of periods(from,to)){
      const seen=new Set();let finished=false;
      for(let page=1;page<=200;page++){
        const d=await api(API+'/api-public/v1/shopping-order/orders/claims',{method:'POST',body:JSON.stringify({fromPaidDate:startDate,toPaidDate:endDate,type,statuses:[status],page,masking:false,menuName:'shopping-seller-toss-im.취소교환반품.'+type+'.'+status})}),rows=array(d.claims);if(rows.length>50)bad();
        for(const value of rows){const key=id(object(value).id);if(seen.has(key))bad();seen.add(key);const {order,rejected}=claim(value,type,claimType),old=orders.get(order.orderNo+'\0'+order.lineId);if(rejected&&old)continue;mergeOrders(orders,order);}
        if(rows.length<50){finished=true;break;}
      }
      if(!finished)fail('토스쇼핑 클레임 전체 조회 한도에 도달했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
    }
    const after=await verifyIdentity();if(before.identityId!==after.identityId)fail('토스쇼핑 조회 중 판매자가 바뀌었습니다.','IDENTITY_MISMATCH',409);
    return {complete:true,orders:[...orders.values()],notes:['클레임 기간은 원본 fromPaidDate/toPaidDate 결제일 기준입니다.'],summary:{message:'토스쇼핑 주문·취소·반품·교환 전체 페이지 조회 완료',count:orders.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:{userAgent,merchantId,merchantUserId}}),cancel:()=>session.cancel?.()};
}
