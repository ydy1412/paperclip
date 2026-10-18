import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {validateEsmCookies} from '../src/integrations/esm.mjs';

const source=(await readFile(new URL('../browser-helper/popup.js',import.meta.url),'utf8')).replace(/\nrun\(load\);\s*$/,'');
const plain=value=>JSON.parse(JSON.stringify(value));
const SECRET='FIXTURE_ESM_AUTH_VALUE_DO_NOT_DISPLAY';
const PARTITION_SECRET='FIXTURE_PARTITION_VALUE_DO_NOT_DISPLAY';
const BASE='http://127.0.0.1:4317';
class UiElement {
  constructor(output){this._text='';this.output=output;this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.options=[];this.listeners=new Map();this.classList={toggle(){}};}
  get textContent(){return this._text;}
  set textContent(value){this._text=String(value);this.output.push(this._text);}
  addEventListener(name,fn){this.listeners.set(name,fn);}
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
  const grant={connectionId:'connection-1',grant:'fixture-grant-0123456789abcdef',expiresAt:new Date(Date.now()+240000).toISOString(),site:'gmarket',sellerId:'fixture-seller',name:'예제 판매자'};
  const h={output,trace,posts,storage,consoleOutput,grant,tab:{id:17,url:'https://www.esmplus.com/Home/Home',windowId:3},serverContext:{providers:[{id:'esm',kind:'market',browserUrl:'https://www.esmplus.com'}],connections:[{id:'connection-1',providerId:'esm',kind:'market',mode:'session',site:'gmarket',sellerId:'fixture-seller',name:'예제 판매자'}],sessionImports:[grant],drafts:[]},get ui(){return id=>{if(!elements.has(id))elements.set(id,new UiElement(output));return elements.get(id);};},stores:[{id:'other-store',tabIds:[20]},{id:'active-store',tabIds:[17]}],cookies:[{name:'ESM_AUTH',value:SECRET,domain:'.esmplus.com',path:'/',hostOnly:false,secure:true,httpOnly:true,session:false,expirationDate:Date.now()/1000+600,storeId:'active-store'},{name:'ESM_AUTH',value:PARTITION_SECRET,domain:'.esmplus.com',path:'/',hostOnly:false,secure:true,httpOnly:true,session:false,expirationDate:Date.now()/1000+600,storeId:'active-store',partitionKey:{topLevelSite:'https://other.test'}}],permission:true,postOk:true,contextReads:0,postResponseReads:0,updated,activated,focused,...options};
  const cookieApi={getAllCookieStores:async()=>{trace.push('stores');h.onStores?.();return h.stores;},getAll:async query=>{trace.push('cookies');h.cookieQuery=plain(query);h.onCookies?.();return h.cookies;}};
  const chrome={tabs:{query:async()=>{trace.push('tab');h.onTab?.();return [{...h.tab}];},onUpdated:updated,onActivated:activated},windows:{onFocusChanged:focused},permissions:{request:query=>{trace.push('permission-request');h.requestQuery=plain(query);h.onRequest?.();return Promise.resolve(h.permission);},contains:async()=>{trace.push('permission-check');return h.permission;},remove:async query=>{trace.push('permission-remove');h.removeQuery=plain(query);return true;}},cookies:cookieApi,storage:{local:{get:async()=>({dobiBridgeToken:'PAIR_TOKEN'}),set:async value=>storage.push(plain(value)),remove:async()=>{}}}};
  const fetch=async(url,request={})=>{
    assert.equal(new URL(url).origin,BASE,'확장은 로컬 프로그램에만 전송해야 합니다.');
    if(url===BASE+'/api/bridge/context'){trace.push('context');h.contextReads++;h.onContext?.();return {ok:true,json:async()=>plain(h.serverContext)};}
    assert.equal(url,BASE+'/api/bridge/esm-session');trace.push('POST-session');posts.push({url,request:plain(request)});
    return {ok:h.postOk,json:async()=>{h.postResponseReads++;return {error:SECRET};}};
  };
  const context=vm.createContext({URL,AbortSignal,TextEncoder,Set,Map,Date,Error,fetch,chrome,document:{getElementById:id=>h.ui(id),createElement:()=>new UiElement(output),querySelectorAll:()=>[]},location:{origin:'https://www.esmplus.com'},console:{log:value=>consoleOutput.push(String(value)),error:value=>consoleOutput.push(String(value))}});
  vm.runInContext(source,context);
  h.api=vm.runInContext('({state,prepareEsmSession,beginEsmSession,normalizeEsmCookies,esmCookieStore,scanVisibleOrders})',context);h.api.state.token='PAIR_TOKEN';h.api.state.context=plain(h.serverContext);h.ui('esmConnectionSelect').value='connection-1';h.chrome=chrome;h.cookieApi=cookieApi;
  return h;
}
async function ready(h){await h.api.prepareEsmSession();h.ui('confirmEsm').checked=true;assert.ok(h.api.state.esmPrepared);}
function assertNoLeak(h){const visible=h.output.concat(h.consoleOutput).join('\n');assert.ok(!visible.includes(SECRET));assert.ok(!visible.includes(PARTITION_SECRET));assert.ok(!visible.includes(h.grant.grant));assert.deepEqual(h.storage,[]);assert.equal(h.postResponseReads,0);}

test('ESM 쿠키 권한은 선택 권한이며 기존 기본 권한을 유지한다',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../browser-helper/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,'0.3.0');assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert.deepEqual(manifest.host_permissions,[BASE+'/*']);assert.deepEqual(manifest.optional_permissions,['cookies']);assert.deepEqual(manifest.optional_host_permissions,['https://*.esmplus.com/*','https://*.coupang.com/*']);
});

test('명시적인 동의 없이는 권한·쿠키 API를 호출하지 않는다',async()=>{
  const h=harness();await h.api.prepareEsmSession();h.api.beginEsmSession();assert.equal(h.trace.filter(t=>t==='permission-request').length,0);assert.equal(h.trace.filter(t=>t==='cookies'||t==='stores').length,0);assert.equal(h.posts.length,0);assertNoLeak(h);
});

test('권한 거절은 쿠키 저장소 조회와 POST를 모두 차단한다',async()=>{
  const h=harness({permission:false});await ready(h);const operation=h.api.beginEsmSession();assert.equal(h.trace.at(-1),'permission-request','request는 await 전에 버튼 동작에서 바로 호출해야 합니다.');await operation;assert.equal(h.trace.filter(t=>t==='stores'||t==='cookies').length,0);assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/권한/);assertNoLeak(h);
});

test('현재 탭의 cookie store만 읽고 파티션 쿠키를 제외하여 로컬에 한 번 POST한다',async()=>{
  const h=harness();await ready(h);
  // Optional API bindings may appear only after permission is granted.
  h.chrome.cookies=undefined;h.onRequest=()=>{h.chrome.cookies=h.cookieApi;};
  const operation=h.api.beginEsmSession();assert.equal(h.trace.at(-1),'permission-request');await operation;
  assert.deepEqual(h.requestQuery,{permissions:['cookies'],origins:['https://*.esmplus.com/*']});assert.deepEqual(h.cookieQuery,{storeId:'active-store',domain:'esmplus.com'});assert.equal(h.posts.length,1);
  const request=h.posts[0].request;assert.equal(request.method,'POST');assert.equal(request.headers['X-Dobi-Bridge'],'PAIR_TOKEN');const data=JSON.parse(request.body),cookies=JSON.parse(data.cookies);
  assert.equal(data.connectionId,'connection-1');assert.equal(data.grant,h.grant.grant);assert.equal(data.confirmed,true);assert.equal(data.origin,'https://www.esmplus.com');assert.equal(cookies.length,1);assert.equal(cookies[0].name,'ESM_AUTH');assert.equal(cookies[0].value,SECRET);assert.equal(cookies[0].domain,'.esmplus.com');assert.equal(cookies[0].partitionKey,undefined);assert.equal(cookies[0].storeId,undefined);assert.ok(h.contextReads>=4);assert.equal(h.trace.filter(t=>t==='permission-remove').length,1);assert.equal(h.api.state.esmPrepared,null);assertNoLeak(h);
  h.api.beginEsmSession();assert.equal(h.posts.length,1);assert.equal(h.trace.filter(t=>t==='permission-request').length,1);
});

test('탭을 포함하지 않거나 모호한 store에는 fallback하지 않는다',async()=>{
  for(const stores of [[{id:'wrong',tabIds:[10]}],[{id:'a',tabIds:[17]},{id:'b',tabIds:[17]}]]){
    const h=harness({stores});await ready(h);await h.api.beginEsmSession();assert.equal(h.trace.filter(t=>t==='cookies').length,0);assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/저장소/);assertNoLeak(h);
  }
});

test('쿠키의 잘못된 domain 또는 storeId는 값 출력 없이 전체 전송을 거부한다',async()=>{
  for(const change of [{domain:'.not-esmplus.test'},{domain:'esmplus.com.attacker.test'},{storeId:'other-store'},{hostOnly:true}]){
    const h=harness();h.cookies=[{...h.cookies[0],...change}];await ready(h);await h.api.beginEsmSession();assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/쿠키|도메인/);assertNoLeak(h);
  }
});

test('권한 전 관찰한 탭 변경과 권한 후·쿠키 후 URL 변경을 차단한다',async()=>{
  const before=harness();await ready(before);before.activated.emit({tabId:44,windowId:3});before.api.beginEsmSession();assert.equal(before.trace.filter(t=>t==='permission-request').length,0);
  const afterPermission=harness();await ready(afterPermission);afterPermission.onRequest=()=>{afterPermission.tab.url='https://www.esmplus.com/Home/Changed';};await afterPermission.api.beginEsmSession();assert.equal(afterPermission.trace.filter(t=>t==='cookies'||t==='stores').length,0);assert.equal(afterPermission.posts.length,0);
  const afterCookie=harness();await ready(afterCookie);afterCookie.onCookies=()=>{afterCookie.tab.url='https://post-tx.esmplus.com/another-page';};await afterCookie.api.beginEsmSession();assert.equal(afterCookie.trace.filter(t=>t==='cookies').length,1);assert.equal(afterCookie.posts.length,0);
  for(const h of [before,afterPermission,afterCookie])assertNoLeak(h);
});

test('권한 후 승인 교체와 쿠키 읽기 후 계정 선택 변경은 POST를 차단한다',async()=>{
  const changedGrant=harness();await ready(changedGrant);changedGrant.onRequest=()=>{changedGrant.serverContext.sessionImports=[{...changedGrant.grant,grant:'changed-grant-0123456789abcdef'}];};await changedGrant.api.beginEsmSession();assert.equal(changedGrant.trace.filter(t=>t==='cookies').length,0);assert.equal(changedGrant.posts.length,0);
  const changedSelection=harness();await ready(changedSelection);changedSelection.onCookies=()=>{changedSelection.ui('esmConnectionSelect').value='connection-2';};await changedSelection.api.beginEsmSession();assert.equal(changedSelection.posts.length,0);
  assertNoLeak(changedGrant);assertNoLeak(changedSelection);
});

test('만료된 ESM_AUTH나 파티션에만 있는 ESM_AUTH는 재로그인 안내 후 전송하지 않는다',async()=>{
  for(const mode of ['expired','partitioned']){const h=harness();h.cookies=mode==='expired'?[{...h.cookies[0],expirationDate:Date.now()/1000-1}]:[h.cookies[1]];await ready(h);await h.api.beginEsmSession();assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/ESM_AUTH|로그인/);assertNoLeak(h);}
});

test('정확한 ESM origin과 유효한 1회 승인이 없으면 준비 단계에서 거부한다',async()=>{
  for(const url of ['https://www.esmplus.com.evil.test/','http://www.esmplus.com/','https://www.esmplus.com:8443/']){const h=harness();h.tab.url=url;await assert.rejects(h.api.prepareEsmSession(),/정상 로그인/);assert.equal(h.trace.filter(t=>t==='permission-request'||t==='cookies').length,0);assertNoLeak(h);}
  const h=harness();h.serverContext.sessionImports[0].expiresAt=new Date(Date.now()-1000).toISOString();await assert.rejects(h.api.prepareEsmSession(),/만료/);assert.equal(h.trace.filter(t=>t==='permission-request'||t==='cookies').length,0);assertNoLeak(h);
  for(const site of ['1',2,'Gmarket','wrong']){const badSite=harness();badSite.serverContext.sessionImports[0].site=site;badSite.serverContext.connections[0].site=site;await assert.rejects(badSite.api.prepareEsmSession(),/판매자 계정/);assert.equal(badSite.trace.filter(t=>t==='permission-request'||t==='cookies').length,0);assertNoLeak(badSite);}
});

test('쿠키 이름·경로·값·개별 및 전체 크기 제한을 검증한다',()=>{
  const h=harness(),base=h.cookies[0];
  for(const change of [{name:'bad name'},{path:'/\r\n'},{value:'unsafe;value'},{value:'unsafe value'},{value:'unsafe,value'},{value:'"quoted"'},{value:'\\escaped'},{value:'한글'},{secure:'true'},{expirationDate:'invalid'}])assert.throws(()=>h.api.normalizeEsmCookies([{...base,...change}],'active-store'),/형식|만료|범위/);
  assert.throws(()=>h.api.normalizeEsmCookies(Array.from({length:201},()=>base),'active-store'),/200개/);
  assert.throws(()=>h.api.normalizeEsmCookies([{...base,value:'x'.repeat(30001)}],'active-store'),/30,000자/);
});

test('서버 오류 응답에 쿠키값이 있어도 읽거나 화면·로그·저장소에 출력하지 않는다',async()=>{
  const h=harness({postOk:false});await ready(h);await h.api.beginEsmSession();assert.equal(h.posts.length,1);assert.equal(h.postResponseReads,0);assert.match(h.ui('message').textContent,/판매자 계정/);assertNoLeak(h);
});

test('33개·정규화 JSON 36,581자 쿠키는 서버와 같은 한도로 POST 전에 거부한다',async()=>{
  const h=harness(),base=h.cookies[0];h.cookies=Array.from({length:33},(_,i)=>({...base,name:i===0?'ESM_AUTH':'fixture_cookie_'+i,value:''}));
  const normalized=()=>h.cookies.map(c=>({name:c.name,value:c.value,domain:'.esmplus.com',path:c.path,hostOnly:c.hostOnly,secure:c.secure,httpOnly:c.httpOnly,session:false,expirationDate:c.expirationDate}));
  const extra=36581-JSON.stringify(normalized()).length,each=Math.floor(extra/33),remainder=extra-each*33;
  h.cookies.forEach((c,i)=>{c.value='x'.repeat(each+(i===32?remainder:0));});
  assert.equal(JSON.stringify(normalized()).length,36581);assert.throws(()=>validateEsmCookies(normalized()),/30,000자/);
  await ready(h);await h.api.beginEsmSession();assert.equal(h.trace.filter(t=>t==='cookies').length,1);assert.equal(h.posts.length,0);assert.match(h.ui('message').textContent,/30,000자/);assertNoLeak(h);
});

test('기존 주문 표 기능은 ESM 쿠키 API를 호출하지 않는다',()=>{
  const h=harness();const result=plain(h.api.scanVisibleOrders('https://www.esmplus.com'));assert.deepEqual(result,{tables:[]});assert.equal(h.trace.filter(t=>t==='permission-request'||t==='stores'||t==='cookies').length,0);assert.equal(h.posts.length,0);assertNoLeak(h);
});
