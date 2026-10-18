import {bad,baseOrder,browserRequired,fail,html,id,identity,integer,loginForm,mergeOrders,newTransport,orderDate,range,text,addDays} from './common.mjs';
import {downloadRecords} from './tables.mjs';
const ORIGIN='https://admin.sellerhub.co.kr';
const TYPES=[['1','신규','없음'],['2','발송대기','없음'],['3','배송중','없음'],['4','배송완료','없음'],['5','구매확정','없음'],['2','취소','취소요청'],['3','취소','반품요청'],['4','발송대기','교환요청']];
const STATUSES={'신규주문':'신규','입금확인':'신규','발송대기':'발송대기','배송중':'배송중','배송완료':'배송완료','구매확정':'구매확정'};
// Source 0x060012cc/ce/e8/ea: form login, provider client_id and full search Excel export.
export function createSellerHubClient({credentials={},session}){
 const request=newTransport(session);
 async function verifyIdentity(){
  const check=await request(ORIGIN+'/shop/admin_provider/chk.cafe24.php',{format:'text'});if(!/^true$/i.test(check.trim())&&!/CAFE24/.test(check))fail('셀러허브 인증 상태를 확인할 수 없습니다.','SESSION_REQUIRED',401);
  const raw=await request(ORIGIN+'/shop/admin_provider/order/list_v2.php?mode=group&period=6&first=0',{format:'text'});if(loginForm(html(raw)))fail('셀러허브에 다시 로그인해주세요.','SESSION_REQUIRED',401);
  const matches=[...raw.matchAll(/\bclient_id\s*=\s*(?:"([A-Za-z0-9_-]{1,100})"|'([A-Za-z0-9_-]{1,100})'|([A-Za-z0-9_-]{1,100}))\s*;/g)].map(m=>m[1]??m[2]??m[3]);
  const unique=[...new Set(matches)];if(unique.length!==1)bad();return identity(credentials,unique[0],'셀러허브 판매자 '+unique[0]);
 }
 async function login(){
  if(!credentials.sellerId||!credentials.password)fail('셀러허브 아이디와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);
  const body=new URLSearchParams([['returnUrl','../admin_provider/index.php'],['type_gubun',''],['returnUrl','../admin_provider/index.php'],['m_id',credentials.sellerId],['password',credentials.password],['idsave','on']]);
  const raw=await request(ORIGIN+'/shop/member/login_ok.php',{method:'POST',body:body.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},format:'text',followRedirects:true});
  if(loginForm(html(raw)))return browserRequired('셀러허브 로그인창에서 추가 인증을 완료해주세요.');return verifyIdentity();
 }
 function normalize(row,status,claimType){
  const sourceStatus=text(row['주문상태']),quantity=integer(row['수량'],{positive:true});let price;
  // This precedence is intentional: the original checks and overwrites in this order.
  for(const key of ['상품가격','쇼핑몰판매가','등록판매가'])if(row[key]!==undefined)price=integer(row[key]);if(price===undefined)bad();
  const amount=price*quantity;if(!Number.isSafeInteger(amount))bad();let tracking=text(row['송장번호']).replaceAll('-','');if(tracking.includes('가송장 입력시 건당 3000원'))tracking='';
  const result=baseOrder('셀러허브',credentials.account||credentials.sellerId,{providerId:'sellerhub',orderNo:id(row['주문번호']),lineId:id(row['주문아이템번호']),orderedAt:orderDate(row['주문일자']),product:text(row['상품명']),option:[text(row['옵션1']),text(row['옵션2'])].filter(Boolean).join(', '),sku:text(row['상품코드']),quantity,amount,unitPrice:price,buyer:text(row['주문자명']),recipient:text(row['받는분이름']),phone:text(row['받는분핸드폰'])||text(row['받는분전화번호']),postcode:text(row['우편번호']).replaceAll('-',''),address:text(row['주소']),deliveryMemo:text(row['배송메세지']),carrier:text(row['택배사코드']),tracking,status:STATUSES[sourceStatus]??status,sourceStatus,claimType,sourceIds:{goodsId:id(text(row['상품번호']).replace(/^SE/,''))}});
  if(claimType!=='없음'){result.status=status;result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;}else if(!STATUSES[sourceStatus]){result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;}
  return result;
 }
 async function collectOrders(input){
  const {from,to}=range(input);await verifyIdentity();const orders=new Map();
  for(let start=from;start<=to;start=addDays(start,31)){
   const end=addDays(start,30)>to?to:addDays(start,30);
   for(const [step,status,claimType] of TYPES){
    const q=new URLSearchParams({mode:'group',skey:'all',sword:'',sgkey:'item.goodsnm',sgword:'',bundle_deli_cnt:'0',dtkind:'orddt',chk:'',xlsType:'search',xlsMode:'goods'});
    if(claimType==='없음'){q.append('step[]',step);q.set('step2false','Y');}else q.append('step2[]',step);q.append('regdt[]',start.replaceAll('-',''));q.append('regdt[]',end.replaceAll('-',''));
    const rows=await downloadRecords(session,ORIGIN+'/shop/admin_provider/order/dnXls_excel.php?'+q,{required:['주문번호','주문아이템번호','상품명','수량','주문일자']});
    for(const row of rows){const ordered=orderDate(row['주문일자']);if(ordered<start||ordered>end)bad();mergeOrders(orders,normalize(row,status,claimType));}
   }
  }await verifyIdentity();return {complete:true,notes:[],orders:[...orders.values()],summary:{message:'셀러허브 주문·취소·반품·교환 엑셀 수집 완료',count:orders.size}};
 }
 return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel:()=>session.cancel?.()};
}
