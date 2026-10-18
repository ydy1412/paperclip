import {attr,bad,baseOrder,browserRequired,credentialIdentity,fail,html,id,integer,loginForm,mergeOrders,newTransport,nodeText,nodes,orderDate,range,text} from './common.mjs';
import {downloadRecords} from './tables.mjs';
const ORIGIN='https://ownerclan.com';
const TYPES=[['deli_gbn[1]','N','신규','없음'],['deli_gbn[2]','S','발송대기','없음'],['deli_gbn[3]','Y','배송중','없음'],['deli_gbn[8]','Y','배송완료','없음'],['deli_gbn[5]','D','취소','취소요청'],['deli_gbn[4]','C','취소','취소요청'],['deli_gbn[6]','B','취소','반품요청'],['deli_gbn[7]','Z','취소','반품요청']];
// Source 0x06001310/12/2c/2e/38/3a/3c and 0x0600084b/4c.
export function createOwnerClanClient({credentials={},session}){
 const request=newTransport(session);let direct=false;
 async function verifyIdentity(){const raw=await request(ORIGIN+'/vender/main.php',{format:'text'});if(loginForm(html(raw))||!raw.includes('로그아웃'))fail('오너클랜 로그인 상태를 확인할 수 없습니다.','SESSION_REQUIRED',401);return credentialIdentity(credentials,direct?'credential-login':'user-confirmation');}
 async function login(){if(!credentials.sellerId||!credentials.password)fail('오너클랜 아이디와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);const raw=await request(ORIGIN+'/vender/loginproc.php',{method:'POST',body:new URLSearchParams({id:credentials.sellerId,passwd:credentials.password,x:'44',y:'38'}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},format:'text',followRedirects:true});if(loginForm(html(raw)))return browserRequired();direct=true;return verifyIdentity();}
 async function deliveryState(orderNo,orderedAt){
  const q=new URLSearchParams({code:'',excel_type:'',gbn_mode:'',deli_gbn3:'',deli_gbnr:'',orderby:'b.ordercode DESC',orderbyWhere:'b.ordercode DESC',search_start:orderedAt,search_end:orderedAt,s_check:'cd',search:orderNo,x:'14',y:'14',searchtype:''});
  for(const [key,value] of [['1','N'],['2','S'],['3','Y'],['8','Y'],['5','D'],['4','C'],['6','B'],['9','B'],['7','Z']])q.append('deli_gbn['+key+']',value);
  const raw=await request(ORIGIN+'/vender/order_list.php',{method:'POST',body:q.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},format:'text'}),doc=html(raw);
  if(loginForm(doc))fail('오너클랜 로그인 화면이 반환되었습니다.','SESSION_REQUIRED',401);const forms=[...nodes(doc)].filter(n=>n.tagName==='form'&&attr(n,'name')==='form2');if(forms.length!==1||!nodeText(forms[0]).includes(orderNo))bad();
  const statuses=new Set([...nodes(forms[0])].filter(n=>n.tagName==='td').map(nodeText).map(v=>v.trim()).filter(v=>['배송중','배송완료'].includes(v)));if(statuses.size!==1)bad();return [...statuses][0];
 }
 function normalize(row,status,claimType){
  const quantity=integer(row['수량'],{positive:true}),price=integer(row['오너클랜 판매가격']),amount=quantity*price;if(!Number.isSafeInteger(amount))bad();
  return baseOrder('오너클랜',credentials.account||credentials.sellerId,{providerId:'ownerclan',orderNo:id(row['주문번호']),lineId:id(row['주문순번']),orderedAt:orderDate(row['일자']),product:text(row['상품명']),option:text(row['옵션']),sku:[text(row['공급사 관리코드1']),text(row['공급사 관리코드2'])].filter(Boolean).join(' '),quantity,amount,unitPrice:price,buyer:text(row['보내는사람']),recipient:text(row['받는사람']),phone:text(row['받는사람 핸드폰'])||text(row['받는사람 전화번호']),postcode:text(row['우편번호']).replaceAll('-',''),address:text(row['주소']),deliveryMemo:text(row['배송메세지']),carrier:text(row['택배사명']),tracking:text(row['송장번호']),status,sourceStatus:status,claimType,sourceIds:{goodsId:id(row['상품코드'])}});
 }
 async function collectOrders(input){
  const {from,to}=range(input);await verifyIdentity();const orders=new Map(),shipping=new Map();
  for(const [filter,value,status,claimType] of TYPES){
   const q=new URLSearchParams({code:'',excel_type:'2',gbn_mode:'2',deli_gbn3:'',deli_gbnr:'',orderby:'a.ordercode DESC',orderbyWhere:'a.ordercode DESC',search_start:from,search_end:to,s_check:'rn',search:'',searchtype:''});q.set(filter,value);
   const rows=await downloadRecords(session,ORIGIN+'/vender/order_excel.php',{method:'POST',body:q.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},required:['주문번호','주문순번','상품명','수량','일자']});
   const seen=new Set();for(const row of rows){let actual=status;const orderNo=id(row['주문번호']),date=orderDate(row['일자']);if(date<from||date>to)bad();
    if(['배송중','배송완료'].includes(status)){if(!shipping.has(orderNo))shipping.set(orderNo,await deliveryState(orderNo,date));actual=shipping.get(orderNo);if(actual!==status)continue;}
    const order=normalize(row,actual,claimType),key=orderNo+'\0'+order.lineId;if(seen.has(key))bad();seen.add(key);mergeOrders(orders,order);
   }
  }await verifyIdentity();return {complete:true,notes:['원본에도 교환 전용 조회와 구매확정 전용 필터가 확인되지 않아 해당 두 기능은 제공하지 않습니다.','원본 서버에서 별도 판매자 ID를 확인하지 않아 계정 소유자 확인이 필요합니다.'],orders:[...orders.values()],summary:{message:'오너클랜 신규·준비·배송·취소·반품 수집 완료',count:orders.size,unsupported:['교환 전용 조회','구매확정 전용 조회']}};
 }
 return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel:()=>session.cancel?.()};
}
