import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AppError} from './store.mjs';

let workerActive=false;
export function validateEstimate(input){
  if(!input||!Array.isArray(input.items)||input.items.length<1||input.items.length>5)throw new AppError('상품을 1~5개 입력해주세요.');
  const category=input.category??'unknown',remoteArea=input.remoteArea??null;
  if(typeof category!=='string'||category.length>200||remoteArea!==null&&typeof remoteArea!=='boolean')throw new AppError('HS 품목분류와 산간 여부를 확인해주세요.');
  let imageBytes=0;
  const items=input.items.map(item=>{
    const title=item?.title,quantity=item?.quantity??1,imageBase64=item?.imageBase64??'';
    if(typeof title!=='string'||!title.trim()||title.length>500||typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<1||quantity>100000)throw new AppError('상품명과 수량을 확인해주세요.');
    if(typeof imageBase64!=='string'||imageBase64.length>7*1024*1024||imageBase64&&(!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)||imageBase64.length%4))throw new AppError('상품 이미지는 5MB 이하의 Base64로 전달해주세요.');
    imageBytes+=imageBase64.length;
    return {title:title.trim(),quantity,...(imageBase64?{imageBase64}:{})};
  });
  if(imageBytes>10*1024*1024)throw new AppError('이미지 전송량을 줄여주세요.',413);
  return {items,category,remoteArea};
}

export function createShippingEstimator(dataDir){
  const directory=path.join(dataDir,'shipping-model'),worker=fileURLToPath(new URL('../shipping-model/model.py',import.meta.url));let child=null;
  async function manifest(){try{return JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));}catch{throw new AppError('배송비 예측 모델을 먼저 학습해주세요.',503);}}
  return {
    async metadata(){
      try{const data=await manifest();return {available:true,...Object.fromEntries(['model','createdAt','categorySystem','target','remoteSurchargeKrw','images','source','undersampling','splits','evaluation','intervalRadiusKrw','intervalRadiiByHs2','limitations','peakMemoryMb','readiness'].map(k=>[k,data[k]]))};}
      catch(error){if(error.status===503)return {available:false,remoteSurchargeKrw:5000};throw error;}
    },
    async predict(input,signal){
      const request=validateEstimate(input),data=await manifest();
      if(typeof data.pythonExecutable!=='string'||!data.pythonExecutable||data.pythonExecutable.includes('\0'))throw new AppError('예측 모델의 Python 실행 환경을 확인해주세요.',503);
      if(workerActive)throw new AppError('다른 배송비를 계산 중입니다. 잠시 후 다시 시도해주세요.',409);
      workerActive=true;
      return new Promise((resolve,reject)=>{
        let output='',errors='',overLimit=false,timedOut=false;
        const environment=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
        child=spawn(data.pythonExecutable,[worker,'predict','--model-dir',directory],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...environment,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',PYTHONDONTWRITEBYTECODE:'1'}});
        const abort=()=>child?.kill('SIGKILL');
        const timer=setTimeout(()=>{timedOut=true;abort();},30000);
        if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
        child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>64000){overLimit=true;abort();}});
        child.stderr.on('data',chunk=>{errors+=chunk.toString();if(errors.length>8000){overLimit=true;abort();}});
        let spawnError=false;child.on('error',()=>{spawnError=true;});child.stdin.on('error',()=>{});
        child.on('close',code=>{
          clearTimeout(timer);signal?.removeEventListener('abort',abort);child=null;workerActive=false;
          if(spawnError||timedOut||overLimit||code!==0){
            const inputError=/"error":\s*"(ValueError|UnidentifiedImageError|DecompressionBombError|JSONDecodeError)"/.test(errors);
            reject(new AppError(inputError?'상품 이미지와 입력값을 확인해주세요.':'배송비 예측 실행에 실패했습니다. 모델과 실행 환경을 확인해주세요.',inputError?400:503));return;
          }
          try{const value=JSON.parse(output);if(!Number.isFinite(value.baseFeeKrw)||!Array.isArray(value.baseIntervalKrw))throw Error();resolve(value);}catch{reject(new AppError('배송비 예측 결과를 확인해주세요.',503));}
        });
        child.stdin.end(JSON.stringify(request));
      });
    },
    close(){child?.kill('SIGKILL');},
  };
}
