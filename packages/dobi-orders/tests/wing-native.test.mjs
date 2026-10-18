import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile,readdir,readFile,rm,rename,symlink,unlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createNativeWingLogin} from '../src/integrations/wing-native.mjs';

const PASSWORD='SYNTHETIC_PASSWORD_DO_NOT_LOG';
const VALUE='SYNTHETIC_COOKIE_DO_NOT_LOG';
const fixtureCookie=()=>({name:'fixture_session',value:VALUE,domain:'.coupang.com',path:'/',hostOnly:false,secure:true,httpOnly:true,session:true});
const frame=(cookies=[fixtureCookie()],change={})=>JSON.stringify({protocol:1,type:'result',cookies:JSON.stringify(cookies),profileReleased:true,...change})+'\n';
async function harness(t,options={}){
  const appRoot=await mkdtemp(join(tmpdir(),'dobi-wing-native-test-'));
  await mkdir(join(appRoot,'runtime','wing-login'),{recursive:true});await writeFile(join(appRoot,'runtime','wing-login','CoupangLogin.exe'),'fixture-only');
  t.after(async()=>{assert.ok(resolve(appRoot).startsWith(resolve(tmpdir())+'\\dobi-wing-native-test-')||resolve(appRoot).startsWith(resolve(tmpdir())+'/dobi-wing-native-test-'));await rm(appRoot,{recursive:true,force:true});});
  const calls=[],children=[];
  const h={appRoot,calls,children,...options};
  function spawnImpl(executable,args,settings){
    calls.push({executable,args,settings});if(h.spawnThrows)throw Error(PASSWORD);
    const child=new EventEmitter(),stdin=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=stdin;child.kills=0;child.ended=false;child.closed=false;
    child.close=(code=0)=>{if(child.closed)return;child.closed=true;child.emit('close',code);};
    child.result=(raw=h.output??frame(),code=0)=>{child.stdout.emit('data',Buffer.isBuffer(raw)?raw:Buffer.from(raw));setImmediate(()=>child.close(code));};
    stdin.write=(data,encoding,callback)=>{h.stdin=String(data);h.input=JSON.parse(data);callback?.();queueMicrotask(async()=>{try{if(h.onInput)await h.onInput(child,h.input);else child.result();}catch(error){h.fixtureError=error;child.emit('error',error);}});return true;};
    stdin.end=()=>{child.ended=true;if(h.onEnd)h.onEnd(child);else setImmediate(()=>child.close(2));};stdin.destroy=()=>{};
    child.kill=()=>{child.kills++;setImmediate(()=>child.close(2));return true;};children.push(child);return child;
  }
  h.login=createNativeWingLogin({spawnImpl,appRoot,platform:'win32',timeoutMs:5000,killGraceMs:5,cleanupRetries:1,cleanupRetryDelay:1,...h.settings});
  h.profiles=async()=>{try{return await readdir(join(appRoot,'data','wing-profiles'));}catch(error){if(error.code==='ENOENT')return [];throw error;}};
  return h;
}
const request=extra=>({sellerId:'fixture-seller',password:PASSWORD,...extra});
function safeError(error,code){assert.equal(error.code,code);assert.ok(!String(error).includes(PASSWORD));assert.ok(!String(error).includes(VALUE));return true;}

test('판매처별 네이티브 창은 고정 도메인 쿠키·문서화한 저장 키만 전달한다',async t=>{
 const cookies=[{...fixtureCookie(),domain:'.lotteon.com'}],sessionData={AuthToken:'SYNTHETIC_LOTTE_TOKEN',userAgent:'fixture-agent'};
 const h=await harness(t,{output:frame(cookies,{sessionData})});const result=await h.login(request({providerId:'lotteon'}));assert.equal(h.input.providerId,'lotteon');assert.deepEqual(JSON.parse(result.cookies),cookies);assert.deepEqual(JSON.parse(result.sessionData),sessionData);assert.deepEqual(await h.profiles(),[]);
 for(const output of [frame(cookies,{sessionData:{...sessionData,unknown:'DO_NOT_EXPORT'}}),frame(cookies,{sessionData:{AuthToken:42}}),frame([{...cookies[0],domain:'.coupang.com'}],{sessionData}),frame(cookies,{sessionData:{userAgent:'fixture',AuthToken:'bad\nvalue'}})]){const bad=await harness(t,{output});await assert.rejects(()=>bad.login(request({providerId:'lotteon'})),e=>safeError(e,'INVALID_RESULT'));}
 const other=await harness(t,{output:frame([{...fixtureCookie(),domain:'.a-bly.com'}],{sessionData})});await assert.rejects(()=>other.login(request({providerId:'ably'})),e=>safeError(e,'INVALID_RESULT'));
});
test('동적 상점 호스트는 고정 정책을 통과한 값만 자식 stdin에 전달한다',async t=>{
 const h=await harness(t,{output:frame([{...fixtureCookie(),domain:'admin.example.com',hostOnly:true}],{sessionData:{userAgent:'fixture'}})});await h.login(request({providerId:'imweb',host:'admin.example.com'}));assert.equal(h.input.host,'admin.example.com');const count=h.calls.length;for(const host of ['127.0.0.1','localhost','admin.example.com/other','admin.example.com:8443','admin.example.com\n'])await assert.rejects(()=>h.login(request({providerId:'imweb',host})));assert.equal(h.calls.length,count);
});
test('정확한 두 판매처의 네이티브 로그인 응답 토큰만 쿠키 없이 전달한다',async t=>{for(const providerId of ['ably','alwayz']){const h=await harness(t,{output:frame([],{sessionData:{token:'SYNTHETIC_RESPONSE_TOKEN',userAgent:'fixture'}})});const value=await h.login(request({providerId}));assert.deepEqual(JSON.parse(value.cookies),[]);assert.equal(JSON.parse(value.sessionData).token,'SYNTHETIC_RESPONSE_TOKEN');}const other=await harness(t,{output:frame([],{sessionData:{token:'SYNTHETIC_RESPONSE_TOKEN'}})});await assert.rejects(()=>other.login(request({providerId:'ssg'})),e=>safeError(e,'INVALID_RESULT'));});

test('전용 프로필·stdin 자격증명·단일 stdout 결과를 사용하고 성공 후 생성한 프로필만 정리한다',async t=>{
  const h=await harness(t);await mkdir(join(h.appRoot,'data','wing-profiles','keep-user-folder'),{recursive:true});await writeFile(join(h.appRoot,'data','wing-profiles','keep-user-folder','keep.txt'),'keep');
  const old=process.env.WEBVIEW2_USER_DATA_FOLDER;process.env.WEBVIEW2_USER_DATA_FOLDER='C:\\DO_NOT_OPEN_EXISTING_PROFILE';
  try{
    const result=await h.login(request());assert.deepEqual(JSON.parse(result.cookies),[fixtureCookie()]);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].args,[]);assert.equal(h.calls[0].settings.windowsHide,true);assert.equal(h.calls[0].settings.shell,undefined);assert.deepEqual(h.calls[0].settings.stdio,['pipe','pipe','pipe']);assert.equal(h.calls[0].settings.env.WEBVIEW2_USER_DATA_FOLDER,undefined);
    assert.equal(h.input.sellerId,'fixture-seller');assert.equal(h.input.password,PASSWORD);assert.equal(h.input.protocol,1);assert.equal(dirname(h.input.profilePath),await realpath(join(h.appRoot,'data','wing-profiles')));assert.match(h.input.profilePath,/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.ok(!JSON.stringify(h.calls).includes(PASSWORD));assert.deepEqual(await h.profiles(),['keep-user-folder']);assert.equal(await readFile(join(h.appRoot,'data','wing-profiles','keep-user-folder','keep.txt'),'utf8'),'keep');
  }finally{if(old===undefined)delete process.env.WEBVIEW2_USER_DATA_FOLDER;else process.env.WEBVIEW2_USER_DATA_FOLDER=old;}
});

test('반복 로그인은 서로 다른 새 UUID 프로필을 사용한다',async t=>{
  const paths=[];const h=await harness(t,{onInput:async(child,input)=>{assert.deepEqual(await readdir(input.profilePath),[]);paths.push(input.profilePath);child.result();}});await h.login(request());await h.login(request());assert.equal(new Set(paths).size,2);assert.deepEqual(await h.profiles(),[]);
});

test('저장된 비밀번호 없이도 전용 창에서 수동 로그인을 진행할 수 있다',async t=>{
  const h=await harness(t);await h.login(request({password:''}));assert.equal(h.input.password,'');await h.login({sellerId:'fixture-seller'});assert.equal(h.input.password,'');assert.equal(h.calls.length,2);assert.deepEqual(await h.profiles(),[]);
});

test('잘못된 입력·사전 취소·지원하지 않는 OS는 프로세스를 시작하지 않는다',async t=>{
  const h=await harness(t);for(const change of [{sellerId:''},{sellerId:'x'.repeat(101)},{sellerId:'bad\nvalue'},{password:null},{password:'x'.repeat(2049)}])await assert.rejects(h.login(request(change)),e=>safeError(e,'INVALID_CREDENTIALS'));
  const aborted=new AbortController();aborted.abort();await assert.rejects(h.login(request({signal:aborted.signal})),e=>safeError(e,'CANCELLED'));const other=createNativeWingLogin({appRoot:h.appRoot,platform:'linux'});await assert.rejects(other(request()),e=>safeError(e,'NATIVE_UNAVAILABLE'));assert.equal(h.calls.length,0);assert.deepEqual(await h.profiles(),[]);
});

test('stdout의 배너·여러 프레임·잘못된 UTF8·프로토콜·미해제 프로필·비정상 종료를 거부한다',async t=>{
  for(const output of ['banner\n'+frame(),frame()+frame(),Buffer.from([0xff,0x0a]),frame(undefined,{protocol:2}),frame(undefined,{profileReleased:false}),frame(undefined,{extra:VALUE})]){const h=await harness(t,{output});await assert.rejects(h.login(request()),e=>safeError(e,'INVALID_RESULT'));assert.deepEqual(await h.profiles(),[]);}
  const badExit=await harness(t,{onInput:child=>child.result(frame(),2)});await assert.rejects(badExit.login(request()),e=>safeError(e,'INVALID_RESULT'));assert.deepEqual(await badExit.profiles(),[]);
});

test('Wing에 적용되지 않는 쿠키·파티션·형식·중복·개수·JSON 크기 위반을 거부한다',async t=>{
  const cases=[...[
    {domain:'.evil.test'},{domain:'coupang.com.evil.test'},{domain:'coupang.com',hostOnly:true},{domain:'www.coupang.com',hostOnly:true},
    {hostOnly:true},{name:'bad name'},{value:'unsafe;value'},{value:'unsafe value'},{value:'"quoted"'},{path:'/\r\n'},{secure:'true'},
    {name:'__Host-fixture',hostOnly:false},{name:'__Secure-fixture',secure:false},{partitionKey:{}},{session:false},{session:true,expirationDate:Date.now()/1000+300},
  ].map(change=>[{...fixtureCookie(),...change}]),[fixtureCookie(),fixtureCookie()],Array.from({length:201},(_,i)=>({...fixtureCookie(),name:'fixture_'+i})),[{...fixtureCookie(),value:'x'.repeat(30001)}]];
  for(const cookies of cases){const h=await harness(t,{output:frame(cookies)});await assert.rejects(h.login(request()),e=>safeError(e,'INVALID_RESULT'));assert.deepEqual(await h.profiles(),[]);}
});

test('정상 hostOnly Wing 쿠키를 보존하고 반환 직전 만료된 쿠키는 제외한다',async t=>{
  const current={...fixtureCookie(),name:'__Host-fixture',domain:'wing.coupang.com',hostOnly:true};const old={...fixtureCookie(),name:'expired',session:false,expirationDate:Date.now()/1000-1};const h=await harness(t,{output:frame([current,old])});assert.deepEqual(JSON.parse((await h.login(request())).cookies),[current]);assert.deepEqual(await h.profiles(),[]);
});

test('stdout와 stderr 출력 상한을 넘으면 원문을 노출하지 않고 중단·정리한다',async t=>{
  for(const stream of ['stdout','stderr']){const h=await harness(t,{onInput:child=>child[stream].emit('data',Buffer.from(VALUE+'x'.repeat(stream==='stdout'?131073:8193)))});await assert.rejects(h.login(request()),e=>safeError(e,'OUTPUT_LIMIT'));assert.equal(h.children[0].ended,true);assert.deepEqual(await h.profiles(),[]);}
});

test('사용자 취소는 stdin EOF로 창을 닫고 현재 프로필만 정리한다',async t=>{
  const signal=new AbortController();const h=await harness(t,{onInput:()=>signal.abort()});await assert.rejects(h.login(request({signal:signal.signal})),e=>safeError(e,'CANCELLED'));assert.equal(h.children[0].ended,true);assert.equal(h.children[0].kills,0);assert.deepEqual(await h.profiles(),[]);
});

test('응답 없는 창은 제한 시간 후 정상 닫기를 요청하고 필요할 때만 전용 프로세스를 종료한다',async t=>{
  const h=await harness(t,{onInput:()=>{},onEnd:()=>{},settings:{timeoutMs:10,killGraceMs:5}});await assert.rejects(h.login(request()),e=>safeError(e,'TIMEOUT'));assert.equal(h.children[0].ended,true);assert.equal(h.children[0].kills,1);assert.deepEqual(await h.profiles(),[]);
});

test('spawn·stdin·네이티브 오류 원문에 fixture 비밀값이 있어도 고정 오류만 반환한다',async t=>{
  const spawn=await harness(t,{spawnThrows:true});await assert.rejects(spawn.login(request()),e=>safeError(e,'NATIVE_UNAVAILABLE'));assert.deepEqual(await spawn.profiles(),[]);
  const stdin=await harness(t,{onInput:child=>child.stdin.emit('error',Error(PASSWORD))});await assert.rejects(stdin.login(request()),e=>safeError(e,'NATIVE_LOGIN_FAILED'));assert.deepEqual(await stdin.profiles(),[]);
  const native=await harness(t,{output:JSON.stringify({protocol:1,type:'error',code:'BROWSER_FAILED',error:VALUE})+'\n'});await assert.rejects(native.login(request()),e=>safeError(e,'NATIVE_LOGIN_FAILED'));assert.deepEqual(await native.profiles(),[]);
});

test('프로필이 다른 폴더를 가리키는 junction으로 교체되면 재귀 삭제를 중단한다',async t=>{
  if(process.platform!=='win32'){t.skip('Windows junction 경계 검증');return;}
  let link;const h=await harness(t,{onInput:async(child,input)=>{link=input.profilePath;const saved=join(dirname(link),'saved-fixture');await rename(link,saved);const victim=join(h.appRoot,'victim');await mkdir(victim);await writeFile(join(victim,'keep.txt'),'keep');await symlink(victim,link,'junction');child.result();}});
  try{await assert.rejects(h.login(request()),e=>safeError(e,'PROFILE_CLEANUP_FAILED'));assert.equal(await readFile(join(h.appRoot,'victim','keep.txt'),'utf8'),'keep');}finally{if(link)await unlink(link);}
});
