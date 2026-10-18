import {parse as parseLossless} from 'lossless-json';
import {parse} from 'parse5';
import he from 'he';

export class MarketSessionError extends Error {
  constructor(message,code='INVALID_RESPONSE',status=502){super(message);this.name='MarketSessionError';this.code=code;this.status=status;}
}
export const fail=(message,code,status)=>{throw new MarketSessionError(message,code,status);};
export const bad=()=>fail('판매처 응답 형식을 확인할 수 없어 전체 수집을 중단했습니다.');
export function scalar(value,{optional=false,max=10000}={}){
  if(value===undefined||value===null){if(optional)return '';bad();}
  if(typeof value==='number'&&!Number.isSafeInteger(value)||!['string','number','boolean'].includes(typeof value))bad();
  const s=String(value).trim();if(s.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s))bad();return s;
}
export const text=v=>he.decode(scalar(v,{optional:true}).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<[^>]*>/g,'')).trim();
export function id(value){const s=scalar(value,{max:200});if(!s||/[\s<>"'\\/]/.test(s))bad();return s;}
export function integer(value,{positive=false,signed=false}={}){const s=scalar(value).replaceAll(',','');if(!(signed?/^-?\d+$/:/^\d+$/).test(s))bad();const n=Number(s);if(!Number.isSafeInteger(n)||Math.abs(n)>1e12||positive&&n<1)bad();return n;}
export function object(v){if(!v||typeof v!=='object'||Array.isArray(v))bad();return v;}
export function array(v){if(!Array.isArray(v)||v.length>10000)bad();return v;}
export function json(raw){try{return parseLossless(raw,undefined,n=>/^-?\d+$/.test(n)&&!Number.isSafeInteger(Number(n))?n:Number(n));}catch{bad();}}
export function date(v){const s=scalar(v),d=new Date(s+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)bad();return s;}
export const addDays=(v,n)=>new Date(Date.parse(date(v)+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function range({from,to}){date(from);date(to);if(to<from||(Date.parse(to)-Date.parse(from))/86400000>366)fail('조회 기간은 1년 이내로 지정해주세요.','INVALID_DATE',400);return {from,to};}
export function orderDate(v){const s=scalar(v);if(/^\d{14}$/.test(s)){if(Number(s.slice(8,10))>23||Number(s.slice(10,12))>59||Number(s.slice(12,14))>59)bad();return date(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8));}const m=/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})(?:[ T].*)?$/.exec(s);if(!m)bad();return date(m.slice(1).join('-'));}
export function jsonState(credentials){if(!credentials.sessionData)return {};let data;try{data=JSON.parse(credentials.sessionData);}catch{bad();}return object(data);}
export function jwtPayload(token){if(typeof token!=='string'||token.length>20000||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))bad();try{return object(json(Buffer.from(token.split('.')[1],'base64url').toString('utf8')));}catch{bad();}}
export function token(v){const s=scalar(v,{max:20000});if(!s||/[\s\x00-\x1f\x7f]/.test(s))bad();return s;}
export function identity(credentials,identityId,identityLabel,identitySource='server'){
  identityId=id(identityId);if(credentials.identityId&&credentials.identityId!==identityId)fail('로그인한 판매자 계정이 저장된 연결과 다릅니다.','IDENTITY_MISMATCH',409);
  return {ok:true,serverAuthenticated:true,identityId,identityLabel:scalar(identityLabel,{max:300}),identitySource};
}
export const credentialIdentity=(credentials,source='credential-login')=>identity(credentials,'login:'+id(credentials.sellerId),credentials.sellerId+' (사용자 확인 필요)',source);
export const browserRequired=message=>({ok:false,pending:true,stage:'browser',summary:{message:message||'추가 인증은 판매처 로그인창에서 완료해주세요.'}});
export function baseOrder(provider,account,fields){
  const quantity=integer(fields.quantity,{positive:true}),amount=integer(fields.amount),orderedAt=orderDate(fields.orderedAt),product=text(fields.product);if(!product)bad();
  const claimStatuses={'취소요청':['취소','취소요청'],'반품요청':['배송완료','반품요청'],'교환요청':['발송대기','교환요청']},mapped=claimStatuses[fields.status],status=mapped?.[0]??fields.status??'신규';
  let claimType=fields.claimType??'없음';if(mapped&&claimType==='없음')claimType=mapped[1];if(!['신규','발송대기','배송중','배송완료','구매확정','취소'].includes(status)||!['없음','취소요청','반품요청','교환요청','처리완료'].includes(claimType))bad();
  const destinationValues=[fields.recipient,fields.phone,fields.postcode,fields.address].map(text),phone=destinationValues[1];
  const destinationComplete=destinationValues.every(v=>v&&!/[*●•]|알수없음|정보없음|비공개|조회불가|마스킹|개인정보\s*보호/.test(v))&&/^[+()\d\s.-]+$/.test(phone)&&(phone.match(/\d/g)?.length??0)>=8;
  const order={channel:provider,account,sku:'',option:'',buyer:'',recipient:'',phone:'',postcode:'',address:'',deliveryMemo:'',carrier:'',tracking:'',...fields,status,claimType,sourceStatus:fields.sourceStatus??fields.status??'',orderNo:id(fields.orderNo),lineId:id(fields.lineId),orderedAt,product,quantity,amount,unitPrice:fields.unitPrice===undefined?Math.floor(amount/quantity):integer(fields.unitPrice)};
  order.sourceIds={provider:fields.providerId,fulfillableQty:['신규','발송대기'].includes(order.status)&&claimType==='없음'&&destinationComplete?quantity:0,...fields.sourceIds};
  if(/[*●•]|알수없음|비공개|마스킹/.test(text(order.tracking))){order.tracking='';order.sourceIds.needsReview=true;order.sourceIds.trackingMasked=true;}
  if(order.sourceIds.fulfillableQty!==undefined){const allowed=integer(order.sourceIds.fulfillableQty);if(allowed>quantity)bad();order.sourceIds.fulfillableQty=allowed;}
  if(!destinationComplete||claimType!=='없음'||order.sourceIds.needsReview||!['신규','발송대기'].includes(order.status)){order.sourceIds.fulfillableQty=0;if(!destinationComplete||claimType!=='없음')order.sourceIds.needsReview=true;}
  return order;
}
export function mergeOrders(map,order){const key=order.orderNo+'\0'+order.lineId,old=map.get(key);if(old&&[old.product,old.quantity,old.amount].join('\0')!==[order.product,order.quantity,order.amount].join('\0'))bad();if(!old||order.claimType!=='없음'||old.claimType==='없음')map.set(key,order);if(map.size>10000)fail('한 번에 10,000품목까지 수집할 수 있습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);}
export function html(raw){if(typeof raw!=='string'||raw.length>32*1024*1024)bad();return parse(raw);}
export function* nodes(node){yield node;for(const child of node.childNodes??[])yield*nodes(child);}
export const attr=(node,name)=>(node.attrs??[]).find(a=>a.name===name)?.value;
export function nodeText(node){if(node.nodeName==='#text')return node.value??'';if(['script','style'].includes(node.tagName))return '';if(node.tagName==='br')return '\n';return (node.childNodes??[]).map(nodeText).join('');}
export function loginForm(doc){return [...nodes(doc)].some(n=>n.tagName==='input'&&attr(n,'type')?.toLowerCase()==='password');}
export function newTransport(session){
  return async function request(url,{method='GET',body,headers={},format='json',followRedirects=false}={}){
    let response;try{response=await session.request(url,{method,body,headers,followRedirects});}catch(e){if(e?.code==='IDENTITY_MISMATCH')fail('판매처 계정이 저장된 연결과 다릅니다.','IDENTITY_MISMATCH',409);if(e?.code==='SESSION_REQUIRED'||e?.status===401)fail('판매처 로그인이 만료되었거나 추가 인증이 필요합니다.','SESSION_REQUIRED',401);if(e?.code==='CANCELLED')fail('판매처 로그인을 취소했습니다.','CANCELLED',400);fail('판매처 연결 요청에 실패했습니다. 로그인 상태와 네트워크를 확인해주세요.','NETWORK_ERROR');}
    if(response.status===401||response.status===403||response.status>=300&&response.status<400)fail('판매처 로그인이 만료되었거나 추가 인증이 필요합니다.','SESSION_REQUIRED',401);
    if(!response.ok)fail('판매처가 조회 요청을 처리하지 못했습니다. 전체 수집을 중단했습니다.','REMOTE_ERROR');
    let raw;try{raw=await response.text();}catch{fail('판매처 응답을 읽지 못했습니다.','NETWORK_ERROR');}if(raw.length>32*1024*1024)bad();
    if(format==='text')return raw;if(/^\s*</.test(raw))fail('판매처 로그인 화면이 반환되었습니다. 다시 로그인해주세요.','SESSION_REQUIRED',401);return format==='json-value'?json(raw):object(json(raw));
  };
}
