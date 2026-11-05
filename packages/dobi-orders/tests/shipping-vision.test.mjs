import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateAttributes,visionArgs,extractVision} from '../shipping-model/vision.mjs';
import {createApp} from '../server.mjs';

const attrs=()=>({typeGroup:'cosmetics',kind:'shampoo',description:'plastic bottle',materials:['plastic'],sizeClass:'handheld',visibleText:['820ml','W-310C'],
  evidence:[{kind:'volume',value:820,unit:'ml',quote:'820ml',scope:'product'},{kind:'mass',value:820,unit:'g',quote:'820ml',scope:'product'},{kind:'length',value:310,unit:'cm',quote:'W-310C',scope:'product'}],weightPriorKg:{lower:.8,upper:1.3,basis:'visible_capacity_plus_packaging'},bulky:false,fragile:null});

test('사진의 단위·숫자·인용을 검증하고 모델번호를 치수로 사용하지 않는다',()=>{
  const result=validateAttributes(attrs());assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].kind,'volume');
  assert.deepEqual(validateAttributes(result),result);
  const unproven=attrs();unproven.evidence=[];unproven.weightPriorKg.basis='explicit_mass';assert.equal(validateAttributes(unproven).weightPriorKg.basis,'visual_inference');
  const extra=attrs();extra.evidence.push({...extra.evidence[0],quote:'imagined 820ml'});assert.equal(validateAttributes(extra).evidence.length,1);
});

test('사진 해석 함수는 도구·검색·플러그인·하위 에이전트를 사용하지 않는다',()=>{
  const args=visionArgs('/tmp/input','/tmp/output',['/tmp/1.jpg']);
  for(const flag of ['shell_tool','plugins','multi_agent','browser_use','computer_use']){const i=args.indexOf(flag);assert.equal(args[i-1],'--disable');}
  assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('web_search="disabled"'));assert.ok(!args.some(x=>x.includes('bypass')));
});

test('해석 런타임이 없으면 실패하고 임의의 속성을 만들지 않는다',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dobi-vision-test-'));
  try{await assert.rejects(extractVision([{image:Buffer.from([255,216,255,...Array(20).fill(0)]),title:'cup',category:'691110'}],{cacheDir:dir,binary:'/unavailable-codex'}),/vision_runtime_unavailable/);}
  finally{await rm(dir,{recursive:true,force:true});}
});

test('멀티모달 API는 이미지가 필요하며 client vision 필드를 신뢰하지 않는다',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dobi-multimodal-test-'));await mkdir(path.join(dir,'shipping-multimodal-model'));
  await writeFile(path.join(dir,'shipping-multimodal-model','manifest.json'),JSON.stringify({pythonExecutable:'/private/not-exposed',vision:{model:'gpt-6-luna'}}));
  const app=await createApp({dbPath:':memory:',dataRoot:dir,visionBinary:'/unavailable-codex'});
  try{
    const boot=await fetch(app.url+'/api/bootstrap').then(r=>r.json());
    const post=input=>fetch(app.url+'/api/shipping-multimodal-estimate',{method:'POST',headers:{'content-type':'application/json','x-dobi-token':boot.token},body:JSON.stringify(input)});
    assert.equal((await post({items:[{title:'cup'}],vision:[attrs()]})).status,400);
    for(let i=0;i<2;i++){const response=await post({items:[{title:'cup',imageBase64:'ZGF0YQ=='}],vision:[attrs()]});assert.equal(response.status,400);assert.ok(!(await response.text()).includes('/private/'));}
    assert.equal(app.store.all().length,0);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
