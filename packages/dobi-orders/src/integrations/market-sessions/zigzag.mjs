import {addDays,array,bad,baseOrder,browserRequired,fail,id,identity,integer,mergeOrders,newTransport,object,orderDate,range,scalar,text,token} from './common.mjs';
const ORIGIN='https://partners.kakaostyle.com',BASE='/api/provider/';
// Independently written minimal read queries using shipped GraphQL names/types/fields.
// Source: 0x06001530/32/40/42/44/46/48/4a/4e/52/54/68/6a/6c.
const FIELDS='order_item_number status product_id quantity total_amount product_info { name options price product_code custom_product_code product_item_code custom_product_item_code } order { order_number date_paid orderer { name email mobile_tel } } receiver { name mobile_tel postcode address1 address2 } shipping_memo shipping_company invoice_number date_created date_marked_in_transit date_confirmed';
const ALLOWED='query AllowedShopList($is_parent: Boolean) { shop_list(is_parent: $is_parent) { item_list { id name main_domain } } }';
const DETAIL='query GetOrderItemDetail($order_item_number: String!, $is_zonly: Boolean) { order_item(order_item_number: $order_item_number,is_zonly:$is_zonly) { order_item_number status product_id quantity total_amount product_info { name options price product_code custom_product_code product_item_code custom_product_item_code } order { order_number orderer { name email mobile_tel } } receiver { name mobile_tel address1 address2 } shipping_memo shipping_company invoice_number date_created date_paid date_marked_in_transit date_confirmed request_list { status date_requested date_completed } } }';
const NORMAL=[
 ['GetPreShipmentPartnerOrderItemList',['SHIPMENT_PROCESS_REQUESTED'],'date_shipment_process_requested','DATE_PAID_DESC'],
 ['GetPreShipmentPartnerOrderItemList',['AWAITING_SHIPMENT'],'date_shipment_process_requested','DATE_PAID_DESC'],
 ['GetShipmentPartnerOrderItemList',['IN_TRANSIT','DOMESTIC_IN_TRANSIT'],'date_marked_in_transit','DATE_MARKED_IN_TRANSIT_DESC'],
 ['GetShipmentPartnerOrderItemList',['SHIPPED'],'date_shipped','DATE_SHIPPED_DESC'],
 ['GetConfirmPartnerOrderItemList',['CONFIRMED'],'date_confirmed','DATE_CONFIRMED_DESC'],
];
const CLAIMS=[['GetPartnerCancelClaimList',['CANCEL_REQUESTED','CANCELLED'],'취소요청'],['GetPartnerReturnClaimList',['RETURN_REQUESTED','RETURN_COLLECTING','RETURN_COLLECTED','RETURNED'],'반품요청'],['GetPartnerExchangeClaimList',['EXCHANGE_REQUESTED','EXCHANGE_COLLECTING','EXCHANGE_COLLECTED','EXCHANGED'],'교환요청']];
const STATUS={NEW_ORDER:'신규',SHIPMENT_PROCESS_REQUESTED:'신규',AWAITING_SHIPMENT:'발송대기',IN_TRANSIT:'배송중',DOMESTIC_IN_TRANSIT:'배송중',INTERNATIONAL_AWAITING_SHIPMENT:'발송대기',INTERNATIONAL_IN_TRANSIT:'배송중',SHIPPED:'배송완료',CONFIRMED:'구매확정',PENDING:'신규',BEFORE_TRANSFER:'신규',SHIPPING_DEFERRED:'발송대기'};
function listQuery(name,dateField,claim=false){
 const dateVars=`$${dateField}_ymd_gte:Int,$${dateField}_ymd_lte:Int`,dateArgs=`${dateField}_ymd_gte:$${dateField}_ymd_gte,${dateField}_ymd_lte:$${dateField}_ymd_lte`;
 if(claim)return `query ${name}($request_status_list:[OrderItemRequestStatus!]!,${dateVars},$page:Int!,$items_per_page:Int!,$order_by:OrderItemListOrderType!,$order_search_param:OrderSearchParamFilter!,$order_item_search_param:OrderItemSearchParamFilter!){ partner_claim_list(request_status_list:$request_status_list,${dateArgs},page:$page,items_per_page:$items_per_page,order_by:$order_by,order_search_param:$order_search_param,order_item_search_param:$order_item_search_param){total_count item_list{order_item_request_number status date_requested order_item{${FIELDS}}}}}`;
 return `query ${name}($status_list:[OrderItemStatus!],${dateVars},$page:Int!,$items_per_page:Int!,$order_by:OrderItemListOrderType!){partner_order_item_list(status_list:$status_list,${dateArgs},exclude_new_exchange_order_item:true,page:$page,items_per_page:$items_per_page,order_by:$order_by){total_count item_list{${FIELDS}}}}`;
}
const ZONLY='query ZonlySearchOrderItemList($page:Int!,$items_per_page:Int!,$order:ZonlyOrderItemListOrderType!,$date_created_ymd_gte:Int,$date_created_ymd_lte:Int){zonly_order_item_list(page:$page,items_per_page:$items_per_page,order:$order,date_created_ymd_gte:$date_created_ymd_gte,date_created_ymd_lte:$date_created_ymd_lte){total_count item_list{order_item_number status date_created product_id quantity total_amount order{order_number orderer{name email}} product_info{name options price product_code custom_product_code product_item_code custom_product_item_code} active_request{status order_item_request_number}}}}';
export function createZigzagClient({credentials={},session,now=()=>new Date()}){
 const request=newTransport(session);let shop;
 function headers(){let cookies;try{cookies=JSON.parse(session.getSessionCookies());}catch{bad();}const values=[...new Set(array(cookies).filter(c=>c.name==='ZigzagMarketingCenter').map(c=>token(c.value)))];if(values.length!==1)fail('지그재그 로그인 세션을 확인할 수 없습니다.','SESSION_REQUIRED',401);return {'Content-Type':'application/json',ZigzagMarketingCenter:values[0]};}
 async function graph(name,query,variables,{root=false}={}){const segment=root?'':id(shop?.main_domain),body=await request(ORIGIN+BASE+segment+'/graphql/'+name,{method:'POST',body:JSON.stringify({query,variables}),headers:headers()});if(body.errors!==undefined&&array(body.errors).length)fail('지그재그 조회가 거절되었습니다. 로그인 또는 판매처 응답 변경을 확인해주세요.','REMOTE_ERROR');return object(body.data);}
 async function verifyIdentity(){
  const data=await graph('AllowedShopList',ALLOWED,{is_parent:null},{root:true}),shops=array(object(data.shop_list).item_list).map(object);let matches=shops;
  if(credentials.shopNo)matches=matches.filter(s=>id(s.id)===credentials.shopNo);else if(credentials.storeName)matches=matches.filter(s=>scalar(s.name)===credentials.storeName);else if(credentials.identityId)matches=matches.filter(s=>id(s.id)===credentials.identityId);
  if(matches.length!==1)fail('지그재그 다점포 계정은 연결 설정에 정확한 상점 이름 또는 상점 번호를 입력해주세요.','STORE_SELECTION_REQUIRED',400);shop=matches[0];id(shop.main_domain);
  const check=await request(ORIGIN+BASE+encodeURIComponent(shop.main_domain)+'/info/ad_display?time='+new Date(now()).getTime(),{headers:headers()});if(check.description!==undefined||Object.keys(check).length&&!['RUNNING','STOP'].includes(check.status))fail('지그재그 상점 세션을 확인할 수 없습니다.','SESSION_REQUIRED',401);
  return identity(credentials,id(shop.id),scalar(shop.name));
 }
 async function login(){
  if(!credentials.sellerId||!credentials.password)fail('지그재그 아이디와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);
  const raw=await request(ORIGIN+BASE+'login',{method:'POST',body:JSON.stringify({identifier:credentials.sellerId,password:credentials.password}),headers:{'Content-Type':'application/json'},format:'text'});if(/^\s*</.test(raw))return browserRequired('지그재그 로그인창에서 추가 인증을 완료해주세요.');return verifyIdentity();
 }
 function normalize(row,detail,{claimType='없음',zonly=false}={}){
  object(row);object(detail);if(id(detail.order_item_number)!==id(row.order_item_number))bad();const p=object(detail.product_info),order=object(detail.order),receiver={...(row.receiver??{}),...(detail.receiver??{})},quantity=integer(detail.quantity,{positive:true}),price=integer(p.price),amount=price*quantity;if(!Number.isSafeInteger(amount))bad();
  const sourceStatus=scalar(detail.status),status=STATUS[sourceStatus]??(/^EXCHANGE/.test(sourceStatus)?'발송대기':/CANCEL|RETURN/.test(sourceStatus)?'취소':undefined);if(!status)bad();let actualClaim=claimType;if(/^CANCEL/.test(sourceStatus))actualClaim='취소요청';if(/^RETURN/.test(sourceStatus))actualClaim='반품요청';if(/^EXCHANGE/.test(sourceStatus))actualClaim='교환요청';
  const result=baseOrder('지그재그',credentials.account||credentials.sellerId,{providerId:'zigzag',orderNo:id(order.order_number),lineId:id(detail.order_item_number),orderedAt:orderDate(detail.date_paid??row.order?.date_paid??detail.date_created??row.date_created),product:text(p.name),option:text(p.options),sku:text(p.custom_product_item_code)||text(p.product_item_code)||text(p.custom_product_code)||text(p.product_code),quantity,amount,unitPrice:price,buyer:text(order.orderer?.name),recipient:text(receiver.name),phone:text(receiver.mobile_tel),postcode:text(receiver.postcode),address:[text(receiver.address1),text(receiver.address2)].filter(Boolean).join(' '),deliveryMemo:text(detail.shipping_memo),carrier:text(detail.shipping_company),tracking:text(detail.invoice_number),status,sourceStatus,claimType:actualClaim,sourceIds:{shopId:id(shop.id),goodsId:id(detail.product_id),zonly}});
  if(zonly||['PENDING','BEFORE_TRANSFER','SHIPPING_DEFERRED'].includes(sourceStatus)||actualClaim!=='없음'||array(detail.request_list??[]).some(r=>/CANCEL|RETURN|EXCHANGE/.test(scalar(object(r).status)))){result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;}
  return result;
 }
 async function collectOrders(input){
  const {from,to}=range(input);await verifyIdentity();const orders=new Map();
  async function pages(name,query,variables,key,{claimType='없음',zonly=false}={}){
   const seen=new Set();let total;
   for(let page=1;page<=100;page++){
    const data=await graph(name,query,{...variables,page,items_per_page:500}),group=object(data[key]),rows=array(group.item_list),count=integer(group.total_count);if(total!==undefined&&total!==count||count>10000)bad();total=count;if(!rows.length){if(seen.size!==total)bad();break;}
    for(const original of rows){object(original);const row=claimType==='없음'?original:object(original.order_item),rowId=id(row.order_item_number),pageKey=claimType==='없음'?rowId:id(original.order_item_request_number);if(seen.has(pageKey))bad();seen.add(pageKey);
     const d=await graph('GetOrderItemDetail',DETAIL,{order_item_number:rowId,is_zonly:zonly});mergeOrders(orders,normalize(row,object(d.order_item),{claimType,zonly}));
    }
    if(seen.size>total)bad();if(seen.size===total)break;if(page===100)fail('지그재그 페이지 수집 제한에 도달했습니다.','LIMIT_EXCEEDED',400);
   }
  }
  for(let start=from;start<=to;start=addDays(start,28)){
   const end=addDays(start,27)>to?to:addDays(start,27),nFrom=Number(start.replaceAll('-','')),nTo=Number(end.replaceAll('-',''));
   for(const [name,statuses,dateField,orderBy] of NORMAL)await pages(name,listQuery(name,dateField),{status_list:statuses,[dateField+'_ymd_gte']:nFrom,[dateField+'_ymd_lte']:nTo,order_by:orderBy},'partner_order_item_list');
   for(const [name,statuses,claimType] of CLAIMS)for(const status of statuses)await pages(name,listQuery(name,'date_requested',true),{request_status_list:[status],date_requested_ymd_gte:nFrom,date_requested_ymd_lte:nTo,order_by:'DATE_REQUESTED_DESC',order_search_param:{},order_item_search_param:{}},'partner_claim_list',{claimType});
   await pages('GetConfirmPartnerOrderItemList',ZONLY,{date_created_ymd_gte:nFrom,date_created_ymd_lte:nTo,order:'DATE_CREATED_DESC'},'zonly_order_item_list',{zonly:true});
  }await verifyIdentity();return {complete:true,notes:['다점포 계정은 상점 이름 또는 상점 번호로 명시적으로 선택합니다. 직진배송은 중복 출고를 막습니다.'],orders:[...orders.values()],summary:{message:'지그재그 상점 주문·클레임·직진배송 전체 페이지 조회 완료',count:orders.size}};
 }
 return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel:()=>session.cancel?.()};
}
