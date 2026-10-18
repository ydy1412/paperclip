import { randomUUID } from 'node:crypto';
import { AppError } from '../store.mjs';
import {sessionLoginMode} from './catalog.mjs';
import { createOfficialClient } from './official.mjs';
import { createRecipeClient,validateRecipe } from './recipe.mjs';
import { createEsmClient,validateEsmCookies } from './esm.mjs';
import {createCoupangSession,validateCoupangCookies} from './coupang-auth.mjs';
import {createCoupangWingClient} from './coupang-wing.mjs';
import {createSellerClient,SELLER_PROVIDERS} from './seller-factory.mjs';
import {createSellerLogins,sellerMetadata,SELLER_META_KEYS,SELLER_IDENTITY_KEYS} from './seller-logins.mjs';

export function esmMetadata(input){
  if(!['gmarket','auction'].includes(input.site))throw new AppError('지마켓 또는 옥션을 선택해주세요.');
  const sellerId=String(input.sellerId||'').trim();
  if(!sellerId||sellerId.length>100||/[\s\x00-\x1f\x7f]/.test(sellerId))throw new AppError('ESM에 등록된 판매자 ID를 입력해주세요.');
  return {site:input.site,sellerId,channel:input.site==='gmarket'?'지마켓':'옥션'};
}
export function wingMetadata(input){const sellerId=String(input.sellerId||'').trim();if(!sellerId||sellerId.length>100||/[\s<>;\x00-\x1f\x7f]/.test(sellerId))throw new AppError('쿠팡 윙 로그인 아이디를 입력해주세요.');return {sellerId,site:undefined,channel:'쿠팡'};}
export const connectionIdentity=c=>JSON.stringify([c?.id,c?.providerId,c?.name,c?.mode,c?.site,c?.sellerId,c?.vendorId,c?.credentialRef,c?.recipe,...SELLER_META_KEYS.map(k=>c?.[k]),...SELLER_IDENTITY_KEYS.map(k=>c?.[k])]);

export function dateRange(from,to){for(const v of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new AppError('수집 시작일과 종료일을 확인해주세요.');if(from>to||Date.parse(to)-Date.parse(from)>92*86400000)throw new AppError('수집 기간은 순서대로 최대 93일을 지정해주세요.');return {from,to};}
export function createIntegrations({store,vault,catalog,fetchImpl=fetch,officialFactory=createOfficialClient,esmFactory=createEsmClient,wingFactory=createCoupangWingClient,wingSessionFactory=createCoupangSession,nativeLogin=options=>import('./wing-native.mjs').then(m=>m.nativeWingLogin(options)),sellerFactory=createSellerClient,sessionOrdersOnly=false,nativeSellerLogin=options=>import('./wing-native.mjs').then(m=>m.nativeSellerLogin(options)),resolveHost=true}){
  const busy=new Set();
  const wingPending=new Map(),nativePending=new Map(),wingEpoch=new Map();
  const credentialKey=c=>c.credentialRef||c.id;
  const provider=id=>{const p=catalog.providers.find(x=>x.id===id);if(!p)throw new AppError('연동 대상을 찾을 수 없습니다.');return p;};
  const connection=id=>{const c=store.connection(id);if(!c)throw new AppError('연결 계정을 찾을 수 없습니다.',404);return c;};
  const seller=createSellerLogins({store,vault,connection,credentialKey,execute,assertCurrent,saveVerified,epoch:wingEpoch,factory:sellerFactory,nativeLogin:nativeSellerLogin,fetchImpl,resolveHost});
  async function saveVerified(c,value){assertCurrent(c);const key=credentialKey(c),had=vault.has(key),previous=had?await vault.get(key):null;assertCurrent(c);let written=false;try{await vault.set(key,value);written=true;assertCurrent(c);}catch(error){if(written){try{if(had)await vault.set(key,previous);else await vault.remove(key);}catch{throw new AppError('취소된 인증 정보의 저장을 되돌리지 못했습니다. 인증 저장소를 확인해주세요.',503);}}throw error;}}
  const needsSessionLogin=c=>sessionOrdersOnly&&c.kind==='market'&&Boolean(sessionLoginMode(c.providerId))&&!['wing','seller','session','browser'].includes(c.mode);
  function publicConnection(c){const keys=['id','providerId','channel','kind','name','mode','recipe','site','sellerId','vendorId',...SELLER_META_KEYS,...SELLER_IDENTITY_KEYS,'sessionImportedAt','state','lastError','lastRunAt','createdAt','updatedAt'];return {...Object.fromEntries(keys.filter(k=>c[k]!==undefined&&(k!=='recipe'||c.mode==='api')).map(k=>[k,c[k]])),hasCredentials:vault.has(credentialKey(c)),hasPassword:['wing','seller'].includes(c.mode)&&c.passwordSaved===true&&vault.has(credentialKey(c)),hasApiKeys:c.mode==='seller'&&c.providerId==='kakaoapi'&&c.apiKeysSaved===true&&vault.has(credentialKey(c)),busy:busy.has(c.id),reconnectRequired:needsSessionLogin(c),...(needsSessionLogin(c)?{state:'로그인 재연결 필요'}:{})};}
  function safeMessage(e,secrets){let s=e?.message||'연동 처리에 실패했습니다.';const values=Object.values(secrets||{}).filter(v=>typeof v==='string'&&v.length>=4);try{for(const c of JSON.parse(secrets?.cookies||'[]'))if(typeof c.value==='string'&&c.value)values.push(c.value);}catch{}try{const walk=v=>{if(typeof v==='string'&&v.length>=4)values.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(walk);};walk(JSON.parse(secrets?.sessionData||'{}'));}catch{}for(const v of values)s=s.split(v).join('[인증값]');if(/<!doctype|<html|stack|password\s*[:=]|secret\s*[:=]|access_token\s*[:=]/i.test(s)||s.length>350)s='API 응답을 처리하지 못했습니다. 인증·권한·응답 규칙을 확인해주세요.';return s;}
  function assertCurrent(c){if(c._wingEpoch!==undefined&&c._wingEpoch!==(wingEpoch.get(c.id)||0))throw new AppError('판매처 로그인 요청이 취소되었습니다. 다시 로그인해주세요.',409);if(connectionIdentity(store.connection(c.id))!==connectionIdentity(c))throw new AppError('연결 정보가 변경되었습니다. 새 연결 상태에서 다시 시도해주세요.',409);}
  async function client(c){const credentials={...await vault.get(credentialKey(c)),account:c.name};if(c.mode==='wing'){if(!c.vendorId)throw new AppError('쿠팡 윙 로그인과 판매자코드 확인을 먼저 완료해주세요.');return wingFactory({credentials:{...credentials,sellerId:c.sellerId,vendorId:c.vendorId},fetchImpl,resolveHost});}if(c.mode==='session')return esmFactory({credentials:{...credentials,site:c.site,sellerId:c.sellerId},fetchImpl,resolveHost});if(c.mode==='official')return officialFactory({provider:c.providerId,credentials,fetchImpl});if(c.mode==='api')return createRecipeClient({recipe:c.recipe,credentials,kind:c.kind,fetchImpl,resolveHost});throw new AppError('브라우저 연결은 브라우저 도우미에서 로그인한 탭을 확인해주세요.');}
  async function callClient(c,method,args){if(needsSessionLogin(c))throw new AppError('로그인 재연결이 필요합니다. 아이디·비밀번호로 연결한 뒤 세션으로 주문을 조회해주세요.',401);if(c.mode==='seller')return seller.call(c,method,args);let api;try{try{api=await client(c);return await api[method](args);}catch(e){
    if(c.mode!=='wing'||e.code!=='SESSION_REQUIRED')throw e;
    const credentials=await vault.get(credentialKey(c));assertCurrent(c);if(!credentials.password)throw e;
    const session=wingSessionFactory({credentials:{sellerId:c.sellerId,vendorId:c.vendorId,password:credentials.password},fetchImpl,resolveHost});
    const login=await completeWing(c,session,await session.login());if(login.pending)throw new AppError('쿠팡 추가 인증이 필요합니다. 윙 로그인 버튼에서 이어서 진행해주세요.',401);
    api=wingFactory({credentials:{...credentials,sellerId:c.sellerId,vendorId:c.vendorId,account:c.name},fetchImpl,resolveHost,session});return await api[method](args);
  }}finally{if(api&&['session','wing'].includes(c.mode)){assertCurrent(c);const stored=await vault.get(credentialKey(c));let cookies=api.getSessionCookies();if(c.mode==='wing'){const rows=JSON.parse(cookies);cookies=rows.length?JSON.stringify(validateCoupangCookies(rows)):stored.cookies;}if(stored.cookies!==cookies){assertCurrent(c);await saveVerified(c,{...stored,cookies});assertCurrent(c);}}}}
  async function execute(id,kind,fn,extraSecrets){if(busy.has(id))throw new AppError('이 계정에서 연동 작업이 진행 중입니다.',409);const c=connection(id);if(['wing','seller'].includes(c.mode))c._wingEpoch=wingEpoch.get(id)||0;busy.add(id);let secrets=extraSecrets;try{if(vault.has(credentialKey(c)))secrets={...await vault.get(credentialKey(c)),...extraSecrets};const result=await fn(c);assertCurrent(c);store.saveConnection({id,state:result.pending?(result.stage==='confirm'?'판매자 확인 필요':'추가 인증 필요'):['인증 확인','세션 연결','윙 로그인','판매처 로그인'].includes(kind)?'인증 확인됨':'수집 완료',lastError:'',lastRunAt:new Date().toISOString()});store.integrationRun(id,kind,result.pending?'진행중':'완료',result.summary||{message:result.pending?'정상 추가 인증 또는 판매자코드 확인이 필요합니다.':'인증과 세션을 확인했습니다.'});return result;}catch(e){const message=safeMessage(e,secrets);if(connectionIdentity(store.connection(id))===connectionIdentity(c)){store.saveConnection({id,state:'확인 필요',lastError:message,lastRunAt:new Date().toISOString()});store.integrationRun(id,kind,'실패',{message});}throw new AppError(message,e.status||502);}finally{busy.delete(id);}}
  function wingConnection(c){if(c.providerId!=='coupang'||c.mode!=='wing'||c.kind!=='market')throw new AppError('쿠팡 윙 로그인 계정을 선택해주세요.');wingMetadata(c);}
  function publicWingPending(p){return {ok:false,pending:true,stage:p.stage,expiresAt:new Date(p.expires).toISOString(),methods:p.methods||[],...(p.stage==='confirm'?{vendorId:p.vendorId}:{}),summary:{message:p.stage==='confirm'?'윙에 표시된 판매자코드를 확인해주세요.':'정상 추가 인증을 완료해주세요.'}};}
  async function completeWing(c,api,result){
    assertCurrent(c);if(result.pending){const p={api,identity:connectionIdentity(c),expires:Date.parse(result.expiresAt),stage:result.stage,methods:result.methods};if(!['method','code'].includes(p.stage)||!Number.isFinite(p.expires)||p.expires>Date.now()+6*60000)throw new AppError('쿠팡 추가 인증 응답을 확인하지 못했습니다.');wingPending.set(c.id,p);return publicWingPending(p);}
    if(!result.ok||!/^[-A-Za-z0-9_]{1,100}$/.test(result.vendorId||''))throw new AppError('쿠팡 판매자코드를 확인하지 못했습니다.');
    if(c.vendorId&&c.vendorId!==result.vendorId)throw new AppError('저장된 쿠팡 판매자코드와 현재 로그인한 계정이 다릅니다.',401);
    if(!c.vendorId){const p={api,identity:connectionIdentity(c),expires:Date.now()+5*60000,stage:'confirm',vendorId:result.vendorId};wingPending.set(c.id,p);return publicWingPending(p);}
    const retained=vault.has(credentialKey(c))?await vault.get(credentialKey(c)):{};assertCurrent(c);await saveVerified(c,{...retained,cookies:JSON.stringify(validateCoupangCookies(api.getSessionCookies()))});assertCurrent(c);wingPending.delete(c.id);store.saveConnection({id:c.id,sessionImportedAt:new Date().toISOString()});return {ok:true,summary:{message:'쿠팡 윙 로그인과 기존 판매자코드를 확인했습니다.'}};
  }
  return {
    catalog,
    sellerStatus:seller.status,sellerLogin:seller.login,cancelSellerLogin:seller.cancel,
    isBusy:()=>busy.size>0,
    dispose(){seller.dispose();for(const c of store.connections())if(c.mode==='wing')wingEpoch.set(c.id,(wingEpoch.get(c.id)||0)+1);for(const controller of nativePending.values())controller.abort();nativePending.clear();for(const p of wingPending.values())p.api.cancel?.();wingPending.clear();},
    wingStatus(id){const c=connection(id);wingConnection(c);const p=wingPending.get(id);if(!p||p.expires<=Date.now()||p.identity!==connectionIdentity(c)){if(p)p.api.cancel?.();wingPending.delete(id);return {ok:Boolean(c.vendorId&&vault.has(credentialKey(c))&&['인증 확인됨','수집 완료'].includes(c.state)),pending:false};}return publicWingPending(p);},
    cancelWingLogin(id){const c=connection(id);wingConnection(c);wingEpoch.set(id,(wingEpoch.get(id)||0)+1);nativePending.get(id)?.abort();const p=wingPending.get(id);p?.api.cancel?.();wingPending.delete(id);return {ok:true,cancelled:true};},
    wingLogin:(id,data={})=>execute(id,'윙 로그인',async c=>{
      wingConnection(c);const step=data.step||'start';
      if(['method','code','confirm'].includes(step)){
        const p=wingPending.get(id);if(!p||p.expires<=Date.now()||p.identity!==connectionIdentity(c)||p.stage!==step){wingPending.delete(id);throw new AppError('쿠팡 로그인 요청이 만료·변경됐습니다. 다시 로그인해주세요.',409);}wingPending.delete(id);
        if(step==='confirm'){
          if(data.confirmed!==true||data.vendorId!==p.vendorId)throw new AppError('윙에 표시된 판매자코드를 확인해주세요.');const verified=await p.api.verifyIdentity();if(verified.vendorId!==p.vendorId)throw new AppError('쿠팡 로그인 계정이 변경됐습니다. 다시 로그인해주세요.',409);
          const retained=vault.has(credentialKey(c))?await vault.get(credentialKey(c)):{};assertCurrent(c);await saveVerified(c,{...retained,cookies:JSON.stringify(validateCoupangCookies(p.api.getSessionCookies()))});assertCurrent(c);store.saveConnection({id,vendorId:p.vendorId,sessionImportedAt:new Date().toISOString()});c.vendorId=p.vendorId;return {ok:true,summary:{message:'쿠팡 윙 로그인과 선택한 판매자코드를 연결했습니다.'}};
        }
        try{return await completeWing(c,p.api,await p.api.continueLogin(step==='method'?{method:data.method}:{code:data.code}));}catch(e){p.api.cancel?.();throw e;}
      }
      if(!['start','native'].includes(step))throw new AppError('지원하지 않는 쿠팡 로그인 단계입니다.');wingPending.get(id)?.api.cancel?.();wingPending.delete(id);
      const secret=vault.has(credentialKey(c))?await vault.get(credentialKey(c)):{};
      if(step==='native'){
        const controller=new AbortController();nativePending.set(id,controller);try{const result=await nativeLogin({sellerId:c.sellerId,password:secret.password||'',signal:controller.signal});assertCurrent(c);const cookies=JSON.stringify(validateCoupangCookies(result.cookies));const api=wingSessionFactory({credentials:{sellerId:c.sellerId,vendorId:c.vendorId,cookies},fetchImpl,resolveHost});return await completeWing(c,api,await api.verifyIdentity());}finally{nativePending.delete(id);}
      }
      const api=wingSessionFactory({credentials:{sellerId:c.sellerId,password:secret.password,vendorId:c.vendorId},fetchImpl,resolveHost});return completeWing(c,api,await api.login());
    },{code:typeof data.code==='string'?data.code:''}),
    list:()=>store.connections().map(publicConnection),
    async save(input){
      const p=provider(input.providerId),before=input.id?connection(input.id):null,name=String(input.name||'').trim();
      if(!name||name.length>100)throw new AppError('계정 이름은 1~100자로 입력해주세요.');
      if(!['official','api','browser','session','wing','seller'].includes(input.mode))throw new AppError('연결 방식을 선택해주세요.');
      if(input.mode==='seller'&&(p.kind!=='market'||!SELLER_PROVIDERS().includes(p.id)))throw new AppError('이 판매처의 로그인 수집 구현을 확인해주세요.');
      if(input.mode==='wing'&&(p.id!=='coupang'||p.kind!=='market'))throw new AppError('쿠팡 윙 로그인 계정을 선택해주세요.');
      if(sessionOrdersOnly&&p.kind==='market'&&sessionLoginMode(p.id)&&['official','api'].includes(input.mode))throw new AppError('아이디·비밀번호 로그인 방식으로 연결해주세요.');
      if(input.mode==='official'&&!p.official)throw new AppError('이 판매처는 공식 API 클라이언트가 구현되지 않았습니다.');
      if(input.mode==='browser'&&!p.browserUrl)throw new AppError('이 대상의 로그인/신청 페이지 주소는 아직 확인되지 않았습니다.');
      if(input.mode==='session'&&(p.id!=='esm'||p.kind!=='market'))throw new AppError('ESM에서만 지마켓·옥션 세션 API를 사용할 수 있습니다.');
      const meta=input.mode==='seller'?sellerMetadata(input,p):input.mode==='session'?esmMetadata(input):input.mode==='wing'?wingMetadata(input):{site:undefined,sellerId:undefined,channel:p.name};
      const reconnect=before&&needsSessionLogin(before)&&input.mode===sessionLoginMode(p.id)&&before.providerId===p.id;
      if(reconnect)meta.channel=before.channel;
      const previousCredentials=reconnect&&vault.has(credentialKey(before))?await vault.get(credentialKey(before)):{};
      const hasOrders=before&&store.all().some(o=>o.sourceConnectionId===before.id);
      if(hasOrders&&(before.name!==name||before.providerId!==p.id||before.channel!==meta.channel||!reconnect&&(before.site!==meta.site||before.sellerId!==meta.sellerId)||before.mode==='seller'&&SELLER_META_KEYS.some(k=>before[k]!==meta[k])))throw new AppError('수집된 주문이 있는 계정의 판매처·판매자 ID·이름은 변경할 수 없습니다. 새 연결을 추가해주세요.');
      if(input.mode==='session'&&store.connections().some(c=>c.id!==before?.id&&c.providerId==='esm'&&c.mode==='session'&&c.site===meta.site&&c.sellerId?.toLowerCase()===meta.sellerId.toLowerCase()))throw new AppError('같은 ESM 판매자 ID의 연결 계정이 이미 있습니다. 기존 계정을 사용해주세요.');
      if(input.mode==='wing'&&store.connections().some(c=>c.id!==before?.id&&c.providerId==='coupang'&&c.mode==='wing'&&c.sellerId?.toLowerCase()===meta.sellerId.toLowerCase()))throw new AppError('같은 쿠팡 윙 아이디의 연결이 이미 있습니다. 기존 계정을 사용해주세요.');
      if(input.mode==='seller'&&store.connections().some(c=>c.id!==before?.id&&c.providerId===p.id&&c.mode==='seller'&&SELLER_META_KEYS.every(k=>String(c[k]||'').toLowerCase()===String(meta[k]||'').toLowerCase())))throw new AppError('같은 판매처 계정과 상점의 연결이 이미 있습니다.');
      const recipe=input.mode==='api'?validateRecipe(input.recipe,p.kind):undefined,credentials=input.credentials||{};
      if(typeof credentials!=='object'||Array.isArray(credentials)||Object.keys(credentials).length>20)throw new AppError('인증 정보 형식을 확인해주세요.');
      for(const [k,v]of Object.entries(credentials))if(!/^[A-Za-z][\w]{0,40}$/.test(k)||typeof v!=='string'||v.length>30000||/[\r\n]/.test(v))throw new AppError('인증 항목을 확인해주세요.');
      if(input.mode==='session'&&Object.keys(credentials).length)throw new AppError('ESM 세션은 브라우저 도우미의 확인 버튼에서 연결해주세요.');
      if(input.mode==='wing'&&(Object.keys(credentials).some(k=>k!=='password')||credentials.password!==undefined&&credentials.password.length>2048))throw new AppError('쿠팡 윙 비밀번호 항목을 확인해주세요.');
      if(input.mode==='seller'&&(Object.keys(credentials).some(k=>!(p.id==='kakaoapi'?['appKey','sellerAppKey','partnerId','channelIds']:['password']).includes(k))||credentials.password!==undefined&&credentials.password.length>2048))throw new AppError('판매처 비밀번호·발급키 항목을 확인해주세요.');
      if(before&&busy.has(before.id))throw new AppError('이 계정에서 연동 작업이 진행 중입니다.',409);
      if(before)busy.add(before.id);
      try{
        const sameSeller=before?.mode==='seller'&&input.mode==='seller'&&before.providerId===p.id&&SELLER_META_KEYS.every(k=>before[k]===meta[k]);
        const priorSecret=sameSeller&&vault.has(credentialKey(before))?await vault.get(credentialKey(before)):{};
        const loginFields=p.id==='kakaoapi'?['appKey','sellerAppKey','partnerId','channelIds']:['password'];
        const retainedLogin=Object.fromEntries(loginFields.filter(k=>priorSecret[k]!==undefined).map(k=>[k,priorSecret[k]]));
        const changed=before&&(before.providerId!==p.id||before.mode!==input.mode||before.site!==meta.site||before.sellerId!==meta.sellerId||JSON.stringify(before.recipe)!==JSON.stringify(recipe)||['wing','seller'].includes(input.mode)&&Object.values(credentials).some(Boolean)||before&&input.mode==='seller'&&SELLER_META_KEYS.some(k=>before[k]!==meta[k]));
        if(changed)await vault.remove(credentialKey(before));
        if(before){seller.clear(before.id);wingPending.get(before.id)?.api.cancel?.();wingPending.delete(before.id);}
        const vendorId=input.mode==='wing'?(before?.mode==='wing'&&before.sellerId===meta.sellerId?before.vendorId:reconnect&&/^[-A-Za-z0-9_]{1,100}$/.test(previousCredentials.vendorId||'')?previousCredentials.vendorId:undefined):undefined;
        const c=store.saveConnection({...(before?{id:before.id}:{}),credentialRef:before&&!changed?credentialKey(before):randomUUID(),providerId:p.id,kind:p.kind,name,mode:input.mode,recipe,...Object.fromEntries(SELLER_META_KEYS.map(k=>[k,undefined])),...meta,vendorId,...Object.fromEntries(SELLER_IDENTITY_KEYS.map(k=>[k,input.mode==='seller'&&before?.mode==='seller'&&before.providerId===p.id&&SELLER_META_KEYS.every(m=>before[m]===meta[m])?before[k]:undefined])),apiKeysSaved:input.mode==='seller'&&p.id==='kakaoapi'?(Boolean((credentials.appKey||retainedLogin.appKey)&&(credentials.sellerAppKey||retainedLogin.sellerAppKey))):undefined,passwordSaved:['wing','seller'].includes(input.mode)?(Boolean(credentials.password||retainedLogin.password)||!changed&&before?.passwordSaved===true):undefined,state:input.mode==='seller'?'판매처 로그인 필요':input.mode==='browser'?'브라우저 확인 필요':input.mode==='session'?'브라우저 세션 연결 필요':input.mode==='wing'?'윙 로그인 필요':'인증 필요',lastError:''});
        if(!['browser','session'].includes(input.mode)&&(Object.keys(credentials).length||recipe?.auth?.type==='none')){const retained=before&&!changed&&vault.has(credentialKey(c))?await vault.get(credentialKey(c)):{};await vault.set(credentialKey(c),{...retained,...retainedLogin,...credentials});}
        return {...publicConnection(c),busy:false};
      }finally{if(before)busy.delete(before.id);}
    },
    test:id=>execute(id,'인증 확인',async c=>{const result=await callClient(c,'testConnection');if(!result?.ok)throw new AppError('연결 API가 인증 성공을 확인하지 못했습니다.');return {ok:true,summary:{message:'인증과 읽기 응답을 확인했습니다.'}};}),
    collect:(id,dates)=>execute(id,'주문 수집',async c=>{if(c.kind!=='market')throw new AppError('주문수집은 쇼핑몰 계정에서 실행해주세요.');const range=dateRange(dates.from,dates.to),result=await callClient(c,'collectOrders',range);assertCurrent(c);if(result.complete!==true||!Array.isArray(result.orders))throw new AppError('전체 페이지 수집을 확인하지 못해 주문을 저장하지 않았습니다.');const summary=store.syncOrders(c,result.orders);return {summary,notes:result.notes||[]};}),
    async importEsmSession(id,data){const cookies=JSON.stringify(validateEsmCookies(data.cookies));return execute(id,'세션 연결',async c=>{if(c.providerId!=='esm'||c.mode!=='session'||c.kind!=='market')throw new AppError('ESM 세션 연결 계정을 선택해주세요.');esmMetadata(c);const api=esmFactory({credentials:{site:c.site,sellerId:c.sellerId,cookies,account:c.name},fetchImpl,resolveHost});const result=await api.testConnection();if(!result?.ok)throw new AppError('ESM 세션과 판매자 계정을 확인하지 못했습니다.');assertCurrent(c);await saveVerified(c,{cookies:api.getSessionCookies()});assertCurrent(c);store.saveConnection({id,sessionImportedAt:new Date().toISOString()});return {ok:true,summary:{message:'ESM 세션과 선택한 판매자 계정을 확인했습니다.'}};},{cookies});},
    async importWingSession(id,data){const cookies=JSON.stringify(validateCoupangCookies(data.cookies));return execute(id,'세션 연결',async c=>{wingConnection(c);if(!c.vendorId)throw new AppError('최초 연결은 윙 로그인과 판매자코드 확인을 먼저 완료해주세요.');const api=wingSessionFactory({credentials:{sellerId:c.sellerId,vendorId:c.vendorId,cookies},fetchImpl,resolveHost});return completeWing(c,api,await api.verifyIdentity());},{cookies});},
    tracking:(id,dates)=>execute(id,'송장 회수',async c=>{if(c.kind!=='forwarder')throw new AppError('배송대행지를 선택해주세요.');const result=await (await client(c)).collectTracking(dateRange(dates.from,dates.to));if(result.complete!==true)throw new AppError('송장 목록 수집이 완료되지 않았습니다.');return {summary:store.applyForwardTracking(c,result.orders)};}),
    async submit(id,{expectedVersion,confirmed}={}){const d=store.forward(id);if(!d)throw new AppError('배송신청 초안을 찾을 수 없습니다.',404);if(!confirmed)throw new AppError('수령인·상품·배송대행지를 검토한 뒤 전송을 확인해주세요.');if(d.state!=='작성중')throw new AppError('이미 전송했거나 결과 확인이 필요한 배송신청입니다.',409);if(expectedVersion!==d.version)throw new AppError('초안이 변경됐습니다. 다시 확인해주세요.',409);const c=connection(d.connectionId);if(c.mode!=='api'||!c.recipe?.operations?.submit)throw new AppError('이 배송대행지에는 확인된 배송신청 API 규칙이 없습니다. 브라우저 신청서 또는 파일을 사용해주세요.');if(busy.has(c.id))throw new AppError('이 배송대행지에서 다른 작업이 진행 중입니다.',409);for(const id of d.orderIds){const order=store.get(id);if(order?.demo)throw new AppError('예제 주문은 실제 배송대행지에 전송할 수 없습니다.');if(store.hasRemoteClaim(order))throw new AppError('판매처 클레임·부분 수량을 확인한 뒤 배송신청해주세요.');if(!order||order.version!==d.orderVersions[id]||order.onHold||order.status==='취소')throw new AppError('초안 생성 뒤 주문이 변경됐습니다. 새 초안을 만들어 검토해주세요.',409);}
      if(store.forwarding().some(f=>f.id!==d.id&&f.state!=='보관됨'&&f.orderIds.some(id=>d.orderIds.includes(id))))throw new AppError('같은 주문의 다른 배송신청이 있어 전송할 수 없습니다.',409);const api=await client(c);busy.add(c.id);store.updateForward(d.id,{state:'전송중'},d.version);try{const result=await api.submit(d);if(!result.applicationId)throw new AppError('접수번호를 확인하지 못했습니다.');if(store.forwarding().some(f=>f.id!==d.id&&f.connectionId===c.id&&f.applicationId===String(result.applicationId)))throw new AppError('배송대행지가 이미 등록된 접수번호를 반환했습니다.');const next=store.updateForward(d.id,{state:'신청완료',applicationId:String(result.applicationId)});store.integrationRun(c.id,'배송신청','완료',{draftId:d.id});return next;}catch(e){store.updateForward(d.id,{state:'결과미확인'});store.integrationRun(c.id,'배송신청','확인 필요',{draftId:d.id,message:'배송대행지에서 접수 여부를 확인한 뒤 접수번호를 등록해주세요.'});throw new AppError('배송신청 결과를 확인하지 못했습니다. 재전송 전에 배송대행지에서 접수 여부를 확인해주세요.',502);}finally{busy.delete(c.id);}},
    receipt(id,{applicationId,carrier='',tracking='',expectedVersion,confirmed}){if(!confirmed)throw new AppError('배송대행지에서 확인한 접수번호임을 확인해주세요.');return store.registerForwardReceipt(id,{applicationId,carrier,tracking,expectedVersion});},
    browserImport(id,{orders,complete,confirmed}){const c=connection(id);if(c.mode!=='browser'||c.kind!=='market')throw new AppError('브라우저 수집 계정을 선택해주세요.');if(!complete||!confirmed)throw new AppError('화면에서 가져온 목록과 현재 페이지 범위를 확인해주세요.');const summary=store.syncOrders(c,orders);store.integrationRun(id,'브라우저 화면 수집','완료',{...summary,scope:'사용자가 확인한 현재 화면/응답'});store.saveConnection({id,state:'화면 수집 완료',lastError:'',lastRunAt:new Date().toISOString()});return {summary};},
    runs:()=>store.runs()
  };
}
