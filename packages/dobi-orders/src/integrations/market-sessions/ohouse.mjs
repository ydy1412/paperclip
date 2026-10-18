import {randomBytes} from 'node:crypto';
import officeCrypto from 'officecrypto-tool';
import CFB from 'cfb';
import {bad,baseOrder,browserRequired,fail,id,identity,integer,mergeOrders,newTransport,object,orderDate,range,text,token} from './common.mjs';
import {tableRecords} from './tables.mjs';
// Ohouse CIL: cookie 1430/1438, identity 143e, Excel 0995/0996/146c.
const API='https://api.ohou.se/orora',MAX=20*1024*1024;
const STATES=[['PAYMENT_COMPLETE','신규'],['READY_FOR_DELIVERY','발송대기'],['ON_DELIVERY','배송중'],['DELIVERY_COMPLETE','배송완료'],['CONFIRMED','구매확정']];
const CLAIMS=[['cancels','CANCEL',['CANCEL_REQUEST','CANCEL_REJECT','CANCEL_DONE'],'취소요청'],['returns','RETURN',['RETURN_REQUEST','RETURN_PICKUP','RETURN_PICKUP_DONE','RETURN_REJECT','RETURN_DONE'],'반품요청'],['exchanges','EXCHANGE',['EXCHANGE_REQUEST','EXCHANGE_PICKUP','EXCHANGE_PICKUP_DONE','EXCHANGE_FORWARD_DELIVERY','EXCHANGE_REJECT','EXCHANGE_DONE'],'교환요청']];
const get=(r,...keys)=>{for(const key of keys)if(r[key]!==undefined&&r[key]!==''&&r[key]!=='알수없음')return text(r[key]);return '';};
function boundedEncryption(bytes){let cfb;try{cfb=CFB.read(bytes,{type:'buffer'});}catch{bad();}if(cfb.FileIndex.length>1000)bad();const info=CFB.find(cfb,'/EncryptionInfo'),pkg=CFB.find(cfb,'/EncryptedPackage');if(!info?.content||!pkg?.content||info.content.length>65536||pkg.content.length<8||pkg.content.length>MAX+65536)bad();const size=Buffer.from(pkg.content).readBigUInt64LE();if(size>BigInt(MAX)||size<1n)fail('오늘의집 Excel 해제 크기 한도를 초과했습니다.','RESPONSE_LIMIT');
  const b=Buffer.from(info.content);if(b.length<12)bad();const minor=b.readUInt16LE(2);if(minor===4){const xml=b.subarray(8).toString('utf8');if(/<!DOCTYPE|<!ENTITY/.test(xml))bad();const spins=[...xml.matchAll(/\bspinCount="(\d+)"/g)];if(spins.length!==1||Number(spins[0][1])>200000)bad();for(const m of xml.matchAll(/\b(keyBits|saltSize|blockSize|hashSize)="(\d+)"/g))if(Number(m[2])<1||Number(m[2])>(m[1]==='keyBits'?256:512))bad();}
  else if(minor===2){if(b.length<40||![128,192,256].includes(b.readUInt32LE(28)))bad();}else bad();
}
export function createOhouseClient({credentials={},session}={}){
  const request=newTransport(session);let cancelled=false;
  function cookieToken(){if(cancelled)fail('오늘의집 연결을 취소했습니다.','CANCELLED',400);let cookies;try{const raw=session.getSessionCookies();cookies=typeof raw==='string'?JSON.parse(raw):raw;}catch{bad();}if(!Array.isArray(cookies))bad();const values=[...new Set(cookies.filter(c=>c.name==='_orora_partner_session').map(c=>c.value))];if(values.length>1)bad();if(!values.length)fail('오늘의집 로그인창에서 먼저 로그인해주세요.','SESSION_REQUIRED',401);return token(values[0]);}
  // This server-issued cookie is the original protocol's authority. Never revive a
  // deleted/rotated cookie from a separately cached bearer in sessionData.
  const headers=()=>({'Authorization':'Bearer '+cookieToken(),'Origin':'https://orora.ohou.se','Referer':'https://orora.ohou.se/','ohouse-trust-client':'ohs-web-client'});
  async function verifyIdentity(){const joined=await request(API+'/join/v1/partners/join-status',{headers:headers()});if(joined.success!==true)fail('오늘의집 입점·로그인 상태를 확인해주세요.','SESSION_REQUIRED',401);
    const account=object((await request(API+'/member/v1/accounts',{headers:headers()})).payload),shop=object((await request(API+'/join/v1/seller-shops',{headers:headers()})).payload);if(text(account.email)!==credentials.sellerId)fail('오늘의집 로그인 이메일이 선택한 계정과 다릅니다.','IDENTITY_MISMATCH',409);return identity(credentials,id(shop.shopId),account.email);
  }
  function normalize(r,status,claimType='없음'){
    const quantity=integer(get(r,'주문수량','수량'),{positive:true}),unitValue=get(r,'판매가'),totalValue=get(r,'판매가 * 수량','주문수량x판매가'),amount=totalValue?integer(totalValue):integer(unitValue)*quantity;if(!Number.isSafeInteger(amount))bad();
    const recipient=get(r,'수취인명','수취인'),phone=get(r,'수취인연락처','수취인 연락처'),address=[get(r,'수취인주소','수거지주소','수취인 주소'),get(r,'수취인주소상세','수취인 주소상세')].filter(Boolean).join(' '),sourceStatus=get(r,'배송상태','반품상태','취소상태','교환상태')||status;
    const unsafe=/\*|●/.test(recipient+phone+address)||/취소|반품|교환/.test(sourceStatus);
    return baseOrder('오늘의집',credentials.account||credentials.sellerId,{providerId:'ohouse',orderNo:id(get(r,'주문번호')),lineId:id(get(r,'상품주문옵션번호','주문옵션번호')),orderedAt:orderDate(get(r,'주문일','주문일자','결제일','주문결제완료일')),product:get(r,'상품명'),sku:get(r,'판매자상품코드','상품자체관리코드','판매자옵션코드','옵션코드','옵션ID','옵션자체관리코드'),option:get(r,'옵션명','선택옵션'),quantity,amount,buyer:get(r,'주문자명','주문자'),recipient,phone,postcode:get(r,'수취인우편번호','수취인 우편번호'),address,deliveryMemo:[get(r,'요청사항','주문메모'),get(r,'배송메모','배송메세지')].filter(Boolean).join(', '),carrier:get(r,'배송정보(택배사)','배송방법'),tracking:get(r,'운송장번호'),status,sourceStatus,claimType,sourceIds:{productOrderId:get(r,'상품주문번호','주문상품번호'),...(unsafe?{fulfillableQty:0,needsReview:true}:{})}});
  }
  async function excel(address,body,password){let response;try{response=await session.request(address,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(body)});}catch(e){if(e.code==='SESSION_REQUIRED')fail('오늘의집 로그인이 만료되었습니다.','SESSION_REQUIRED',401);fail('오늘의집 Excel 요청을 받지 못했습니다.','NETWORK_ERROR');}
    if([401,403].includes(response.status)||response.status>=300&&response.status<400)fail('오늘의집 로그인과 다운로드 권한을 확인해주세요.','SESSION_REQUIRED',401);if(!response.ok)fail('오늘의집 Excel 요청이 거절되었습니다.','REMOTE_ERROR');let bytes;try{bytes=Buffer.from(await response.arrayBuffer());}catch{bad();}if(!bytes.length||bytes.length>MAX)fail('오늘의집 Excel 응답 크기 한도를 초과했습니다.','RESPONSE_LIMIT');
    if(bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'))){boundedEncryption(bytes);try{bytes=Buffer.from(await officeCrypto.decrypt(bytes,{password}));}catch{fail('오늘의집 Excel 암호를 확인하지 못했습니다. 전체 수집을 중단했습니다.','EXPORT_INVALID');}if(bytes.length>MAX)fail('오늘의집 Excel 해제 크기 한도를 초과했습니다.','RESPONSE_LIMIT');}
    if(bytes[0]!==0x50||bytes[1]!==0x4b)fail('오늘의집 Excel 파일을 확인하지 못했습니다.','EXPORT_INVALID');return tableRecords(bytes,{required:['주문번호','상품명']});
  }
  async function collectOrders(input){const {from,to}=range(input);await verifyIdentity();const out=new Map();
    for(const [code,status]of STATES){const password=randomBytes(12).toString('hex')+'Aa!';const body={password,orderExcelSearchDto:{filters:{statuses:[code],carrierTypes:['PARCEL_SERVICE','CARGO_SERVICE','SELLER_DIRECT','RETAIL','FAST_APPLIANCE','FAST_FURNITURE'],paymentAtFrom:from,paymentAtTo:to},page:{cursor:null,direction:'NEXT',size:500},order:'PAYMENT_AT_DESC'}};const rows=await excel(API+'/order/v1/orora/orders/excels',body,password);
      if(rows.length===500)fail('오늘의집 Excel이 조회 페이지 크기와 같아 전체 여부를 확인할 수 없습니다. 기간을 나누어주세요.','COMPLETENESS_REQUIRED',400);for(const r of rows){if(r['주문번호']==='값을 변경하지마세요.')continue;mergeOrders(out,normalize(r,status));}
    }
    for(const [kind,claimType,codes,status]of CLAIMS)for(const code of codes){const password=randomBytes(12).toString('hex')+'Aa!';const q=new URLSearchParams({page:'0',sort:'createdAt,DESC',periodType:'CREATED_AT',periodFrom:from,periodTo:to,claimType,textSearchType:'ORDERER_NAME',textSearchValue:'',statusList:code}),rows=await excel(API+'/claim/v1/orora/claims/'+kind+'/excels?'+q,{password},password);if(rows.length===500)fail('오늘의집 클레임 Excel 전체 여부를 확인할 수 없습니다. 기간을 나누어주세요.','COMPLETENESS_REQUIRED',400);for(const r of rows){if(r['주문번호']==='값을 변경하지마세요.')continue;mergeOrders(out,normalize(r,status,status));}}
    await verifyIdentity();return {complete:true,orders:[...out.values()],notes:['오늘의집 관리자에서 Excel 다운로드 이력이 기록됩니다. 결제일 기준 조회 결과의 원래 주문일을 보존합니다.','취소·반품·교환 이력과 개인정보 마스킹이 있으면 발송 대상에서 제외합니다.'],summary:{message:'오늘의집 주문·전체 클레임 Excel 수집 완료',count:out.size}};
  }
  return {login:async()=>browserRequired('오늘의집 로그인창에서 이메일·비밀번호와 추가 인증을 완료해주세요.'),verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel(){cancelled=true;session.cancel?.();}};
}
