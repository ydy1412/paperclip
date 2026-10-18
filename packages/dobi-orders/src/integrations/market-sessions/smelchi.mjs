import crypto from 'node:crypto';
import {array,attr,bad,baseOrder,browserRequired,credentialIdentity,fail,html,id,integer,loginForm,mergeOrders,newTransport,nodes,object,orderDate,range,text} from './common.mjs';
const ORIGIN='https://scm.smelchi.com';
// GetOrderStatusList 0x060007a5 and full-export/mapping 0x06001299/9d.
const STATES=[['02','신규','없음'],['32','신규','없음'],['03','발송대기','없음'],['04','배송중','없음'],['05','배송완료','없음'],['20','구매확정','없음'],...['06','61','96','07'].map(c=>[c,'취소','취소요청']),...['13','14','15','19'].map(c=>[c,'취소','반품요청']),...['08','09','10','11','12'].map(c=>[c,'발송대기','교환요청'])];
export function createSmelchiClient({credentials={},session}){
 const request=newTransport(session);let direct=false;
 async function verifyIdentity(){const raw=await request(ORIGIN+'/member/seller/detailBasic?step=1',{format:'text'});if(loginForm(html(raw))||!raw.includes('로그아웃'))fail('멸치쇼핑 로그인 상태를 확인할 수 없습니다.','SESSION_REQUIRED',401);return credentialIdentity(credentials,direct?'credential-login':'user-confirmation');}
 async function login(){if(!credentials.sellerId||!credentials.password)fail('멸치쇼핑 아이디와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);const raw=await request(ORIGIN+'/j_spring_security_check',{method:'POST',body:new URLSearchParams({j_username:credentials.sellerId,j_password:credentials.password}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},format:'text',followRedirects:true});if(loginForm(html(raw)))return browserRequired();direct=true;return verifyIdentity();}
 function normalize(row,option,quantity,status,claimType){
  object(row);const orderNo=id(row.ordercd),productId=id(row.productcd),dateMatch=orderNo.length>=14?/\d{8}/.exec(orderNo):null;if(!dateMatch)bad();const ordered=orderDate(dateMatch[0]),price=integer(row.sellingprice),amount=price*quantity;if(!Number.isSafeInteger(amount))bad();
  const address=[text(row.recvrnaddress1),text(row.recvrnaddress2)].filter(Boolean).join(' ')||[text(row.recvaddress1),text(row.recvaddress2)].filter(Boolean).join(' ');
  return baseOrder('멸치쇼핑',credentials.account||credentials.sellerId,{providerId:'smelchi',orderNo,lineId:productId+':'+crypto.createHash('sha256').update(option).digest('hex').slice(0,24),orderedAt:ordered,product:text(row.productname),option,sku:text(row.sellerproductcd),quantity,amount,unitPrice:price,buyer:text(row.membername),recipient:text(row.recvperson),phone:text(row.recvhp),postcode:text(row.recvpostcode).replaceAll('-',''),address,deliveryMemo:text(row.recvmessage),carrier:text(row.delicomname),tracking:text(row.shippingno),status,sourceStatus:text(row.statusname),claimType,sourceIds:{productId,productViewId:text(row.productviewcd)}});
 }
 async function collectOrders(input){
  const {from,to}=range(input);await verifyIdentity();const orders=new Map();
  for(const [code,status,claimType] of STATES){
   const body=new URLSearchParams({schYn:'Y',listType:'orderList',searchDateType:'',startDate:from,endDate:to,buyMenberField:'00',buyMenberText:'',cateCd1:'',sortOrder:'01',rowCnt:'50',cpnUseYn:'',orderStatus:code,page:'1',orderCds:'',productCds:''}).toString();
   const screen=await request(ORIGIN+'/order/list/orderList',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded','x-requested-with':'XMLHttpRequest'},format:'text'}),doc=html(screen);
   if(loginForm(doc))fail('멸치쇼핑 로그인 화면이 반환되었습니다.','SESSION_REQUIRED',401);if(![...nodes(doc)].some(n=>n.tagName==='table'&&attr(n,'id')==='table_style04'))bad();
   const payload=await request(ORIGIN+'/order/list/excelDownOption.json',{method:'POST',body:body+'&memo=',headers:{'Content-Type':'application/x-www-form-urlencoded','x-requested-with':'XMLHttpRequest'}}),rows=array(payload.jsonList),details=array(payload.ordtList),opts=array(payload.optsList);if(rows.length!==details.length)bad();
   const unused=new Set(opts.map((_,n)=>n)),within=new Set();
   for(let n=0;n<rows.length;n++){
    const row=object(rows[n]);object(details[n]);const raw=text(row.optionitem),options=raw&&raw!=='null'?raw.split('|').map(v=>v.trim()):[''];if(options.length>200)bad();let sum=0;
    for(const option of options){let quantity;if(option&&option!=='-'){
      const matches=[...unused].filter(i=>id(object(opts[i]).orderCd)===id(row.ordercd)&&id(opts[i].productCd)===id(row.productcd)&&text(opts[i].optionItem)===option);if(matches.length!==1)bad();const i=matches[0];quantity=integer(opts[i].optionCnt,{positive:true});unused.delete(i);
     }else quantity=integer(row.orderqty,{positive:true});sum+=quantity;
     const order=normalize(row,option,quantity,status,claimType),key=order.orderNo+'\0'+order.lineId;if(within.has(key)||order.orderedAt<from||order.orderedAt>to)bad();within.add(key);mergeOrders(orders,order);
    }if(sum!==integer(row.orderqty,{positive:true}))bad();
   }
   if(unused.size)bad();
  }await verifyIdentity();return {complete:true,notes:['원본 엑셀 JSON 응답 기준 수집이며, 별도 판매자 ID 응답이 없어 계정 소유자 확인이 필요합니다.'],orders:[...orders.values()],summary:{message:'멸치쇼핑 19개 주문·클레임 상태의 원본 엑셀 JSON 수집 완료',count:orders.size}};
 }
 return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel:()=>session.cancel?.()};
}
