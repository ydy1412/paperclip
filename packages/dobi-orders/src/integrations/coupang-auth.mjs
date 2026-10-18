import {parse as parseHtml} from 'parse5';
import {publicHttpsFetch} from './recipe.mjs';

// Independent implementation of the shipped ID/PW/MFA session flow.
// Contract: coupang-wing-login-contract.json, artifact f5c36c69…f42b.
const WING='https://wing.coupang.com',LIMIT=30000,MAX_BODY=12*1024*1024;
const HOSTS=new Set(['wing.coupang.com','xauth.coupang.com','www.coupang.com','coupang.com']);
const NAME=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/,VALUE=/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/,CONTROL=/[\x00-\x1f\x7f]/;
const POST_PATHS=new Set(['/fcc/download-manager/request-auto-download','/tenants/sfl-portal/stop-shipment/search','/tenants/sfl-portal/return-delivery/search','/tenants/sfl-portal/exchange/search']);
export class CoupangAuthError extends Error{constructor(message,code='WING_AUTH',status=400){super(message);this.name='CoupangAuthError';this.code=code;this.status=status;}}
const fail=(message,code,status)=>{throw new CoupangAuthError(message,code,status);};
const expired=()=>fail('쿠팡 윙 로그인이 필요합니다. 로그인과 추가 인증을 완료해주세요.','SESSION_REQUIRED',401);
function instant(now){const n=new Date(typeof now==='function'?now():now??new Date()).getTime();if(!Number.isFinite(n))fail('현재 시각을 확인할 수 없습니다.');return n;}
function domain(raw){if(typeof raw!=='string')fail('쿠팡 쿠키 도메인을 확인해주세요.','INVALID_COOKIES');const d=raw.toLowerCase().replace(/^\./,'');if(!HOSTS.has(d))fail('허용된 쿠팡 쿠키만 연결할 수 있습니다.','INVALID_COOKIES');return d;}
function canonical(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||Object.hasOwn(row,'partitionKey')||row.partitioned===true||row.partitionKeyOpaque===true)fail('쿠팡 쿠키 형식을 확인해주세요.','INVALID_COOKIES');
 const {name,value,hostOnly,secure,path='/'}=row,d=domain(row.domain);
 if(typeof name!=='string'||!NAME.test(name)||name.length>256||typeof value!=='string'||!VALUE.test(value)||typeof path!=='string'||!path.startsWith('/')||path.length>1024||CONTROL.test(path)||path.includes(';')||typeof hostOnly!=='boolean'||typeof secure!=='boolean'||row.httpOnly!==undefined&&typeof row.httpOnly!=='boolean'||row.session!==undefined&&typeof row.session!=='boolean')fail('쿠팡 쿠키 이름·값·경로·보안 속성을 확인해주세요.','INVALID_COOKIES');
 if(name.startsWith('__Secure-')&&!secure||name.startsWith('__Host-')&&(!secure||!hostOnly||path!=='/'))fail('쿠팡 쿠키 보안 속성을 확인해주세요.','INVALID_COOKIES');
 const c={name,value,domain:hostOnly?d:'.'+d,path,hostOnly,secure,httpOnly:Boolean(row.httpOnly),session:row.expirationDate===undefined};
 if(row.expirationDate!==undefined){if(typeof row.expirationDate!=='number'||!Number.isFinite(row.expirationDate)||row.expirationDate<0)fail('쿠팡 쿠키 만료일을 확인해주세요.','INVALID_COOKIES');c.expirationDate=row.expirationDate;}
 if(row.sameSite!==undefined){if(!['unspecified','no_restriction','lax','strict'].includes(row.sameSite))fail('쿠팡 쿠키 SameSite를 확인해주세요.','INVALID_COOKIES');c.sameSite=row.sameSite;}
 if(row.storeId!==undefined){if(typeof row.storeId!=='string'||row.storeId.length>50||CONTROL.test(row.storeId))fail('쿠팡 쿠키 저장소를 확인해주세요.','INVALID_COOKIES');c.storeId=row.storeId;}return c;
}
const applicable=c=>domain(c.domain)==='wing.coupang.com'||domain(c.domain)==='coupang.com'&&!c.hostOnly;
const key=c=>JSON.stringify([domain(c.domain),c.path,c.name]);
export function validateCoupangCookies(input,now=()=>new Date()){
 let raw,rows;try{raw=typeof input==='string'?input:JSON.stringify(input);if(typeof raw!=='string'||raw.length>LIMIT)throw Error();rows=JSON.parse(raw);}catch{fail('쿠팡 쿠키는 30,000자 이하의 JSON 목록이어야 합니다.','INVALID_COOKIES');}
 if(!Array.isArray(rows)||!rows.length||rows.length>200)fail('쿠팡 쿠키 목록을 확인해주세요.','INVALID_COOKIES');
 const result=[],keys=new Set(),stores=new Set();for(const row of rows){const c=canonical(row);if(!applicable(c)||keys.has(key(c)))fail('현재 윙에 적용되는 중복 없는 쿠키만 연결할 수 있습니다.','INVALID_COOKIES');keys.add(key(c));if(c.storeId!==undefined)stores.add(c.storeId);if(c.expirationDate===undefined||c.expirationDate*1000>instant(now))result.push(c);}
 if(stores.size>1)fail('서로 다른 쿠키 저장소를 함께 연결할 수 없습니다.','INVALID_COOKIES');if(!result.some(c=>c.value))expired();return result;
}
function jar(input,now){
 const entries=new Map();let order=0;for(const c of input?validateCoupangCookies(input,now):[])entries.set(key(c),{c,order:order++});
 const purge=()=>{for(const [k,{c}]of entries)if(c.expirationDate!==undefined&&c.expirationDate*1000<=instant(now))entries.delete(k);};
 function matched(url){purge();return [...entries.values()].filter(({c})=>{const d=domain(c.domain);return (c.hostOnly?url.hostname===d:url.hostname===d||url.hostname.endsWith('.'+d))&&(!c.secure||url.protocol==='https:')&&(url.pathname===c.path||url.pathname.startsWith(c.path)&&(c.path.endsWith('/')||url.pathname[c.path.length]==='/'));}).sort((a,b)=>b.c.path.length-a.c.path.length||a.order-b.order).map(x=>x.c);}
 function apply(line,url){
  if(typeof line!=='string'||line.length>LIMIT||CONTROL.test(line))fail('쿠팡 응답 쿠키를 처리하지 못했습니다.','INVALID_COOKIES',502);
  const parts=line.split(';'),pair=parts.shift().trim(),at=pair.indexOf('=');if(at<1)fail('쿠팡 응답 쿠키를 처리하지 못했습니다.','INVALID_COOKIES',502);
  const c={name:pair.slice(0,at),value:pair.slice(at+1),domain:url.hostname,path:url.pathname.lastIndexOf('/')<=0?'/':url.pathname.slice(0,url.pathname.lastIndexOf('/')),hostOnly:true,secure:false,httpOnly:false};let age;
  for(const part of parts){const eq=part.indexOf('='),k=(eq<0?part:part.slice(0,eq)).trim().toLowerCase(),v=eq<0?'':part.slice(eq+1).trim();
   if(k==='domain'){let d;try{d=domain(v);}catch{return;}if(url.hostname!==d&&!url.hostname.endsWith('.'+d))return;c.domain='.'+d;c.hostOnly=false;}
   else if(k==='path'&&v.startsWith('/'))c.path=v;else if(k==='secure')c.secure=true;else if(k==='httponly')c.httpOnly=true;else if(k==='partitioned')return;
   else if(k==='max-age'&&/^-?\d+$/.test(v)){age=Number(v);if(!Number.isSafeInteger(age))fail('쿠팡 쿠키 만료 정보를 확인하지 못했습니다.','INVALID_COOKIES',502);}
   else if(k==='expires'){const n=Date.parse(v);if(Number.isFinite(n))c.expirationDate=Math.max(0,n/1000);}
   else if(k==='samesite'){c.sameSite={none:'no_restriction',lax:'lax',strict:'strict'}[v.toLowerCase()];if(c.sameSite===undefined)delete c.sameSite;}
  }
  if(age!==undefined)c.expirationDate=Math.max(0,instant(now)/1000+age);const normalized=canonical(c),k=key(normalized),before=entries.get(k);if(normalized.expirationDate!==undefined&&normalized.expirationDate*1000<=instant(now)){entries.delete(k);return;}if(before?.c.storeId)normalized.storeId=before.c.storeId;entries.set(k,{c:normalized,order:before?.order??order++});
  if(entries.size>200||JSON.stringify([...entries.values()].map(x=>x.c)).length>LIMIT)fail('쿠팡 세션 저장 한도를 초과했습니다.','INVALID_COOKIES',502);
 }
 return {matched,header:url=>matched(url).map(c=>c.name+'='+c.value).join('; '),update(response,url){
  const previous=new Map(entries),previousOrder=order;
  try{let lines=response.headers.getSetCookie?.();if(!lines?.length){const raw=response.headers.get('set-cookie');lines=raw?raw.split(/,(?=\s*[^;,\s]+=)/):[];}for(const line of lines)apply(line,url);}
  catch(e){entries.clear();for(const [k,value]of previous)entries.set(k,value);order=previousOrder;throw e;}
 },serialize(){purge();return JSON.stringify([...entries.values()].sort((a,b)=>a.order-b.order).map(x=>x.c).filter(applicable));}};
}
function urlFor(raw,base=WING){let u;try{u=new URL(raw,base);}catch{fail('쿠팡 로그인 주소를 확인할 수 없습니다.','INVALID_ENDPOINT',502);}if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.username||u.password||u.port||u.hash||/[\r\n\\]/.test(raw))fail('허용된 쿠팡 HTTPS 주소가 아닙니다.','INVALID_ENDPOINT',502);return u;}
async function bounded(response){
 try{
 if(!response.body?.getReader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>MAX_BODY)fail('쿠팡 응답이 너무 큽니다.','RESPONSE_LIMIT',502);return bytes;}
 const reader=response.body.getReader(),parts=[];let size=0;try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>MAX_BODY)fail('쿠팡 응답이 너무 큽니다.','RESPONSE_LIMIT',502);parts.push(chunk.value);}}finally{try{await reader.cancel();}catch{}}const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
 }catch(e){if(e instanceof CoupangAuthError)throw e;fail('쿠팡 응답을 읽지 못했습니다. 정상 로그인창에서 다시 진행해주세요.','INVALID_RESPONSE',502);}
}
function nodes(html){const root=parseHtml(html),all=[];function visit(n){all.push(n);for(const c of n.childNodes||[])visit(c);}visit(root);return all;}
const attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value;
function formPage(html,pageUrl){
 const all=nodes(html),forms=all.filter(n=>n.tagName==='form');const id=n=>attr(n,'id');
 let form=forms.find(n=>id(n)==='mfa-method-form');if(form){const methods=[];function visit(n){const nId=id(n);if(['btnSms','btnEmail'].includes(nId)&&attr(n,'value'))methods.push({id:nId==='btnSms'?'mobile':'email',label:nId==='btnSms'?'휴대폰 인증':'이메일 인증',value:attr(n,'value')});for(const c of n.childNodes||[])visit(c);}visit(form);if(!methods.length)fail('쿠팡 추가 인증 방법을 확인하지 못했습니다. 로그인창을 이용해주세요.','BROWSER_REQUIRED',409);return {stage:'method',action:action(form,pageUrl),methods};}
 form=forms.find(n=>id(n)==='mfa-form');if(form)return {stage:'code',action:action(form,pageUrl)};
 form=forms.find(n=>id(n)==='kc-form-login')||forms.find(n=>(attr(n,'action')||'').includes('login-actions/authenticate'));if(form)return {stage:'password',action:action(form,pageUrl,true)};
 return null;
}
function action(form,pageUrl,password=false){const value=attr(form,'action');if(!value)fail('쿠팡 로그인 양식 주소가 없습니다.','BROWSER_REQUIRED',409);const u=urlFor(value,pageUrl);if(u.hostname!=='xauth.coupang.com'||!/^\/auth\/realms\/[^/]+\/login-actions\/(authenticate|required-action)\/?$/.test(u.pathname)||password&&!u.pathname.includes('/login-actions/authenticate'))fail('쿠팡 로그인 양식이 변경되었습니다. 정상 로그인창에서 진행해주세요.','BROWSER_REQUIRED',409);return u.href;}
function bellSuccess(text){
 const value=text.trim();if(value==='OK')return true;
 let data;try{data=JSON.parse(value);}catch{return false;}
 if(data==='OK')return true;
 if(!data||typeof data!=='object'||Array.isArray(data)||data.ok===false||data.success===false)return false;
 if(Object.hasOwn(data,'error')&&data.error!==null&&data.error!==false&&data.error!=='')return false;
 const fields=['status','result','code'].filter(k=>Object.hasOwn(data,k));
 return fields.length>0&&fields.every(k=>data[k]==='OK'||data[k]==='SUCCESS');
}
export function createCoupangSession({credentials={},fetchImpl=fetch,resolveHost=true,now=()=>new Date()}={}){
 const cookies=jar(credentials.cookies,now);let referer=WING+'/',challenge=null;
 async function send(raw,options={},auth=false){
  let u=urlFor(raw),method=options.method||'GET',body=options.body;if(!['GET','POST'].includes(method)||method==='GET'&&body!==undefined)fail('허용된 쿠팡 조회 방식이 아닙니다.','INVALID_ENDPOINT');
  if(!auth&&(u.hostname!=='wing.coupang.com'||method==='POST'&&!POST_PATHS.has(u.pathname)))fail('허용된 쿠팡 조회 경로가 아닙니다.','INVALID_ENDPOINT');
  if(auth&&method==='POST'&&(u.hostname!=='xauth.coupang.com'||!/^\/auth\/realms\/[^/]+\/login-actions\/(authenticate|required-action)\/?$/.test(u.pathname)))fail('허용된 쿠팡 로그인 주소가 아닙니다.','INVALID_ENDPOINT');
  const visited=new Set();for(let redirect=0;redirect<=12;redirect++){
   const signature=method+' '+u.href;if(visited.has(signature))fail('쿠팡 로그인 이동이 반복됩니다. 로그인창에서 다시 진행해주세요.','BROWSER_REQUIRED',409);visited.add(signature);
   const headers={Accept:auth?'text/html,application/xhtml+xml,application/json':'application/json, text/plain, */*','Accept-Language':'ko-KR,ko;q=0.9',Referer:referer,'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',Cookie:cookies.header(u)};
   if(method==='POST'){headers['Content-Type']=auth||u.pathname==='/fcc/download-manager/request-auto-download'?'application/x-www-form-urlencoded; charset=UTF-8':'application/json';headers.Origin=auth?'https://xauth.coupang.com':WING;}
   if(!auth&&method==='POST'){const c=cookies.matched(u).find(c=>c.name==='XSRF-TOKEN');if(!c?.value)expired();let value;try{value=decodeURIComponent(c.value);}catch{fail('쿠팡 CSRF 쿠키 형식을 확인하지 못했습니다.','INVALID_COOKIES');}if(CONTROL.test(value))fail('쿠팡 CSRF 헤더 형식을 확인하지 못했습니다.','INVALID_COOKIES');headers['X-XSRF-TOKEN']=value;}
   let response;try{response=await (resolveHost?publicHttpsFetch:fetchImpl)(u.href,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(30000)});}catch{fail('쿠팡 응답을 받지 못했습니다. 정상 로그인창에서 다시 진행해주세요.','NETWORK_ERROR',502);}
   if(!response||!Number.isInteger(response.status)||response.redirected)fail('쿠팡 응답 이동을 확인하지 못했습니다.','INVALID_RESPONSE',502);cookies.update(response,u);
   if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)fail('쿠팡 이동 주소가 없습니다.','INVALID_RESPONSE',502);const next=urlFor(location,u.href);if(!auth)expired();await response.body?.cancel().catch(()=>{});referer=u.href;u=next;method='GET';body=undefined;continue;}
   if([401,403].includes(response.status))expired();if(!response.ok)fail(response.status===429?'쿠팡 조회가 제한되었습니다. 잠시 후 다시 시도해주세요.':'쿠팡 요청을 처리하지 못했습니다.','HTTP_ERROR',502);
   const bytes=await bounded(response);referer=u.href;const result=new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,headers:response.headers});Object.defineProperty(result,'wingUrl',{value:u.href});return result;
  }
  fail('쿠팡 로그인 이동 한도를 초과했습니다.','BROWSER_REQUIRED',409);
 }
 async function verifyIdentity(){
  const bell=await send(WING+'/winglayout/bell/notification/find?_='+instant(now));const bellText=await bell.text();if(bellText.length>1024*1024||!bellSuccess(bellText))expired();
  const response=await send(WING+'/tenants/sfl-portal/delivery/management');const html=await response.text();const ids=[...html.matchAll(/\bvendorId\s*:\s*['"]([A-Za-z0-9_-]{1,100})['"]/g)].map(m=>m[1]);const unique=[...new Set(ids)];if(unique.length!==1)fail('쿠팡 판매자코드를 확인하지 못했습니다. 정상 로그인창에서 다시 진행해주세요.','INVALID_IDENTITY',502);const vendorId=unique[0];
  if(credentials.vendorId&&credentials.vendorId!==vendorId)fail('저장된 쿠팡 판매자코드와 현재 로그인한 계정이 다릅니다. 올바른 계정으로 다시 로그인해주세요.','ACCOUNT_MISMATCH',401);
  return {ok:true,vendorId,sellerId:credentials.sellerId};
 }
 async function afterPage(response){const html=await response.text(),form=formPage(html,response.wingUrl);if(form?.stage==='method'||form?.stage==='code'){challenge={...form,expires:instant(now)+5*60000};return publicChallenge();}if(form?.stage==='password')fail('쿠팡 아이디·비밀번호 또는 추가 로그인 조건을 확인해주세요. 정상 로그인창도 사용할 수 있습니다.','BROWSER_REQUIRED',401);challenge=null;return verifyIdentity();}
 function publicChallenge(){return {ok:false,pending:true,stage:challenge.stage,expiresAt:new Date(challenge.expires).toISOString(),methods:challenge.methods?.map(({id,label})=>({id,label}))||[]};}
 async function login(){
  challenge=null;if(typeof credentials.sellerId!=='string'||!credentials.sellerId||typeof credentials.password!=='string'||!credentials.password)fail('쿠팡 윙 아이디와 비밀번호를 입력해주세요.','CREDENTIALS_REQUIRED');
  const initial=await send(WING+'/',{},true),html=await initial.text(),form=formPage(html,initial.wingUrl);if(!form){return verifyIdentity();}if(form.stage!=='password'){challenge={...form,expires:instant(now)+5*60000};return publicChallenge();}
  return afterPage(await send(form.action,{method:'POST',body:new URLSearchParams({username:credentials.sellerId,password:credentials.password}).toString()},true));
 }
 async function continueLogin(input={}){
  if(!challenge||challenge.expires<=instant(now)){challenge=null;fail('쿠팡 추가 인증 요청이 만료됐습니다. 다시 로그인해주세요.','CHALLENGE_EXPIRED',409);}
  const pending=challenge;challenge=null;let params;
  if(pending.stage==='method'){const method=pending.methods.find(m=>m.id===input.method);if(!method)fail('휴대폰 또는 이메일 인증을 선택해주세요.');params={mfaType:method.value};}
  else {if(typeof input.code!=='string'||!/^[A-Za-z0-9 -]{1,32}$/.test(input.code)||!input.code.trim())fail('쿠팡 인증번호를 입력해주세요.');params={code:input.code.trim(),realActionType:'Submit',actionType:'확인'};}
  return afterPage(await send(pending.action,{method:'POST',body:new URLSearchParams(params).toString()},true));
 }
 return {request:(url,options)=>send(url,options,false),verifyIdentity,login,continueLogin,getSessionCookies:()=>cookies.serialize(),cancel:()=>{challenge=null;}};
}
