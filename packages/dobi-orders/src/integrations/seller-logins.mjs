import {AppError} from '../store.mjs';
import {sellerPolicy,sellerHost} from './seller-policy.mjs';
import {validateSellerCookies} from './seller-session.mjs';
export const SELLER_META_KEYS=['site','sellerId','host','shopNo','loginType','storeName'];
export const SELLER_IDENTITY_KEYS=['identityId','identityLabel','identitySource'];
export function sellerMetadata(input,provider){
 const sellerId=String(input.sellerId??'').trim();if(!sellerId||sellerId.length>100||/[\s<>;\x00-\x1f\x7f]/.test(sellerId))throw new AppError('판매처 로그인 아이디를 입력해주세요.');
 const meta={sellerId,channel:provider.name};
 if(provider.id==='esm'){if(!['gmarket','auction'].includes(input.site))throw new AppError('지마켓 또는 옥션을 선택해주세요.');meta.site=input.site;meta.channel=input.site==='gmarket'?'지마켓':'옥션';}
 if(['imweb','godo5','cafe24'].includes(provider.id)&&input.host){try{meta.host=sellerHost(String(input.host).trim());}catch(e){throw new AppError(e.message);}}
 if(['imweb','godo5'].includes(provider.id)&&!meta.host)throw new AppError('쇼핑몰 관리자 HTTPS 호스트를 입력해주세요.');
 if(provider.id==='smartstore'){if(!['naver','center'].includes(input.loginType))throw new AppError('네이버 아이디 또는 커머스센터 로그인을 선택해주세요.');meta.loginType=input.loginType;}
 for(const key of ['shopNo','storeName'])if(input[key]){if(typeof input[key]!=='string'||input[key].length>200||/[\x00-\x1f\x7f<>]/.test(input[key]))throw new AppError('상점 선택 정보를 확인해주세요.');meta[key]=input[key].trim();}
 try{sellerPolicy(provider.id,meta);}catch(e){throw new AppError(e.message);}return meta;
}
export function createSellerLogins({store,vault,connection,credentialKey,execute,assertCurrent,saveVerified,epoch,factory,nativeLogin,fetchImpl,resolveHost}){
 const pending=new Map(),active=new Map(),native=new Map();
 const check=c=>{if(c.mode!=='seller'||c.kind!=='market')throw new AppError('판매처 로그인 계정을 선택해주세요.');};
 const meta=c=>Object.fromEntries([...SELLER_META_KEYS,...SELLER_IDENTITY_KEYS].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
 const credentials=async c=>({... (vault.has(credentialKey(c))?await vault.get(credentialKey(c)):{}),...meta(c),account:c.name});
 const fresh=(c,secret)=>Object.fromEntries((c.providerId==='kakaoapi'?['appKey','sellerAppKey','partnerId','channelIds']:['password']).filter(k=>secret[k]!==undefined).map(k=>[k,secret[k]]));
 const make=(c,secret)=>{const api=factory({providerId:c.providerId,credentials:{...secret,...meta(c),account:c.name},fetchImpl,resolveHost});let state;try{state=typeof secret.sessionData==='string'?JSON.parse(secret.sessionData):secret.sessionData??{};}catch{throw new AppError('판매처 세션 정보를 확인해주세요.');}if(state.userAgent){const get=api.getSessionState;api.getSessionState=()=>{const out=get?.call(api)??{cookies:api.getSessionCookies()},data=typeof out.sessionData==='string'?JSON.parse(out.sessionData):out.sessionData??{};return {...out,sessionData:{...data,userAgent:state.userAgent}};};}return api;};
 function publicPending(p){return {ok:false,pending:true,stage:p.stage,expiresAt:new Date(p.expires).toISOString(),...(p.stage==='confirm'?{identityId:p.result.identityId,identityLabel:p.result.identityLabel,identitySource:p.result.identitySource}:{}),summary:{message:p.stage==='confirm'?'로그인한 판매자와 선택한 상점을 확인해주세요.':'별도 로그인 창에서 로그인과 추가 인증을 완료해주세요.'}};}
 async function persist(c,api){assertCurrent(c);const state=api.getSessionState?.()??{cookies:api.getSessionCookies()},cookies=JSON.stringify(validateSellerCookies(state.cookies??api.getSessionCookies(),{providerId:c.providerId,credentials:c}));const sessionData=typeof state.sessionData==='string'?state.sessionData:JSON.stringify(state.sessionData??{});if(sessionData.length>30000)throw new AppError('판매처 인증 정보 저장 한도를 초과했습니다.');let parsed;try{parsed=JSON.parse(sessionData);}catch{throw new AppError('판매처 인증 정보 형식을 확인할 수 없습니다.');}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new AppError('판매처 인증 정보 형식을 확인할 수 없습니다.');const retained=vault.has(credentialKey(c))?await vault.get(credentialKey(c)):{};assertCurrent(c);await saveVerified(c,{...retained,cookies,sessionData});assertCurrent(c);}
 function identity(c,result){if(!result?.ok||typeof result.identityId!=='string'||!result.identityId||result.identityId.length>300||/[\x00-\x1f\x7f<>]/.test(result.identityId))throw new AppError('판매처 인증과 상점 식별자를 확인하지 못했습니다.',401);if(c.identityId&&c.identityId!==result.identityId)throw new AppError('저장된 판매처 상점과 로그인한 상점이 다릅니다.',401);return {...result,identityLabel:String(result.identityLabel??result.identityId).slice(0,300),identitySource:result.identitySource??'server'};}
 async function complete(c,api,result,{browser=false}={}){
  assertCurrent(c);if(result?.pending){if(result.stage!=='browser')throw new AppError('이 판매처의 추가 인증은 별도 로그인 창에서 진행해주세요.');const p={api,identity:JSON.stringify(meta(c)),expires:Date.now()+5*60000,stage:'browser'};pending.set(c.id,p);return publicPending(p);}
  const verified=identity(c,result);if(!c.identityId||browser&&verified.identitySource!=='server'){const p={api,identity:JSON.stringify(meta(c)),expires:Date.now()+5*60000,stage:'confirm',result:verified};pending.set(c.id,p);return publicPending(p);}
  await persist(c,api);pending.delete(c.id);store.saveConnection({id:c.id,sessionImportedAt:new Date().toISOString()});return {ok:true,summary:{message:'판매처 로그인과 저장된 상점을 확인했습니다.'}};
 }
 function clear(id){pending.get(id)?.api.cancel?.();pending.delete(id);}
 return {
  status(id){const c=connection(id);check(c);const p=pending.get(id);if(p&&(p.expires<=Date.now()||p.identity!==JSON.stringify(meta(c))))clear(id);return pending.has(id)?publicPending(pending.get(id)):{ok:Boolean(c.identityId&&vault.has(credentialKey(c))&&['인증 확인됨','수집 완료'].includes(c.state)),pending:false};},
  cancel(id){const c=connection(id);check(c);epoch.set(id,(epoch.get(id)||0)+1);clear(id);active.get(id)?.cancel?.();native.get(id)?.abort();return {ok:true,cancelled:true};},
  clear,
  dispose(){for(const c of store.connections())if(c.mode==='seller')epoch.set(c.id,(epoch.get(c.id)||0)+1);for(const id of pending.keys())clear(id);for(const api of active.values())api.cancel?.();for(const ctl of native.values())ctl.abort();},
  login:(id,data={})=>execute(id,'판매처 로그인',async c=>{
   check(c);const step=data.step??'start';if(step==='confirm'){const p=pending.get(id);if(!p||p.stage!=='confirm'||p.expires<=Date.now()||p.identity!==JSON.stringify(meta(c))||data.confirmed!==true||data.identityId!==p.result.identityId){clear(id);throw new AppError('판매처 로그인 확인 요청이 만료·변경됐습니다. 다시 로그인해주세요.',409);}pending.delete(id);active.set(id,p.api);try{const verified=identity(c,await p.api.verifyIdentity());if(verified.identityId!==p.result.identityId)throw new AppError('로그인한 판매처 상점이 변경됐습니다.',409);await persist(c,p.api);store.saveConnection({id,identityId:verified.identityId,identityLabel:verified.identityLabel,identitySource:verified.identitySource,sessionImportedAt:new Date().toISOString()});Object.assign(c,{identityId:verified.identityId,identityLabel:verified.identityLabel,identitySource:verified.identitySource});return {ok:true,summary:{message:'선택한 판매처 상점으로 연결했습니다.'}};}finally{active.delete(id);}}
   if(!['start','native'].includes(step))throw new AppError('지원하는 판매처 로그인 단계가 아닙니다.');clear(id);const secret=await credentials(c);let api;
   try{if(step==='native'){if(c.providerId==='kakaoapi')throw new AppError('이 연결은 직접 발급한 카카오 API 키로 인증해주세요.');const ctl=new AbortController();native.set(id,ctl);const result=await nativeLogin({providerId:c.providerId,...meta(c),password:'',signal:ctl.signal});assertCurrent(c);api=make(c,{cookies:result.cookies,sessionData:result.sessionData});active.set(id,api);return await complete(c,api,await api.verifyIdentity(),{browser:true});}api=make(c,fresh(c,secret));active.set(id,api);return await complete(c,api,await api.login());}finally{native.delete(id);active.delete(id);}
  }),
  async call(c,method,args){check(c);if(!c.identityId)throw new AppError('판매처 로그인과 상점 확인을 먼저 완료해주세요.',401);let api=make(c,await credentials(c));active.set(c.id,api);const run=async()=>{identity(c,await api.verifyIdentity());const result=await api[method](args);identity(c,await api.verifyIdentity());return result;};try{let result;try{result=await run();}catch(e){if(e.code!=='SESSION_REQUIRED')throw e;api.cancel?.();const secret=await credentials(c);api=make(c,fresh(c,secret));active.set(c.id,api);const login=await complete(c,api,await api.login());if(login.pending)throw new AppError('판매처 추가 인증이 필요합니다. 로그인 버튼에서 이어서 진행해주세요.',401);result=await run();}assertCurrent(c);await persist(c,api);return result;}finally{active.delete(c.id);}}
 };
}
