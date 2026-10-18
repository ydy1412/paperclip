import test from 'node:test';
import assert from 'node:assert/strict';
import {createSellerSession,validateSellerCookies} from '../src/integrations/seller-session.mjs';
import {sellerPolicy,sellerHost} from '../src/integrations/seller-policy.mjs';
const c=(name='session',value='synthetic-secret')=>({name,value,domain:'.naver.com',path:'/',hostOnly:false,secure:true,httpOnly:true});
const base={providerId:'smartstore',resolveHost:false,credentials:{cookies:JSON.stringify([c()])}};
test('네이티브 브라우저 User-Agent를 세션에서 복원하고 헤더 오염을 거부한다',async()=>{const seen=[],saved=JSON.stringify({userAgent:'SYNTHETIC_WEBVIEW/155'}),session=createSellerSession({...base,credentials:{...base.credentials,sessionData:saved},fetchImpl:async(url,init)=>{seen.push(init.headers['User-Agent']);return new Response('{}');}});await session.request('https://sell.smartstore.naver.com/');assert.deepEqual(seen,['SYNTHETIC_WEBVIEW/155']);for(const userAgent of ['bad\r\nInjected: yes','x'.repeat(1025),12])assert.throws(()=>createSellerSession({...base,credentials:{...base.credentials,sessionData:JSON.stringify({userAgent})}}),{code:'INVALID_SESSION'});});
test('판매처별 HTTPS 호스트와 상점 도메인을 분리하고 다른 공급자/사설 주소를 거부한다',async()=>{
 for(const value of ['127.0.0.1','localhost','x.local','http://public.example','https://user:pw@example.com','https://example.com/path','https://example.com:8443'])assert.throws(()=>sellerHost(value));
 assert.equal(sellerPolicy('cafe24',{sellerId:'my-mall'}).allowsHost('my-mall.cafe24.com'),true);assert.equal(sellerPolicy('imweb',{host:'shop.example.com'}).allowsHost('shop.example.com'),true);assert.equal(sellerPolicy('imweb',{host:'shop.example.com'}).allowsHost('other.example.com'),false);
 const session=createSellerSession({...base,fetchImpl:()=>{throw Error('must not request');}});for(const url of ['https://evil.test/','http://sell.smartstore.naver.com/','https://sell.smartstore.naver.com.evil.test/','https://sell.smartstore.naver.com/#hash'])await assert.rejects(session.request(url),{code:'INVALID_ENDPOINT'});
});
test('로그인 쿠키 경로/도메인, custom 인증 헤더 및 서버 응답 헤더를 보존한다',async()=>{
 const calls=[],session=createSellerSession({...base,fetchImpl:async(url,init)=>{calls.push({url,init});return new Response('{}',{headers:{user:'synthetic-user','X-NCP-LOGIN-INFO':'synthetic-meta','Set-Cookie':'next=rotated; Domain=.naver.com; Path=/; Secure; HttpOnly'}});}});
 const response=await session.request('https://sell.smartstore.naver.com/api/login/init',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json;charset=UTF-8'},body:'{}'});
 assert.equal(response.headers.get('user'),'synthetic-user');assert.equal(response.headers.get('X-NCP-LOGIN-INFO'),'synthetic-meta');assert.equal(calls[0].init.headers.Authorization,'Bearer synthetic');assert.equal(calls[0].init.headers.Cookie,'session=synthetic-secret');assert.ok(JSON.parse(session.getSessionCookies()).some(c=>c.value==='rotated'));
 await assert.rejects(session.request('https://sell.smartstore.naver.com/',{headers:{Cookie:'injected'}}),{code:'INVALID_REQUEST'});
});
test('응답 쿠키 batch 초과/잘못된 prefix 실패는 기존 유효 쿠키 전체를 유지한다',async()=>{
 for(const bad of ['__Host-bad=x; Domain=.naver.com; Path=/; Secure','extra=x; Domain=.naver.com; Path=/; Secure']){
  const initial=bad.startsWith('extra')?Array.from({length:200},(_,i)=>c('s'+i,'x')):[c()];const headers=new Headers();headers.append('Set-Cookie','session=rotated; Domain=.naver.com; Path=/; Secure');headers.append('Set-Cookie',bad);
  const session=createSellerSession({...base,credentials:{cookies:JSON.stringify(initial)},fetchImpl:async()=>new Response('{}',{headers})}),before=session.getSessionCookies();await assert.rejects(session.request('https://sell.smartstore.naver.com/'),{code:'INVALID_COOKIES'});assert.equal(session.getSessionCookies(),before);
 }
});
test('도메인 위조 Set-Cookie를 무시하고 요청마다 해당 도메인 쿠키만 보낸다',async()=>{
 const sent=[],session=createSellerSession({...base,fetchImpl:async(url,init)=>{sent.push(init.headers.Cookie);return new Response('{}',{headers:{'Set-Cookie':'foreign=secret; Domain=.kakao.com; Path=/; Secure'}});}});await session.request('https://sell.smartstore.naver.com/');await session.request('https://accounts.commerce.naver.com/');assert.deepEqual(sent,['session=synthetic-secret','session=synthetic-secret']);assert.equal(JSON.parse(session.getSessionCookies()).length,1);
 assert.throws(()=>validateSellerCookies([c('s','x'),c('s','x')],base),{code:'INVALID_COOKIES'});assert.throws(()=>validateSellerCookies([{...c(),partitionKey:{topLevelSite:'https://naver.com'}}],base),{code:'INVALID_COOKIES'});
});
test('redirect는 명시 요청에서만 따르며 origin 전환 시 인증 헤더를 전달하지 않는다',async()=>{
 const sent=[],session=createSellerSession({...base,fetchImpl:async(url,init)=>{sent.push(init.headers);return sent.length===1?new Response(null,{status:302,headers:{Location:'https://accounts.commerce.naver.com/next'}}):new Response('{}');}});const first=await session.request('https://sell.smartstore.naver.com/start',{headers:{Authorization:'Bearer synthetic'}});assert.equal(first.status,302);assert.equal(sent.length,1);
 const calls=[],follow=createSellerSession({...base,fetchImpl:async(url,init)=>{calls.push(init);return calls.length===1?new Response(null,{status:302,headers:{Location:'https://accounts.commerce.naver.com/next'}}):new Response('{}');}});await follow.request('https://sell.smartstore.naver.com/start',{method:'POST',body:'id=synthetic',headers:{Authorization:'Bearer synthetic'},followRedirects:true});assert.equal(calls[1].method,'GET');assert.equal(calls[1].body,undefined);assert.equal(calls[1].headers.Authorization,undefined);
});
test('네트워크/스트림 오류 원문은 반사하지 않고 취소 뒤 후속 요청도 막는다',async()=>{
 for(const fetchImpl of [async()=>{throw Error('PRIVATE-SECRET');},async()=>new Response(new ReadableStream({pull(c){c.error(Error('PRIVATE-SECRET'));}}))]){const session=createSellerSession({...base,fetchImpl});await assert.rejects(session.request('https://sell.smartstore.naver.com/'),e=>!e.message.includes('PRIVATE-SECRET'));}
 const session=createSellerSession({...base,fetchImpl:async()=>new Response('{}')});session.cancel();await assert.rejects(session.request('https://sell.smartstore.naver.com/'),{code:'CANCELLED'});
});
test('만료 쿠키를 저장/전송하지 않고 서버401·403을 재로그인 상태로 돌린다',async()=>{
 for(const status of [401,403]){const session=createSellerSession({...base,credentials:{cookies:JSON.stringify([{...c(),expirationDate:1}])},fetchImpl:async(url,init)=>{assert.equal(init.headers.Cookie,'');return new Response('{}',{status});}});assert.equal(session.getSessionCookies(),'[]');await assert.rejects(session.request('https://sell.smartstore.naver.com/'),{code:'SESSION_REQUIRED'});}
});
