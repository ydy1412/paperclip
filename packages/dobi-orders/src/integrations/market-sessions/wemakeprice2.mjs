import {createHash} from 'node:crypto';
import {array,bad,baseOrder,browserRequired,credentialIdentity,fail,html,id,integer,loginForm,mergeOrders,newTransport,object,orderDate,range,text} from './common.mjs';
const HOST='https://wpartner.wemakeprice.com';
const sha1=s=>createHash('sha1').update(s,'utf8').digest('hex');
const STATES=[['getOrderInfoList','D1','신규'],['getOrderInfoList','D2','발송대기'],['getShipInfoList','D3','배송중'],['getShipInfoList','R','배송완료'],['getShipInfoList','D4','구매확정']];
// Wemakeprice2: login 0f62 salted SHA1, 0f72–7a/80 list, 0f84/86/88 mapping, 03cb claim codes.
export function createWemakeprice2Client({credentials={},session}={}){
  const request=newTransport(session);
  const bare=async path=>array(await request(HOST+path,{format:'json-value'}));
  async function verifyIdentity(){const raw=await request(HOST+'/main',{format:'text'});if(loginForm(html(raw))||!raw.includes('로그아웃'))fail('위메프 로그인창에서 로그인을 완료해주세요.','SESSION_REQUIRED',401);return {...credentialIdentity(credentials),serverAuthenticated:false};}
  async function login(){if(!credentials.sellerId||!credentials.password)fail('위메프 ID와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);const page=await request(HOST+'/login',{format:'text'});if(page.includes('_captchaImage'))return browserRequired('위메프 로그인창에서 자동입력방지와 추가 인증을 완료해주세요.');
    const salt=text(object((await request(HOST+'/salt.json?_='+Date.now())).data).salt);if(salt.length<13||salt.length>1024)bad();const short=salt[1]+salt[4]+salt[8]+salt[12],password=sha1(short+sha1(credentials.password.toLowerCase()))+short;
    const result=await request(HOST+'/login.json',{method:'POST',body:new URLSearchParams({userId:credentials.sellerId,userPassword:password,userIdSaveYn:''}).toString()});if(result.authPartner||result.agreementToken)return browserRequired('위메프 로그인창에서 문자·이메일 인증과 약관 안내를 직접 완료해주세요.');
    try{return await verifyIdentity();}catch(e){if(e.code==='SESSION_REQUIRED')return browserRequired();throw e;}
  }
  async function normalize(row,status,claimType='없음'){
    object(row);const orderNo=id(row.orderNo),lineId=id(row.orderOptNo);const details=await bare('/ship/getOrderInfo.json?'+new URLSearchParams({orderNo})),matches=details.filter(r=>id(object(r).orderOptNo)===lineId);if(matches.length!==1)bad();const d=matches[0];
    const shipping=await request(HOST+'/ship/getShippingAddress.json?'+new URLSearchParams({bundleNo:id(row.bundleNo||d.bundleNo)}));const r={...d,...row},s={...r,...shipping};
    const quantity=integer(row.prodQty??row.claimProdQty??d.prodQty,{positive:true}),unitPrice=integer(row.prodPrice??d.prodPrice),amount=claimType==='없음'&&row.totProdPrice!==undefined?integer(row.totProdPrice):unitPrice*quantity;if(!Number.isSafeInteger(amount))bad();
    const recipient=text(s.receiverNm),phone=text(s.issuePhone||s.phone),address=[text(s.roadAddr1||s.addrInfo),text(s.roadAddr2)].filter(Boolean).join(' '),sourceStatus=text(row.shipStatusNm||row.claimStatusNm)||status;
    return baseOrder('위메프',credentials.account||credentials.sellerId,{providerId:'wemakeprice2',orderNo,lineId,orderedAt:orderDate(r.orderDt),product:text(r.prodNm),sku:text(r.sellerProdCd||r.sellerOptCd),option:text(r.soptTitle||r.optNm),quantity,unitPrice,amount,buyer:text(r.buyerNm),recipient,phone,postcode:text(s.zipcode),address,deliveryMemo:text(s.message),carrier:text(r.companyNm),tracking:text(r.invoiceNo),status,sourceStatus,claimType,sourceIds:{bundleNo:id(row.bundleNo||d.bundleNo),partnerId:text(r.partnerId),claimBundleNo:text(r.claimBundleNo),...(/[＊*●]/.test(recipient+phone+address)||/취소|반품|교환/.test(sourceStatus)?{fulfillableQty:0,needsReview:true}:{})}});
  }
  async function collectOrders(input){const {from,to}=range(input);await verifyIdentity();const out=new Map(),configs=STATES.map(([endpoint,code,status])=>({path:'/ship/'+endpoint+'.json',code,status}));
    for(const [endpoint,claimType]of [['getClaimCancelList','취소요청'],['getClaimReturnList','반품요청'],['getClaimExchangeList','교환요청']])for(const code of ['C1','C2','C3','C4','C8','C9'])configs.push({path:'/claim/'+endpoint+'.json',code,status:claimType,claimType});
    for(const c of configs){const seen=new Set();for(let page=1;page<=100;page++){const q=new URLSearchParams({schTotalFlag:'',schDateType:c.claimType?'requestDate':'orderDt',schStartDate:from,schEndDate:to,schType:'',schValue:'',schLimitCnt:'500',schPageNo:String(page)});q.set(c.claimType?'schClaimStatus':'schShipStatus',c.code);const rows=await bare(c.path+'?'+q);for(const row of rows){const key=id(object(row).orderNo)+'\0'+id(row.orderOptNo);if(seen.has(key))bad();seen.add(key);mergeOrders(out,await normalize(row,c.status,c.claimType));}if(rows.length<500)break;if(page===100)fail('위메프 조회 페이지 한도에 도달했습니다. 기간을 줄여주세요.','LIMIT_EXCEEDED',400);}}
    await verifyIdentity();return {complete:true,orders:[...out.values()],notes:['위메프 원본의 주문·취소·반품·교환 전체 지원 상태를 조회했습니다.','원본의 약관 자동 동의는 실행하지 않습니다. 원격 로그인 ID 대조 필드는 없어 사용자 계정 확인이 필요하며, 원격 서비스 운영과 실계정 수집은 미검증입니다.'],summary:{count:out.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies()}),cancel:()=>session.cancel?.()};
}
