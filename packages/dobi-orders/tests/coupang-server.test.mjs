import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';
import {memoryVault} from '../src/integrations/vault.mjs';

const COOKIE_SECRET='SYNTHETIC-WING-COOKIE-NO-EXPORT',PASSWORD='SYNTHETIC-WING-PASSWORD-NO-EXPORT',OTP='SYNTHETIC-OTP-456';
const COOKIE=JSON.stringify([{name:'XSRF-TOKEN',value:COOKIE_SECRET,domain:'.coupang.com',path:'/',hostOnly:false,secure:true,httpOnly:true}]);
const EXTENSION='chrome-extension://'+'c'.repeat(32),WING='https://wing.coupang.com',XAUTH='https://xauth.coupang.com';
const INITIAL=XAUTH+'/auth/realms/seller/protocol/openid-connect/auth?client_id=wing';
const action=kind=>XAUTH+'/auth/realms/seller/login-actions/'+(kind==='password'?'authenticate?execution=login':'required-action?execution='+kind)+'&session_code=synthetic';
const form=kind=>kind==='password'?`<form id="kc-form-login" action="${action(kind).replaceAll('&','&amp;')}"></form>`:kind==='method'?`<form id="mfa-method-form" action="${action(kind).replaceAll('&','&amp;')}"><input id="btnSms" value="synthetic-mobile"><input id="btnEmail" value="synthetic-email"></form>`:`<form id="mfa-form" action="${action(kind).replaceAll('&','&amp;')}"></form>`;
function reply(body,{status=200,location,cookie}={}){const headers=new Headers();if(location)headers.set('Location',location);if(cookie)headers.append('Set-Cookie',cookie);return new Response(body,{status,headers});}
function publicSafe(data){assert.doesNotMatch(JSON.stringify(data),/SYNTHETIC-WING-COOKIE|SYNTHETIC-WING-PASSWORD|SYNTHETIC-OTP|"password"|"cookies"|"credentialRef"/);}
async function server(t,{mfa=false,...options}={}){
  const state={vendorId:'SYNTHETIC_A1',requests:[],nativeCalls:[]},vault=memoryVault(),backups=[];
  const fetchImpl=async(url,init)=>{
    const u=new URL(url),body=Object.fromEntries(new URLSearchParams(init.body));state.requests.push({url:u,init,body});
    assert.ok([WING,XAUTH].includes(u.origin),'Only synthetic Coupang routes may reach the injected transport');
    if(u.origin===WING&&u.pathname==='/')return reply('',{status:302,location:INITIAL});
    if(u.origin===XAUTH&&u.pathname.endsWith('/protocol/openid-connect/auth'))return reply(form('password'));
    if(u.origin===XAUTH&&init.method==='POST'){
      if(u.pathname.endsWith('/authenticate')){assert.equal(body.password,PASSWORD);return mfa?reply(form('method')):reply('signed in',{cookie:'XSRF-TOKEN='+COOKIE_SECRET+'; Domain=.coupang.com; Path=/; Secure; HttpOnly'});}
      if(u.searchParams.get('execution')==='method'){assert.equal(body.mfaType,'synthetic-mobile');return reply(form('code'));}
      assert.deepEqual(body,{code:OTP,realActionType:'Submit',actionType:'확인'});return reply('signed in',{cookie:'XSRF-TOKEN='+COOKIE_SECRET+'; Domain=.coupang.com; Path=/; Secure; HttpOnly'});
    }
    if(!init.headers.Cookie?.includes('XSRF-TOKEN='+COOKIE_SECRET))return reply('not signed in',{status:401});
    if(u.pathname==='/winglayout/bell/notification/find')return reply('{"status":"OK"}');
    if(u.pathname==='/tenants/sfl-portal/delivery/management')return reply(`<script>const merchant={vendorId:'${state.vendorId}'};</script>`);
    assert.fail('Unexpected synthetic Coupang endpoint');
  };
  const nativeLogin=async data=>{state.nativeCalls.push(data);if(data.signal.aborted)throw Error('cancelled');return {cookies:COOKIE};};
  const app=await createApp({dbPath:':memory:',vault,resolveHost:false,fetchImpl,nativeLogin,...options});
  const admin={'Content-Type':'application/json','X-Dobi-Token':app.token,Origin:app.url};
  async function request(url,{method='POST',data={},headers=admin}={}){const r=await fetch(app.url+url,{method,headers,...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(data)})});const dataOut=await r.json();if(url==='/api/restore'&&dataOut.backupPath)backups.push(dataOut.backupPath);return {status:r.status,data:dataOut};}
  const get=(url,headers=admin)=>request(url,{method:'GET',headers});
  const post=(url,data={},headers=admin)=>request(url,{data,headers});
  async function add(change={}){const r=await post('/api/connections',{providerId:'coupang',mode:'wing',sellerId:'synthetic-wing',name:'합성 쿠팡',credentials:{password:PASSWORD},...change});assert.equal(r.status,201);publicSafe(r.data);return r.data;}
  const loginUrl=c=>`/api/connections/${c.id}/wing-login`;
  async function connect(c){const started=await post(loginUrl(c));assert.equal(started.status,200);assert.equal(started.data.stage,'confirm');assert.equal(started.data.vendorId,state.vendorId);const confirmed=await post(loginUrl(c),{step:'confirm',confirmed:true,vendorId:started.data.vendorId});assert.equal(confirmed.status,200);assert.equal(confirmed.data.ok,true);return confirmed.data;}
  async function pair(){const code=await post('/api/bridge/pair-code');assert.equal(code.status,200);const r=await post('/api/bridge/pair',{code:code.data.code},{'Content-Type':'application/json',Origin:EXTENSION});assert.equal(r.status,200);return {'Content-Type':'application/json',Origin:EXTENSION,'X-Dobi-Bridge':r.data.token};}
  async function grant(c){const r=await post(`/api/connections/${c.id}/session-request`);assert.equal(r.status,200);return r.data;}
  const importBody=(c,g,change={})=>({connectionId:c.id,grant:g.grant,confirmed:true,origin:WING,cookies:COOKIE,...change});
  t.after(async()=>{await app.close();const allowed=path.resolve(fileURLToPath(new URL('../data/backups/',import.meta.url)));for(const file of backups){const resolved=path.resolve(file);assert.equal(path.dirname(resolved),allowed);assert.match(path.basename(resolved),/^before-restore-\d+\.json$/);await unlink(resolved).catch(e=>{if(e.code!=='ENOENT')throw e;});}});
  return {app,vault,state,admin,post,get,add,connect,pair,grant,importBody,loginUrl};
}

test('HTTP ID/PW→추가 인증→최초 판매자코드 확인 전에는 연결·수집·세션 import를 허용하지 않습니다',async t=>{
  const s=await server(t,{mfa:true}),c=await s.add(),url=s.loginUrl(c),key=s.app.store.connection(c.id).credentialRef;
  assert.equal((await s.get(url)).data.pending,false);
  assert.equal((await s.post(`/api/connections/${c.id}/session-request`)).status,400);
  assert.equal((await s.post(`/api/connections/${c.id}/test`)).status,400);
  assert.equal(s.state.requests.length,0);
  const method=await s.post(url);assert.equal(method.status,200);assert.equal(method.data.stage,'method');publicSafe(method.data);assert.equal((await s.get(url)).data.stage,'method');
  const code=await s.post(url,{step:'method',method:'mobile'});assert.equal(code.status,200);assert.equal(code.data.stage,'code');publicSafe(code.data);
  const confirmation=await s.post(url,{step:'code',code:OTP});assert.equal(confirmation.status,200);assert.equal(confirmation.data.stage,'confirm');assert.equal(confirmation.data.vendorId,'SYNTHETIC_A1');publicSafe(confirmation.data);
  assert.equal(s.app.store.connection(c.id).vendorId,undefined);assert.equal((await s.vault.get(key)).cookies,undefined);assert.equal((await s.post(`/api/connections/${c.id}/session-request`)).status,400);
  const bridge=await s.pair();const attempt=await s.post('/api/bridge/coupang-session',s.importBody(c,{grant:'f'.repeat(64)}),bridge);assert.equal(attempt.status,403);
  const confirmed=await s.post(url,{step:'confirm',confirmed:true,vendorId:'SYNTHETIC_A1'});assert.equal(confirmed.status,200);assert.equal(confirmed.data.ok,true);publicSafe(confirmed.data);
  assert.equal(s.app.store.connection(c.id).vendorId,'SYNTHETIC_A1');assert.ok((await s.vault.get(key)).cookies.includes(COOKIE_SECRET));assert.deepEqual((await s.get(url)).data,{ok:true,pending:false});
  publicSafe((await s.get('/api/connections')).data);publicSafe((await s.get('/api/integration-runs')).data);publicSafe((await s.get('/api/backup')).data);
});

test('판매자 확인을 거절·오입력하거나 확인 중 원격 VendorId가 바뀌면 쿠키를 저장하지 않습니다',async t=>{
  const s=await server(t),c=await s.add(),url=s.loginUrl(c),key=s.app.store.connection(c.id).credentialRef;
  await s.post(url);assert.equal((await s.post(url,{step:'confirm',confirmed:false,vendorId:'SYNTHETIC_A1'})).status,400);assert.equal((await s.vault.get(key)).cookies,undefined);
  await s.post(url);assert.equal((await s.post(url,{step:'confirm',confirmed:true,vendorId:'SYNTHETIC_OTHER'})).status,400);assert.equal(s.app.store.connection(c.id).vendorId,undefined);
  await s.post(url);s.state.vendorId='SYNTHETIC_OTHER';const changed=await s.post(url,{step:'confirm',confirmed:true,vendorId:'SYNTHETIC_A1'});assert.equal(changed.status,409);assert.equal((await s.vault.get(key)).cookies,undefined);publicSafe(changed.data);
});

test('저장된 VendorId로 재로그인하면 재확인 없이 대조하며 다른 계정은 거부합니다',async t=>{
  const s=await server(t),c=await s.add();await s.connect(c);assert.equal((await s.post(s.loginUrl(c))).data.ok,true);s.state.vendorId='SYNTHETIC_OTHER';const r=await s.post(s.loginUrl(c));assert.equal(r.status,401);publicSafe(r.data);assert.equal(s.app.store.connection(c.id).vendorId,'SYNTHETIC_A1');
});

test('GET/POST wing-login은 로컬 Origin과 변경 토큰을 적용하고 다른 provider를 거부합니다',async t=>{
  const s=await server(t),c=await s.add(),url=s.loginUrl(c);
  assert.equal((await s.post(url,{}, {'Content-Type':'application/json',Origin:s.app.url})).status,403);
  assert.equal((await s.post(url,{}, {...s.admin,Origin:'https://evil.example'})).status,403);
  assert.equal((await s.get(url,{Origin:'https://evil.example'})).status,403);
  assert.equal(s.state.requests.length,0);
  const esm=await s.add({providerId:'esm',mode:'session',site:'gmarket',sellerId:'synthetic-gmarket',name:'합성 지마켓',credentials:{}});
  assert.equal((await s.get(s.loginUrl(esm))).status,400);assert.equal((await s.post(s.loginUrl(esm))).status,400);
});

test('취소 후 추가 인증 요청은 재사용할 수 없고 공개 상태에서 사라집니다',async t=>{
  const s=await server(t,{mfa:true}),c=await s.add(),url=s.loginUrl(c);await s.post(url);assert.equal((await s.get(url)).data.stage,'method');
  assert.equal((await s.post(url,{step:'cancel'})).data.cancelled,true);assert.deepEqual((await s.get(url)).data,{ok:false,pending:false});
  assert.equal((await s.post(url,{step:'method',method:'mobile'})).status,409);assert.equal(s.app.store.connection(c.id).vendorId,undefined);
});

test('독립 native 로그인 보조도 검증 후 최초 판매자코드 확인을 요구합니다',async t=>{
  const s=await server(t),c=await s.add(),r=await s.post(s.loginUrl(c),{step:'native'});assert.equal(r.status,200);assert.equal(r.data.stage,'confirm');assert.equal(s.state.nativeCalls.length,1);assert.equal(s.state.nativeCalls[0].sellerId,c.sellerId);assert.equal(s.state.nativeCalls[0].password,PASSWORD);assert.equal(s.app.store.connection(c.id).vendorId,undefined);publicSafe(r.data);
  assert.equal((await s.post(s.loginUrl(c),{step:'confirm',confirmed:true,vendorId:r.data.vendorId})).status,200);
});

test('Wing bridge 연결은 앱 발급·페어링·확인·정확한 Origin과 일회용 grant를 요구합니다',async t=>{
  const s=await server(t),c=await s.add();await s.connect(c);const bridge=await s.pair();
  assert.equal((await s.post(`/api/connections/${c.id}/session-request`,{},bridge)).status,403);
  const g=await s.grant(c);assert.equal(g.providerId,'coupang');assert.equal(g.mode,'wing');assert.equal(g.sellerId,c.sellerId);assert.ok(!Object.hasOwn(g,'identity'));
  const context=(await s.get('/api/bridge/context',bridge)).data;assert.equal(context.sessionImports[0].grant,g.grant);publicSafe(context);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g),s.admin)).status,403);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g),{...bridge,'X-Dobi-Bridge':'invalid'})).status,403);
  for(const change of [{confirmed:'yes'},{origin:'https://wing.coupang.com.evil.example'},{origin:'https://xauth.coupang.com'},{origin:'https://www.coupang.com'},{origin:'http://wing.coupang.com'},{grant:'e'.repeat(64)}])assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g,change),bridge)).status,403);
  const imported=await s.post('/api/bridge/coupang-session',s.importBody(c,g),bridge);assert.equal(imported.status,200);assert.equal(imported.data.ok,true);publicSafe(imported.data);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g),bridge)).status,403);assert.equal((await s.get('/api/bridge/context',bridge)).data.sessionImports.length,0);
});

test('다른 provider·다른 연결의 grant는 Wing import에 사용할 수 없습니다',async t=>{
  const s=await server(t),c=await s.add();await s.connect(c);const bridge=await s.pair(),g=await s.grant(c);
  const esm=await s.add({providerId:'esm',mode:'session',site:'auction',sellerId:'synthetic-auction',name:'합성 옥션',credentials:{}}),esmGrant=await s.grant(esm);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,esmGrant),bridge)).status,403);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(esm,esmGrant),bridge)).status,403);
  assert.equal((await s.post('/api/bridge/esm-session',s.importBody(c,g,{origin:'https://www.esmplus.com'}),bridge)).status,403);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g),bridge)).status,200);
});

test('grant 갱신·인증 참조 변경·만료는 기존 요청을 무효화합니다',async t=>{
  const s=await server(t),c=await s.add();await s.connect(c);const bridge=await s.pair(),old=await s.grant(c),latest=await s.grant(c);assert.notEqual(old.grant,latest.grant);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,old),bridge)).status,403);
  assert.equal((await s.post('/api/connections',{...c,credentials:{password:'SYNTHETIC-NEW-PASSWORD'}})).status,201);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,latest),bridge)).status,403);assert.equal((await s.get('/api/bridge/context',bridge)).data.sessionImports.length,0);
  const expires=await s.grant(c),realNow=Date.now;try{Date.now=()=>Date.parse(expires.expiresAt)+1;assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,expires),bridge)).status,403);assert.equal((await s.get('/api/bridge/context',bridge)).data.sessionImports.length,0);}finally{Date.now=realNow;}
});

test('잘못된 쿠키·다른 VendorId의 import 실패도 grant를 소모하고 기존 세션을 유지합니다',async t=>{
  const s=await server(t),c=await s.add();await s.connect(c);const bridge=await s.pair(),key=s.app.store.connection(c.id).credentialRef,before=await s.vault.get(key),g=await s.grant(c);
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g,{cookies:'not-json'}),bridge)).status,400);assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g),bridge)).status,403);assert.deepEqual(await s.vault.get(key),before);
  const other=await s.grant(c);s.state.vendorId='SYNTHETIC_OTHER';const mismatch=await s.post('/api/bridge/coupang-session',s.importBody(c,other),bridge);assert.equal(mismatch.status,401);publicSafe(mismatch.data);assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,other),bridge)).status,403);assert.deepEqual(await s.vault.get(key),before);
});

test('백업은 쿠키·비밀번호를 제외하고 복원은 grant·진행 상태·인증 참조를 초기화합니다',async t=>{
  const s=await server(t),c=await s.add();await s.connect(c);const bridge=await s.pair(),g=await s.grant(c),oldRef=s.app.store.connection(c.id).credentialRef;
  const backup=(await s.get('/api/backup')).data;publicSafe(backup);assert.equal(backup.connections[0].vendorId,'SYNTHETIC_A1');assert.equal(backup.connections[0].state,'인증 필요');
  backup.connections[0].cookies=COOKIE;backup.connections[0].password=PASSWORD;backup.connections[0].credentials={password:PASSWORD};backup.connections[0].passwordSaved=true;backup.connections[0].credentialRef=oldRef;backup.connections[0].recipe={auth:{cookie:COOKIE_SECRET}};
  const restored=await s.post('/api/restore',backup);assert.equal(restored.status,200);const stored=s.app.store.connection(c.id);assert.notEqual(stored.credentialRef,oldRef);assert.equal(stored.state,'인증 필요');for(const key of ['cookies','password','credentials','passwordSaved','recipe'])assert.equal(stored[key],undefined);
  const rows=(await s.get('/api/connections')).data;assert.equal(rows[0].hasCredentials,false);assert.equal(rows[0].hasPassword,false);publicSafe(rows);publicSafe((await s.get('/api/backup')).data);assert.deepEqual((await s.get(s.loginUrl(c))).data,{ok:false,pending:false});
  assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g),bridge)).status,403);assert.equal((await s.get('/api/bridge/context',bridge)).data.sessionImports.length,0);
  const fresh=await s.grant(c);assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,fresh),bridge)).status,200);
});

test('로그인 응답 대기 중 취소하면 늦게 도착한 challenge를 다시 공개하지 않습니다',async t=>{
  let started,release;const begun=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  const s=await server(t,{wingSessionFactory:()=>({async login(){started();await gate;return {ok:false,pending:true,stage:'method',methods:[{id:'mobile',label:'휴대폰 인증'}],expiresAt:new Date(Date.now()+5*60000).toISOString()};},cancel(){},getSessionCookies:()=>COOKIE})}),c=await s.add(),url=s.loginUrl(c);
  try{const waiting=s.post(url);await begun;assert.equal((await s.post(url,{step:'cancel'})).data.cancelled,true);release();const late=await waiting;assert.ok(late.status===409||late.data.cancelled===true);assert.deepEqual((await s.get(url)).data,{ok:false,pending:false});}finally{release();}
});

test('Wing import 검증 중 grant 재사용·새 발급·설정·복원·수집의 HTTP 경계를 차단합니다',async t=>{
  let started,release,blocked=false,checks=0;const begun=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  const s=await server(t,{wingSessionFactory:()=>({login:async()=>({ok:true,vendorId:'SYNTHETIC_A1'}),async verifyIdentity(){checks++;if(blocked){started();await gate;}return {ok:true,vendorId:'SYNTHETIC_A1'};},getSessionCookies:()=>COOKIE,cancel(){}})}),c=await s.add();await s.connect(c);const bridge=await s.pair(),g=await s.grant(c);blocked=true;
  try{
    const waiting=s.post('/api/bridge/coupang-session',s.importBody(c,g),bridge);await begun;
    assert.equal((await s.post('/api/bridge/coupang-session',s.importBody(c,g),bridge)).status,403);
    assert.equal((await s.post(`/api/connections/${c.id}/session-request`)).status,409);
    assert.equal((await s.post('/api/connections',{...c,credentials:{}})).status,409);
    assert.equal((await s.post('/api/restore',(await s.get('/api/backup')).data)).status,409);
    assert.equal((await s.post(`/api/connections/${c.id}/collect`,{from:'2026-10-16',to:'2026-10-16'})).status,409);
    release();assert.equal((await waiting).status,200);assert.equal(checks,2);publicSafe((await s.get('/api/connections')).data);
  }finally{release();}
});

test('백업 복원은 진행 중 추가 인증을 폐기하고 이전 단계 재사용을 차단합니다',async t=>{
  const s=await server(t,{mfa:true}),c=await s.add(),url=s.loginUrl(c);assert.equal((await s.post(url)).data.stage,'method');
  const backup=(await s.get('/api/backup')).data;publicSafe(backup);assert.equal((await s.post('/api/restore',backup)).status,200);
  assert.deepEqual((await s.get(url)).data,{ok:false,pending:false});assert.equal((await s.post(url,{step:'method',method:'mobile'})).status,409);
  const restored=(await s.get('/api/connections')).data[0];assert.equal(restored.hasCredentials,false);assert.equal(restored.hasPassword,false);assert.equal((await s.post(`/api/connections/${c.id}/session-request`)).status,400);
});
