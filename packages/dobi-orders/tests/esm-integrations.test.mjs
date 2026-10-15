import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {createStore} from '../src/store.mjs';
import {createIntegrations} from '../src/integrations/service.mjs';
import {memoryVault} from '../src/integrations/vault.mjs';
import {integrationCatalog} from '../src/integrations/catalog.mjs';
const cookies=JSON.stringify([{name:'ESM_AUTH',value:'SYNTHETIC-ESM-COOKIE-DO-NOT-EXPORT',domain:'.esmplus.com',path:'/',secure:true,hostOnly:false,httpOnly:true}]);
const row={orderNo:'123456789012345678',lineId:'',product:'합성 ESM 상품',quantity:2,unitPrice:15000,amount:30000,orderedAt:'2026-10-14',recipient:'합성 수령인',phone:'010-0000-0000',postcode:'01234',address:'합성 주소',status:'신규',sourceIds:{provider:'esm',esmOrderNo:'987654321012345678',fulfillableQty:2}};
const mockFactory=({credentials})=>({testConnection:async()=>({ok:true}),collectOrders:async()=>({orders:[row],complete:true}),getSessionCookies:()=>credentials.cookies});
async function pairedApp(options={}){
 const app=await createApp({dbPath:':memory:',esmFactory:mockFactory,resolveHost:false,...options});
 const admin={'Content-Type':'application/json','X-Dobi-Token':app.token};
 const request=async(url,body,headers=admin)=>{const response=await fetch(app.url+url,{method:'POST',headers,body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const code=(await request('/api/bridge/pair-code',{})).data.code;
 const origin='chrome-extension://'+'b'.repeat(32);
 const token=(await request('/api/bridge/pair',{code},{'Content-Type':'application/json',Origin:origin})).data.token;
 const bridge={'Content-Type':'application/json','X-Dobi-Bridge':token,Origin:origin};
 const c=(await request('/api/connections',{providerId:'esm',name:'합성 지마켓',mode:'session',site:'gmarket',sellerId:'synthetic-seller'})).data;
 return {app,admin,bridge,c,request,grant:async()=> (await request(`/api/connections/${c.id}/session-request`,{})).data};
}
const payload=(c,g,extra={})=>({connectionId:c.id,grant:g.grant,confirmed:true,origin:'https://www.esmplus.com',cookies,...extra});

test('ESM 연결은 앱의 1회용 요청과 페어링·확인·사이트 조건을 요구하고 쿠키를 공개하지 않는다',async()=>{
 const s=await pairedApp();try{
  assert.equal(s.c.channel,'지마켓');assert.equal(s.c.hasCredentials,false);
  assert.equal((await s.request(`/api/connections/${s.c.id}/session-request`,{},s.bridge)).status,403);
  const g=await s.grant();const context=await fetch(s.app.url+'/api/bridge/context',{headers:s.bridge}).then(r=>r.json());assert.equal(context.sessionImports[0].grant,g.grant);
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g),s.admin)).status,403);
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g,{confirmed:'yes'}),s.bridge)).status,403);
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g,{origin:'https://www.esmplus.com.evil.example'}),s.bridge)).status,403);
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g),s.bridge)).status,200);
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g),s.bridge)).status,403);
  const all=await fetch(s.app.url+'/api/connections').then(r=>r.json());assert.equal(all[0].hasCredentials,true);assert.equal(all[0].state,'인증 확인됨');
  assert.doesNotMatch(JSON.stringify([all,s.app.store.snapshot(),s.app.store.runs()]),/SYNTHETIC-ESM-COOKIE|ESM_AUTH|"cookies"/);
  assert.equal((await fetch(s.app.url+'/api/bridge/context',{headers:s.bridge}).then(r=>r.json())).sessionImports.length,0);
 }finally{await s.app.close();}
});

test('갱신된 연결 요청과 변경된 판매자 설정은 기존 승인을 무효화한다',async()=>{
 const s=await pairedApp();try{
  const old=await s.grant(),latest=await s.grant();assert.notEqual(old.grant,latest.grant);
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,old),s.bridge)).status,403);
  const edited=await s.request('/api/connections',{id:s.c.id,providerId:'esm',mode:'session',site:'auction',sellerId:'other-seller',name:s.c.name});assert.equal(edited.status,201);
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,latest),s.bridge)).status,403);
  assert.equal((await fetch(s.app.url+'/api/bridge/context',{headers:s.bridge}).then(r=>r.json())).sessionImports.length,0);
 }finally{await s.app.close();}
});

test('실패한 계정 대조는 세션을 저장하지 않고 승인 재사용과 인증값 오류 반사를 차단한다',async()=>{
 const secret='SYNTHETIC-ESM-COOKIE-DO-NOT-EXPORT';
 const s=await pairedApp({esmFactory:({credentials})=>({testConnection:async()=>{throw Error('계정 대조 실패 '+secret);},getSessionCookies:()=>credentials.cookies})});
 try{const g=await s.grant(),r=await s.request('/api/bridge/esm-session',payload(s.c,g),s.bridge);assert.equal(r.status,502);assert.doesNotMatch(JSON.stringify(r.data),new RegExp(secret));assert.equal(s.app.integrations.list()[0].hasCredentials,false);assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g),s.bridge)).status,403);assert.doesNotMatch(JSON.stringify(s.app.store.runs()),new RegExp(secret));}
 finally{await s.app.close();}
});

test('세션 검증 중 설정·복원·다른 수집을 막고 한 승인으로 두 검증을 시작하지 않는다',async()=>{
 let release,started;const begun=new Promise(r=>started=r),gate=new Promise(r=>release=r);let calls=0;
 const s=await pairedApp({esmFactory:({credentials})=>({testConnection:async()=>{calls++;started();await gate;return {ok:true};},getSessionCookies:()=>credentials.cookies})});
 try{const g=await s.grant(),pending=s.request('/api/bridge/esm-session',payload(s.c,g),s.bridge);await begun;
  assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g),s.bridge)).status,403);
  assert.equal((await s.request('/api/connections',{id:s.c.id,providerId:'esm',mode:'session',site:'gmarket',sellerId:'synthetic-seller',name:s.c.name})).status,409);
  assert.equal((await s.request('/api/restore',s.app.store.snapshot())).status,409);
  assert.equal((await s.request(`/api/connections/${s.c.id}/collect`,{from:'2026-10-14',to:'2026-10-14'})).status,409);
  release();assert.equal((await pending).status,200);assert.equal(calls,1);
 }finally{release();await s.app.close();}
});

test('ESM 재수집·상품명 수정·수동 메모는 같은 외부 주문을 유지하고 미완료 결과는 반영하지 않는다',async()=>{
 let rows=[row],complete=true;const store=createStore(':memory:'),vault=memoryVault(),service=createIntegrations({store,vault,catalog:integrationCatalog,resolveHost:false,esmFactory:({credentials})=>({testConnection:async()=>({ok:true}),collectOrders:async()=>({orders:rows,complete}),getSessionCookies:()=>credentials.cookies})});
 try{const c=await service.save({providerId:'esm',mode:'session',site:'gmarket',sellerId:'synthetic',name:'합성'});await service.importEsmSession(c.id,{cookies});
  await service.collect(c.id,{from:'2026-10-14',to:'2026-10-14'});const original=store.all()[0];assert.equal(original.lineId,'');assert.equal(original.orderNo,'123456789012345678');
  store.update(original.id,{product:'수동 이름',workMemo:'보존할 메모',onHold:true,holdReason:'검수 대기'});
  rows=[{...row,product:'원격 이름 수정',status:'발송대기'}];const next=await service.collect(c.id,{from:'2026-10-14',to:'2026-10-14'});assert.equal(next.summary.updated,1);assert.equal(store.all().length,1);assert.equal(store.get(original.id).onHold,true);assert.equal(store.get(original.id).workMemo,'보존할 메모');
  complete=false;rows=[{...row,orderNo:'2'}];await assert.rejects(()=>service.collect(c.id,{from:'2026-10-14',to:'2026-10-14'}),/전체 페이지/);assert.equal(store.all().length,1);
  complete=true;rows=[{...row,orderNo:'3'},{...row,orderNo:'4',quantity:-1}];await assert.rejects(()=>service.collect(c.id,{from:'2026-10-14',to:'2026-10-14'}),/수량/);assert.equal(store.all().length,1);
  await assert.rejects(()=>service.save({id:c.id,providerId:'esm',mode:'session',site:'auction',sellerId:'other',name:c.name}),/판매자 ID/);
 }finally{store.close();}
});

test('쿠키 갱신은 실패 후에도 암호화 저장소에 남으며 restore는 세션 참조를 새로 만든다',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dobi-esm-restore-')),store=createStore(':memory:',dir),vault=memoryVault();let updated=cookies;
 const service=createIntegrations({store,vault,catalog:integrationCatalog,resolveHost:false,esmFactory:()=>({testConnection:async()=>({ok:true}),collectOrders:async()=>{updated=cookies.replace('DO-NOT-EXPORT','ROTATED');throw Error('상세 조회 실패');},getSessionCookies:()=>updated})});
 try{const c=await service.save({providerId:'esm',mode:'session',site:'gmarket',sellerId:'synthetic',name:'합성'});await service.importEsmSession(c.id,{cookies});
  await assert.rejects(()=>service.collect(c.id,{from:'2026-10-14',to:'2026-10-14'}),/상세 조회/);const key=store.connection(c.id).credentialRef;assert.match((await vault.get(key)).cookies,/ROTATED/);assert.equal(store.all().length,0);
  const snap=store.snapshot();assert.doesNotMatch(JSON.stringify(snap),/SYNTHETIC-ESM-COOKIE|ESM_AUTH/);store.restore(snap);assert.equal(store.connection(c.id).site,'gmarket');assert.equal(store.connection(c.id).sellerId,'synthetic');assert.notEqual(store.connection(c.id).credentialRef,key);assert.equal(service.list()[0].hasCredentials,false);
 }finally{store.close();}
});

test('세션 승인부터 실제 ESM 클라이언트의 6개 상태·상세 변환과 HTTP 주문 조회까지 연결된다',async()=>{
 const seen=[];
 const fetchImpl=async(url,options)=>{
  const u=new URL(url);seen.push(u);assert.equal(options.method,'GET');assert.match(options.headers.Cookie,/ESM_AUTH=/);assert.equal(options.redirect,'error');
  if(u.pathname==='/Home/SellerList')return Response.json({gmk:['synthetic-seller'],iac:[]});
  if(u.pathname.endsWith('/detail'))return Response.json({data:{deliveryTypeCode:'NORMAL'}});
  assert.equal(u.searchParams.get('sellerSiteId'),'2');assert.equal(u.searchParams.get('sellerId'),'synthetic-seller');
  if(u.pathname==='/api/new-order/orders')return new Response('{"data":{"list":[{"siteOrderNo":123456789012345678,"orderNo":987654321012345678,"sellerId":"synthetic-seller","siteId":"2","goodsName":"<b>합성 &amp; ESM</b>","orderQty":"2","sellPrice":"15,000","tradeAmnt":"30,000","payDate":"2026-10-14","rcverName":"합성 수령인","rcverInfoCp":"010-0000-0000","zipCode":"01234","rcverInfoRoadNamAd":"합성 주소"}]}}',{headers:{'Content-Type':'application/json'}});
  return Response.json({data:{list:[]}});
 };
 const s=await pairedApp({esmFactory:undefined,fetchImpl});
 try{
  const g=await s.grant();assert.equal((await s.request('/api/bridge/esm-session',payload(s.c,g),s.bridge)).status,200);
  const result=await s.request(`/api/connections/${s.c.id}/collect`,{from:'2026-10-14',to:'2026-10-14'});assert.equal(result.status,200);assert.equal(result.data.summary.inserted,1);
  const orders=await fetch(s.app.url+'/api/orders').then(r=>r.json());const actual=orders.orders[0];
  assert.equal(actual.orderNo,'123456789012345678');assert.equal(actual.sourceIds.esmOrderNo,'987654321012345678');assert.equal(actual.lineId,'');assert.equal(actual.product,'합성 & ESM');assert.equal(actual.channel,'지마켓');assert.equal(actual.amount,30000);assert.equal(actual.sourceIds.fulfillableQty,2);
  assert.equal(seen.filter(u=>u.pathname.includes('/api/')&&!u.pathname.endsWith('/detail')).length,6);assert.equal(seen.filter(u=>u.pathname.endsWith('/detail')).length,1);
  assert.doesNotMatch(JSON.stringify([orders,result.data,s.app.store.snapshot(),s.app.store.runs()]),/SYNTHETIC-ESM-COOKIE|ESM_AUTH|"cookies"/);
 }finally{await s.app.close();}
});

test('ESM 백업 복원과 공개 응답은 해당 연결에서 사용하지 않는 API recipe의 비밀값을 제외한다',async()=>{
 const s=await pairedApp();const injected={auth:{cookie:'SYNTHETIC-RESTORE-SECRET'},arbitrary:{cookies:'SYNTHETIC-RESTORE-SECRET'}};
 try{
  s.app.store.saveConnection({...s.app.store.connection(s.c.id),recipe:injected});
  assert.doesNotMatch(JSON.stringify(s.app.store.snapshot()),/SYNTHETIC-RESTORE-SECRET/);assert.doesNotMatch(JSON.stringify(s.app.integrations.list()),/SYNTHETIC-RESTORE-SECRET/);
  const backup=s.app.store.snapshot();backup.connections[0].recipe=injected;
  assert.equal((await s.request('/api/restore',backup)).status,200);
  assert.equal(s.app.store.connection(s.c.id).recipe,undefined);
  const publicRows=await fetch(s.app.url+'/api/connections').then(r=>r.json());assert.doesNotMatch(JSON.stringify([publicRows,s.app.store.snapshot()]),/SYNTHETIC-RESTORE-SECRET|"recipe"/);
 }finally{await s.app.close();}
});
