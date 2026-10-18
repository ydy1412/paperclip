import { readFileSync } from 'node:fs';
import {SELLER_PROVIDERS} from './seller-factory.mjs';
export const integrationCatalog=JSON.parse(readFileSync(new URL('./catalog.json',import.meta.url),'utf8'));
for(const p of integrationCatalog.providers)if(SELLER_PROVIDERS().includes(p.id)){
 p.sellerLogin=true;p.loginMethod='판매처 로그인 · 상점 확인 · 세션 수집';p.readiness='원본 로그인·주문 수집 구현 · 실계정 검증 필요';
 p.capabilities={...p.capabilities,collectApi:true};
 if(p.id==='tossmall')p.browserUrl='https://shopping-seller.toss.im';
}
integrationCatalog.counts.sellerLoginClients=SELLER_PROVIDERS().length;
const keyOnly=integrationCatalog.providers.find(p=>p.id==='kakaoapi');
if(keyOnly){keyOnly.apiKeyOnly=true;keyOnly.loginMethod='자체 발급키';keyOnly.readiness='키 전용 · 세션 로그인 미지원';}

// Executable clients determine authentication support; stored catalog labels cannot add a client.
export const sessionLoginMode=id=>id==='coupang'?'wing':id!=='kakaoapi'&&SELLER_PROVIDERS().includes(id)?'seller':null;
export function mergeIntegrationCatalog(stored){
 const defaults=new Map(integrationCatalog.providers.map(p=>[p.id,p]));
 const providers=stored.providers.map(p=>{
  const current=defaults.get(p.id);defaults.delete(p.id);if(!current)return {...p,sellerLogin:false,wingLogin:false};
  const {sellerLogin=false,wingLogin=false}=current;
  return {...p,sellerLogin,wingLogin,apiKeyOnly:p.id==='kakaoapi',loginMethod:current.loginMethod,readiness:current.readiness,capabilities:{...p.capabilities,collectApi:current.capabilities?.collectApi??false}};
 });
 providers.push(...defaults.values());
 return {...stored,providers,counts:{...stored.counts,...integrationCatalog.counts}};
}
