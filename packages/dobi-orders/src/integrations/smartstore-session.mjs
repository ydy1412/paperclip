import {parse as parseLossless} from 'lossless-json';
import he from 'he';
import {createSellerSession} from './seller-session.mjs';

// Read-only reconstruction from SmartStore's selected CIL. See docs/SMARTSTORE.md.
const SELL='https://sell.smartstore.naver.com',ACCOUNTS='https://accounts.commerce.naver.com',DAY=86400000,PAGE_SIZE=500,MAX_PAGES=100,MAX_ORDERS=10000;
const CALLBACK=SELL+'/#/home/dashboard';
const SERVER_TIME={operationName:'getGraphqlServerTime',variables:{},query:'query getGraphqlServerTime { currentServerTime: getGraphqlServerTime { serverTime __typename } }'};
const COMMON='orderNo productOrderNo orderQuantity productName productUnitPrice productPayAmt productOptionAmt productOptionContents sellerProductManagementCode sellerInternalCode1 sellerInternalCode2 productNo productUrl orderMemberName orderMemberId receiverName productOrderStatus payDateTime deliveryFeeAmt deliveryFeeRatingClass deliveryFeeDiscountAmt totalDiscountAmt deliveryAttributeText';
const DELIVERY_FIELDS=COMMON+' orderStatus orderDateTime orderMemberTelNo receiverTelNo1 receiverTelNo2 receiverZipCode receiverDisplayBaseAddress receiverDisplayDetailAddress receiverIntegratedAddress productOrderMemo sellerOptionManagementCode individualCustomUniqueCode dispatchDateTime deliveryCompanyName deliveryInvoiceNo quantityClaimYn';
const SHIPPED_FIELDS=COMMON+' orderStatus claimStatus orderMemberTelNo receiverTelNo1 receiverTelNo2 receiverZipCode receiverAddress dispatchDateTime deliveryCompleteDateTime deliveryCompanyName deliveryInvoiceNo quantityClaimYn';
const CLOSED_FIELDS=COMMON+' orderStatus dispatchDateTime deliveryCompleteDateTime purchaseDecisionCompleteDateTime sellerOptionManagementCode deliveryCompanyName deliveryInvoiceNo';
const CLAIM_FIELDS=COMMON+' claimStatus orderMemberTelNo receiverTelNo1 receiverTelNo2 claimRequestReason';
const KNOWN_STATUS=new Set('ADMIN_CANCEL_DONE CANCEL_REQUEST PLACE_ORDER PLACE_ORDER_RELEASE CANCELING CANCELED READY_TO_DISPATCH DELAY_DISPATCH NEW_ORDER CANCEL_DONE CANCEL_REJECT HOLDBACK_REQUESTED PURCHASE_DECISION_REQUEST REDELIVERING MATTER_ON_DELIVERY ORDER_QUANTITY DELIVERING PURCHASE_DECIDED PAYMENT_WAITING CANCELED_BY_NOPAYMENT DELIVERED PAYED RETURNED EXCHANGED NOT_REQUESTED EXCHANGE_DELIVERY_REQUEST REQUESTED WAITING_DISPATCH CHANGE_ADDRESS_BEFORE_DISPATCH RETURN HOLDBACK RELEASED EXCHANGE WAITING PURCHASE_DECISION_HOLDBACK ADMIN_CANCEL CANCEL_BEFORE_DISPATCH DISPATCH_READY RETURN_REQUEST COLLECTING COLLECT_DONE RETURN_DONE RETURN_REJECT EXCHANGE_REQUEST EXCHANGE_REDELIVERING EXCHANGE_DONE EXCHANGE_REJECT'.split(' '));
const SEARCHES=[
  {key:'deliveryList',operation:'smartstoreFindDeliveriesByDetailConditions_ForSaleDelivery',type:'delivery',fields:DELIVERY_FIELDS,status:'신규',orderStatus:'WAITING_DISPATCH',detailedOrderStatus:'NEW_ORDER'},
  ...['PLACE_ORDER','PLACE_ORDER_RELEASE'].map(detailedOrderStatus=>({key:'deliveryList',operation:'smartstoreFindDeliveriesByDetailConditions_ForSaleDelivery',type:'delivery',fields:DELIVERY_FIELDS,status:'발송대기',orderStatus:'WAITING_DISPATCH',detailedOrderStatus})),
  ...[['DELIVERING','배송중'],['DELIVERED','배송완료']].map(([orderStatus,status])=>({key:'deliveryStatusListMp',operation:'SmartStoreFindDeliveryStatusesByDetailConditions_ForSaleDeliveryStatus',type:'shipped',fields:SHIPPED_FIELDS,status,orderStatus,detailedOrderStatus:'ALL'})),
  {key:'purchaseDecisionList',operation:'SmartStoreFindPurchaseDecisionsByDetailConditions_ForPurchaseDecision',type:'closed',fields:CLOSED_FIELDS,status:'구매확정'},
  ...['CANCEL_REQUEST','CANCELING','CANCEL_DONE','CANCEL_REJECT'].map(claimStatus=>({key:'cancelListMp',operation:'findClaimCancelsByDetailConditionsMp_ForClaimCancel',type:'cancel',fields:CLAIM_FIELDS+' receiverAddress receiverZipCode cancelDateTime clamRequestDateTime',status:claimStatus==='CANCEL_DONE'?'취소':'신규',claimType:'취소요청',claimStatus})),
  ...['RETURN_REQUEST','COLLECTING','COLLECT_DONE','RETURN_DONE','RETURN_REJECT'].map(claimStatus=>({key:'returnList',operation:'findClaimReturnsByDetailConditionsMp_ForClaimReturn',type:'return',fields:CLAIM_FIELDS+' claimRequestDateTime refundDateTime deliveryCompanyName deliveryInvoiceNo',status:'배송완료',claimType:'반품요청',claimStatus})),
  ...['EXCHANGE_REQUEST','COLLECTING','COLLECT_DONE','EXCHANGE_REDELIVERING','EXCHANGE_DONE','EXCHANGE_REJECT'].map(claimStatus=>({key:'exchangeList',operation:'SmartStoreFindClaimExchangesByDetailConditions_ForClaimExchange',type:'exchange',fields:CLAIM_FIELDS+' exchangeRequestDateTime reDeliveryCompanyName reDeliveryInvoiceNo deliveryCompanyName deliveryInvoiceNo',status:claimStatus==='EXCHANGE_REDELIVERING'?'배송중':'배송완료',claimType:'교환요청',claimStatus})),
];

export class SmartstoreSessionError extends Error {
  constructor(message,code='INVALID_RESPONSE',status=502){super(message);this.name='SmartstoreSessionError';this.code=code;this.status=status;}
}
const fail=(message,code,status)=>{throw new SmartstoreSessionError(message,code,status);};
const bad=()=>fail('스마트스토어 응답 형식을 확인할 수 없습니다. 전체 수집을 중단했습니다.');
function str(v){if(v===null||v===undefined)return '';if(typeof v==='string')return v.trim();if(typeof v==='number'&&Number.isSafeInteger(v))return String(v);bad();}
function text(v){const s=str(v);if(s.length>10000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s))bad();return he.decode(s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<[^>]*>/g,'')).trim();}
function id(v){const s=str(v);if(!/^[1-9]\d{0,29}$/.test(s))bad();return s;}
function numeric(v,{positive=false,signed=false}={}){const s=str(v).replaceAll(',','');if(!(signed?/^-?\d+$/:/^\d+$/).test(s))bad();const n=Number(s);if(!Number.isSafeInteger(n)||positive&&n<1)bad();return n;}
function object(v){if(!v||typeof v!=='object'||Array.isArray(v))bad();return v;}
function json(raw){try{return parseLossless(raw,undefined,n=>/^-?\d+$/.test(n)&&!Number.isSafeInteger(Number(n))?n:Number(n));}catch{bad();}}
function day(v){const s=str(v),d=new Date(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)fail('조회 기간을 올바르게 입력해주세요.','INVALID_RANGE',400);return s;}
function dayOf(v){const s=str(v);if(/^\d{12,14}$/.test(s)){const d=new Date(Number(s)+9*3600000);if(!Number.isFinite(d.getTime()))bad();return d.toISOString().slice(0,10);}const m=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);if(!m)bad();return day(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);}
function epoch(s,end=false){return String(Date.parse(s+'T00:00:00+09:00')+(end?DAY-1:0));}
function query(profile){
  const vars=['$merchantNo: String!','$serviceType: String!','$paging_page: Int','$paging_size: Int','$dateRange_from: String','$dateRange_to: String','$rangeType: RangeType','$sort_direction: SortDirectionType','$sort_type: SortType'];
  const args=['merchantNo','serviceType','paging_page','paging_size','dateRange_from','dateRange_to','rangeType','sort_direction','sort_type'];
  if(profile.orderStatus){vars.push('$orderStatus: SearchOrderStatusType','$detailedOrderStatus: DetailedSearchOrderStatusType');args.push('orderStatus','detailedOrderStatus');}
  if(profile.claimStatus){vars.push('$claimStatus: ClaimStatusType');args.push('claimStatus');}
  return `query ${profile.operation}(${vars.join(', ')}) { ${profile.key}: ${profile.operation}(${args.map(s=>`${s}: $${s}`).join(', ')}) { elements { ${profile.fields} } pagination { size totalElements page totalPages } } }`;
}
function browserPending(message){return {ok:false,pending:true,stage:'browser',summary:{message}};}

export function createSmartstoreSessionClient({credentials={},session,fetchImpl=fetch,resolveHost=true,now=()=>new Date()}={}){
  const sellerId=text(credentials.sellerId),storeName=text(credentials.storeName),account=text(credentials.account||sellerId);
  if(!sellerId||!['naver','center'].includes(credentials.loginType??'naver'))fail('스마트스토어 로그인 ID와 계정 유형을 설정해주세요.','CREDENTIALS_REQUIRED',400);
  const http=session??createSellerSession({providerId:'smartstore',credentials,fetchImpl,resolveHost,now});
  let identity;
  async function request(url,options={}){
    let response;try{response=await http.request(url,options);}catch(e){if(e?.code==='SESSION_REQUIRED'||e?.status===401)fail('스마트스토어 로그인이 만료되었습니다. 다시 로그인해주세요.','SESSION_REQUIRED',401);if(e instanceof SmartstoreSessionError)throw e;fail('스마트스토어 요청에 실패했습니다. 연결 상태를 확인해주세요.','NETWORK_ERROR',502);}
    if(!response||response.status===401||response.status===403)fail('스마트스토어 로그인 또는 판매자센터 접근 권한을 확인해주세요.','SESSION_REQUIRED',401);
    if(!response.ok)fail('스마트스토어가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.','HTTP_ERROR',502);
    return response;
  }
  async function readJson(url,options={}){const r=await request(url,options);let raw;try{raw=await r.text();}catch{bad();}const d=json(raw);if(d&&Object.hasOwn(d,'errors')&&!Array.isArray(d.errors))bad();if(d?.errors?.length||d?.error||raw.includes('GW.AUTHN'))fail('스마트스토어 인증 또는 조회 응답에 오류가 있습니다. 전체 수집을 중단했습니다.','QUERY_ERROR',502);return {data:d,response:r};}
  async function graphql(body,url=SELL+'/o/v3/graphql',contentType='application/json'){return (await readJson(url,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':contentType,Referer:SELL+'/o/v3/n/sale/delivery'}})).data;}
  function verifyUser(response){const user=response.headers.get('user');if(!user)return '';const parts=user.split(':'),actual=parts[0].replace(/@naver\.com$/i,'');if(actual!==sellerId.replace(/@naver\.com$/i,''))fail('로그인한 스마트스토어 계정이 설정한 ID와 다릅니다.','ACCOUNT_MISMATCH',409);return parts[2]??'';}
  async function init(select=false){const r=await request(SELL+`/api/login/init?needLoginInfoForAngular=${select?'false':'true'}&stateName=${select?'work.channel-select':'home'}`);if(!r.headers.get('X-NCP-LOGIN-INFO'))fail('스마트스토어 판매자센터 로그인 확인이 필요합니다.','SESSION_REQUIRED',401);return {response:r,currentChannel:verifyUser(r)};}
  async function channels(){const {data}=await readJson(SELL+'/api/login/channels');if(!Array.isArray(data)||!data.length||data.length>1000)fail('스마트스토어의 판매 가능 스토어를 확인할 수 없습니다.','STORE_REQUIRED',409);return data.map(c=>{object(c);return {...c,channelNo:id(c.channelNo),roleNo:id(c.roleNo),channelName:text(c.channelName)};});}
  async function verifyIdentity(){
    const first=await init(),list=await channels();
    const found=storeName?list.filter(c=>c.channelName===storeName):list.length===1?list:[];
    if(found.length!==1)fail(storeName?'설정한 스토어명을 하나로 확인할 수 없습니다. 스토어명을 확인해주세요.':'여러 스토어가 연결되어 있습니다. 연결할 스토어명을 입력해주세요.','STORE_REQUIRED',409);
    const selected=found[0];if(!selected.channelName)bad();
    let current=first.currentChannel;
    if(current!==selected.channelNo){
      const selecting=await init(true);current=selecting.currentChannel;
      if(current!==selected.channelNo){
        const url=SELL+'/api/login/change-channel?channelNo='+encodeURIComponent(selected.channelNo)+'&roleNo='+encodeURIComponent(selected.roleNo)+'&url=https:%2F%2Fsell.smartstore.naver.com%2F%23%2Fhome%2Fdashboard';
        const r=await request(url,{method:'POST',body:`{"roleNo":${selected.roleNo},"channelNo":${selected.channelNo},"url":${JSON.stringify(CALLBACK)}}`,headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:SELL+'/o/n/sale/delivery/json'}});
        let info;try{info=json(decodeURIComponent(r.headers.get('X-NCP-LOGIN-INFO')??''));}catch{bad();}object(info);
        if(info.redirectUrl){let redirect;try{redirect=new URL(str(info.redirectUrl));}catch{bad();}if(redirect.origin!==SELL||redirect.username||redirect.password)bad();redirect.hash='';await request(redirect.href);}
        const fresh=await init();if(fresh.currentChannel&&fresh.currentChannel!==selected.channelNo)fail('스마트스토어 채널 전환 결과가 선택한 스토어와 다릅니다.','ACCOUNT_MISMATCH',409);
        if(!fresh.currentChannel&&list.length>1)fail('스마트스토어의 현재 스토어를 서버에서 확인할 수 없습니다.','ACCOUNT_MISMATCH',409);
      }
    }
    const page=await request(SELL+'/o/v3/n/sale/delivery');let html;try{html=await page.text();}catch{bad();}
    // The server embeds this object within escaped JSON. Decode only text, never script.
    const decoded=he.decode(html).replace(/\\+"/g,'"');
    const merchants=[...decoded.matchAll(/"merchantNo"\s*:\s*(?:"(\d+)"|(\d+)(?=\s*[,}]))/g)].map(m=>id(m[1]??m[2]));const unique=[...new Set(merchants)];if(unique.length!==1)fail('스마트스토어의 판매자 고유번호를 확인할 수 없습니다.','IDENTITY_REQUIRED',409);
    const merchantNo=unique[0],identityId=`${merchantNo}:${selected.channelNo}`;
    if(credentials.identityId&&identityId!==credentials.identityId)fail('로그인한 스마트스토어가 기존 연결의 스토어와 다릅니다.','ACCOUNT_MISMATCH',409);
    const time=await graphql(SERVER_TIME);if(!time?.data?.currentServerTime?.serverTime)fail('스마트스토어 세션을 확인할 수 없습니다.','SESSION_REQUIRED',401);
    const notification=await readJson(SELL+'/api/seller/notification/new-notification');if(typeof notification.data?.newNotificationYn!=='string'&&typeof notification.data?.newNotificationYn!=='boolean')fail('스마트스토어 추가 인증이 필요합니다.','SESSION_REQUIRED',401);
    identity={merchantNo,channelNo:selected.channelNo,identityId,identityLabel:selected.channelName};return {ok:true,identityId,identityLabel:selected.channelName};
  }
  async function login(){
    if(credentials.loginType!=='center')return browserPending('네이버 로그인창에서 로그인과 추가 인증을 완료해주세요.');
    if(!str(credentials.password))return browserPending('스마트스토어 센터 로그인창에서 로그인해주세요.');
    const captcha=await graphql({operationName:'foreignCaptcha',variables:{},query:'query foreignCaptcha { foreignCaptcha { ip isForeignIp captchaKey __typename } }'},ACCOUNTS+'/graphql','application/x-www-form-urlencoded');
    const foreign=object(captcha?.data?.foreignCaptcha);if(typeof foreign.isForeignIp!=='boolean')bad();if(foreign.isForeignIp)return browserPending('해외 접속 확인이 필요합니다. 센터 로그인창에서 인증해주세요.');
    const result=await graphql({operationName:'idLogin',variables:{id:sellerId,password:credentials.password,saveId:false,chkLong:false,captchaKey:null,captcha:'',svcUrl:SELL+'/#/login-callback'},query:'mutation idLogin($id: String!, $password: String!, $saveId: Boolean!, $chkLong: Boolean!, $captchaKey: String, $captcha: String, $svcUrl: String) { login(loginRequest: {id: $id, password: $password, saveId: $saveId, chkLong: $chkLong, captchaKey: $captchaKey, captcha: $captcha, svcUrl: $svcUrl}) { id statCd loginStatus showCaptcha captchaKey sessionKey idNo __typename } }'},ACCOUNTS+'/graphql','application/json;charset=UTF-8');
    const status=object(result?.data?.login);if(status.showCaptcha===true)return browserPending('문자 확인 또는 추가 인증이 필요합니다. 센터 로그인창을 열어주세요.');
    await request(SELL+'/',{followRedirects:true});
    const r=await request(SELL+'/api/login?url=https:%2F%2Fsell.smartstore.naver.com%2F%23%2Fhome%2Fdashboard',{method:'POST',body:JSON.stringify({url:CALLBACK}),headers:{'Content-Type':'application/json;charset=UTF-8'}});
    if((await r.text()).includes('사용자 인증이 실패하였습니다'))return browserPending('센터 로그인 확인이 필요합니다. 로그인창에서 인증을 완료해주세요.');
    try{return await verifyIdentity();}catch(e){if(e.code==='SESSION_REQUIRED')return browserPending('추가 인증이 필요합니다. 센터 로그인창에서 인증을 완료해주세요.');throw e;}
  }
  function normalize(row,profile){
    object(row);const orderNo=id(row.orderNo),lineId=id(row.productOrderNo),quantity=numeric(row.orderQuantity,{positive:true}),base=numeric(row.productUnitPrice),optionAmount=row.productOptionAmt===null||row.productOptionAmt===undefined?0:numeric(row.productOptionAmt,{signed:true}),unitPrice=base+optionAmount,amount=unitPrice*quantity;
    if(unitPrice<0||!Number.isSafeInteger(unitPrice)||!Number.isSafeInteger(amount))bad();
    const product=text(row.productName);if(!product)bad();
    const codes=[row.orderStatus,row.claimStatus,row.productOrderStatus].map(str).filter(Boolean);
    const unrecognized=!codes.length||codes.some(s=>!KNOWN_STATUS.has(s));
    let claimType=profile.claimType&&!profile.claimStatus.endsWith('_REJECT')?profile.claimType:'없음';
    if(claimType==='없음'&&codes.some(s=>['CANCEL_REQUEST','CANCELING','CANCELED','CANCEL_DONE','ADMIN_CANCEL_DONE','CANCELED_BY_NOPAYMENT'].includes(s)))claimType='취소요청';
    if(claimType==='없음'&&codes.some(s=>['RETURN_REQUEST','RETURNED','RETURN_DONE'].includes(s)))claimType='반품요청';
    if(claimType==='없음'&&codes.some(s=>['EXCHANGE_REQUEST','EXCHANGED','EXCHANGE_REDELIVERING','EXCHANGE_DONE'].includes(s)))claimType='교환요청';
    const claimed=claimType!=='없음';
    let status=profile.status;
    if(!profile.claimType){if(codes.some(s=>['CANCELED','CANCEL_DONE','ADMIN_CANCEL_DONE','CANCELED_BY_NOPAYMENT'].includes(s)))status='취소';else if(codes.includes('PURCHASE_DECIDED'))status='구매확정';else if(codes.includes('DELIVERED'))status='배송완료';else if(codes.some(s=>['DELIVERING','REDELIVERING'].includes(s)))status='배송중';}
    const address=text(row.receiverDisplayBaseAddress||row.receiverIntegratedAddress||row.receiverAddress)+(row.receiverDisplayBaseAddress&&row.receiverDisplayDetailAddress?' '+text(row.receiverDisplayDetailAddress):'');
    const recipient=text(row.receiverName),phone=text(row.receiverTelNo1||row.receiverTelNo2),postcode=text(row.receiverZipCode),partial=row.quantityClaimYn===true||row.quantityClaimYn==='Y';
    const destinationComplete=[recipient,phone,postcode,address].every(v=>v&&!/[*●•]|알수없음|정보없음|비공개|조회불가|마스킹|개인정보\s*보호/.test(v))&&/^[+()\d\s.-]+$/.test(phone)&&(phone.match(/\d/g)?.length??0)>=8;
    const safeFulfillment=!claimed&&!profile.claimType&&!partial&&!unrecognized&&!codes.includes('PAYMENT_WAITING')&&['신규','발송대기'].includes(status)&&destinationComplete;
    const sku=text(row.sellerProductManagementCode||row.sellerOptionManagementCode||row.sellerInternalCode1||row.sellerInternalCode2);
    return {channel:'스마트스토어',account,orderNo,lineId,orderedAt:dayOf(row.orderDateTime||row.payDateTime),product,option:text(row.productOptionContents),sku,quantity,unitPrice,amount,buyer:text(row.orderMemberName),recipient,phone,postcode,address,deliveryMemo:text(row.productOrderMemo),carrier:text(profile.type==='exchange'?row.reDeliveryCompanyName||row.deliveryCompanyName:row.deliveryCompanyName),tracking:text(profile.type==='exchange'?row.reDeliveryInvoiceNo||row.deliveryInvoiceNo:row.deliveryInvoiceNo),status,claimType,sourceStatus:[text(row.orderStatus),text(row.claimStatus||profile.claimStatus),text(row.productOrderStatus)].filter(Boolean).join('/'),
      sourceIds:{provider:'smartstore-session',merchantNo:identity.merchantNo,channelNo:identity.channelNo,productOrderNo:lineId,paidAt:dayOf(row.payDateTime),fulfillableQty:safeFulfillment?quantity:0,...(!safeFulfillment&&['신규','발송대기'].includes(status)||partial?{needsReview:true}:{}),...(profile.claimStatus?{claimStatus:profile.claimStatus}:{}),...(row.individualCustomUniqueCode?{customsCode:text(row.individualCustomUniqueCode)}:{}),...(row.productPayAmt!==undefined&&row.productPayAmt!==null?{productPayAmt:numeric(row.productPayAmt)}:{})}};
  }
  async function collectOrders({from,to}={}){
    from=day(from);to=day(to);const today=new Date(new Date(typeof now==='function'?now():now).getTime()+9*3600000).toISOString().slice(0,10);
    if(from>to||to>today||Date.parse(to)-Date.parse(from)>731*DAY||Date.parse(today)-Date.parse(from)>731*DAY)fail('스마트스토어 조회 기간은 최근 2년 이내로 입력해주세요.','INVALID_RANGE',400);
    const before=await verifyIdentity(),results=new Map();let count=0;
    for(const profile of SEARCHES){
      const seen=new Set();let expectedTotal;
      for(let page=1;page<=MAX_PAGES;page++){
        const variables={merchantNo:identity.merchantNo,serviceType:'MP',paging_page:page,paging_size:PAGE_SIZE,sort_type:profile.type==='closed'?'PRODUCT_ORDER_PURCHASE_DECISION_COMPLETE_OPERATION_YMDT':'RECENTLY_ORDER_YMDT',sort_direction:'DESC',rangeType:profile.type==='cancel'?'CLAIM_REQUEST':profile.type==='return'?'RETURN_REQUEST':profile.type==='exchange'?'EXCHANGE_REQUEST':'PAY_COMPLETED',dateRange_from:epoch(from),dateRange_to:epoch(profile.claimType?today:to,true)};
        if(profile.orderStatus)Object.assign(variables,{orderStatus:profile.orderStatus,detailedOrderStatus:profile.detailedOrderStatus});if(profile.claimStatus){variables.claimStatus=profile.claimStatus;delete variables.sort_type;delete variables.sort_direction;}
        const d=await graphql({operationName:profile.operation,variables,query:query(profile)}),table=object(d?.data?.[profile.key]);
        if(!Array.isArray(table.elements)||table.elements.length>PAGE_SIZE)bad();const p=object(table.pagination),reportedPage=numeric(p.page,{positive:true}),size=numeric(p.size,{positive:true}),total=numeric(p.totalElements),pages=numeric(p.totalPages);
        if(reportedPage!==page||size!==PAGE_SIZE||(total?pages!==Math.ceil(total/PAGE_SIZE):![0,1].includes(pages))||total>MAX_ORDERS||pages>MAX_PAGES)bad();if(expectedTotal!==undefined&&expectedTotal!==total)fail('스마트스토어 조회 중 주문 수가 변경되었습니다. 전체 수집을 다시 시도해주세요.','UNSTABLE_PAGINATION',409);expectedTotal=total;
        for(const row of table.elements){const key=id(row.productOrderNo);if(seen.has(key))fail('스마트스토어 응답에 중복 품목이 있습니다. 전체 수집을 중단했습니다.','UNSTABLE_PAGINATION',409);seen.add(key);const order=normalize(row,profile);if(order.sourceIds.paidAt<from||order.sourceIds.paidAt>to)continue;
          const existing=results.get(key),rank=profile.claimType?(profile.claimStatus.endsWith('_REJECT')?0:10):['신규','발송대기','배송중','배송완료','구매확정'].indexOf(order.status)+1;
          if(existing&&existing.order.orderNo!==order.orderNo)bad();if(!existing||rank>existing.rank)results.set(key,{order,rank});
          if(results.size>MAX_ORDERS||++count>MAX_ORDERS*SEARCHES.length)fail('스마트스토어는 한 번에 10,000품목까지 수집할 수 있습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
        }
        if(page>=pages){if(seen.size!==total)bad();break;}if(table.elements.length!==PAGE_SIZE||page===MAX_PAGES)bad();
      }
    }
    const after=await verifyIdentity();if(before.identityId!==after.identityId)fail('스마트스토어 조회 중 계정이 변경되었습니다. 전체 수집을 중단했습니다.','ACCOUNT_MISMATCH',409);
    return {complete:true,orders:[...results.values()].map(x=>x.order),notes:['원본 PAY_COMPLETED 결제일로 조회하며 주문 생성일은 orderedAt에 보존합니다.'],summary:{provider:'스마트스토어',identityLabel:after.identityLabel,readOnly:true,queryCount:SEARCHES.length}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,continueLogin:async()=>browserPending('로그인창에서 추가 인증을 완료해주세요.'),collectOrders,getSessionCookies:()=>http.getSessionCookies(),getSessionState:()=>({cookies:http.getSessionCookies(),sessionData:identity??{}}),cancel:()=>http.cancel?.()};
}
