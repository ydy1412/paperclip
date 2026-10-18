import {createSmartstoreSessionClient} from './smartstore-session.mjs';
import {createCafe24SessionClient} from './cafe24-session.mjs';
import {createMarketSessionClient,MARKET_SESSION_PROVIDERS} from './market-sessions/index.mjs';
import {createSellerSession,SellerSessionError} from './seller-session.mjs';
import {createEsmClient} from './esm.mjs';
export const SELLER_PROVIDERS=()=>['esm','smartstore','cafe24',...MARKET_SESSION_PROVIDERS];
function createEsmLogin(options){
 const {credentials={}}=options,session=options.session??createSellerSession({...options,providerId:'esm'});let collector;
 async function verifyIdentity(){if(collector)await collector.testConnection();else {const response=await session.request('https://www.esmplus.com/Home/SellerList');let data;try{data=await response.json();}catch{throw new SellerSessionError('ESM 로그인과 판매자 목록을 확인해주세요.','SESSION_REQUIRED',401);}const list=data?.[credentials.site==='gmarket'?'gmk':'iac'];if(!Array.isArray(data?.gmk)||!Array.isArray(data?.iac)||[...data.gmk,...data.iac].some(x=>typeof x!=='string')||!list.includes(credentials.sellerId))throw new SellerSessionError('ESM 로그인 계정에 선택한 판매자 ID가 없습니다.','IDENTITY_MISMATCH',401);}return {ok:true,serverAuthenticated:true,identityId:credentials.site+':'+credentials.sellerId,identityLabel:credentials.sellerId,identitySource:'server'};}
 return {login:async()=>({ok:false,pending:true,stage:'browser',summary:{message:'ESM 로그인 창에서 정상 로그인과 추가 인증을 완료해주세요.'}}),verifyIdentity,testConnection:verifyIdentity,
 async collectOrders(range){await verifyIdentity();collector=createEsmClient({...options,credentials:{...credentials,cookies:session.getSessionCookies()}});const result=await collector.collectOrders(range);await verifyIdentity();return result;},
 getSessionCookies:()=>collector?.getSessionCookies()??session.getSessionCookies(),cancel:()=>session.cancel()};
}
export function createSellerClient(options){if(options.providerId==='smartstore')return createSmartstoreSessionClient(options);if(options.providerId==='cafe24')return createCafe24SessionClient(options);if(options.providerId==='esm')return createEsmLogin(options);return createMarketSessionClient(options);}
