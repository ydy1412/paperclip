import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {memoryVault} from '../src/integrations/vault.mjs';
import {createStore} from '../src/store.mjs';
import {integrationCatalog,mergeIntegrationCatalog} from '../src/integrations/catalog.mjs';
import {fixtureLogin,fixtureOrder,fixtureDate,wingHttpFixture} from './fixtures/wing-http.mjs';

async function setup(t,{legacy=false,mfa=true}={}){
  const dir=await mkdtemp(join(tmpdir(),'dobi-session-hosted-')),vault=memoryVault(),dbPath=join(dir,'orders.sqlite');
  let legacyId,businessId,orderId;
  if(legacy){
    const store=createStore(dbPath,join(dir,'backups'));
    const c=store.saveConnection({providerId:'coupang',kind:'market',channel:'쿠팡',name:'기존 쿠팡',mode:'official',credentialRef:'legacy-credential',state:'인증 확인됨'});
    await vault.set('legacy-credential',{vendorId:'SYNTHETIC_A1',accessKey:'synthetic-old-key',secretKey:'synthetic-old-secret'});
    store.syncOrders(c,[{...fixtureOrder,product:'기존 상품',orderedAt:fixtureDate(),quantity:1,unitPrice:12000,status:'신규'}]);
    const order=store.all()[0];store.update(order.id,{workMemo:'유지할 메모',onHold:true,holdReason:'검토 중'});
    const business=store.saveBusiness({name:'기존 사업자'});store.assignBusiness(c.channel,c.name,business.id);
    store.saveDraft('operator','order-new',{values:{product:'저장 중인 상품'}});
    const catalog=structuredClone(integrationCatalog);for(const p of catalog.providers){delete p.sellerLogin;delete p.wingLogin;}
    catalog.providers.find(p=>p.id==='coupang').name='내 쿠팡 표시명';catalog.providers.push({id:'operator-provider',name:'내 공급처',kind:'forwarder',browserUrl:'https://example.com'});store.saveReference('catalog',catalog);
    legacyId=c.id;businessId=business.id;orderId=order.id;store.close();
  }
  const transport=wingHttpFixture({mfa});let app,server,closed=false;
  const start=async()=>{
    app=await createApp({dbPath,dataRoot:dir,hosted:true,vault,resolveHost:false,fetchImpl:transport.fetchImpl,officialFactory(){assert.fail('Official-key collector must never run');}});
    server=http.createServer((req,res)=>{req.dobiOwnerId='operator';return app.handler(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  };
  const stop=async()=>{await new Promise(r=>server.close(r));await app.close();};await start();
  t.after(async()=>{if(!closed)await stop();await rm(dir,{recursive:true,force:true});});
  const call=async(path,data)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,data:await response.json()};};
  return {dir,vault,transport,legacyId,businessId,orderId,call,get app(){return app;},restart:async()=>{await stop();await start();},close:async()=>{await stop();closed=true;}};
}
const login=async(h,id,{confirm=true}={})=>{
  const url='/connections/'+id+'/wing-login';let r=await h.call(url,{step:'start'});assert.equal(r.status,200);
  if(r.data.stage==='method'){assert.equal((await h.call(url,{step:'method',method:'mobile'})).data.stage,'code');r=await h.call(url,{step:'code',code:fixtureLogin.code});}
  if(confirm&&r.data.stage==='confirm')r=await h.call(url,{step:'confirm',vendorId:r.data.vendorId,confirmed:true});return r;
};
const add=async h=>{const r=await h.call('/connections',{providerId:'coupang',kind:'market',name:'합성 쿠팡',mode:'wing',sellerId:fixtureLogin.sellerId,credentials:{password:fixtureLogin.password}});assert.equal(r.status,201);return r.data;};
const range=()=>({from:fixtureDate(),to:fixtureDate()});

test('기존 키 계정을 같은 ID로 재연결하고 세션으로 수집하며 주문·사업자·메모를 보존한다',async t=>{
  const h=await setup(t,{legacy:true});
  const before=(await h.call('/connections')).data.find(c=>c.id===h.legacyId);assert.equal(before.reconnectRequired,true);assert.equal(before.state,'로그인 재연결 필요');
  assert.equal((await h.call('/connections/'+h.legacyId+'/collect',range())).status,401);assert.equal(h.transport.state.reads,0);
  const catalog=(await h.call('/integrations/catalog')).data;assert.equal(catalog.providers.find(p=>p.id==='coupang').wingLogin,true);assert.equal(catalog.providers.find(p=>p.id==='coupang').name,'내 쿠팡 표시명');assert.ok(catalog.providers.some(p=>p.id==='operator-provider'));
  // The operator label must not change the persisted account channel during reconnect.
  const converted=await h.call('/connections',{id:h.legacyId,providerId:'coupang',name:'기존 쿠팡',mode:'wing',sellerId:fixtureLogin.sellerId,credentials:{password:fixtureLogin.password}});assert.equal(converted.status,201);assert.equal(converted.data.id,h.legacyId);
  assert.equal((await login(h,h.legacyId)).data.ok,true);
  const collected=await h.call('/connections/'+h.legacyId+'/collect',range());assert.equal(collected.status,200,JSON.stringify(collected.data));assert.equal(h.transport.state.missingCookies,0);assert.ok(h.transport.state.reads>0);
  const order=h.app.store.get(h.orderId);assert.equal(order.product,'합성 세션 상품');assert.equal(order.workMemo,'유지할 메모');assert.equal(order.onHold,true);assert.equal(h.app.store.all().length,1);
  assert.equal(h.app.store.accountBusinesses()[0].businessId,h.businessId);assert.equal(h.app.store.draft('operator','order-new').values.product,'저장 중인 상품');
  const secret=await h.vault.get(h.app.store.connection(h.legacyId).credentialRef);assert.ok(secret.cookies);assert.equal(secret.accessKey,undefined);
});

test('실제 세션 요청·재시작·쿠키 갱신과 실패 시 기존 주문 보존을 확인한다',async t=>{
  const h=await setup(t,{mfa:false}),c=await add(h);assert.equal((await login(h,c.id)).data.ok,true);
  await h.restart();const result=await h.call('/connections/'+c.id+'/collect',range());assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(h.app.store.all().length,1);assert.equal(h.transport.state.logins,1);assert.equal(h.transport.state.missingCookies,0);
  const original=h.app.store.all();h.transport.state.failSearch=true;assert.equal((await h.call('/connections/'+c.id+'/collect',range())).status,502);assert.deepEqual(h.app.store.all(),original);
  h.transport.state.failSearch=false;h.transport.state.cookie='synthetic-session-2';const renewed=await h.call('/connections/'+c.id+'/collect',range());assert.equal(renewed.status,200);assert.equal(h.transport.state.logins,2);assert.match((await h.vault.get(h.app.store.connection(c.id).credentialRef)).cookies,/synthetic-session-2/);
});

test('호스트는 키 방식 신규 저장과 Windows 로그인창을 거부하며 취소된 추가 인증을 이어가지 않는다',async t=>{
  const h=await setup(t),c=await add(h),url='/connections/'+c.id+'/wing-login';
  assert.equal((await h.call('/connections',{providerId:'coupang',name:'새 키 계정',mode:'official',credentials:{}})).status,400);
  assert.equal((await h.call(url,{step:'native'})).status,409);assert.equal(h.transport.state.logins,0);
  assert.equal((await h.call(url,{step:'start'})).data.stage,'method');await h.call(url,{step:'cancel'});assert.equal((await h.call(url,{step:'method',method:'mobile'})).status,409);
  assert.equal((await h.call(url)).data.pending,false);
});

test('최초 판매자 확인·다른 판매자 거부와 백업의 인증 제외를 유지한다',async t=>{
  const h=await setup(t,{mfa:false}),c=await add(h);assert.equal((await login(h,c.id,{confirm:false})).data.stage,'confirm');assert.equal((await h.call('/connections/'+c.id+'/collect',range())).status,400);
  await h.call('/connections/'+c.id+'/wing-login',{step:'confirm',vendorId:'SYNTHETIC_A1',confirmed:true});
  const backup=h.app.store.snapshot();assert.doesNotMatch(JSON.stringify(backup),/synthetic-password|synthetic-session-1|credentialRef/);
  h.transport.state.vendorId='SYNTHETIC_OTHER';assert.equal((await h.call('/connections/'+c.id+'/collect',range())).status,401);assert.equal(h.app.store.all().length,0);
  h.app.store.restore(backup);assert.equal((await h.call('/connections')).data[0].hasCredentials,false);assert.equal(h.app.store.connection(c.id).vendorId,'SYNTHETIC_A1');
});

test('카카오 API형은 세션 지원으로 표시하지 않고 사용자 목록을 보존한다',()=>{
  const catalog=mergeIntegrationCatalog(structuredClone(integrationCatalog));const kakao=catalog.providers.find(p=>p.id==='kakaoapi');assert.equal(kakao.apiKeyOnly,true);assert.equal(kakao.wingLogin,false);
});
