import {spawn} from 'node:child_process';
import {mkdir,lstat,realpath,rm,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sellerPolicy} from './seller-policy.mjs';
import {validateSellerCookies} from './seller-session.mjs';

const APP_ROOT=fileURLToPath(new URL('../../',import.meta.url));
const NAME=/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const VALUE=/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;
const MAX_STDOUT=131072,MAX_STDERR=8192;
const NATIVE_CODES=new Set(['INVALID_INPUT','NATIVE_UNAVAILABLE','PROFILE_BUSY','UI_FAILED','CANCELLED','TIMEOUT','BROWSER_FAILED','SELF_TEST_FAILED']);
const TEXT={INVALID_CREDENTIALS:'쿠팡 Wing 아이디와 비밀번호 형식을 확인해주세요.',NATIVE_UNAVAILABLE:'쿠팡 로그인 창을 사용할 수 없습니다. 앱 전용 로그인 도구와 Microsoft WebView2 Runtime을 확인해주세요.',CANCELLED:'쿠팡 로그인 창 연결을 취소했습니다.',TIMEOUT:'쿠팡 로그인 시간이 초과됐습니다. 다시 연결해주세요.',OUTPUT_LIMIT:'쿠팡 로그인 창의 결과 크기 제한을 초과했습니다.',INVALID_RESULT:'쿠팡 로그인 창의 결과 형식을 확인할 수 없습니다. 다시 연결해주세요.',NATIVE_LOGIN_FAILED:'쿠팡 로그인 창 연결을 완료하지 못했습니다. 정상 로그인과 추가 인증을 확인해주세요.',PROFILE_CLEANUP_FAILED:'쿠팡 임시 로그인 프로필 정리를 완료하지 못했습니다. 로그인 창이 닫혔는지 확인하고 앱을 다시 시작해주세요.'};
export class WingNativeError extends Error {
  constructor(code){super(TEXT[code]||TEXT.NATIVE_LOGIN_FAILED);this.name='WingNativeError';this.code=code;this.status=code==='CANCELLED'?499:code==='INVALID_CREDENTIALS'?400:503;}
}
const fail=code=>{throw new WingNativeError(code);};
function credentials(sellerId,password){if(typeof sellerId!=='string'||!sellerId.trim()||sellerId.length>100||typeof password!=='string'||password.length>2048||/[\x00-\x1f\x7f]/.test(sellerId+password))fail('INVALID_CREDENTIALS');}
function cookiesFromFrame(raw){
  if(typeof raw!=='string'||raw.length>30000)fail('INVALID_RESULT');let rows;try{rows=JSON.parse(raw);}catch{fail('INVALID_RESULT');}
  if(!Array.isArray(rows)||!rows.length||rows.length>200)fail('INVALID_RESULT');
  const normalized=[],keys=new Set(),allowed=new Set(['name','value','domain','path','hostOnly','secure','httpOnly','session','expirationDate']);
  for(const c of rows){
    if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!allowed.has(k))||typeof c.domain!=='string'||typeof c.hostOnly!=='boolean'||typeof c.secure!=='boolean'||typeof c.httpOnly!=='boolean'||typeof c.session!=='boolean')fail('INVALID_RESULT');
    const domain=c.domain.toLowerCase(),bare=domain.startsWith('.')?domain.slice(1):domain;
    if(c.hostOnly?domain!=='wing.coupang.com':!['coupang.com','wing.coupang.com'].includes(bare))fail('INVALID_RESULT');
    if(typeof c.name!=='string'||c.name.length>256||!NAME.test(c.name)||typeof c.value!=='string'||!VALUE.test(c.value)||typeof c.path!=='string'||!c.path.startsWith('/')||c.path.length>1024||/[\x00-\x1f\x7f;]/.test(c.path))fail('INVALID_RESULT');
    if(c.name.startsWith('__Secure-')&&!c.secure||c.name.startsWith('__Host-')&&(!c.secure||!c.hostOnly||c.path!=='/'))fail('INVALID_RESULT');
    if(c.expirationDate!==undefined&&(typeof c.expirationDate!=='number'||!Number.isFinite(c.expirationDate)||c.expirationDate<0)||c.session!==(c.expirationDate===undefined))fail('INVALID_RESULT');
    if(c.expirationDate!==undefined&&c.expirationDate<=Date.now()/1000)continue;
    const key=JSON.stringify([bare,c.path,c.name]);if(keys.has(key))fail('INVALID_RESULT');keys.add(key);
    normalized.push({...c,domain:c.hostOnly?bare:'.'+bare});
  }
  const value=JSON.stringify(normalized);if(!normalized.length||value.length>30000)fail('INVALID_RESULT');return value;
}
function parseFrame(bytes,exitCode,context){
  let raw,frame;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!/^[^\r\n]+\r?\n$/.test(raw))throw Error();frame=JSON.parse(raw);}catch{fail('INVALID_RESULT');}
  if(!frame||Array.isArray(frame)||frame.protocol!==1)fail('INVALID_RESULT');
  if(frame.type==='error'){
    if(typeof frame.code!=='string'||!NATIVE_CODES.has(frame.code))fail('INVALID_RESULT');
    fail(frame.code==='CANCELLED'||frame.code==='TIMEOUT'?frame.code:frame.code==='NATIVE_UNAVAILABLE'?'NATIVE_UNAVAILABLE':'NATIVE_LOGIN_FAILED');
  }
  if(context){
    if(exitCode!==0||frame.type!=='result'||frame.profileReleased!==true||Object.keys(frame).some(k=>!['protocol','type','cookies','sessionData','profileReleased'].includes(k)))fail('INVALID_RESULT');
    let rows;try{rows=validateSellerCookies(frame.cookies,{...context,allowEmpty:true});}catch{fail('INVALID_RESULT');}
    const state=frame.sessionData;if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).some(k=>!['userAgent',...(context.providerId==='lotteon'?['AuthToken']:[]),...(['ably','alwayz'].includes(context.providerId)?['token']:[])].includes(k))||Object.values(state).some(v=>typeof v!=='string'||v.length>20000||/[\x00-\x1f\x7f]/.test(v)))fail('INVALID_RESULT');
    if(!rows.length&&!state.AuthToken&&!state.token)fail('INVALID_RESULT');
    return {cookies:JSON.stringify(rows),sessionData:JSON.stringify(state)};
  }
  if(exitCode!==0||frame.type!=='result'||frame.profileReleased!==true||Object.keys(frame).some(k=>!['protocol','type','cookies','profileReleased'].includes(k)))fail('INVALID_RESULT');
  return {cookies:cookiesFromFrame(frame.cookies)};
}
async function profileDirectory(appRoot){
  const root=await realpath(appRoot),data=join(root,'data'),parent=join(data,'wing-profiles');
  for(const path of [data,parent]){await mkdir(path,{recursive:true,mode:0o700});const item=await lstat(path);if(!item.isDirectory()||item.isSymbolicLink())fail('NATIVE_UNAVAILABLE');}
  if(await realpath(data)!==data||await realpath(parent)!==parent)fail('NATIVE_UNAVAILABLE');
  const path=join(parent,randomUUID());await mkdir(path,{mode:0o700});return {path,parent};
}
async function cleanProfile({path,parent},retries,delay){
  // This exact, freshly created UUID directory is the only recursive deletion target.
  if(dirname(path)!==parent||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path.slice(parent.length+1)))fail('PROFILE_CLEANUP_FAILED');
  try{const item=await lstat(path);if(!item.isDirectory()||item.isSymbolicLink()||await realpath(parent)!==parent)fail('PROFILE_CLEANUP_FAILED');await rm(path,{recursive:true,force:true,maxRetries:retries,retryDelay:delay});}
  catch(error){if(error?.code==='ENOENT')return;fail('PROFILE_CLEANUP_FAILED');}
}

// Dependency injection is limited to the process/filesystem boundary for synthetic tests.
export function createNativeWingLogin({spawnImpl=spawn,appRoot=APP_ROOT,platform=process.platform,timeoutMs=300000,killGraceMs=12000,cleanupRetries=16,cleanupRetryDelay=250}={}){
  return async function login({sellerId,password='',signal,providerId='coupang',host,loginType}={}){
    const context=providerId==='coupang'?null:{providerId,credentials:{sellerId,host,loginType}};
    if(context)sellerPolicy(providerId,context.credentials);
    credentials(sellerId,password);if(signal?.aborted)fail('CANCELLED');if(platform!=='win32')fail('NATIVE_UNAVAILABLE');
    const executable=resolve(appRoot,'runtime','wing-login','CoupangLogin.exe');try{if(!(await stat(executable)).isFile())fail('NATIVE_UNAVAILABLE');}catch{fail('NATIVE_UNAVAILABLE');}
    let profile;try{profile=await profileDirectory(appRoot);}catch(error){if(error instanceof WingNativeError)throw error;fail('NATIVE_UNAVAILABLE');}
    try{
      if(signal?.aborted)fail('CANCELLED');
      return await new Promise((resolvePromise,reject)=>{
        let child,done=false,stdout=[],stdoutBytes=0,stderrBytes=0,failure=null,killTimer,reapTimer;
        const timer=setTimeout(()=>stop('TIMEOUT'),timeoutMs);
        function finish(error,result){if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(reapTimer);signal?.removeEventListener('abort',cancel);try{child?.stdin?.destroy();}catch{}stdout=[];error?reject(error):resolvePromise(result);}
        function stop(code){if(done||failure)return;failure=new WingNativeError(code);try{child?.stdin?.end();}catch{}killTimer=setTimeout(()=>{try{child?.kill();}catch{}reapTimer=setTimeout(()=>finish(failure),2000);},killGraceMs);}
        function cancel(){stop('CANCELLED');}
        signal?.addEventListener('abort',cancel,{once:true});
        try{
          // Prevent ambient WebView2 overrides from selecting an existing profile or debugger.
          const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^WEBVIEW2_/i.test(key)));
          child=spawnImpl(executable,[],{cwd:resolve(appRoot),windowsHide:true,stdio:['pipe','pipe','pipe'],env});
          child.on('error',()=>finish(new WingNativeError('NATIVE_UNAVAILABLE')));
          child.stdin.on('error',()=>stop('NATIVE_LOGIN_FAILED'));
          child.stdout.on('data',chunk=>{if(done||failure)return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);stdoutBytes+=bytes.length;if(stdoutBytes>MAX_STDOUT){stdout=[];stop('OUTPUT_LIMIT');return;}stdout.push(bytes);});
          child.stderr.on('data',chunk=>{if(done||failure)return;stderrBytes+=chunk.length;if(stderrBytes>MAX_STDERR)stop('OUTPUT_LIMIT');});
          child.on('close',code=>{if(done)return;if(failure){finish(failure);return;}try{finish(null,parseFrame(Buffer.concat(stdout),code,context));}catch(error){finish(error instanceof WingNativeError?error:new WingNativeError('INVALID_RESULT'));}});
          if(signal?.aborted){cancel();return;}
          // Credentials go only to this process's pipe, never argv/environment/files/logs.
          child.stdin.write(JSON.stringify({protocol:1,sellerId,password,profilePath:profile.path,...(context?{providerId,host,loginType}:{})})+'\n','utf8',error=>{if(error)stop('NATIVE_LOGIN_FAILED');});
        }catch{try{child?.kill();}catch{}finish(new WingNativeError('NATIVE_UNAVAILABLE'));}
      });
    }finally{password=null;await cleanProfile(profile,cleanupRetries,cleanupRetryDelay);}
  };
}
export const nativeWingLogin=createNativeWingLogin();
export async function nativeSellerLogin(options){try{return await nativeWingLogin(options);}catch(e){if(e instanceof WingNativeError){e.message=e.message.replaceAll('쿠팡 Wing','판매처').replaceAll('쿠팡','판매처');}throw e;}}
