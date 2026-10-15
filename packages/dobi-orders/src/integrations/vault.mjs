import { spawn } from 'node:child_process';
import { readFile,writeFile,rename,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../store.mjs';

// DPAPI protects credentials for the current Windows account. Secrets travel via stdin,
// never command arguments, environment variables, application logs or ordinary backups.
async function dpapi(value,protect) {
  if(process.platform!=='win32')throw new AppError('인증 정보 암호화 저장은 Windows에서 지원됩니다.');
  const operation=protect?'Protect':'Unprotect';
  const script=`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Security;$s=[Console]::In.ReadToEnd();$b=${protect?'[Text.Encoding]::UTF8.GetBytes($s)':'[Convert]::FromBase64String($s)'};$r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write(${protect?'[Convert]::ToBase64String($r)':'[Text.Encoding]::UTF8.GetString($r)'})`;
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const out=[];let size=0,finished=false;
    const fail=()=>{if(!finished){finished=true;clearTimeout(timer);reject(new AppError('인증 정보 암호화 저장/읽기에 실패했습니다. 현재 Windows 계정을 확인해주세요.'));}};
    const timer=setTimeout(()=>{child.kill();fail();},15000);
    child.on('error',fail);child.stdout.on('data',b=>{size+=b.length;if(size>1024*1024){child.kill();fail();}else out.push(b);});child.stderr.resume();
    child.on('close',code=>{if(finished)return;finished=true;clearTimeout(timer);if(code!==0)reject(new AppError('Windows 암호화 저장소를 사용할 수 없습니다.'));else resolve(Buffer.concat(out).toString('utf8'));});
    child.stdin.on('error',fail);child.stdin.end(value,'utf8');
  });
}

export async function createVault(filename,{encrypt=v=>dpapi(v,true),decrypt=v=>dpapi(v,false)}={}) {
  let records={};try{records=JSON.parse(await readFile(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new AppError('암호화된 인증 저장소를 읽을 수 없습니다.');}
  let writing=Promise.resolve();
  async function persist(){await mkdir(path.dirname(filename),{recursive:true});const temp=filename+'.tmp';await writeFile(temp,JSON.stringify(records),{mode:0o600});await rename(temp,filename);}
  return {
    has:id=>Boolean(records[id]),
    async set(id,credentials){const blob=await encrypt(JSON.stringify(credentials));writing=writing.catch(()=>{}).then(async()=>{const before=records[id];records[id]=blob;try{await persist();}catch(e){if(before===undefined)delete records[id];else records[id]=before;throw e;}});await writing;},
    async get(id){if(!records[id])throw new AppError('이 계정의 인증 정보를 입력해주세요.');try{return JSON.parse(await decrypt(records[id]));}catch(e){if(e instanceof AppError)throw e;throw new AppError('인증 정보를 읽지 못했습니다. 다시 저장해주세요.');}},
    async remove(id){writing=writing.catch(()=>{}).then(async()=>{const before=records[id];delete records[id];try{await persist();}catch(e){if(before!==undefined)records[id]=before;throw e;}});await writing;}
  };
}

export function memoryVault(){const entries=new Map();return {has:id=>entries.has(id),set:async(id,c)=>entries.set(id,structuredClone(c)),get:async id=>{if(!entries.has(id))throw new AppError('인증 정보를 입력해주세요.');return structuredClone(entries.get(id));},remove:async id=>entries.delete(id)};}
