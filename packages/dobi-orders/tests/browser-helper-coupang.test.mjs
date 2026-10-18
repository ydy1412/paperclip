import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../browser-helper/popup.js',import.meta.url),'utf8')).replace(/\nrun\(load\);\s*$/,'');
const plain=value=>JSON.parse(JSON.stringify(value));
const BASE='http://127.0.0.1:4317';
const SECRET='FIXTURE_WING_COOKIE_VALUE_DO_NOT_DISPLAY';
const OTHER_SECRET='FIXTURE_OTHER_SCOPE_VALUE_DO_NOT_DISPLAY';
const PARTITION_SECRET='FIXTURE_PARTITION_VALUE_DO_NOT_DISPLAY';
class UiElement {
  constructor(output){this._text='';this.output=output;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.options=[];this.listeners=new Map();this.classList={toggle(){}};}
  get textContent(){return this._text;}
  set textContent(value){this._text=String(value);this.output.push(this._text);}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  replaceChildren(){this.options=[];this.value='';}
  append(child){this.options.push(child);if(!this.value)this.value=child.value;}
}
class Hook {
  constructor(){this.listeners=[];}
  addListener(listener){this.listeners.push(listener);}
  emit(...args){for(const listener of this.listeners)listener(...args);}
}
function harness(options={}){
  const output=[],trace=[],posts=[],storage=[],consoleOutput=[],elements=new Map(),updated=new Hook(),activated=new Hook(),focused=new Hook();
  const grant={connectionId:'wing-connection',providerId:'coupang',mode:'wing',grant:'fixture-wing-grant-0123456789abcdef',expiresAt:new Date(Date.now()+240000).toISOString(),sellerId:'fixture-vendor',name:'예제 Wing 판매자'};
  const h={output,trace,posts,storage,consoleOutput,grant,tab:{id:17,url:'https://wing.coupang.com/tenants/seller-web/vendor-inventory/list',windowId:3},serverContext:{providers:[{id:'coupang',kind:'market',browserUrl:'https://wing.coupang.com'}],connections:[{id:'wing-connection',providerId:'coupang',kind:'market',mode:'wing',sellerId:'fixture-vendor',name:'예제 Wing 판매자'}],sessionImports:[grant],drafts:[]},get ui(){return id=>{if(!elements.has(id))elements.set(id,new UiElement(output));return elements.get(id);};},stores:[{id:'other-store',tabIds:[20]},{id:'active-store',tabIds:[17]}],cookies:[{name:'fixture_session',value:SECRET,domain:'.coupang.com',path:'/',hostOnly:false,secure:true,httpOnly:true,session:false,expirationDate:Date.now()/1000+600,storeId:'active-store'}],permission:true,postOk:true,contextReads:0,storeReads:0,postResponseReads:0,updated,activated,focused,...options};
  const cookieApi={getAllCookieStores:async()=>{trace.push('stores');h.storeReads++;h.onStores?.();return h.stores;},getAll:async query=>{trace.push('cookies');h.cookieQuery=plain(query);h.onCookies?.();return h.cookies;}};
  const chrome={tabs:{query:async()=>{trace.push('tab');h.onTab?.();return [{...h.tab}];},onUpdated:updated,onActivated:activated},windows:{onFocusChanged:focused},permissions:{request:query=>{trace.push('permission-request');h.requestQuery=plain(query);h.onRequest?.();return Promise.resolve(h.permission);},contains:async()=>{trace.push('permission-check');return h.contains?h.contains():h.permission;},remove:async query=>{trace.push('permission-remove');h.removeQuery=plain(query);return true;}},cookies:cookieApi,storage:{local:{get:async()=>({dobiBridgeToken:'PAIR_TOKEN'}),set:async value=>storage.push(plain(value)),remove:async()=>{}}}};
  const fetch=async(url,request={})=>{
    assert.equal(new URL(url).origin,BASE,'도우미는 로컬 프로그램에만 전송해야 합니다.');
    if(url===BASE+'/api/bridge/context'){trace.push('context');h.contextReads++;h.onContext?.();return {ok:true,json:async()=>plain(h.serverContext)};}
    assert.equal(url,BASE+'/api/bridge/coupang-session');trace.push('POST-wing');posts.push({url,request:plain(request)});if(h.postThrows)throw Error(SECRET);
    return {ok:h.postOk,json:async()=>{h.postResponseReads++;return {error:SECRET};}};
  };
  const context=vm.createContext({URL,AbortSignal,TextEncoder,Set,Map,Date,Error,fetch,chrome,document:{getElementById:id=>h.ui(id),createElement:()=>new UiElement(output),querySelectorAll:()=>[]},location:{origin:'https://wing.coupang.com'},console:{log:value=>consoleOutput.push(String(value)),error:value=>consoleOutput.push(String(value))}});
  vm.runInContext(source,context);
  h.api=vm.runInContext('({state,prepareWingSession,beginWingSession,normalizeWingCookies,renderWingImports,renderEsmImports,prepareEsmSession,scanVisibleOrders})',context);h.api.state.token='PAIR_TOKEN';h.api.state.context=plain(h.serverContext);h.ui('wingConnectionSelect').value='wing-connection';h.chrome=chrome;h.cookieApi=cookieApi;
  return h;
}
async function ready(h){await h.api.prepareWingSession();h.ui('confirmWing').checked=true;assert.ok(h.api.state.wingPrepared);}
function assertNoLeak(h){const visible=h.output.concat(h.consoleOutput).join('\n');for(const value of [SECRET,OTHER_SECRET,PARTITION_SECRET,h.grant.grant])assert.ok(!visible.includes(value));assert.deepEqual(h.storage,[]);assert.equal(h.postResponseReads,0);assert.ok(!JSON.stringify(plain(h.api.state)).includes(SECRET),'쿠키값은 공유 상태에 남기지 않습니다.');}

test('Wing 추가 권한은 선택 사항이며 기존 기본 권한과 ESM 권한을 유지한다',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../browser-helper/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,'0.3.0');assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert.deepEqual(manifest.host_permissions,[BASE+'/*']);assert.deepEqual(manifest.optional_permissions,['cookies']);assert.deepEqual(manifest.optional_host_permissions,['https://*.esmplus.com/*','https://*.coupang.com/*']);
  const html=await readFile(new URL('../browser-helper/popup.html',import.meta.url),'utf8');assert.match(html,/id="confirmWing" type="checkbox"/);assert.match(html,/정상 로그인을 완료/);assert.match(html,/아이디·비밀번호를 읽지/);
});

test('Wing 로그인 완료·쿠키 사용 동의가 없거나 권한이 거절되면 쿠키를 읽지 않는다',async()=>{
  const noConsent=harness();await noConsent.api.prepareWingSession();noConsent.api.beginWingSession();assert.equal(noConsent.trace.filter(t=>t==='permission-request'||t==='stores'||t==='cookies').length,0);assert.equal(noConsent.posts.length,0);assertNoLeak(noConsent);
  const denied=harness({permission:false});await ready(denied);const work=denied.api.beginWingSession();assert.equal(denied.trace.at(-1),'permission-request','권한 요청은 버튼의 직접 사용자 동작 안에서 호출합니다.');await work;assert.equal(denied.trace.filter(t=>t==='stores'||t==='cookies').length,0);assert.equal(denied.posts.length,0);assert.match(denied.ui('message').textContent,/권한/);assertNoLeak(denied);
});

test('현재 Wing 탭 저장소의 적용 가능한 쿠키만 로컬에 한 번 보내고 권한을 해제한다',async()=>{
  const h=harness(),base=h.cookies[0];h.cookies.push({...base,name:'__Host-fixture',domain:'wing.coupang.com',hostOnly:true,session:true,expirationDate:undefined},{...base,name:'other_host',domain:'www.coupang.com',hostOnly:true,value:OTHER_SECRET},{...base,name:'root_host_only',domain:'coupang.com',hostOnly:true,value:OTHER_SECRET},{...base,name:'other_subdomain',domain:'.www.coupang.com',value:OTHER_SECRET},{...base,value:PARTITION_SECRET,partitionKey:{topLevelSite:'https://other.test'}});
  await ready(h);h.chrome.cookies=undefined;h.onRequest=()=>{h.chrome.cookies=h.cookieApi;};const work=h.api.beginWingSession();assert.equal(h.trace.at(-1),'permission-request');await work;
  assert.deepEqual(h.requestQuery,{permissions:['cookies'],origins:['https://*.coupang.com/*']});assert.deepEqual(h.cookieQuery,{storeId:'active-store',domain:'coupang.com'});assert.equal(h.posts.length,1);
  const request=h.posts[0].request;assert.equal(request.method,'POST');assert.equal(request.headers['X-Dobi-Bridge'],'PAIR_TOKEN');const data=JSON.parse(request.body),cookies=JSON.parse(data.cookies);assert.equal(data.connectionId,'wing-connection');assert.equal(data.grant,h.grant.grant);assert.equal(data.confirmed,true);assert.equal(data.origin,'https://wing.coupang.com');assert.equal(cookies.length,2);assert.equal(cookies[0].value,SECRET);assert.equal(cookies[0].domain,'.coupang.com');assert.equal(cookies[1].domain,'wing.coupang.com');assert.equal(cookies[1].hostOnly,true);assert.equal(cookies[1].session,true);assert.ok(cookies.every(c=>c.partitionKey===undefined&&c.storeId===undefined));assert.ok(!data.cookies.includes(OTHER_SECRET));assert.ok(!data.cookies.includes(PARTITION_SECRET));assert.ok(h.contextReads>=4);assert.equal(h.trace.filter(t=>t==='permission-remove').length,1);assert.deepEqual(h.removeQuery,h.requestQuery);assert.equal(h.api.state.wingPrepared,null);assert.equal(h.api.state.context.sessionImports.length,0);assertNoLeak(h);
  h.api.beginWingSession();assert.equal(h.posts.length,1);assert.equal(h.trace.filter(t=>t==='permission-request').length,1);
});

test('현재 탭을 포함하지 않는 저장소·모호한 저장소·도중 변경된 저장소에 fallback하지 않는다',async()=>{
  for(const stores of [[{id:'wrong',tabIds:[10]}],[{id:'a',tabIds:[17]},{id:'b',tabIds:[17]}]]){const h=harness({stores});await ready(h);await h.api.beginWingSession();assert.equal(h.trace.filter(t=>t==='cookies').length,0);assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/저장소/);assertNoLeak(h);}
  const changed=harness();await ready(changed);changed.onStores=()=>{if(changed.storeReads===2)changed.stores=[{id:'new-store',tabIds:[17]}];};await changed.api.beginWingSession();assert.equal(changed.trace.filter(t=>t==='cookies').length,1);assert.equal(changed.posts.length,0);assertNoLeak(changed);
});

test('Wing 외부 도메인·잘못된 storeId·모순된 hostOnly·불안전한 prefix를 전송하지 않는다',async()=>{
  for(const change of [{domain:'.evil.test'},{domain:'coupang.com.evil.test'},{domain:'bad..coupang.com'},{storeId:'other-store'},{hostOnly:true},{name:'__Host-fixture',hostOnly:false},{name:'__Secure-fixture',secure:false}]){const h=harness();h.cookies=[{...h.cookies[0],...change}];await ready(h);await h.api.beginWingSession();assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/쿠키|도메인/);assertNoLeak(h);}
});

test('정확한 HTTPS Wing origin과 명시적인 Coupang 판매자 승인만 준비할 수 있다',async()=>{
  for(const url of ['https://www.coupang.com/','https://seller.coupang.com/','https://wing.coupang.com.evil.test/','http://wing.coupang.com/','https://wing.coupang.com:8443/','https://user:pass@wing.coupang.com/']){const h=harness();h.tab.url=url;await assert.rejects(h.api.prepareWingSession(),/정상 로그인/);assert.equal(h.trace.filter(t=>t==='permission-request'||t==='cookies').length,0);assertNoLeak(h);}
  for(const change of [{providerId:'esm'},{providerId:undefined},{mode:'session'},{sellerId:'other-vendor'},{grant:'short'},{expiresAt:new Date(Date.now()-1000).toISOString()},{expiresAt:new Date(Date.now()+3600000).toISOString()}]){const h=harness();Object.assign(h.serverContext.sessionImports[0],change);await assert.rejects(h.api.prepareWingSession(),/판매자 계정|만료|5분/);assert.equal(h.trace.filter(t=>t==='permission-request'||t==='cookies').length,0);assertNoLeak(h);}
  const duplicate=harness();duplicate.serverContext.sessionImports.push({...duplicate.grant});await assert.rejects(duplicate.api.prepareWingSession(),/먼저 승인/);assertNoLeak(duplicate);
});

test('ESM과 Wing 승인 목록은 서로 다른 연결·판매자 계약을 섞지 않는다',async()=>{
  const h=harness();h.serverContext.connections.push({id:'esm-connection',providerId:'esm',kind:'market',mode:'session',site:'gmarket',sellerId:'esm-seller'});h.serverContext.sessionImports.push({connectionId:'esm-connection',providerId:'esm',grant:'fixture-esm-grant-0123456789abcdef',expiresAt:h.grant.expiresAt,site:'gmarket',sellerId:'esm-seller'});h.api.state.context=plain(h.serverContext);h.api.renderEsmImports();h.api.renderWingImports();assert.deepEqual(h.ui('wingConnectionSelect').options.map(o=>o.value),['wing-connection']);assert.deepEqual(h.ui('esmConnectionSelect').options.map(o=>o.value),['esm-connection']);
  h.ui('wingConnectionSelect').value='esm-connection';await assert.rejects(h.api.prepareWingSession(),/쿠팡 Wing 판매자/);h.ui('esmConnectionSelect').value='wing-connection';await assert.rejects(h.api.prepareEsmSession(),/ESM 판매자/);assert.equal(h.trace.filter(t=>t==='permission-request'||t==='cookies').length,0);assertNoLeak(h);
});

test('권한 전 탭 변경·권한 후 URL 변경·쿠키 조회 후 페이지 변경을 차단한다',async()=>{
  const before=harness();await ready(before);before.activated.emit({tabId:44,windowId:3});before.api.beginWingSession();assert.equal(before.trace.filter(t=>t==='permission-request').length,0);
  const afterPermission=harness();await ready(afterPermission);afterPermission.onRequest=()=>{afterPermission.tab.url='https://wing.coupang.com/changed';};await afterPermission.api.beginWingSession();assert.equal(afterPermission.trace.filter(t=>t==='cookies'||t==='stores').length,0);assert.equal(afterPermission.posts.length,0);
  const permissionEvent=harness();await ready(permissionEvent);permissionEvent.onRequest=()=>permissionEvent.updated.emit(17,{status:'loading'});await permissionEvent.api.beginWingSession();assert.equal(permissionEvent.trace.filter(t=>t==='stores'||t==='cookies').length,0);assert.equal(permissionEvent.trace.filter(t=>t==='permission-remove').length,1);assert.equal(permissionEvent.posts.length,0);
  const afterCookie=harness();await ready(afterCookie);afterCookie.onCookies=()=>{afterCookie.tab.url='https://wing.coupang.com/another';};await afterCookie.api.beginWingSession();assert.equal(afterCookie.trace.filter(t=>t==='cookies').length,1);assert.equal(afterCookie.posts.length,0);
  const beforePost=harness();await ready(beforePost);beforePost.onContext=()=>{if(beforePost.contextReads===4)beforePost.tab.id=55;};await beforePost.api.beginWingSession();assert.equal(beforePost.trace.filter(t=>t==='cookies').length,1);assert.equal(beforePost.posts.length,0);
  for(const h of [before,afterPermission,permissionEvent,afterCookie,beforePost])assertNoLeak(h);
});

test('쿠키 전후 grant·판매자 선택·동의·권한 변경은 전송을 차단한다',async()=>{
  const grant=harness();await ready(grant);grant.onRequest=()=>{grant.serverContext.sessionImports[0].grant='changed-grant-0123456789abcdef';};await grant.api.beginWingSession();assert.equal(grant.trace.filter(t=>t==='cookies').length,0);assert.equal(grant.posts.length,0);
  const expired=harness();await ready(expired);expired.onCookies=()=>{expired.serverContext.sessionImports[0].expiresAt=new Date(Date.now()-1000).toISOString();};await expired.api.beginWingSession();assert.equal(expired.posts.length,0);
  const selection=harness();await ready(selection);selection.onCookies=()=>{selection.ui('wingConnectionSelect').value='other-connection';};await selection.api.beginWingSession();assert.equal(selection.posts.length,0);
  const consent=harness();await ready(consent);consent.onCookies=()=>{consent.ui('confirmWing').checked=false;};await consent.api.beginWingSession();assert.equal(consent.posts.length,0);
  const revoked=harness();await ready(revoked);revoked.contains=()=>!revoked.trace.includes('cookies');await revoked.api.beginWingSession();assert.equal(revoked.posts.length,0);
  for(const h of [grant,expired,selection,consent,revoked])assertNoLeak(h);
});

test('만료·파티션·다른 호스트 쿠키만 있으면 정상 로그인 재확인을 안내한다',async()=>{
  for(const change of [{expirationDate:Date.now()/1000-1},{partitionKey:{topLevelSite:'https://other.test'}},{domain:'www.coupang.com',hostOnly:true}]){const h=harness();h.cookies=[{...h.cookies[0],...change}];await ready(h);await h.api.beginWingSession();assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/로그인 쿠키/);assertNoLeak(h);}
});

test('RFC 쿠키 문법·만료 정보·200개와 정규화 JSON 30,000자 제한을 검증한다',async()=>{
  const h=harness(),base=h.cookies[0];
  for(const change of [{name:'bad name'},{path:'/\r\n'},{value:'unsafe;value'},{value:'unsafe value'},{value:'unsafe,value'},{value:'"quoted"'},{value:'\\escaped'},{value:'한글'},{secure:'true'},{expirationDate:'invalid'},{session:false,expirationDate:undefined}])assert.throws(()=>h.api.normalizeWingCookies([{...base,...change}],'active-store'),/형식|만료|범위/);
  assert.throws(()=>h.api.normalizeWingCookies(Array.from({length:201},()=>base),'active-store'),/200개/);assert.throws(()=>h.api.normalizeWingCookies([{...base,value:'x'.repeat(30001)}],'active-store'),/30,000자/);
  h.cookies=Array.from({length:33},(_,i)=>({...base,name:'fixture_cookie_'+i,value:'x'.repeat(1000)}));await ready(h);await h.api.beginWingSession();assert.equal(h.trace.filter(t=>t==='cookies').length,1);assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/30,000자/);assertNoLeak(h);
});

test('서버·쿠키 API 오류 원문이나 응답의 쿠키값을 화면·로그·저장소에 출력하지 않는다',async()=>{
  const server=harness({postOk:false});await ready(server);await server.api.beginWingSession();assert.equal(server.posts.length,1);assert.match(server.ui('message').textContent,/판매자 계정/);
  const network=harness({postThrows:true});await ready(network);await network.api.beginWingSession();assert.equal(network.posts.length,1);assert.match(network.ui('message').textContent,/완료하지 못/);
  const getter=harness();await ready(getter);getter.cookieApi.getAll=async()=>{throw Error(SECRET);};await getter.api.beginWingSession();assert.equal(getter.posts.length,0);assert.match(getter.ui('message').textContent,/완료하지 못/);
  for(const h of [server,network,getter]){assert.equal(h.trace.filter(t=>t==='permission-remove').length,1);assertNoLeak(h);}
});

test('기존 주문 표 수집과 Wing 준비 단계에서는 쿠키나 권한을 읽지 않는다',async()=>{
  const h=harness();assert.deepEqual(plain(h.api.scanVisibleOrders('https://wing.coupang.com')),{tables:[]});await h.api.prepareWingSession();assert.equal(h.trace.filter(t=>t==='permission-request'||t==='stores'||t==='cookies').length,0);assert.equal(h.posts.length,0);assertNoLeak(h);
});
