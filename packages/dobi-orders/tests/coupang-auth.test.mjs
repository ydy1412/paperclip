import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoupangSession,validateCoupangCookies,CoupangAuthError} from '../src/integrations/coupang-auth.mjs';

const WING='https://wing.coupang.com',XAUTH='https://xauth.coupang.com';
const INITIAL=XAUTH+'/auth/realms/seller/protocol/openid-connect/auth?client_id=wing';
const ACTION='/auth/realms/seller/login-actions/authenticate?session_code=synthetic-code&execution=e1&client_id=wing&tab_id=t1';
const METHOD='/auth/realms/seller/login-actions/required-action?execution=mfa-method&tab_id=t1';
const CODE='/auth/realms/seller/login-actions/required-action?execution=mfa-code&tab_id=t1';
const BELL='/winglayout/bell/notification/find',MANAGEMENT='/tenants/sfl-portal/delivery/management';
const PRIVATE='synthetic-private-never-reflect';
const NOW=Date.parse('2026-10-16T03:00:00Z');
const credential={sellerId:'synthetic-wing+도비',password:'synthetic-password +&=한글'};
const cookie=(change={})=>({name:'XSRF-TOKEN',value:'synthetic-xsrf',domain:'wing.coupang.com',hostOnly:true,path:'/',secure:true,httpOnly:false,...change});
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
const passwordForm=(action=ACTION)=>`<form method="post" id="kc-form-login" action="${escape(action)}"><input name="username"><input name="password"></form>`;
const methodForm=(value='synthetic-mobile+token&destination=masked')=>`<form action="${escape(METHOD)}" id="mfa-method-form"><input id="btnSms" value="${escape(value)}"><div><input id="btnEmail" value="synthetic-email"></div></form>`;
const codeForm=()=>`<form id="mfa-form" action="${escape(CODE)}"><input name="code"></form>`;
function response(body='',{status=200,cookies=[],headers={},combinedCookies=false}={}){
  const h=new Headers(headers);for(const c of cookies)h.append('Set-Cookie',c);
  const r=new Response([204,205,304].includes(status)?null:body,{status,headers:h});
  if(combinedCookies)Object.defineProperty(r.headers,'getSetCookie',{value:undefined});return r;
}
const redirect=(location,cookies=[])=>response('',{status:302,cookies,headers:{Location:location}});
function harness(handler,{credentials={},clock=()=>NOW}={}){
  const calls=[];
  const session=createCoupangSession({credentials:{...credential,...credentials},resolveHost:false,now:()=>new Date(clock()),fetchImpl:async(url,init)=>{
    const u=new URL(url),call={url:u,init,body:init.body===undefined?undefined:Object.fromEntries(new URLSearchParams(init.body))};calls.push(call);return handler(call,calls);
  }});return {session,calls};
}
function identityRoutes({bell='{"status":"OK"}',html="<script>var account={vendorId: 'SYNTHETIC_A1'};</script>",cookies=[]}={}){
  return ({url})=>url.pathname===BELL?response(bell,{cookies}):url.pathname===MANAGEMENT?response(html):assert.fail('Unexpected synthetic identity path');
}
const noLeak=e=>{assert.ok(e instanceof CoupangAuthError);assert.ok(!e.message.includes(PRIVATE));return true;};
const rejectsCode=(promise,code)=>assert.rejects(promise,e=>{noLeak(e);assert.equal(e.code,code);return true;});

test('서버가 준 동적 action의 엔티티·상대 URL과 ID/PW 인코딩을 유지합니다',async()=>{
  const authCookies=['XAUTH_SESSION=synthetic-auth; Path=/auth/; Secure; HttpOnly'];
  const h=harness((c,calls)=>{
    if(calls.length===1){assert.equal(c.url.href,WING+'/');return redirect(INITIAL);}
    if(calls.length===2){assert.equal(c.url.href,INITIAL);return response(passwordForm(),{cookies:authCookies});}
    if(calls.length===3){assert.equal(c.url.href,XAUTH+ACTION);assert.equal(c.init.method,'POST');assert.deepEqual(c.body,{username:credential.sellerId,password:credential.password});assert.match(c.init.headers['Content-Type'],/^application\/x-www-form-urlencoded/);assert.equal(c.init.headers.Origin,XAUTH);assert.match(c.init.headers.Cookie,/XAUTH_SESSION=synthetic-auth/);return redirect(WING+'/welcome',['XSRF-TOKEN=rotated%2Bcsrf; Domain=.coupang.com; Path=/; Secure; HttpOnly']);}
    if(c.url.pathname==='/welcome'){assert.equal(c.init.method,'GET');assert.equal(c.init.body,undefined);assert.doesNotMatch(c.init.headers.Cookie,/XAUTH_SESSION/);return response('<main>정상 로그인 후 화면</main>');}
    return identityRoutes()(c);
  });
  const result=await h.session.login();assert.deepEqual(result,{ok:true,vendorId:'SYNTHETIC_A1',sellerId:credential.sellerId});
  assert.equal(h.calls.length,6);const saved=JSON.parse(h.session.getSessionCookies());assert.equal(saved.find(c=>c.name==='XSRF-TOKEN').value,'rotated%2Bcsrf');assert.equal(saved.some(c=>c.name==='XAUTH_SESSION'),false);
  assert.ok(!JSON.stringify(result).includes(credential.password));
});

test('로그인 form의 속성 순서·단일 따옴표와 경로 상대 action을 HTML로 해석합니다',async()=>{
  const h=harness((c,calls)=>{
    if(calls.length===1)return redirect(XAUTH+'/auth/realms/seller/login-actions/entry');
    if(calls.length===2)return response(`<script>const fake='<form id="kc-form-login" action="https://evil.example">';</script><form action='authenticate?execution=e2&amp;session_code=synthetic' method='post'><input name='username'></form>`);
    if(c.init.method==='POST'){assert.equal(c.url.href,XAUTH+'/auth/realms/seller/login-actions/authenticate?execution=e2&session_code=synthetic');return response('complete');}
    return identityRoutes()(c);
  });assert.equal((await h.session.login()).ok,true);
});

test('정상 추가 인증의 wire 키를 따르고 서버의 목적지 값·action을 공개하지 않습니다',async()=>{
  const mobile='synthetic-mobile+token&destination=masked';let posts=0;
  const h=harness((c,calls)=>{
    if(calls.length===1)return redirect(INITIAL);
    if(calls.length===2)return response(passwordForm());
    if(c.init.method==='POST'){
      if(++posts===1)return response(methodForm(mobile));
      if(posts===2){assert.equal(c.url.href,XAUTH+METHOD);assert.deepEqual(c.body,{mfaType:mobile});return redirect(XAUTH+'/auth/realms/seller/login-actions/code-page');}
      assert.equal(c.url.href,XAUTH+CODE);assert.deepEqual(c.body,{code:'123 456',realActionType:'Submit',actionType:'확인'});return redirect(WING+'/welcome');
    }
    if(c.url.pathname.endsWith('/code-page'))return response(codeForm());if(c.url.pathname==='/welcome')return response('done');return identityRoutes()(c);
  });
  const method=await h.session.login();assert.equal(method.stage,'method');assert.deepEqual(method.methods,[{id:'mobile',label:'휴대폰 인증'},{id:'email',label:'이메일 인증'}]);assert.equal(method.pending,true);assert.ok(!JSON.stringify(method).includes(mobile));assert.ok(!JSON.stringify(method).includes('session_code'));
  const code=await h.session.continueLogin({method:'mobile'});assert.equal(code.stage,'code');assert.deepEqual(code.methods,[]);
  const done=await h.session.continueLogin({code:' 123 456 '});assert.equal(done.vendorId,'SYNTHETIC_A1');assert.equal(posts,3);
});

test('이메일 인증도 선택한 서버 input value만 mfaType으로 전송합니다',async()=>{
  let posts=0;const h=harness((c,calls)=>{if(calls.length===1)return redirect(INITIAL);if(calls.length===2)return response(methodForm());if(c.init.method==='POST'){posts++;assert.deepEqual(c.body,{mfaType:'synthetic-email'});return response(codeForm());}assert.fail('Unexpected synthetic route');});
  await h.session.login();assert.equal((await h.session.continueLogin({method:'email'})).stage,'code');assert.equal(posts,1);
});

test('추가 인증 만료·취소·동시 재사용과 잘못된 입력은 요청 전에 차단합니다',async()=>{
  let now=NOW;
  // Use an xauth page as the source so the relative required-action remains trusted.
  const make=()=>harness((c,calls)=>calls.length===1?redirect(INITIAL):response(codeForm()),{clock:()=>now});
  const expired=make();await expired.session.login();now+=5*60000;await rejectsCode(expired.session.continueLogin({code:'123456'}),'CHALLENGE_EXPIRED');assert.equal(expired.calls.length,2);
  now=NOW;const cancelled=make();await cancelled.session.login();cancelled.session.cancel();await rejectsCode(cancelled.session.continueLogin({code:'123456'}),'CHALLENGE_EXPIRED');assert.equal(cancelled.calls.length,2);
  for(const input of [{code:''},{code:'   '},{code:'x'.repeat(33)},{code:'123\r\n'+PRIVATE},{method:'sms'}]){const current=make();await current.session.login();await assert.rejects(current.session.continueLogin(input),noLeak);assert.equal(current.calls.length,2);}
  const reuse=make();await reuse.session.login();const first=reuse.session.continueLogin({code:'123456'}),second=reuse.session.continueLogin({code:'123456'});await rejectsCode(second,'CHALLENGE_EXPIRED');await first;assert.equal(reuse.calls.length,3);
});

test('비밀번호 form이 반복되거나 MFA 선택지가 없으면 브라우저 인증으로 안내합니다',async()=>{
  const repeated=harness((c,calls)=>calls.length===1?redirect(INITIAL):response(passwordForm()));await rejectsCode(repeated.session.login(),'BROWSER_REQUIRED');assert.equal(repeated.calls.length,3);
  const missing=harness((c,calls)=>calls.length===1?redirect(INITIAL):response(`<form id="mfa-method-form" action="${escape(METHOD)}"></form>`));await rejectsCode(missing.session.login(),'BROWSER_REQUIRED');assert.equal(missing.calls.length,2);
});

test('바뀐 로그인 action·외부 도메인·비HTTPS·userinfo·포트·fragment를 POST하지 않습니다',async()=>{
  for(const action of ['https://evil.example/'+PRIVATE,XAUTH+'/auth/realms/seller/login-actions/not-login',XAUTH+'/auth/realms/seller/other',WING+ACTION,'http://xauth.coupang.com'+ACTION,'https://user:'+PRIVATE+'@xauth.coupang.com'+ACTION,'https://xauth.coupang.com:8443'+ACTION,XAUTH+ACTION+'#'+PRIVATE]){
    const h=harness((c,calls)=>calls.length===1?redirect(INITIAL):response(passwordForm(action)));await assert.rejects(h.session.login(),noLeak);assert.equal(h.calls.length,2);assert.equal(h.calls.some(c=>c.init.method==='POST'),false);
  }
});

test('로그인 리다이렉트의 외부·비HTTPS 이동과 반복·한도를 요청 전에 차단합니다',async()=>{
  for(const location of ['https://evil.example/'+PRIVATE,'https://wing.coupang.com.evil.example/'+PRIVATE,'http://wing.coupang.com/'+PRIVATE,'https://'+PRIVATE+'@wing.coupang.com/']){const h=harness(()=>redirect(location));await rejectsCode(h.session.login(),'INVALID_ENDPOINT');assert.equal(h.calls.length,1);}
  const loop=harness(()=>redirect(WING+'/'));await rejectsCode(loop.session.login(),'BROWSER_REQUIRED');assert.equal(loop.calls.length,1);
  const limit=harness((c,calls)=>redirect(WING+'/hop/'+calls.length));await rejectsCode(limit.session.login(),'BROWSER_REQUIRED');assert.equal(limit.calls.length,13);
});

test('전달용 세션 요청은 타 도메인·GET 본문·임의 POST·리다이렉트를 허용하지 않습니다',async()=>{
  const h=harness(()=>response('OK'),{credentials:{cookies:JSON.stringify([cookie()])}});
  for(const [url,init]of [[XAUTH+'/',{}],[WING+'/anything',{method:'PUT'}],[WING+'/anything',{method:'GET',body:'{}'}],[WING+'/anything',{method:'POST',body:'{}'}],['https://evil.example/',{}]])await assert.rejects(h.session.request(url,init),noLeak);
  assert.equal(h.calls.length,0);const redirected=harness(()=>redirect(XAUTH+ACTION));await rejectsCode(redirected.session.request(WING+'/orders'),'SESSION_REQUIRED');assert.equal(redirected.calls.length,1);
});

test('401·403·HTTP 오류·위장된 자동 리다이렉트·위치 없는 이동을 성공 처리하지 않습니다',async()=>{
  for(const status of [401,403,429,500]){const h=harness(()=>response(PRIVATE,{status}));await assert.rejects(h.session.verifyIdentity(),e=>{noLeak(e);assert.equal(e.code,[401,403].includes(status)?'SESSION_REQUIRED':'HTTP_ERROR');return true;});assert.equal(h.calls.length,1);}
  const already=harness(()=>{const r=response('OK');Object.defineProperty(r,'redirected',{value:true});return r;});await rejectsCode(already.session.verifyIdentity(),'INVALID_RESPONSE');
  const missing=harness(()=>response('',{status:302}));await rejectsCode(missing.session.login(),'INVALID_RESPONSE');
  const network=harness(()=>{throw Error(PRIVATE);});await rejectsCode(network.session.login(),'NETWORK_ERROR');
});

test('Bell의 로그인 HTML·누락·유사 문자열은 판매자 조회 전에 실패합니다',async()=>{
  for(const bell of ['<!doctype html><title>OK</title>',PRIVATE,'BROKEN','{"status":"NOT_OK"}','{"status":"OKAY"}','{"ok":false}']){const h=harness(identityRoutes({bell}));await rejectsCode(h.session.verifyIdentity(),'SESSION_REQUIRED');assert.equal(h.calls.length,1);}
});

test('판매자코드 누락·서로 다른 다중 값·기존 VendorId 불일치는 비밀을 노출하지 않습니다',async()=>{
  for(const html of ['<main>'+PRIVATE+'</main>',"<script>vendorId:'SYNTHETIC_A1';vendorId:'SYNTHETIC_A2';</script>"]){const h=harness(identityRoutes({html}));await rejectsCode(h.session.verifyIdentity(),'INVALID_IDENTITY');}
  const mismatch=harness(identityRoutes({html:`<script>vendorId:'${PRIVATE}';</script>`}),{credentials:{vendorId:'SYNTHETIC_STORED'}});await rejectsCode(mismatch.session.verifyIdentity(),'ACCOUNT_MISMATCH');
  const valid=harness(identityRoutes({html:"<script>vendorId:'SYNTHETIC_A1';vendorId:'SYNTHETIC_A1';</script>"}),{credentials:{vendorId:'SYNTHETIC_A1'}});assert.deepEqual(await valid.session.verifyIdentity(),{ok:true,vendorId:'SYNTHETIC_A1',sellerId:credential.sellerId});
});

test('입력 쿠키의 RFC 문법·hostOnly·보안 접두어·중복·partition·저장소를 검증합니다',()=>{
  for(const change of [{domain:'evil.example'},{domain:'www.coupang.com'},{domain:'xauth.coupang.com'},{domain:'coupang.com',hostOnly:true},{domain:'sub.wing.coupang.com'},{hostOnly:undefined},{secure:undefined},{name:'bad name'},{name:'n'.repeat(257)},{name:'__Secure-secret',secure:false},{name:'__Host-secret',hostOnly:false},{name:'__Host-secret',path:'/api'},{value:PRIVATE+';x=1'},{value:PRIVATE+'\r\n'},{value:'"quoted"'},{value:'한글'},{path:'api'},{path:'/api;cookie'},{expirationDate:'1'},{httpOnly:'true'},{partitionKey:{}},{partitioned:true},{sameSite:'None'},{storeId:PRIVATE+'\n'}])assert.throws(()=>validateCoupangCookies([cookie(change)],()=>new Date(NOW)),noLeak);
  assert.throws(()=>validateCoupangCookies([cookie(),cookie()],()=>new Date(NOW)),noLeak);
  assert.throws(()=>validateCoupangCookies([cookie({storeId:'0'}),cookie({name:'OTHER',storeId:'1'})],()=>new Date(NOW)),noLeak);
  const out=validateCoupangCookies([cookie({domain:'.coupang.com',hostOnly:false,sameSite:'no_restriction',storeId:'0'})],()=>new Date(NOW));assert.equal(out[0].domain,'.coupang.com');assert.equal(out[0].session,true);
});

test('200개와 30,000자 입력 한도를 정확히 적용하고 만료 쿠키를 제거합니다',()=>{
  const many=Array.from({length:200},(_,i)=>cookie({name:'C'+i,value:'v'}));assert.equal(validateCoupangCookies(many,()=>new Date(NOW)).length,200);assert.throws(()=>validateCoupangCookies([...many,cookie({name:'EXTRA'})],()=>new Date(NOW)),noLeak);
  const base=[cookie({value:''})],available=30000-JSON.stringify(base).length,exact=JSON.stringify([cookie({value:'s'.repeat(available)})]);assert.equal(exact.length,30000);assert.equal(validateCoupangCookies(exact,()=>new Date(NOW)).length,1);assert.throws(()=>validateCoupangCookies(exact.replace('s','ss'),()=>new Date(NOW)),noLeak);
  const live=validateCoupangCookies([cookie(),cookie({name:'PAST',expirationDate:NOW/1000})],()=>new Date(NOW));assert.equal(live.length,1);assert.throws(()=>validateCoupangCookies([cookie({expirationDate:NOW/1000})],()=>new Date(NOW)),e=>e.code==='SESSION_REQUIRED');
});

test('Cookie 헤더는 hostOnly·Domain·Path 경계와 긴 경로 우선순위를 유지합니다',async()=>{
  const input=[cookie({name:'ROOT',value:'root'}),cookie({name:'PARENT',value:'parent',domain:'.coupang.com',hostOnly:false}),cookie({name:'API',value:'api',path:'/api'}),cookie({name:'API_DEEP',value:'deep',path:'/api/order'})];
  const h=harness((c,calls)=>{if(calls.length===1){assert.equal(c.init.headers.Cookie,'API_DEEP=deep; API=api; ROOT=root; PARENT=parent');return response('ok');}assert.equal(c.init.headers.Cookie,'ROOT=root; PARENT=parent');return response('ok');},{credentials:{cookies:JSON.stringify(input)}});
  await h.session.request(WING+'/api/order/1');await h.session.request(WING+'/apix');
});

test('xauth 쿠키는 Wing에 보내지 않고 부모 Domain 쿠키만 두 호스트에서 사용합니다',async()=>{
  const h=harness((c,calls)=>{
    if(calls.length===1){assert.match(c.init.headers.Cookie,/WING_ONLY/);return redirect(INITIAL);}
    if(calls.length===2){assert.doesNotMatch(c.init.headers.Cookie,/WING_ONLY/);assert.match(c.init.headers.Cookie,/PARENT/);return response(passwordForm(),{cookies:['AUTH_ONLY=synthetic; Path=/; Secure']});}
    if(c.init.method==='POST'){assert.match(c.init.headers.Cookie,/AUTH_ONLY/);return redirect(WING+'/welcome');}
    assert.doesNotMatch(c.init.headers.Cookie,/AUTH_ONLY/);return c.url.pathname==='/welcome'?response('done'):identityRoutes()(c);
  },{credentials:{cookies:JSON.stringify([cookie({name:'WING_ONLY'}),cookie({name:'PARENT',domain:'.coupang.com',hostOnly:false})])}});
  await h.session.login();
});

test('Set-Cookie 회전·삭제·Expires의 쉼표·Max-Age 우선·기본 Path를 적용합니다',async()=>{
  let now=NOW;const h=harness((c,calls)=>{
    if(calls.length===1)return response('ok',{combinedCookies:true,cookies:['XSRF-TOKEN=rotated; Path=/; Secure; HttpOnly','DROP=gone; Path=/; Secure','DROP=; Path=/; Max-Age=0','PAST=old; Path=/; Expires=Thu, 15 Oct 2026 03:00:00 GMT','LIFE=active; Path=/; Expires=Thu, 15 Oct 2026 03:00:00 GMT; Max-Age=1','DEFAULT=path; Secure','FORGED='+PRIVATE+'; Domain=evil.example; Path=/','WRONG_HOST='+PRIVATE+'; Domain=xauth.coupang.com; Path=/']});
    assert.match(c.init.headers.Cookie,/XSRF-TOKEN=rotated/);assert.doesNotMatch(c.init.headers.Cookie,/DROP|PAST|LIFE|FORGED|WRONG_HOST/);if(c.url.pathname==='/orders/next')assert.match(c.init.headers.Cookie,/DEFAULT=path/);else assert.doesNotMatch(c.init.headers.Cookie,/DEFAULT/);return response('ok');
  },{credentials:{cookies:JSON.stringify([cookie({storeId:'0'})])},clock:()=>now});
  await h.session.request(WING+'/orders/list');let saved=JSON.parse(h.session.getSessionCookies());assert.equal(saved.find(c=>c.name==='XSRF-TOKEN').storeId,'0');assert.equal(saved.find(c=>c.name==='DEFAULT').path,'/orders');assert.ok(saved.some(c=>c.name==='LIFE'));
  now+=1000;await h.session.request(WING+'/orders/next');await h.session.request(WING+'/orders-other');saved=JSON.parse(h.session.getSessionCookies());assert.equal(saved.some(c=>['LIFE','DROP','PAST','FORGED','WRONG_HOST'].includes(c.name)),false);
});

test('잘못된 응답 쿠키·보안 접두어와 파티션 쿠키를 저장하지 않습니다',async()=>{
  for(const line of ['broken-cookie','BAD='+PRIVATE+'\r\nX-Synthetic: invalid','__Host-BAD=v; Domain=wing.coupang.com; Secure; Path=/','__Secure-BAD=v; Path=/','BAD="quoted"; Path=/','BAD=v; Max-Age=9999999999999999999999999999999']){const h=harness(()=>response('ok',{cookies:[line]}));await assert.rejects(h.session.request(WING+'/api/orders'),noLeak);assert.equal(JSON.parse(h.session.getSessionCookies()).length,0);}
  const partition=harness(()=>response('ok',{cookies:['PARTITIONED=v; Secure; Path=/; Partitioned']}));await partition.session.request(WING+'/api/orders');assert.equal(JSON.parse(partition.session.getSessionCookies()).length,0);
});

test('POST 조회는 현재 경로에 적용되는 XSRF 쿠키를 디코딩한 헤더로 전송합니다',async()=>{
  const h=harness(c=>{assert.equal(c.init.headers['X-XSRF-TOKEN'],'synthetic+csrf/=');assert.equal(c.init.headers.Origin,WING);assert.equal(c.init.headers['Content-Type'],c.url.pathname.startsWith('/fcc/')?'application/x-www-form-urlencoded; charset=UTF-8':'application/json');return response('{}');},{credentials:{cookies:JSON.stringify([cookie({value:'synthetic%2Bcsrf%2F%3D'})])}});
  await h.session.request(WING+'/fcc/download-manager/request-auto-download',{method:'POST',body:'type=WING_DELIVERY'});await h.session.request(WING+'/tenants/sfl-portal/exchange/search',{method:'POST',body:'{}'});
  for(const c of [undefined,cookie({path:'/other'}),cookie({value:'bad%'}),cookie({value:'bad%0D%0A'+PRIVATE})]){const current=harness(()=>assert.fail('CSRF failure must precede network'),{credentials:{cookies:c?JSON.stringify([c]):undefined}});await assert.rejects(current.session.request(WING+'/fcc/download-manager/request-auto-download',{method:'POST',body:'{}'}),noLeak);assert.equal(current.calls.length,0);}
});

test('응답 크기 한도와 원문 응답·비밀번호가 오류나 정상 결과에 반영되지 않습니다',async()=>{
  const big=harness(()=>response('x'.repeat(12*1024*1024+1)));await rejectsCode(big.session.request(WING+'/api/orders'),'RESPONSE_LIMIT');
  const html=harness(identityRoutes({bell:'<html>'+PRIVATE+'</html>'}));await assert.rejects(html.session.verifyIdentity(),noLeak);
});

// Regression cases below must also leave a usable, bounded jar after failure.
test('응답 쿠키 개수 한도를 넘는 실패 뒤에도 저장 가능한 200개 상태를 유지합니다',async()=>{
  const input=Array.from({length:200},(_,i)=>cookie({name:'C'+i,value:'v'}));const h=harness(()=>response('ok',{cookies:['EXTRA=v; Secure; Path=/']}),{credentials:{cookies:JSON.stringify(input)}});
  await rejectsCode(h.session.request(WING+'/api/orders'),'INVALID_COOKIES');const saved=h.session.getSessionCookies();assert.equal(validateCoupangCookies(saved,()=>new Date(NOW)).length,200);assert.equal(JSON.parse(saved).some(c=>c.name==='EXTRA'),false);
});

test('응답 쿠키 문자 한도를 넘는 실패 뒤에도 이전 쿠키를 안전하게 직렬화합니다',async()=>{
  const h=harness(()=>response('ok',{cookies:['EXTRA='+'v'.repeat(29850)+'; Path=/; Secure']}),{credentials:{cookies:JSON.stringify([cookie()])}});
  await rejectsCode(h.session.request(WING+'/api/orders'),'INVALID_COOKIES');const saved=h.session.getSessionCookies();assert.ok(saved.length<=30000);assert.equal(validateCoupangCookies(saved,()=>new Date(NOW)).length,1);
});

test('응답 스트림 읽기 실패도 원문 예외 내용을 공개하지 않습니다',async()=>{
  const session=createCoupangSession({resolveHost:false,now:()=>new Date(NOW),fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.error(new Error(PRIVATE));}}))});
  await assert.rejects(session.request(WING+'/api/orders'),noLeak);
});

test('Bell이 명시적으로 NOT OK를 반환하면 계정 확인을 성공시키지 않습니다',async()=>{
  const h=harness(identityRoutes({bell:'{"status":"NOT OK"}'}));await rejectsCode(h.session.verifyIdentity(),'SESSION_REQUIRED');assert.equal(h.calls.length,1);
});

test('응답 Set-Cookie 묶음에 실패가 있으면 회전·추가·삭제를 모두 되돌립니다',async()=>{
  const original=JSON.stringify([cookie(),cookie({name:'KEEP',value:'keep'})]);
  const h=harness(()=>response('ok',{cookies:['XSRF-TOKEN=rotated; Secure; Path=/','ADDED=new; Secure; Path=/','KEEP=; Path=/; Max-Age=0','BAD="quoted"; Path=/']}),{credentials:{cookies:original}});
  const before=h.session.getSessionCookies();await rejectsCode(h.session.request(WING+'/api/orders'),'INVALID_COOKIES');assert.equal(h.session.getSessionCookies(),before);
  const cookies=JSON.parse(before);assert.equal(cookies.find(c=>c.name==='XSRF-TOKEN').value,'synthetic-xsrf');assert.equal(cookies.find(c=>c.name==='KEEP').value,'keep');
});

test('Bell은 명시적 성공 값만 허용하고 부정·불명·충돌하는 JSON은 거부합니다',async()=>{
  for(const bell of ['OK','  OK\n','"OK"','{"status":"OK"}','{"result":"SUCCESS"}','{"code":"OK"}','{"status":"OK","result":"SUCCESS","error":null}']){const h=harness(identityRoutes({bell}));assert.equal((await h.session.verifyIdentity()).ok,true);}
  for(const bell of ['NOT OK','["OK"]','true','{"message":"OK"}','{"status":200}','{"status":"OK","result":"NOT OK"}','{"status":"OK","success":false}','{"status":"OK","error":"'+PRIVATE+'"}']){const h=harness(identityRoutes({bell}));await rejectsCode(h.session.verifyIdentity(),'SESSION_REQUIRED');assert.equal(h.calls.length,1);}
});
