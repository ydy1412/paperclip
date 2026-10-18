import {addDays,array,bad,baseOrder,browserRequired,credentialIdentity,fail,html,id,integer,loginForm,mergeOrders,newTransport,object,orderDate,range,text} from './common.mjs';
// InterparkNew (Buyzle): 0e05 login; 0e1b–23,0e39 lists; 0e2b detail; 0e3d–41 claims.
const HOST='https://seller.buyzle.co.kr';
const CLAIMS=[['cancel-request',['cancelRequest','cancelProcessing','cancelRevoke','cancelComplete'],'cancelRequestDate','취소요청'],['return-request',['returnRequest','returnComplete','returnRevoke'],'returnRequestDate','반품요청'],['exchange-request',['exchangeRequest','exchangeAccept','exchangeComplete','exchangeRevoke'],'exchangeRequestDate','교환요청']];
export function createInterparkClient({credentials={},session}={}){
  const request=newTransport(session);
  async function verifyIdentity(){const raw=await request(HOST+'/main',{format:'text'});if(loginForm(html(raw))||!raw.includes('로그아웃'))fail('인터파크 로그인창에서 로그인과 판매자 확인을 완료해주세요.','SESSION_REQUIRED',401);return {...credentialIdentity(credentials,'credential-login'),serverAuthenticated:false};}
  async function login(){if(!credentials.sellerId||!credentials.password)fail('인터파크 ID와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);
    try{await request(HOST+'/login/process',{method:'POST',body:new URLSearchParams({loginTgt:'INPK',isProcess:'1',loginId:credentials.sellerId,loginPwd:credentials.password,captchaText:''}).toString(),headers:{Referer:HOST+'/login'},format:'text',followRedirects:true});return await verifyIdentity();}catch(e){if(['SESSION_REQUIRED','INVALID_RESPONSE'].includes(e.code))return browserRequired('인터파크 로그인창에서 계정 유형 선택과 추가 인증을 완료해주세요.');throw e;}
  }
  async function normalize(row,status,claimType='없음'){
    object(row);const orderNo=id(row.orderNo||row.ordclmNo),lineId=id(row.ordSeq),detail=object((await request(HOST+'/api/orders?'+new URLSearchParams({ordclmNo:orderNo,orderSeq:lineId,service:'interpark'}))).data);
    if(detail.ordclmNo!==undefined&&id(detail.ordclmNo)!==orderNo)bad();const ship=detail.shippingAddress===null||detail.shippingAddress===undefined?{}:object(detail.shippingAddress),r={...row,...detail};
    const quantity=integer(row.ordCnt??row.ordclmCnt??row.clmreqCnt??row.clmCnt,{positive:true}),unitPrice=integer(row.saleUnitcost),amount=unitPrice*quantity;if(!Number.isSafeInteger(amount))bad();
    const recipient=text(r.rcvrNm),phone=text(ship.rcvrMpno||r.rcvrMpno||ship.rcvrTelno||r.rcvrTelno),address=[text(ship.zipAddrDoro||r.address),text(ship.dtlAddrDoro)].filter(Boolean).join(' '),sourceStatus=text(row.currentOrdclmprdStatNm||row.currentOrdclmprdStat||row.clmStatNm)||status;
    const unsafe=Boolean(row.clmreqCnt!==undefined&&integer(row.clmreqCnt)>0||/[＊*●]/.test(recipient+phone+address)||/취소|반품|교환/.test(sourceStatus));
    return baseOrder('인터파크',credentials.account||credentials.sellerId,{providerId:'interpark',orderNo,lineId,orderedAt:orderDate(r.ordclmDts),product:text(row.prdNm),option:text(row.optFnm),sku:text(row.externalParentPrdNo||row.externalPrdNo),quantity,unitPrice,amount,buyer:text(row.ordNm),recipient,phone,postcode:text(ship.zipNoDoro||ship.zipNo||r.zipCode),address,deliveryMemo:text(ship.delvMsg||r.delvMsg),carrier:text(row.hdelvMafcEntrNm),tracking:text(row.invoNo),status,sourceStatus,claimType,sourceIds:{deliveryNo:text(row.delvwhOrdNo),...(unsafe?{fulfillableQty:0,needsReview:true}:{})}});
  }
  async function collectOrders(input){const {from,to}=range(input);await verifyIdentity();const orders=new Map(),configs=[];
    for(const [path,code,status]of [['acknowledge','40','신규'],['acknowledge','50','발송대기'],['delivery','stepShipping','배송중'],['delivery','stepComplete','배송완료'],['buyconfirm','','구매확정']])configs.push({path,status,period:'paymentDate',code});
    for(const [path,codes,period,claimType]of CLAIMS)for(const code of codes)configs.push({path,code,period,status:claimType,claimType});
    for(const c of configs){const seen=new Set();for(let page=1;page<=100;page++){const q=new URLSearchParams({detailedSearchType:'',detailedSearchValue:'',searchPeriodType:c.period,startDate:addDays(from,-1)+'T15:00:00Z',endDate:to+'T14:59:59Z',page:String(page),size:'500'});if(c.claimType)q.set('claimOrderStatus',c.code);else if(c.code)q.set('orderStatus',c.code);if(c.path==='acknowledge')q.set('orderSendStep','');if(c.path==='delivery')q.set('buyConfirmHoldYn','all');if(c.path==='buyconfirm')q.set('searchFilterSettlementStatus','');
      const data=object((await request(HOST+'/api/orders/'+c.path+'?'+q)).data),rows=array(data.orders??data.orderDeliveries);for(const row of rows){const key=id(object(row).orderNo||row.ordclmNo)+'\0'+id(row.ordSeq);if(seen.has(key))bad();seen.add(key);mergeOrders(orders,await normalize(row,c.status,c.claimType));}if(rows.length<500)break;if(page===100)fail('인터파크 조회 페이지 한도에 도달했습니다. 기간을 줄여주세요.','LIMIT_EXCEEDED',400);}}
    await verifyIdentity();return {complete:true,orders:[...orders.values()],notes:['Buyzle로 변경된 인터파크 원본 경로의 전체 지원 상태를 조회했습니다.','원본에 원격 사용자 ID 대조 필드가 없어 로그인한 계정은 사용자 확인에 의존합니다. 현재 원격 서비스 운영 여부와 실계정 수집은 미검증입니다.'],summary:{count:orders.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies()}),cancel:()=>session.cancel?.()};
}
