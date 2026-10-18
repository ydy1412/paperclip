import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSellerClient,SELLER_PROVIDERS} from '../src/integrations/seller-factory.mjs';
import {SELLER_POLICY_IDS} from '../src/integrations/seller-policy.mjs';
import {integrationCatalog} from '../src/integrations/catalog.mjs';
test('원본 26개 판매처 타입은 쿠팡 Wing과 25개 실제 전용 클라이언트로 연결된다',()=>{
 assert.deepEqual([...SELLER_PROVIDERS()].sort(),[...SELLER_POLICY_IDS].sort());let calls=0;
 for(const providerId of SELLER_PROVIDERS()){
  const client=createSellerClient({providerId,credentials:{sellerId:'fixture',password:'SYNTHETIC',site:'gmarket',host:providerId==='cafe24'?'fixture.cafe24.com':'admin.example.com',loginType:'center',shopNo:'1',cookies:'[]',sessionData:'{}'},resolveHost:false,fetchImpl:async()=>{calls++;throw Error('No remote request in constructor');}});
  for(const method of ['login','verifyIdentity','testConnection','collectOrders','getSessionCookies','cancel'])assert.equal(typeof client[method],'function',providerId+' '+method);
  assert.equal(integrationCatalog.providers.find(p=>p.id===providerId)?.sellerLogin,true);client.cancel();
 }assert.equal(calls,0);assert.equal(integrationCatalog.counts.sellerLoginClients,25);assert.equal(integrationCatalog.providers.find(p=>p.id==='coupang').wingLogin,true);
});
test('브라우저 ESM 연결은 실제 판매자 목록을 대조하며 다른 판매자와 대소문자를 추정하지 않는다',async()=>{
 const options={providerId:'esm',credentials:{sellerId:'Fixture-Seller',site:'gmarket',cookies:'[]'},resolveHost:false,fetchImpl:async()=>new Response(JSON.stringify({gmk:['Fixture-Seller'],iac:['auction-fixture']}))};
 const client=createSellerClient(options);assert.equal((await client.login()).stage,'browser');assert.equal((await client.verifyIdentity()).identityId,'gmarket:Fixture-Seller');
 for(const sellerId of ['other','fixture-seller'])await assert.rejects(()=>createSellerClient({...options,credentials:{...options.credentials,sellerId}}).verifyIdentity(),e=>e.code==='IDENTITY_MISMATCH');
});
test('네이티브 ESM 연결의 실제 수집 클라이언트는 회전한 쿠키로 후속 계정 확인을 수행한다',async()=>{
 let rotated=false,queries=0;const cookies=JSON.stringify([{name:'ESM_AUTH',value:'SYNTHETIC_FIRST',domain:'.esmplus.com',path:'/',hostOnly:false,secure:true,httpOnly:true,session:true}]);
 const client=createSellerClient({providerId:'esm',credentials:{sellerId:'fixture',site:'gmarket',cookies},resolveHost:false,now:()=>new Date('2026-10-16T00:00:00Z'),fetchImpl:async(url,init)=>{const u=new URL(url);if(u.pathname==='/Home/SellerList'){if(rotated)assert.match(init.headers.Cookie,/ESM_AUTH=SYNTHETIC_ROTATED/);return new Response(JSON.stringify({gmk:['fixture'],iac:[]}));}assert.equal(init.method,'GET');queries++;rotated=true;return new Response(JSON.stringify({data:{list:[]}}),{headers:{'Set-Cookie':'ESM_AUTH=SYNTHETIC_ROTATED; Domain=.esmplus.com; Path=/; Secure; HttpOnly'}});}});
 assert.equal((await client.collectOrders({from:'2026-10-16',to:'2026-10-16'})).complete,true);await client.verifyIdentity();assert.ok(queries>=6);assert.match(client.getSessionCookies(),/SYNTHETIC_ROTATED/);
});
test('잠금 설치된 SheetJS 실행 코드와 라이선스는 검증한 공식 0.20.3 소스 해시와 일치한다',async()=>{
 const evidence=JSON.parse(await readFile(new URL('../docs/SHEETJS-SOURCE.json',import.meta.url),'utf8'));
 for(const file of evidence.verifiedIdentical){const bytes=await readFile(new URL('../node_modules/xlsx/'+file.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.file);}
});
