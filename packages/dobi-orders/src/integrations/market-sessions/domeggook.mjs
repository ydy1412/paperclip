import {array,bad,baseOrder,browserRequired,fail,id,identity,integer,mergeOrders,newTransport,object,range,scalar,text,orderDate} from './common.mjs';
const HOST='https://www.domeggook.com';
const PROFILES=[
  ['order/lst','ord','waitchk,waitdeli',['waitchk'],'신규','없음'],['order/lst','ord','waitchk,waitdeli',['waitdeli'],'발송대기','없음'],['order/lst','deli','waitok,waitrcpt',['waitok'],'배송중','없음'],['order/lst','deli','waitchk,waitdeli',['waitrcpt'],'배송완료','없음'],['order/lst','ord','waitserv,done',['waitserv','done'],'구매확정','없음'],
  ['order/lst','reqDeny','waitdeny',[],'신규','취소요청'],['order/lst','deny','denyconfirm,denybuy,denysell',['denyconfirm','denybuy','denysell'],'취소','취소요청'],
  ...['APPLY','WAIT','DELAY','SUCCESS','CANCEL'].map(s=>['returns/lstReturn','apply','APPLY,WAIT,SUCCESS,DELAY',[s],s==='SUCCESS'?'취소':'배송완료',s==='CANCEL'?'없음':'반품요청']),
  ...['APPLY','SHIPPING','SUCCESS','DELAY','CANCEL'].map(s=>['returns/lstTrans','apply','APPLY,SUCCESS,DELAY',[s],s==='SHIPPING'?'배송중':'발송대기',s==='CANCEL'?'없음':'교환요청'])
];
// DomeggookNew selected CIL 0x06001230/32/44/46/48, GetClaimSupportInfo.
export function createDomeggookClient({credentials={},session,now=()=>new Date()}){
  const api=newTransport(session);let submitted=false;
  async function page(path,options={}){let r;try{r=await session.request(HOST+path,options);}catch(e){if(['SESSION_REQUIRED','CANCELLED'].includes(e?.code))throw e;fail('도매꾹 연결에 실패했습니다.','NETWORK_ERROR');}if([401,403].includes(r.status)||r.status>=300&&r.status<400)fail('도매꾹 로그인이 필요합니다.','SESSION_REQUIRED',401);if(!r.ok)fail('도매꾹 요청이 실패했습니다.','REMOTE_ERROR');let bytes;try{bytes=new Uint8Array(await r.arrayBuffer());}catch{bad();}if(bytes.length>32*1024*1024)bad();const prefix=Buffer.from(bytes.subarray(0,4096)).toString('ascii'),charset=/charset\s*=\s*["']?([\w-]+)/i.exec((r.headers.get('Content-Type')??'')+' '+prefix)?.[1]??'euc-kr';try{return new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{bad();}}
  async function verifyIdentity(){const raw=await page('/main/mySell/my_sellMain.php');if(!raw.includes('로그아웃'))fail('도매꾹 판매자 로그인을 확인할 수 없습니다.','SESSION_REQUIRED',401);return identity(credentials,'login:'+id(credentials.sellerId),credentials.sellerId+' (판매자 화면 확인)',submitted?'credential-login':'user-confirmation');}
  async function login(){
    if(credentials.loginType==='naver'||!credentials.password)return browserRequired('도매꾹 로그인창에서 일반 또는 네이버 로그인과 추가 인증을 완료해주세요.');
    await page('/ssl/member/mem_loginForm.php');
    const raw=await page('/main/member/mem_ing.php',{method:'POST',body:new URLSearchParams({mode:'mongoLogin',encording:'utf8',back:'',extCookie:'',id:credentials.sellerId,pass:credentials.password}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},followRedirects:true});
    if(/captcha|인증번호|추가 인증|본인인증/i.test(raw))return browserRequired('도매꾹 로그인창에서 추가 인증을 완료해주세요.');
    // The original defers password-change campaigns with a write request. Let the
    // user decide in the normal browser instead of changing account preferences.
    if(raw.includes('mem_requestChangePwd.php'))return browserRequired('도매꾹 로그인창에서 비밀번호 변경 안내를 확인해주세요.');submitted=true;return verifyIdentity();
  }
  function normalize(row,p){object(row);const quantity=integer(row.qty,{positive:true}),amount=integer(row.amt),o=baseOrder('도매꾹',credentials.account||credentials.sellerId,{providerId:'domeggook',orderNo:'OR'+id(row.no),lineId:id(row.no),orderedAt:orderDate(row.dateOrder),product:text(row.itemTitle),option:text(row.opt),quantity,amount,buyer:text(row.buyName),recipient:text(row.receiveName),phone:text(row.receiveMobile),postcode:'',address:text(row.receiveAddr),deliveryMemo:[text(row.receiveReq),text(row.buyMemo)].filter(Boolean).join(' | '),carrier:text(row.deliCompanyName),tracking:text(row.deliCode),status:p[4],claimType:p[5],sourceStatus:text(row.status),sourceIds:{goodsId:id(row.itemNo),queryStates:p[3],fulfillableQty:0,needsReview:true,postcodeUnprovided:true}});
    if(row.ccon)o.sourceIds.customsCode=text(row.ccon);return o;
  }
  async function collectOrders(input){
    const {from,to}=range(input),before=await verifyIdentity(),orders=new Map();
    for(const p of PROFILES){const seen=new Set();let finished=false;for(let pageNo=1;pageNo<=100;pageNo++){
      const q=new URLSearchParams({chn:'',sec:'',dtbase:p[1],dateQuick:'',dt1:from.replaceAll('-','.'),dt2:to.replaceAll('-','.'),stBasis:p[2],ono:'',btar:'buyName',bkw:'',ino:'',ttl:'',format:'grid',pg:String(pageNo),sz:'500',so:'od'});for(const s of p[3])q.append('st[]',s);
      const d=await api(HOST+'/sc/'+p[0]+'?'+q),rows=array(d.dat);if(rows.length>500)bad();
      for(const row of rows){const key=id(object(row).no);if(seen.has(key))bad();seen.add(key);const order=normalize(row,p),old=orders.get(order.orderNo+'\0'+order.lineId);if(p[3].includes('CANCEL')&&old)continue;mergeOrders(orders,order);}
      if(rows.length<500){finished=true;break;}}
      if(!finished)fail('도매꾹 전체 페이지 수집 한도에 도달했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
    }
    const after=await verifyIdentity();if(before.identityId!==after.identityId)bad();return {complete:true,orders:[...orders.values()],notes:['배송중·배송완료는 원본의 발송일(dtbase=deli), 나머지 일반 주문은 주문일 기준으로 조회합니다.','원본 별도 우편번호 조회 서비스를 복사하지 않아 receiveAddr만 제공되는 품목은 우편번호 확인 전 발송을 막습니다.'],summary:{message:'도매꾹 주문·취소·반품·교환 전체 페이지 조회 완료',count:orders.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:{}}),cancel:()=>session.cancel?.()};
}
