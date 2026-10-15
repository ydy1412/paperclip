'use strict';
const BASE = 'http://127.0.0.1:4317';
const $ = id => document.getElementById(id);
const state = {token:null, context:null, tab:null, capture:null, fill:null, busy:false, esmPrepared:null, esmRevision:0};
const ESM_ORIGINS = new Set(['https://www.esmplus.com','https://seller.esmplus.com','https://post-tx.esmplus.com','https://signin.esmplus.com']);
const ESM_PERMISSION = {permissions:['cookies'],origins:['https://*.esmplus.com/*']};
const ESM_COOKIE_NAME=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const ESM_COOKIE_VALUE=/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;
const ESM_MAX_COOKIE_CHARS=30000,ESM_MAX_COOKIES=200;
const fieldLabels = {orderNo:'주문번호',lineId:'상품 주문번호',product:'상품명',quantity:'수량',unitPrice:'단가',amount:'금액',recipient:'수취인',phone:'전화번호',postcode:'우편번호',address:'주소',customsCode:'개인통관번호',deliveryMemo:'배송메모',sku:'상품코드',option:'옵션'};
function message(value,error=false){$('message').textContent=value;$('message').classList.toggle('error',error);}
function option(select,value,label){const el=document.createElement('option');el.value=value;el.textContent=label;select.append(el);}
function cells(row,values){for(const value of values){const td=document.createElement('td');td.textContent=String(value??'');row.append(td);}}
async function api(path,data){const response=await fetch(BASE+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(state.token?{'X-Dobi-Bridge':state.token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});let result;try{result=await response.json();}catch{throw Error('로컬 프로그램의 응답을 읽지 못했습니다.');}if(!response.ok)throw Error(result.error||result.message||'로컬 프로그램 연결에 실패했습니다.');return result;}
async function run(task){if(state.busy)return;state.busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await task();}catch(error){message(error.message||'작업을 완료하지 못했습니다.',true);}finally{state.busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('saveOrders').disabled=!$('confirmOrders').checked||!state.capture;$('fillDraft').disabled=!$('confirmDraft').checked||!state.fill||state.fill.plan.writes.length===0;updateEsmButton();}}
function providerFor(connection){return state.context.providers.find(p=>p.id===connection.providerId);}
function isForwarder(connection){const p=providerFor(connection);return /forwarder|shipping-agency|배송대행/.test(String(connection.kind||p?.kind||''));}
function expectedOrigin(provider){if(!provider?.browserUrl)throw Error('이 연결에는 검증할 브라우저 주소가 없습니다.');let url;try{url=new URL(provider.browserUrl);}catch{throw Error('연결의 사이트 주소가 올바르지 않습니다.');}if(!/^https?:$/.test(url.protocol))throw Error('HTTP/HTTPS 사이트에서만 사용할 수 있습니다.');return url.origin;}
async function activeTab(origin,previous){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!tab.url)throw Error('쇼핑몰 또는 배송대행지 탭을 선택하고 도우미를 다시 열어주세요.');let url;try{url=new URL(tab.url);}catch{throw Error('현재 탭 주소를 확인할 수 없습니다.');}if(url.origin!==origin)throw Error('현재 탭이 선택한 연결의 사이트와 다릅니다. 연결 사이트를 열어주세요.');if(previous&&(tab.id!==previous.id||tab.url!==previous.url))throw Error('미리보기 후 탭 또는 페이지가 바뀌었습니다. 미리보기를 다시 읽어주세요.');return {id:tab.id,url:tab.url};}
async function inject(tab,func,args){const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func,args});if(!result)throw Error('현재 탭을 읽을 권한이 없습니다. 사이트에서 도우미를 다시 열어주세요.');if(result.result?.error)throw Error(result.result.error);return result.result;}
function resetReview(){state.capture=null;state.fill=null;$('orderReview').hidden=true;$('draftReview').hidden=true;$('confirmOrders').checked=false;$('confirmDraft').checked=false;$('saveOrders').disabled=true;$('fillDraft').disabled=true;invalidateEsmPreparation();}
async function load(){resetReview();const saved=await chrome.storage.local.get('dobiBridgeToken');state.token=saved.dobiBridgeToken||null;$('pairPanel').hidden=!!state.token;$('connectedPanel').hidden=!state.token;if(!state.token){message('일회용 코드로 내 주문 작업실에 연결해주세요.');return;}state.context=await api('/api/bridge/context');state.context.providers||=[];state.context.connections||=[];state.context.drafts||=[];renderEsmImports();const connections=$('connectionSelect');connections.replaceChildren();for(const c of state.context.connections.filter(c=>!isForwarder(c)&&c.mode==='browser'))option(connections,c.id,c.name||providerFor(c)?.name||c.id);if(!connections.options.length)option(connections,'','앱에서 브라우저 방식 쇼핑몰 연결을 추가해주세요.');const drafts=$('draftSelect');drafts.replaceChildren();for(const d of state.context.drafts.filter(d=>d.state!=='submitted'&&d.state!=='cancelled')){const c=state.context.connections.find(c=>c.id===d.connectionId);if(c&&isForwarder(c))option(drafts,d.id,(c.name||providerFor(c)?.name||'배송대행지')+' · '+d.itemCount+'건 · '+String(d.createdAt||'').slice(0,16));}if(!drafts.options.length)option(drafts,'','앱에서 배송 초안을 먼저 만들어주세요.');const [tab]=await chrome.tabs.query({active:true,currentWindow:true});$('tabHost').textContent=tab?.url?new URL(tab.url).host:'현재 사이트 탭을 열어주세요.';message('연결됐습니다. 직접 로그인한 사이트에서 작업을 선택해주세요.');}
$('pairForm').addEventListener('submit',event=>{event.preventDefault();run(async()=>{state.token=null;const code=$('pairCode').value.trim();if(!code)throw Error('일회용 코드를 입력해주세요.');const result=await api('/api/bridge/pair',{code});if(!result.token||typeof result.token!=='string')throw Error('연결 토큰이 발급되지 않았습니다.');await chrome.storage.local.set({dobiBridgeToken:result.token});$('pairCode').value='';await load();});});
$('unpair').addEventListener('click',()=>run(async()=>{await chrome.storage.local.remove('dobiBridgeToken');state.token=null;await load();}));
$('refresh').addEventListener('click',()=>run(load));
for(const [button,show] of [['orderMode','ordersPanel'],['draftMode','draftsPanel'],['esmMode','esmPanel']])$(button).addEventListener('click',()=>{resetReview();$('ordersPanel').hidden=show!=='ordersPanel';$('draftsPanel').hidden=show!=='draftsPanel';$('esmPanel').hidden=show!=='esmPanel';$('orderMode').classList.toggle('active',show==='ordersPanel');$('draftMode').classList.toggle('active',show==='draftsPanel');$('esmMode').classList.toggle('active',show==='esmPanel');});
$('connectionSelect').addEventListener('change',resetReview);$('draftSelect').addEventListener('change',resetReview);
$('confirmOrders').addEventListener('change',()=>{$('saveOrders').disabled=!$('confirmOrders').checked||!state.capture;});
$('confirmDraft').addEventListener('change',()=>{$('fillDraft').disabled=!$('confirmDraft').checked||!state.fill||state.fill.plan.writes.length===0;});
$('readOrders').addEventListener('click',()=>run(async()=>{resetReview();const connection=state.context.connections.find(c=>c.id===$('connectionSelect').value);if(!connection)throw Error('앱에서 쇼핑몰 연결을 추가해주세요.');const provider=providerFor(connection),origin=expectedOrigin(provider),tab=await activeTab(origin);const result=await inject(tab,scanVisibleOrders,[origin]);if(!result.tables.length)throw Error('주문번호와 상품명 열이 있는 표시된 HTML 표를 찾지 못했습니다. 다른 주문 목록을 열거나 파일 가져오기를 이용해주세요.');state.capture={tab,origin,connectionId:connection.id,tables:result.tables};$('tableSelect').replaceChildren();result.tables.forEach((table,i)=>option($('tableSelect'),String(i),'표 '+(table.index+1)+' · '+table.orders.length+'건 · '+table.headers.join(' / ').slice(0,90)));$('orderReview').hidden=false;renderOrders();message('현재 페이지의 표를 읽었습니다. 원본과 미리보기를 확인해주세요.');}));
function renderOrders(){if(!state.capture)return;const table=state.capture.tables[Number($('tableSelect').value)];$('orderRows').replaceChildren();for(const order of table.orders.slice(0,30)){const tr=document.createElement('tr');cells(tr,[order.orderNo,order.product,order.quantity,order.amount??'']);const details=document.createElement('details'),summary=document.createElement('summary'),info=document.createElement('div');summary.textContent='수집 값 전체';for(const [key,value] of Object.entries(order)){const line=document.createElement('p');line.textContent=(fieldLabels[key]||key)+' : '+value;info.append(line);}details.append(summary,info);tr.cells[1].append(details);$('orderRows').append(tr);}$('orderSummary').textContent='유효 주문 '+table.orders.length+'건 · 건너뛴 행 '+table.skipped+'개'+(table.limited?' · 최대 5,000행 제한':'')+'. 수량 열이 없으면 1, 알 수 없는 상태는 신규로 미리봅니다.';$('confirmOrders').checked=false;$('saveOrders').disabled=true;}
$('tableSelect').addEventListener('change',renderOrders);
$('saveOrders').addEventListener('click',()=>run(async()=>{if(!state.capture||!$('confirmOrders').checked)throw Error('원본 주문 확인이 필요합니다.');const capture=state.capture,table=capture.tables[Number($('tableSelect').value)];if(!table.orders.length)throw Error('저장할 유효 주문이 없습니다.');await activeTab(capture.origin,capture.tab);const result=await api('/api/bridge/browser-orders',{connectionId:capture.connectionId,orders:table.orders,complete:true,confirmed:true});resetReview();message('현재 표의 주문을 로컬에 저장했습니다. '+formatSummary(result));}));
function formatSummary(result){const summary=result.summary||result;return [summary.inserted!==undefined?'추가 '+summary.inserted+'건':'',summary.updated!==undefined?'갱신 '+summary.updated+'건':'',summary.skipped!==undefined?'중복/건너뜀 '+summary.skipped+'건':''].filter(Boolean).join(' · ');}
$('readDraft').addEventListener('click',()=>run(async()=>{resetReview();const id=$('draftSelect').value;if(!id)throw Error('앱에서 배송 초안을 만들어주세요.');const result=await api('/api/bridge/draft/'+encodeURIComponent(id));const origin=expectedOrigin(result.provider),tab=await activeTab(origin);const prepared=prepareDraft(result.draft,result.provider);const plan=await inject(tab,inspectDraftFields,[origin,prepared]);state.fill={tab,origin,plan,draftId:id};$('draftRows').replaceChildren();for(const write of plan.writes){for(let i=0;i<write.values.length;i++){const tr=document.createElement('tr');cells(tr,[(fieldLabels[write.field]||write.field)+(write.values.length>1?' '+(i+1):''),write.previous[i],write.values[i]]);$('draftRows').append(tr);}}$('draftSkipped').replaceChildren();for(const reason of [...prepared.skipped,...plan.skipped]){const li=document.createElement('li');li.textContent=reason;$('draftSkipped').append(li);}$('draftSummary').textContent='입력 가능한 필드 '+plan.writes.length+'개 / 값 '+plan.writes.reduce((n,w)=>n+w.values.length,0)+'개. 현재 값과 초안 값을 비교해주세요.';$('draftReview').hidden=false;message(plan.writes.length?'초안 입력 대상을 읽었습니다. 확인 후 채우기 버튼을 눌러주세요.':'현재 화면에서 확실하게 매칭할 입력 필드가 없습니다. 건너뛴 이유를 확인해주세요.');}));
$('fillDraft').addEventListener('click',()=>run(async()=>{if(!state.fill||!$('confirmDraft').checked)throw Error('원본 주문과 입력 대상 확인이 필요합니다.');const fill=state.fill;await activeTab(fill.origin,fill.tab);const result=await inject(fill.tab,fillDraftFields,[fill.origin,fill.plan]);resetReview();message('초안 값 '+result.filled+'개를 채웠습니다. 건너뛴 값 '+result.skipped+'개. 사이트에서 직접 검토하고 제출해주세요.');}));

class EsmSessionError extends Error {}
function esmExpiry(entry){const value=typeof entry?.expiresAt==='number'?entry.expiresAt:Date.parse(entry?.expiresAt);if(!Number.isFinite(value))throw new EsmSessionError('세션 연결 승인의 만료 시각을 확인할 수 없습니다. 앱에서 다시 승인해주세요.');return value;}
function esmEntry(context,connectionId){
  const entries=(Array.isArray(context?.sessionImports)?context.sessionImports:[]).filter(e=>e?.connectionId===connectionId);
  if(entries.length!==1)throw new EsmSessionError('앱에서 이 판매자 계정의 세션 연결을 먼저 승인해주세요.');
  const entry=entries[0],connection=(context.connections||[]).find(c=>c.id===connectionId);
  if(!connection||connection.providerId!=='esm'||connection.kind!=='market'||connection.mode!=='session'||typeof entry.grant!=='string'||!/^[A-Za-z0-9_-]{16,256}$/.test(entry.grant)||typeof entry.sellerId!=='string'||!entry.sellerId||entry.sellerId.length>160||!['gmarket','auction'].includes(entry.site)||(connection.site!==undefined&&connection.site!==entry.site)||(connection.sellerId!==undefined&&connection.sellerId!==entry.sellerId))throw new EsmSessionError('승인된 ESM 판매자 계정을 확인할 수 없습니다. 앱에서 다시 승인해주세요.');
  if(esmExpiry(entry)<=Date.now())throw new EsmSessionError('세션 연결 승인이 만료됐습니다. 앱에서 새 승인을 발급해주세요.');
  return {connectionId:entry.connectionId,grant:entry.grant,expiresAt:entry.expiresAt,site:entry.site,sellerId:entry.sellerId,name:String(entry.name||connection.name||'지마켓·옥션').slice(0,200)};
}
function esmEntryKey(entry){return JSON.stringify([entry.connectionId,entry.grant,entry.expiresAt,entry.site,entry.sellerId]);}
function renderEsmImports(){const select=$('esmConnectionSelect');select.replaceChildren();state.context.sessionImports||=[];for(const raw of state.context.sessionImports){try{const entry=esmEntry(state.context,raw.connectionId);option(select,entry.connectionId,entry.name+' · '+entry.sellerId);}catch{}}if(!select.options.length)option(select,'','앱에서 ESM 계정의 세션 연결을 승인해주세요.');}
function invalidateEsmPreparation(){state.esmRevision++;state.esmPrepared=null;$('confirmEsm').checked=false;$('esmPreparedInfo').textContent='현재 ESM 탭과 앱의 승인을 먼저 확인해주세요.';updateEsmButton();}
function updateEsmButton(){$('connectEsm').disabled=state.busy||!state.esmPrepared||!$('confirmEsm').checked;}
function assertEsmPrepared(prepared){
  if(!prepared||!state.token||prepared.pairToken!==state.token||prepared.revision!==state.esmRevision||state.esmPrepared!==prepared||$('esmConnectionSelect').value!==prepared.entry.connectionId||!$('confirmEsm').checked)throw new EsmSessionError('선택한 판매자 계정·탭과 동의를 다시 확인해주세요.');
  if(esmEntryKey(esmEntry(state.context,prepared.entry.connectionId))!==esmEntryKey(prepared.entry))throw new EsmSessionError('앱의 승인이 바뀌었습니다. 현재 탭과 승인을 다시 확인해주세요.');
  if(!ESM_ORIGINS.has(prepared.tab.origin))throw new EsmSessionError('ESM의 정상 로그인 탭에서만 세션을 연결할 수 있습니다.');
}
async function esmActiveTab(previous){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});let url;
  try{url=new URL(tab?.url);}catch{throw new EsmSessionError('로그인한 ESM 탭을 선택해주세요.');}
  if(!Number.isSafeInteger(tab?.id)||!ESM_ORIGINS.has(url.origin)||url.username||url.password)throw new EsmSessionError('ESM의 정상 로그인 탭에서만 세션을 연결할 수 있습니다.');
  if(previous&&(tab.id!==previous.id||tab.url!==previous.url||url.origin!==previous.origin||tab.windowId!==previous.windowId))throw new EsmSessionError('확인 후 탭 또는 페이지가 바뀌었습니다. 현재 ESM 탭을 다시 확인해주세요.');
  return {id:tab.id,url:tab.url,origin:url.origin,windowId:tab.windowId};
}
async function prepareEsmSession(){
  invalidateEsmPreparation();const connectionId=$('esmConnectionSelect').value;if(!connectionId)throw new EsmSessionError('앱에서 ESM 판매자 계정의 세션 연결을 승인해주세요.');
  const context=await api('/api/bridge/context'),entry=esmEntry(context,connectionId),tab=await esmActiveTab();
  if($('esmConnectionSelect').value!==connectionId)throw new EsmSessionError('판매자 계정 선택이 바뀌었습니다. 다시 확인해주세요.');
  state.context=context;state.esmPrepared={entry,tab,pairToken:state.token,revision:state.esmRevision};
  $('esmPreparedInfo').textContent=entry.name+' · '+entry.sellerId+' · '+tab.origin+' 확인됨. 동의 후 세션 연결 버튼을 눌러주세요.';message('현재 ESM 탭과 앱의 승인을 확인했습니다. 로그인 쿠키 사용에 동의한 경우 연결할 수 있습니다.');updateEsmButton();
}
async function revalidateEsmSession(prepared){
  assertEsmPrepared(prepared);await esmActiveTab(prepared.tab);
  const context=await api('/api/bridge/context');
  if(esmEntryKey(esmEntry(context,prepared.entry.connectionId))!==esmEntryKey(prepared.entry))throw new EsmSessionError('앱의 세션 연결 승인이 만료되거나 바뀌었습니다. 다시 승인해주세요.');
  state.context.sessionImports=context.sessionImports;assertEsmPrepared(prepared);await esmActiveTab(prepared.tab);assertEsmPrepared(prepared);
}
function esmCookieStore(stores,tabId){const matches=(Array.isArray(stores)?stores:[]).filter(s=>typeof s?.id==='string'&&s.id.length>0&&s.id.length<=128&&Array.isArray(s.tabIds)&&s.tabIds.includes(tabId));if(matches.length!==1)throw new EsmSessionError('현재 ESM 탭의 쿠키 저장소를 정확히 찾지 못했습니다. 다른 저장소를 사용하지 않았습니다.');return matches[0].id;}
function normalizeEsmCookies(raw,storeId,now=Date.now()){
  if(!Array.isArray(raw)||!raw.length||raw.length>ESM_MAX_COOKIES)throw new EsmSessionError('ESM 로그인 쿠키는 최대 200개까지 연결할 수 있습니다. 쿠키 목록과 로그인 상태를 확인해주세요.');
  const cookies=[],keys=new Set();let expiredAuth=false;
  for(const item of raw){
    if(item?.partitionKey!==undefined&&item.partitionKey!==null)continue;
    if(!item||typeof item.domain!=='string'||item.domain.length>253||item.storeId!==storeId||typeof item.hostOnly!=='boolean'||typeof item.secure!=='boolean'||typeof item.httpOnly!=='boolean'||typeof item.session!=='boolean')throw new EsmSessionError('현재 ESM 탭의 쿠키 범위 또는 형식을 확인할 수 없습니다.');
    const domain=item.domain.toLowerCase(),bare=domain.startsWith('.')?domain.slice(1):domain;
    if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*esmplus\.com$/.test(bare)||(item.hostOnly&&domain.startsWith('.')))throw new EsmSessionError('ESM 이외의 도메인 또는 모순된 쿠키 범위가 있어 전송하지 않았습니다.');
    if(typeof item.name!=='string'||!item.name||item.name.length>256||!ESM_COOKIE_NAME.test(item.name)||typeof item.value!=='string'||!ESM_COOKIE_VALUE.test(item.value)||typeof item.path!=='string'||!item.path.startsWith('/')||item.path.length>1024||/[\u0000-\u001f\u007f;]/.test(item.path))throw new EsmSessionError('ESM 로그인 쿠키의 이름·값·경로 형식이 올바르지 않아 전송하지 않았습니다.');
    if(item.name.startsWith('__Secure-')&&!item.secure||item.name.startsWith('__Host-')&&(!item.secure||!item.hostOnly||item.path!=='/'))throw new EsmSessionError('ESM 로그인 쿠키의 보안 속성이 올바르지 않아 전송하지 않았습니다.');
    if(item.expirationDate!==undefined&&(typeof item.expirationDate!=='number'||!Number.isFinite(item.expirationDate)||item.expirationDate<0)||!item.session&&item.expirationDate===undefined)throw new EsmSessionError('ESM 로그인 쿠키의 만료 정보를 확인할 수 없습니다.');
    if(item.expirationDate!==undefined&&item.expirationDate<=now/1000){if(item.name==='ESM_AUTH')expiredAuth=true;continue;}
    const key=JSON.stringify([bare,item.path,item.name]);if(keys.has(key))throw new EsmSessionError('같은 범위의 쿠키가 중복되어 전송하지 않았습니다.');keys.add(key);
    const cookie={name:item.name,value:item.value,domain:item.hostOnly?bare:'.'+bare,path:item.path,hostOnly:item.hostOnly,secure:item.secure,httpOnly:item.httpOnly,session:item.expirationDate===undefined};if(item.expirationDate!==undefined)cookie.expirationDate=item.expirationDate;
    cookies.push(cookie);
  }
  if(!cookies.some(c=>c.name==='ESM_AUTH'&&c.value))throw new EsmSessionError(expiredAuth?'ESM_AUTH가 만료됐습니다. ESM에서 다시 로그인해주세요.':'ESM_AUTH가 없습니다. ESM에서 정상 로그인한 뒤 다시 연결해주세요.');
  if(JSON.stringify(cookies).length>ESM_MAX_COOKIE_CHARS)throw new EsmSessionError('ESM 로그인 쿠키의 정규화된 JSON은 30,000자 이하여야 합니다. 크기 제한을 초과해 전송하지 않았습니다.');
  return cookies;
}
async function transferEsmSession(prepared,permissionPromise){
  let granted=false,rawCookies=null,cookies=null,payload=null;
  try{
    assertEsmPrepared(prepared);granted=await permissionPromise;if(granted!==true)throw new EsmSessionError('ESM 쿠키 선택 권한이 허용되지 않아 세션을 읽거나 전송하지 않았습니다.');
    if(typeof chrome.cookies?.getAllCookieStores!=='function'||typeof chrome.cookies?.getAll!=='function')throw new EsmSessionError('허용된 ESM 쿠키 API를 사용할 수 없습니다. 브라우저 권한을 다시 확인해주세요.');
    await revalidateEsmSession(prepared);if(!await chrome.permissions.contains(ESM_PERMISSION))throw new EsmSessionError('ESM 쿠키 선택 권한이 해제됐습니다. 다시 확인해주세요.');
    const storeId=esmCookieStore(await chrome.cookies.getAllCookieStores(),prepared.tab.id);await esmActiveTab(prepared.tab);assertEsmPrepared(prepared);
    rawCookies=await chrome.cookies.getAll({storeId,domain:'esmplus.com'});cookies=normalizeEsmCookies(rawCookies,storeId);
    await revalidateEsmSession(prepared);
    if(esmCookieStore(await chrome.cookies.getAllCookieStores(),prepared.tab.id)!==storeId)throw new EsmSessionError('현재 탭의 쿠키 저장소가 바뀌어 전송하지 않았습니다. 다시 확인해주세요.');
    if(!await chrome.permissions.contains(ESM_PERMISSION))throw new EsmSessionError('ESM 쿠키 선택 권한이 해제되어 전송하지 않았습니다.');
    await revalidateEsmSession(prepared);cookies=normalizeEsmCookies(rawCookies,storeId);assertEsmPrepared(prepared);
    payload=JSON.stringify({connectionId:prepared.entry.connectionId,grant:prepared.entry.grant,confirmed:true,origin:prepared.tab.origin,cookies:JSON.stringify(cookies)});
    const response=await fetch(BASE+'/api/bridge/esm-session',{method:'POST',headers:{'Content-Type':'application/json','X-Dobi-Bridge':prepared.pairToken},body:payload,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new EsmSessionError('프로그램에서 세션 또는 판매자 계정을 확인하지 못했습니다. 앱의 연결 상태를 확인하고 다시 승인해주세요.');
    state.context.sessionImports=state.context.sessionImports.filter(e=>!(e.connectionId===prepared.entry.connectionId&&e.grant===prepared.entry.grant));renderEsmImports();
    message('지마켓·옥션 세션 연결을 프로그램이 확인했습니다. 앱에서 연결 상태와 주문 수집을 확인해주세요.');
    return {connected:true};
  }catch(error){if(error instanceof EsmSessionError)throw error;throw new EsmSessionError('ESM 세션 연결을 완료하지 못했습니다. 현재 탭과 앱의 승인을 다시 확인해주세요.');}
  finally{rawCookies=null;cookies=null;payload=null;invalidateEsmPreparation();if(granted){let released=false;try{released=await chrome.permissions.remove(ESM_PERMISSION);}catch{}if(!released)message('선택 권한 해제를 확인하지 못했습니다. 브라우저 확장 관리에서 ESM 쿠키 권한을 해제해주세요.',true);}}
}
function beginEsmSession(){
  if(state.busy)return;const prepared=state.esmPrepared;let permissionPromise;
  try{assertEsmPrepared(prepared);if(typeof chrome.permissions?.request!=='function')throw new EsmSessionError('이 브라우저에서 ESM 선택 권한을 요청할 수 없습니다. 최신 Chrome 또는 Edge를 사용해주세요.');
    // Keep this call synchronous in the explicit button click's user gesture.
    permissionPromise=chrome.permissions.request(ESM_PERMISSION);
  }catch{message('현재 ESM 탭과 앱의 승인을 확인하고 쿠키 사용에 동의한 뒤 연결해주세요.',true);return;}
  return run(()=>transferEsmSession(prepared,permissionPromise));
}
$('prepareEsm').addEventListener('click',()=>run(prepareEsmSession));
$('connectEsm').addEventListener('click',beginEsmSession);
$('esmConnectionSelect').addEventListener('change',invalidateEsmPreparation);
$('confirmEsm').addEventListener('change',()=>{if(!$('confirmEsm').checked)invalidateEsmPreparation();else updateEsmButton();});
chrome.tabs.onUpdated?.addListener((tabId,change)=>{if(state.esmPrepared?.tab.id===tabId&&(change.url!==undefined||change.status==='loading'))invalidateEsmPreparation();});
chrome.tabs.onActivated?.addListener(info=>{if(state.esmPrepared&&(state.esmPrepared.tab.id!==info.tabId||state.esmPrepared.tab.windowId!==info.windowId))invalidateEsmPreparation();});
chrome.windows?.onFocusChanged?.addListener(windowId=>{if(state.esmPrepared&&state.esmPrepared.tab.windowId!==windowId)invalidateEsmPreparation();});

function prepareDraft(draft,provider){
  const items=Array.isArray(draft.items)?draft.items:Array.isArray(draft.orders)?draft.orders:[];
  const mappings=Array.isArray(provider.formMapping)?provider.formMapping:[];
  const allowed=new Set(Object.keys(fieldLabels));
  const normalize=field=>field==='qty'?'quantity':field;
  const counts=new Map();for(const m of mappings){const f=normalize(m.field);counts.set(f,(counts.get(f)||0)+1);}
  const blocked=/password|passwd|\bpwd\b|csrf|secret|token|authentication|login|userid|username|user_name|otp|captcha|verification|one[-_]time|submit|agree|terms|cookie|session|apikey|accesskey|인증|비밀번호|로그인|동의|제출/i;
  const candidates=[],skipped=[];
  for(const m of mappings){const field=normalize(m.field),selector=String(m.selector||''),type=m.selector_type||m.selectorType||'css';
    if(!allowed.has(field)||!selector||selector.length>400||!['id','name','css'].includes(type)||blocked.test(selector)){skipped.push((fieldLabels[field]||field||'필드')+': 인증/제출 또는 지원하지 않는 selector 제외');continue;}
    if(m.direct_fill_candidate===false||m.autoEligible===false||(m.source_transform_calls||[]).length||counts.get(field)!==1){skipped.push(fieldLabels[field]+': 변환 또는 분할/복수 후보를 확정하지 못해 제외');continue;}
    candidates.push({field,selector,selector_type:type});
  }
  const common={};for(const field of allowed){const nested=draft.recipient&&typeof draft.recipient==='object'?draft.recipient:{};let value=draft[field]??draft.recipientInfo?.[field]??draft.shipping?.[field]??nested[field];if(value!==undefined&&value!==null&&typeof value!=='object')common[field]=String(value);else{const values=items.map(item=>item[field]??(field==='quantity'?item.qty:undefined)).filter(v=>v!==undefined&&v!==null).map(String);if(values.length===items.length&&values.length&&new Set(values).size===1)common[field]=values[0];}}
  return {items:items.map(item=>Object.fromEntries([...allowed].map(f=>[f,item[f]??(f==='quantity'?item.qty:undefined)]))),common,candidates,skipped};
}

// The following functions execute only after the user presses a popup button.
// They read the visible DOM in the active top-level tab. They never access cookies,
// storage, hidden authentication data, page scripts or network APIs.
function scanVisibleOrders(origin){
  if(location.origin!==origin)return {error:'현재 사이트가 선택한 연결과 다릅니다.'};
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const norm=s=>String(s).toLowerCase().replace(/[\s\-_:()（）\[\].]/g,'');
  const aliases={orderNo:['주문번호','마켓주문번호','쇼핑몰주문번호','orderno','orderid'],lineId:['상품주문번호','주문상품번호','주문순번','상품주문순번','lineid','orderitemid'],product:['상품명','판매상품명','노출상품명','등록상품명','product','productname','itemname'],quantity:['수량','주문수량','구매수량','상품수량','배송수량','quantity','qty'],unitPrice:['단가','판매가','상품단가','판매단가','판매가격','unitprice'],amount:['주문금액','결제금액','총주문금액','상품주문금액','실결제금액','amount'],orderedAt:['주문일','주문일자','주문일시','결제일','결제일시','orderedat','orderdate'],buyer:['구매자','구매자명','주문자','주문자명','buyer'],recipient:['수취인','수취인명','수령인','수령인명','받는사람','받는분','recipient'],phone:['수취인연락처','수취인연락처1','수령인연락처','수취인전화번호','수취인휴대폰','수취인휴대전화','받는분연락처','phone'],postcode:['우편번호','수취인우편번호','배송우편번호','postcode','zipcode'],address:['주소','배송지주소','배송주소','수취인주소','수령인주소','통합배송지','address'],addressDetail:['상세주소','배송지상세주소','수취인상세주소'],carrier:['택배사','배송사','운송사','carrier'],tracking:['송장번호','운송장번호','tracking','invoiceno'],status:['주문상태','배송상태','처리상태','status']};
  const fields=new Map();for(const [field,names] of Object.entries(aliases))for(const name of names)fields.set(norm(name),field);
  const number=text=>{const cleaned=String(text).replace(/[,\s₩원￦$]/g,'');if(!/^\d+(?:\.\d+)?$/.test(cleaned))return null;const value=Number(cleaned);return Number.isSafeInteger(value)&&value>=0?value:null;};
  const clean=s=>String(s||'').replace(/\u00a0/g,' ').trim();
  const date=text=>{const match=String(text).match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);if(!match)return null;const iso=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');const d=new Date(iso+'T00:00:00Z');return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==iso?null:iso;};
  const status=text=>{const s=norm(text);if(/취소완료|취소됨|^취소$|canceled|cancelled/.test(s))return '취소';if(/구매확정|confirmed/.test(s))return '구매확정';if(/배송완료|배달완료|finaldelivery/.test(s))return '배송완료';if(/배송중|출고완료|발송완료|delivering|departure/.test(s))return '배송중';if(/상품준비|발송대기|배송준비|instruct/.test(s))return '발송대기';return '신규';};
  const tables=[];Array.from(document.querySelectorAll('table')).forEach((table,index)=>{
    if(!visible(table))return;const rows=Array.from(table.rows).filter(visible);const header=rows.find(row=>row.querySelectorAll('th').length>0)||rows[0];if(!header)return;
    const headerCells=Array.from(header.cells),headers=headerCells.map(cell=>visible(cell)?clean(cell.innerText):''),mapping=headers.map(name=>fields.get(norm(name))||null);const used=mapping.filter(Boolean);
    if(!used.includes('orderNo')||!used.includes('product')||used.length<3||new Set(used).size!==used.length)return;
    const orders=[];let skipped=0;const after=rows.slice(rows.indexOf(header)+1),limited=after.length>5000;
    for(const row of after.slice(0,5000)){if(row.querySelector('th'))continue;const cells=Array.from(row.cells);if(cells.length!==headers.length||cells.some(cell=>cell.colSpan!==1||cell.rowSpan!==1)){skipped++;continue;}const raw={};for(let i=0;i<cells.length;i++)if(mapping[i]&&visible(cells[i]))raw[mapping[i]]=clean(cells[i].innerText);
      if(!raw.orderNo||!raw.product||!/[A-Za-z0-9]/.test(raw.orderNo)||/[\r\n\s]/.test(raw.orderNo)||raw.orderNo.length>150||raw.product.length>1000){skipped++;continue;}const quantity=raw.quantity?number(raw.quantity):1;if(quantity===null||quantity<1){skipped++;continue;}
      const order={orderNo:raw.orderNo,product:raw.product,quantity,status:status(raw.status)};let invalid=false;
      for(const field of ['unitPrice','amount'])if(raw[field]){const value=number(raw[field]);if(value===null){invalid=true;break;}order[field]=value;}if(invalid){skipped++;continue;}
      for(const field of ['lineId','buyer','recipient','phone','postcode','address','carrier','tracking'])if(raw[field])order[field]=raw[field];if(raw.addressDetail)order.address=[order.address,raw.addressDetail].filter(Boolean).join(' ');if(raw.orderedAt){const value=date(raw.orderedAt);if(!value){skipped++;continue;}order.orderedAt=value;}
      if(['배송중','배송완료','구매확정'].includes(order.status)&&(!order.carrier||!order.tracking)){skipped++;continue;}
      orders.push(order);
    }
    if(orders.length)tables.push({index,headers,orders,skipped,limited});
  });return {tables};
}

function inspectDraftFields(origin,prepared){
  if(location.origin!==origin)return {error:'현재 사이트가 선택한 배송대행지와 다릅니다.'};
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const editable=el=>visible(el)&&!el.disabled&&!el.readOnly&&(el instanceof HTMLTextAreaElement||(el instanceof HTMLInputElement&&['text','tel','email','number','search','url'].includes(el.type)))&&!/password|csrf|secret|token|auth|login|username|user_name|otp|captcha|verification|one[-_]time|submit|agree|terms|cookie|session|apikey|accesskey/i.test((el.name||'')+' '+(el.id||'')+' '+(el.autocomplete||''));
  const find=m=>Array.from(m.selector_type==='id'?document.querySelectorAll('[id="'+CSS.escape(m.selector)+'"]'):m.selector_type==='name'?document.getElementsByName(m.selector):document.querySelectorAll(m.selector));
  const itemFields=new Set(['orderNo','lineId','product','quantity','unitPrice','amount','sku','option']);const writes=[],skipped=[];
  for(const m of prepared.candidates){let nodes;try{nodes=find(m);}catch{skipped.push(m.field+': selector 문법을 확인하지 못했습니다.');continue;}if(!nodes.length){skipped.push(m.field+': 현재 표시된 입력 요소가 없습니다.');continue;}if(nodes.some(n=>!editable(n))){skipped.push(m.field+': 숨김/비활성/인증 또는 지원하지 않는 입력 요소가 포함돼 제외했습니다.');continue;}
    let values;if(itemFields.has(m.field)){if(!prepared.items.length||nodes.length!==prepared.items.length){skipped.push(m.field+': 상품 행 수와 입력 요소 수가 달라 제외했습니다.');continue;}values=prepared.items.map(i=>i[m.field]);}else{if(nodes.length!==1||prepared.common[m.field]===undefined){skipped.push(m.field+': 공통 값 또는 단일 입력 대상을 확정하지 못했습니다.');continue;}values=[prepared.common[m.field]];}
    if(values.some(v=>v===undefined||v===null||typeof v==='object'||String(v)==='')){skipped.push(m.field+': 빈 값 또는 알 수 없는 초안 값이 있어 제외했습니다.');continue;}
    if(values.some((v,i)=>nodes[i].maxLength>=0&&String(v).length>nodes[i].maxLength)){skipped.push(m.field+': 입력 길이 제한을 초과해 제외했습니다.');continue;}
    writes.push({...m,values:values.map(String),previous:nodes.map(n=>n.value)});
  }return {writes,skipped};
}

function fillDraftFields(origin,plan){
  if(location.origin!==origin)return {error:'현재 사이트가 선택한 배송대행지와 다릅니다.'};
  const visible=el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const editable=el=>visible(el)&&!el.disabled&&!el.readOnly&&(el instanceof HTMLTextAreaElement||(el instanceof HTMLInputElement&&['text','tel','email','number','search','url'].includes(el.type)))&&!/password|csrf|secret|token|auth|login|username|user_name|otp|captcha|verification|one[-_]time|submit|agree|terms|cookie|session|apikey|accesskey/i.test((el.name||'')+' '+(el.id||'')+' '+(el.autocomplete||''));
  const tasks=[];let filled=0,skipped=0;
  for(const write of plan.writes){let nodes;try{nodes=Array.from(write.selector_type==='id'?document.querySelectorAll('[id="'+CSS.escape(write.selector)+'"]'):write.selector_type==='name'?document.getElementsByName(write.selector):document.querySelectorAll(write.selector));}catch{skipped+=write.values.length;continue;}if(nodes.length!==write.values.length||nodes.some((node,i)=>!editable(node)||node.value!==write.previous[i])){skipped+=write.values.length;continue;}nodes.forEach((node,i)=>tasks.push({node,value:write.values[i],previous:write.previous[i]}));}
  for(const {node,value,previous} of tasks){if(!node.isConnected||!editable(node)||node.value!==previous){skipped++;continue;}const prototype=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;if(!setter){skipped++;continue;}setter.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true,composed:true}));node.dispatchEvent(new Event('change',{bubbles:true}));filled++;}
  return {filled,skipped};
}
run(load);
