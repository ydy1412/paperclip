import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createStore} from '../src/store.mjs';
import {createIntegrations} from '../src/integrations/service.mjs';
import {memoryVault,createVault} from '../src/integrations/vault.mjs';
import {integrationCatalog} from '../src/integrations/catalog.mjs';
import {validateCoupangCookies} from '../src/integrations/coupang-auth.mjs';

const SELLER='synthetic-wing-owner',PASSWORD='SYNTHETIC-WING-PASSWORD-한글',COOKIE_SECRET='SYNTHETIC-WING-COOKIE-DO-NOT-EXPORT',OTP='943721';
const cookieList=value=>[{name:'XSRF-TOKEN',value:'SYNTHETIC-XSRF-TOKEN',domain:'wing.coupang.com',path:'/',secure:true,hostOnly:true,httpOnly:false},{name:'SYNTHETIC_SESSION',value,domain:'.coupang.com',path:'/',secure:true,hostOnly:false,httpOnly:true}];
const cookies=JSON.stringify(cookieList(COOKIE_SECRET));
const row={orderNo:'184467440737095511',lineId:'184467440737095512:184467440737095513',product:'합성 윙 상품',quantity:2,unitPrice:5000,amount:10000,orderedAt:'2026-10-16',recipient:'합성 수령인',phone:'010-0000-0000',postcode:'01234',address:'테스트 주소',status:'신규',sourceIds:{provider:'coupang-wing',fulfillableQty:2}};
const range={from:'2026-10-16',to:'2026-10-16'};
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const response=(text,headers={})=>new Response(typeof text==='string'?text:JSON.stringify(text),{status:200,headers});
function setup(options={}){const store=options.store??createStore(':memory:'),vault=options.vault??memoryVault();return {store,vault,service:createIntegrations({store,vault,catalog:integrationCatalog,resolveHost:false,...options})};}
async function save(s,overrides={}){return s.service.save({providerId:'coupang',mode:'wing',sellerId:SELLER,name:'합성 윙 계정',credentials:{password:PASSWORD},...overrides});}
function sessionFactory({vendorId='A12345',login,verify,continued,cookie=cookies}={}){
  return ({credentials})=>({login:async()=>login?login(credentials):{ok:true,vendorId,sellerId:credentials.sellerId},verifyIdentity:async()=>verify?verify(credentials):{ok:true,vendorId,sellerId:credentials.sellerId},continueLogin:async input=>continued?continued(input):{ok:true,vendorId,sellerId:credentials.sellerId},getSessionCookies:()=>cookie,cancel(){}});
}
async function bound(s){const c=await save(s),pending=await s.service.wingLogin(c.id);assert.equal(pending.stage,'confirm');await s.service.wingLogin(c.id,{step:'confirm',confirmed:true,vendorId:pending.vendorId});return s.store.connection(c.id);}
function checkPublic(s,...extra){const data=JSON.stringify([s.service.list(),s.store.snapshot(),s.service.runs(),...extra]);for(const value of [PASSWORD,COOKIE_SECRET,'SYNTHETIC-XSRF-TOKEN'])assert.ok(!data.includes(value),'public state must not contain credential values');assert.doesNotMatch(data,/"cookies"\s*:|"password"\s*:/);}
function loginHttp(){
  const calls=[],loginUrl='https://xauth.coupang.com/auth/realms/seller/login-actions/authenticate?session_code=synthetic&execution=login',methodUrl='https://xauth.coupang.com/auth/realms/seller/login-actions/required-action?execution=method',codeUrl='https://xauth.coupang.com/auth/realms/seller/login-actions/required-action?execution=code';
  let vendorId='A12345';
  return {calls,setVendor:value=>vendorId=value,async fetch(url,init){const u=new URL(url),params=new URLSearchParams(init.body);calls.push({url:u,method:init.method,params,headers:init.headers});
    if(u.hostname==='wing.coupang.com'&&u.pathname==='/')return new Response(null,{status:302,headers:{Location:loginUrl}});
    if(u.href===loginUrl&&init.method==='GET')return response(`<form id="kc-form-login" action="${loginUrl.replaceAll('&','&amp;')}"></form>`);
    if(u.href===loginUrl&&init.method==='POST'){assert.equal(params.get('username'),SELLER);assert.equal(params.get('password'),PASSWORD);const headers=new Headers();headers.append('Set-Cookie','XSRF-TOKEN=SYNTHETIC-XSRF-TOKEN; Domain=wing.coupang.com; Path=/; Secure');headers.append('Set-Cookie',`SYNTHETIC_SESSION=${COOKIE_SECRET}; Domain=.coupang.com; Path=/; Secure; HttpOnly`);return response(`<form id="mfa-method-form" action="${methodUrl}"><button id="btnSms" value="SMS">문자</button><button id="btnEmail" value="EMAIL">이메일</button></form>`,headers);}
    if(u.href===methodUrl){assert.equal(params.get('mfaType'),'SMS');return response(`<form id="mfa-form" action="${codeUrl}"></form>`);}
    if(u.href===codeUrl){assert.equal(params.get('code'),OTP);assert.equal(params.get('realActionType'),'Submit');assert.equal(params.get('actionType'),'확인');return response(`<html><script>var data={vendorId: '${vendorId}'};</script></html>`);}
    if(u.pathname==='/winglayout/bell/notification/find'){assert.match(init.headers.Cookie,/SYNTHETIC_SESSION=/);return response({code:'OK'});}
    if(u.pathname==='/tenants/sfl-portal/delivery/management'){assert.match(init.headers.Cookie,/SYNTHETIC_SESSION=/);return response(`<html><script>var data={vendorId: '${vendorId}'};</script></html>`);}
    throw new Error('Unexpected synthetic HTTP path');
  }};
}

test('Wing 저장→실제 HTTP 인증 모듈의 MFA→명시적 판매자 확인→DPAPI 재로딩이 연결됩니다',{skip:process.platform!=='win32'},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dobi-wing-service-')),file=path.join(dir,'credentials.json'),vault=await createVault(file),http=loginHttp(),s=setup({vault,fetchImpl:http.fetch.bind(http)});
  try{
    const c=await save(s);assert.equal(c.hasPassword,true);assert.equal(c.hasCredentials,true);assert.equal(c.vendorId,undefined);checkPublic(s,c);assert.doesNotMatch(await readFile(file,'utf8'),/SYNTHETIC-WING|한글/);
    const method=await s.service.wingLogin(c.id);assert.equal(method.stage,'method');assert.equal(method.pending,true);assert.deepEqual(method.methods.map(m=>m.id),['mobile','email']);assert.equal(s.service.wingStatus(c.id).stage,'method');assert.equal((await vault.get(s.store.connection(c.id).credentialRef)).cookies,undefined);
    const code=await s.service.wingLogin(c.id,{step:'method',method:'mobile'});assert.equal(code.stage,'code');const confirm=await s.service.wingLogin(c.id,{step:'code',code:OTP});assert.equal(confirm.stage,'confirm');assert.equal(confirm.vendorId,'A12345');assert.equal(s.store.connection(c.id).vendorId,undefined);assert.equal((await vault.get(s.store.connection(c.id).credentialRef)).cookies,undefined);
    await assert.rejects(()=>s.service.collect(c.id,range),/판매자코드 확인/);const accepted=await s.service.wingLogin(c.id,{step:'confirm',confirmed:true,vendorId:'A12345'});assert.equal(accepted.ok,true);const saved=s.store.connection(c.id);assert.equal(saved.vendorId,'A12345');assert.ok(saved.sessionImportedAt);assert.equal(s.service.list()[0].state,'인증 확인됨');
    const decrypted=await vault.get(saved.credentialRef);assert.equal(decrypted.password,PASSWORD);assert.ok(decrypted.cookies.includes(COOKIE_SECRET));assert.doesNotMatch(await readFile(file,'utf8'),/SYNTHETIC-WING|SYNTHETIC-XSRF/);const reopened=await createVault(file);assert.deepEqual(await reopened.get(saved.credentialRef),decrypted);
    await s.service.test(c.id);checkPublic(s,method,code,confirm,accepted);assert.ok(http.calls.some(c=>c.method==='POST'&&c.params.get('username')===SELLER));assert.equal(http.calls.filter(c=>c.method==='POST').length,3);
  }finally{s.service.dispose();s.store.close();}
});
test('첫 판매자코드는 명시 확인 전 쿠키를 저장하지 않으며 잘못된 확인·재사용을 거부합니다',async()=>{
  const s=setup({wingSessionFactory:sessionFactory()});try{const c=await save(s),pending=await s.service.wingLogin(c.id);assert.equal(pending.stage,'confirm');await assert.rejects(()=>s.service.importWingSession(c.id,{cookies}),/최초 연결/);await assert.rejects(()=>s.service.wingLogin(c.id,{step:'confirm',confirmed:false,vendorId:'A12345'}),/확인/);assert.equal((await s.vault.get(s.store.connection(c.id).credentialRef)).cookies,undefined);await s.service.wingLogin(c.id);await assert.rejects(()=>s.service.wingLogin(c.id,{step:'confirm',confirmed:true,vendorId:'A54321'}),/확인/);await s.service.wingLogin(c.id);await s.service.wingLogin(c.id,{step:'confirm',confirmed:true,vendorId:'A12345'});await assert.rejects(()=>s.service.wingLogin(c.id,{step:'confirm',confirmed:true,vendorId:'A12345'}),/만료·변경/);checkPublic(s);}finally{s.store.close();}
});
test('판매자 확인 직전 계정이 바뀌면 저장하지 않고 기존 바인딩과 다른 재연결을 거부합니다',async()=>{
  let current='A12345';const s=setup({wingSessionFactory:sessionFactory({login:()=>({ok:true,vendorId:current}),verify:()=>({ok:true,vendorId:current})})});
  try{const c=await save(s);await s.service.wingLogin(c.id);current='A54321';await assert.rejects(()=>s.service.wingLogin(c.id,{step:'confirm',confirmed:true,vendorId:'A12345'}),/계정이 변경/);assert.equal(s.store.connection(c.id).vendorId,undefined);assert.equal((await s.vault.get(s.store.connection(c.id).credentialRef)).cookies,undefined);current='A12345';await s.service.wingLogin(c.id);await s.service.wingLogin(c.id,{step:'confirm',confirmed:true,vendorId:current});const before=await s.vault.get(s.store.connection(c.id).credentialRef);current='A54321';await assert.rejects(()=>s.service.importWingSession(c.id,{cookies:cookies.replace('DO-NOT-EXPORT','DIFFERENT')}),/판매자코드.*다릅니다/);await assert.rejects(()=>s.service.wingLogin(c.id),/판매자코드.*다릅니다/);assert.equal(s.store.connection(c.id).vendorId,'A12345');assert.deepEqual(await s.vault.get(s.store.connection(c.id).credentialRef),before);checkPublic(s);}finally{s.store.close();}
});
test('같은 판매자의 세션 재연결은 암호를 유지하고 갱신 쿠키를 저장합니다',async()=>{
  let active=cookies;const s=setup({wingSessionFactory:options=>sessionFactory({cookie:options.credentials.cookies??active})(options)});try{const c=await bound(s);active=cookies.replace('DO-NOT-EXPORT','RECONNECTED');await s.service.importWingSession(c.id,{cookies:active});const stored=await s.vault.get(c.credentialRef);assert.equal(stored.password,PASSWORD);assert.deepEqual(JSON.parse(stored.cookies),validateCoupangCookies(active));assert.equal(s.store.connection(c.id).vendorId,'A12345');checkPublic(s);}finally{s.store.close();}
});
test('수집은 완료된 전체 결과만 원자 반영하고 기존 메모·보류·긴 ID를 유지합니다',async()=>{
  let result={orders:[row],complete:true},rotated=cookies;const s=setup({wingSessionFactory:sessionFactory(),wingFactory:({credentials})=>{assert.equal(credentials.vendorId,'A12345');return {collectOrders:async()=>result,getSessionCookies:()=>rotated};}});
  try{const c=await bound(s);await s.service.collect(c.id,range);const initial=s.store.all()[0];assert.equal(initial.orderNo,row.orderNo);assert.equal(initial.lineId,row.lineId);s.store.update(initial.id,{workMemo:'보존할 메모',onHold:true,holdReason:'검수 대기'});result={orders:[{...row,product:'갱신 상품',status:'발송대기'}],complete:true};assert.equal((await s.service.collect(c.id,range)).summary.updated,1);assert.equal(s.store.all().length,1);assert.equal(s.store.get(initial.id).workMemo,'보존할 메모');assert.equal(s.store.get(initial.id).onHold,true);
    const before=s.store.all();for(const invalid of [{orders:[{...row,orderNo:'2'}],complete:false},{orders:[{...row,orderNo:'3'},{...row,orderNo:'4',quantity:-1}],complete:true},{orders:[row,row],complete:true}]){result=invalid;await assert.rejects(()=>s.service.collect(c.id,range));assert.deepEqual(s.store.all(),before);}checkPublic(s);
  }finally{s.store.close();}
});
test('실패해도 갱신된 세션은 보존하되 주문·공개 이력에 인증값을 섞지 않습니다',async()=>{
  const rotated=cookies.replace('DO-NOT-EXPORT','ROTATED');const s=setup({wingSessionFactory:sessionFactory(),wingFactory:()=>({collectOrders:async()=>{throw Error(`합성 조회 실패 ${PASSWORD} ${COOKIE_SECRET}`);},getSessionCookies:()=>rotated})});
  try{const c=await bound(s);await assert.rejects(()=>s.service.collect(c.id,range),error=>!error.message.includes(PASSWORD)&&!error.message.includes(COOKIE_SECRET));assert.equal(s.store.all().length,0);assert.deepEqual(JSON.parse((await s.vault.get(c.credentialRef)).cookies),validateCoupangCookies(rotated));checkPublic(s);}finally{s.store.close();}
});
test('연동 작업 중 수집·검증·저장·세션 교체·새 로그인은 같은 계정에서 겹치지 않습니다',async()=>{
  const started=deferred(),gate=deferred();const s=setup({wingSessionFactory:sessionFactory(),wingFactory:({credentials})=>({collectOrders:async()=>{started.resolve();await gate.promise;return {orders:[row],complete:true};},getSessionCookies:()=>credentials.cookies})});
  try{const c=await bound(s),collect=s.service.collect(c.id,range);await started.promise;assert.equal(s.service.isBusy(),true);assert.equal(s.service.list()[0].busy,true);for(const operation of [()=>s.service.collect(c.id,range),()=>s.service.test(c.id),()=>s.service.save({id:c.id,providerId:'coupang',mode:'wing',sellerId:SELLER,name:c.name,credentials:{}}),()=>s.service.importWingSession(c.id,{cookies}),()=>s.service.wingLogin(c.id)])await assert.rejects(operation,{status:409});gate.resolve();await collect;assert.equal(s.service.isBusy(),false);assert.equal(s.store.all().length,1);}finally{gate.resolve();s.store.close();}
});
test('진행 중 연결 정보의 직접 변경도 최종 저장과 쿠키 덮어쓰기를 차단합니다',async()=>{
  const started=deferred(),gate=deferred(),rotated=cookies.replace('DO-NOT-EXPORT','DO-NOT-COMMIT');const s=setup({wingSessionFactory:sessionFactory(),wingFactory:()=>({collectOrders:async()=>{started.resolve();await gate.promise;return {orders:[row],complete:true};},getSessionCookies:()=>rotated})});
  try{const c=await bound(s),before=await s.vault.get(c.credentialRef),collect=s.service.collect(c.id,range);await started.promise;s.store.saveConnection({id:c.id,vendorId:'A54321'});gate.resolve();await assert.rejects(collect,{status:409});assert.equal(s.store.all().length,0);assert.deepEqual(await s.vault.get(c.credentialRef),before);}finally{gate.resolve();s.store.close();}
});
test('비밀번호 공란 저장은 유지하고 아이디 변경은 세션·판매자 바인딩을 폐기합니다',async()=>{
  const s=setup({wingSessionFactory:sessionFactory()});try{const c=await bound(s);await save(s,{id:c.id,credentials:{}});const preserved=s.store.connection(c.id);assert.equal(preserved.vendorId,'A12345');assert.equal((await s.vault.get(preserved.credentialRef)).password,PASSWORD);await save(s,{id:c.id,sellerId:'another-synthetic-owner',credentials:{}});const changed=s.store.connection(c.id);assert.equal(changed.vendorId,undefined);assert.notEqual(changed.credentialRef,c.credentialRef);assert.equal(s.vault.has(c.credentialRef),false);assert.equal(s.service.list()[0].hasCredentials,false);checkPublic(s);}finally{s.store.close();}
});
test('MFA 공급자가 인증번호를 오류에 반사해도 공개 응답·이력에 남기지 않습니다',async()=>{
  const expiry=new Date(Date.now()+60000).toISOString(),s=setup({wingSessionFactory:sessionFactory({login:()=>({ok:false,pending:true,stage:'code',expiresAt:expiry}),continued:()=>{throw Error('합성 인증 실패 '+OTP);}})});
  try{const c=await save(s);await s.service.wingLogin(c.id);await assert.rejects(()=>s.service.wingLogin(c.id,{step:'code',code:OTP}),error=>!error.message.includes(OTP));assert.ok(!JSON.stringify(s.service.runs()).includes(OTP));assert.ok(!JSON.stringify(s.service.list()).includes(OTP));}finally{s.store.close();}
});
test('쿠키의 로컬 만료가 클라이언트 생성 중 발견되어도 저장된 비밀번호로 한 번 재로그인합니다',async()=>{
  let logins=0;const factory=sessionFactory();const s=setup({wingSessionFactory:options=>{const api=factory(options),login=api.login;api.login=async()=>{logins++;return login();};return api;}});
  try{const c=await bound(s);logins=0;const stored=await s.vault.get(c.credentialRef);await s.vault.set(c.credentialRef,{...stored,cookies:JSON.stringify(cookieList(COOKIE_SECRET).map(cookie=>({...cookie,expirationDate:1})))});assert.equal((await s.service.test(c.id)).ok,true);assert.equal(logins,1);assert.ok((await s.vault.get(c.credentialRef)).cookies.includes(COOKIE_SECRET));}finally{s.service.dispose();s.store.close();}
});
test('HTTP 로그인을 취소한 뒤 늦게 도착한 추가 인증 결과를 다시 pending으로 등록하지 않습니다',async()=>{
  const started=deferred(),gate=deferred(),expiry=new Date(Date.now()+60000).toISOString();const s=setup({wingSessionFactory:sessionFactory({login:async()=>{started.resolve();await gate.promise;return {ok:false,pending:true,stage:'code',expiresAt:expiry};}})});let pending;
  try{const c=await save(s);pending=s.service.wingLogin(c.id);await started.promise;assert.equal(s.service.cancelWingLogin(c.id).cancelled,true);gate.resolve();await pending.catch(()=>{});assert.equal(s.service.wingStatus(c.id).pending,false);assert.equal((await s.vault.get(s.store.connection(c.id).credentialRef)).cookies,undefined);}finally{gate.resolve();await pending?.catch(()=>{});s.service.dispose();s.store.close();}
});
test('백업 복원은 vendor pin을 유지하고 세션 참조만 무효화하여 다른 판매자 재연결을 차단합니다',async()=>{
  let vendorId='A12345';const dir=await mkdtemp(path.join(os.tmpdir(),'dobi-wing-backup-')),s=setup({store:createStore(':memory:',dir),wingSessionFactory:sessionFactory({login:()=>({ok:true,vendorId})})});
  try{const c=await bound(s),snapshot=s.store.snapshot();assert.equal(snapshot.connections[0].vendorId,'A12345');s.store.restore(snapshot);s.service.dispose();const restored=s.store.connection(c.id);assert.equal(restored.vendorId,'A12345');assert.notEqual(restored.credentialRef,c.credentialRef);assert.equal(s.service.list()[0].hasCredentials,false);vendorId='A54321';await save(s,{id:c.id});await assert.rejects(()=>s.service.wingLogin(c.id),/판매자코드.*다릅니다/);assert.equal(s.store.connection(c.id).vendorId,'A12345');checkPublic(s,snapshot);}finally{s.store.close();}
});
