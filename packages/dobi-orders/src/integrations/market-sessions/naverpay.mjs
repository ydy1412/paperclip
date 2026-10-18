import {array,attr,bad,baseOrder,browserRequired,fail,html,id,identity,integer,loginForm,mergeOrders,newTransport,nodes,object,orderDate,range,scalar,text} from './common.mjs';
const HOST='https://admin.pay.naver.com',GQL=HOST+'/o/v3/graphql';
const COMMON='orderNo productOrderNo orderQuantity productName productUnitPrice productOptionAmt productOptionContents productPayAmt sellerProductManagementCode receiverName orderMemberName payDateTime productOrderStatus';
const ADDRESS=' receiverTelNo1 receiverTelNo2 receiverZipCode receiverAddress';
const PROFILES=[
  ...[['NEW_ORDER','신규'],['PLACE_ORDER','발송대기'],['PLACE_ORDER_RELEASE','발송대기']].map(([detail,status])=>({alias:'deliveryList',op:'findDeliveriesByDetailConditions_ForSaleDelivery',status,detail,order:'WAITING_DISPATCH',range:'PAY_COMPLETED',fields:COMMON+ADDRESS+' orderDateTime orderStatus productOrderMemo sellerOptionManagementCode deliveryCompanyName deliveryInvoiceNo individualCustomUniqueCode',service:true})),
  ...[['DELIVERING','배송중'],['DELIVERED','배송완료']].map(([order,status])=>({alias:'deliverySituationList',op:'findDeliveryStatusesByDetailConditions_ForSaleDeliveryStatus',status,detail:'ALL',order,range:'PAY_COMPLETED',fields:COMMON+ADDRESS+' orderStatus claimStatus deliveryCompanyName deliveryInvoiceNo quantityClaimYn'})),
  {alias:'purchaseDecisionList',op:'findPurchaseDecisionsByDetailConditions_ForPurchaseDecision',status:'구매확정',range:'PAY_COMPLETED',fields:COMMON+' orderStatus deliveryCompanyName deliveryInvoiceNo'},
  ...['CANCEL_REQUEST','CANCELING','CANCEL_DONE','CANCEL_REJECT'].map(claim=>({alias:'cancelList',op:'findClaimCancelsByDetailConditions_ForClaimCancel',status:claim==='CANCEL_DONE'?'취소':'신규',claim,claimType:'취소요청',range:'CANCEL_REQUEST',fields:COMMON+ADDRESS+' claimStatus'})),
  ...['RETURN_REQUEST','COLLECTING','COLLECT_DONE','RETURN_DONE','RETURN_REJECT'].map(claim=>({alias:'returnList',op:'findClaimReturnsByDetailConditions_ForClaimReturn',status:'배송완료',claim,claimType:'반품요청',range:'RETURN_REQUEST',fields:COMMON+' receiverTelNo1 receiverTelNo2 claimStatus deliveryCompanyName deliveryInvoiceNo'})),
  ...['EXCHANGE_REQUEST','COLLECTING','COLLECT_DONE','EXCHANGE_REDELIVERING','EXCHANGE_DONE','EXCHANGE_REJECT'].map(claim=>({alias:'exchangeList',op:'findClaimExchangesByDetailConditions_ForClaimExchange',status:claim==='EXCHANGE_REDELIVERING'?'배송중':'배송완료',claim,claimType:'교환요청',range:'EXCHANGE_REQUEST',fields:COMMON+' receiverTelNo1 receiverTelNo2 claimStatus deliveryCompanyName deliveryInvoiceNo reDeliveryCompanyName reDeliveryInvoiceNo'}))
];
function query(p){const defs=['merchantNo: String!','paging_page: Int','paging_size: Int','dateRange_from: String','dateRange_to: String','rangeType: RangeType','sort_direction: SortDirectionType','sort_type: SortType'];if(p.service)defs.push('serviceType: ServiceType!');if(p.order)defs.push('orderStatus: SearchOrderStatusType','detailedOrderStatus: DetailedSearchOrderStatusType');if(p.claim)defs.push('claimStatus: ClaimStatusType');return `query ${p.op}(${defs.map(s=>'$'+s).join(', ')}) { ${p.alias}: ${p.op}(${defs.map(s=>s.split(':')[0]).map(s=>s+': $'+s).join(', ')}) { elements { ${p.fields} } pagination { size totalElements page totalPages } } }`;}
const epoch=(v,end=false)=>String(Date.parse(v+'T00:00:00+09:00')+(end?86400000-1:0));

// NaverPay selected CIL 0x060011d3/d5, 0x060011ee..0x0600120e and Query1..6.
export function createNaverpayClient({credentials={},session,now=()=>new Date()}){
  const request=newTransport(session);let merchantNo='',merchantId='';
  async function verifyIdentity(){
    const raw=await request(HOST+'/merchant/managementlist',{format:'text',followRedirects:true}),doc=html(raw);if(loginForm(doc))fail('네이버페이 로그인이 필요합니다.','SESSION_REQUIRED',401);
    const ids=[...nodes(doc)].filter(n=>n.tagName==='input'&&attr(n,'name')==='login_merchantId').map(n=>id(attr(n,'value')));
    if(new Set(ids).size!==ids.length)bad();
    if(ids.length){const targets=credentials.storeName?ids.filter(v=>v===credentials.storeName):ids.length===1?ids:[];if(targets.length!==1)fail('네이버페이 연결에 가맹점 ID를 정확히 입력해주세요.','STORE_REQUIRED',409);merchantId=targets[0];
      const types=[...nodes(doc)].filter(n=>n.tagName==='input'&&attr(n,'id')==='hid_'+merchantId);if(types.length>1)bad();const merchantTypeCode=types.length?scalar(attr(types[0],'value')):'SHP';if(!/^[A-Z0-9_-]{1,30}$/.test(merchantTypeCode))bad();
      const result=await request(HOST+'/security_merchant_check',{method:'POST',body:new URLSearchParams({login_merchantId:merchantId,url:'',merchantTypeCode}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},format:'text',followRedirects:true});
      if(/naverAccountTwoAuthInfo|showPopup=reAuth/.test(result)||loginForm(html(result)))fail('네이버페이 로그인창에서 가맹점 추가 인증을 완료해주세요.','SESSION_REQUIRED',401);
    }else if(credentials.storeName&&!credentials.identityId)fail('네이버페이 가맹점 선택 화면에서 입력한 가맹점을 확인할 수 없습니다.','STORE_REQUIRED',409);
    const d=await request(HOST+'/front-api/m/v2/me/mall'),mall=object(d.body);merchantNo=id(mall.merchantNumber);if(!/^\d+$/.test(merchantNo))bad();
    return identity(credentials,merchantNo,merchantId||'네이버페이 가맹점 '+merchantNo);
  }
  async function login(){return browserRequired('네이버 로그인창에서 로그인과 네이버페이 가맹점 추가 인증을 완료해주세요.');}
  function normalize(row,p){object(row);const qty=integer(row.orderQuantity,{positive:true}),price=integer(row.productUnitPrice),extra=scalar(row.productOptionAmt??0).replaceAll(',','');if(!/^-?\d+$/.test(extra)||!Number.isSafeInteger(Number(extra)))bad();const amount=(price+Number(extra))*qty;if(!Number.isSafeInteger(amount)||amount<0||amount>1e12)bad();
    const rejected=p.claim?.endsWith('_REJECT'),claimType=p.claimType&&!rejected?p.claimType:'없음';
    const o=baseOrder('네이버페이',credentials.account||credentials.sellerId,{providerId:'naverpay',orderNo:id(row.orderNo),lineId:id(row.productOrderNo),orderedAt:orderDate(row.orderDateTime||row.payDateTime),product:text(row.productName),option:text(row.productOptionContents),sku:text(row.sellerProductManagementCode||row.sellerOptionManagementCode),quantity:qty,amount,buyer:text(row.orderMemberName),recipient:text(row.receiverName),phone:text(row.receiverTelNo1||row.receiverTelNo2),postcode:text(row.receiverZipCode),address:text(row.receiverAddress),deliveryMemo:text(row.productOrderMemo),carrier:text(row.reDeliveryCompanyName||row.deliveryCompanyName),tracking:text(row.reDeliveryInvoiceNo||row.deliveryInvoiceNo),status:p.status,sourceStatus:[text(row.orderStatus),text(row.claimStatus||p.claim),text(row.productOrderStatus)].filter(Boolean).join('/'),claimType,sourceIds:{merchantNo,paidAt:orderDate(row.payDateTime),...(p.claim?{claimStatus:p.claim}:{}),...(row.individualCustomUniqueCode?{customsCode:text(row.individualCustomUniqueCode)}:{})}});
    if(p.claim||row.quantityClaimYn===true||row.quantityClaimYn==='Y'||!['NEW_ORDER','PAYED','PLACE_ORDER','PLACE_ORDER_RELEASE','WAITING_DISPATCH','READY_TO_DISPATCH','DELAY_DISPATCH','DISPATCH_READY'].includes(text(row.productOrderStatus))||row.claimStatus&&!String(row.claimStatus).endsWith('_REJECT')&&row.claimStatus!=='NOT_REQUESTED'){o.sourceIds.fulfillableQty=0;o.sourceIds.needsReview=true;}
    return o;
  }
  async function collectOrders(input){
    const {from,to}=range(input),before=await verifyIdentity(),orders=new Map(),today=new Date(new Date(now()).getTime()+9*3600000).toISOString().slice(0,10);
    for(const p of PROFILES){const seen=new Set();let expected,finished=false;
      for(let page=1;page<=100;page++){
        const variables={merchantNo,paging_page:page,paging_size:500,rangeType:p.range,dateRange_from:epoch(from),dateRange_to:epoch(p.claim?today:to,true),sort_direction:p.claim?'ASC':'DESC',sort_type:p.claim?'CLAIM_REQUEST':p.alias==='purchaseDecisionList'?'PRODUCT_ORDER_PURCHASE_DECISION_COMPLETE_OPERATION_YMDT':'RECENTLY_ORDER_YMDT'};
        if(p.service)variables.serviceType='CHECKOUT';if(p.order){variables.orderStatus=p.order;variables.detailedOrderStatus=p.detail;}if(p.claim)variables.claimStatus=p.claim;if(p.alias==='exchangeList')delete variables.sort_type;
        const d=await request(GQL,{method:'POST',body:JSON.stringify({operationName:p.op,variables,query:query(p)}),headers:{'Content-Type':'application/json',Referer:HOST+'/o/n/sale/delivery/json'}});if(d.errors!==undefined&&(!Array.isArray(d.errors)||d.errors.length)||d.error)fail('네이버페이 GraphQL 조회가 실패했습니다. 전체 수집을 중단했습니다.','QUERY_ERROR');
        const table=object(d.data?.[p.alias]),rows=array(table.elements),pagination=object(table.pagination),total=integer(pagination.totalElements),pages=integer(pagination.totalPages);
        if(rows.length>500||integer(pagination.page)!==page||integer(pagination.size)!==500||pages!==(total?Math.ceil(total/500):pages)||!total&&![0,1].includes(pages)||total>10000||pages>100)bad();if(expected!==undefined&&expected!==total)fail('네이버페이 조회 중 총 주문 수가 변경되었습니다. 다시 수집해주세요.','UNSTABLE_PAGINATION',409);expected=total;
        for(const row of rows){const line=id(object(row).productOrderNo);if(seen.has(line))bad();seen.add(line);const o=normalize(row,p);if(o.sourceIds.paidAt<from||o.sourceIds.paidAt>to)continue;const old=orders.get(o.orderNo+'\0'+o.lineId);if(p.claim?.endsWith('_REJECT')&&old)continue;mergeOrders(orders,o);}
        if(page>=pages){if(seen.size!==total)bad();finished=true;break;}if(rows.length!==500)bad();
      }
      if(!finished)fail('네이버페이 전체 페이지 수집 한도에 도달했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
    }
    const after=await verifyIdentity();if(before.identityId!==after.identityId)fail('네이버페이 조회 중 가맹점이 변경되었습니다.','IDENTITY_MISMATCH',409);
    return {complete:true,orders:[...orders.values()],notes:['원본 PAY_COMPLETED 결제일로 조회하며 실제 주문 생성일을 보존합니다.','기존 원본의 배송중 page=1 고정 대신 전체 페이지를 조회합니다.'],summary:{message:'네이버페이 주문·취소·반품·교환 전체 페이지 조회 완료',count:orders.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:{merchantNo,merchantId}}),cancel:()=>session.cancel?.()};
}
