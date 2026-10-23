import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {validateEstimate} from '../src/shipping-estimator.mjs';
import {createStore} from '../src/store.mjs';
import {parseNext1688File} from '../src/forwarder-files.mjs';
import {exportTrainingData} from '../shipping-model/export.mjs';

test('학습 자료는 원본 이미지를 복구하고 개인정보·배송 후 정보·상품 ID를 입력 특징에서 제외한다',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dobi-model-data-')),database=path.join(dir,'orders.sqlite'),store=createStore(database);
  try{
    const bytes=Buffer.from('<table><tr><td>주문번호</td><td>운송장번호</td><td>받는사람</td><td>품목명</td><td>품목1</td><td>상품이미지1</td><td>배송비</td><td>Weight</td><td>전자상거래주소</td><td>HS CODE</td></tr><tr><td>PRIVATE-APPLICATION</td><td>PRIVATE-TRACKING</td><td>PRIVATE-RECIPIENT</td><td>cup</td><td>cup</td><td><img src="https://img.alicdn.com/cup.jpg"></td><td>6500</td><td>9999</td><td>https://item.taobao.com/item.htm?id=12345678</td><td>691110</td></tr></table>');
    const f=parseNext1688File('test.xls',bytes,1);store.importForwarderShipments({forwarderId:'11111111-1111-4111-8111-111111111111',providerId:'next1688',accountName:'Synthetic'},{...f,bytes,name:'test.xls'});
    const data=exportTrainingData(database),text=JSON.stringify(data);assert.equal(data.records[0].items[0].imageUrl,'https://img.alicdn.com/cup.jpg');assert.equal(data.records[0].category,'691110');assert.ok(data.records[0].productKey);
    for(const value of ['PRIVATE-APPLICATION','PRIVATE-TRACKING','PRIVATE-RECIPIENT','9999','12345678','weight','postcode'])assert.ok(!text.includes(value));
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('예측 입력은 상품·이미지 크기·산간 boolean을 검증하며 URL·호스트 파일을 전달하지 않는다',()=>{
  assert.deepEqual(validateEstimate({items:[{title:' cup ',quantity:2,imageUrl:'file:///private'}],category:'691110',remoteArea:true}),{items:[{title:'cup',quantity:2}],category:'691110',remoteArea:true});
  for(const input of [{items:[]},{items:[{title:'x',quantity:-1}]},{items:[{title:'x',imageBase64:'bad'}]},{items:[{title:'x'}],remoteArea:'false'}])assert.throws(()=>validateEstimate(input));
});

test('학습되지 않은 scoped 모델은 unavailable로 보이며 예측 실패 시 주문을 변경하지 않는다',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dobi-shipping-'));const app=await createApp({dbPath:':memory:',dataRoot:dir});
  try{
    const boot=await fetch(app.url+'/api/bootstrap').then(r=>r.json());
    const metadata=await fetch(app.url+'/api/shipping-model').then(r=>r.json());assert.equal(metadata.available,false);assert.equal(metadata.remoteSurchargeKrw,5000);
    const response=await fetch(app.url+'/api/shipping-estimate',{method:'POST',headers:{'content-type':'application/json','x-dobi-token':boot.token},body:JSON.stringify({items:[{title:'cup'}],remoteArea:false})});assert.equal(response.status,503);assert.equal(app.store.all().length,0);
    await mkdir(path.join(dir,'shipping-model'));await writeFile(path.join(dir,'shipping-model','manifest.json'),JSON.stringify({model:'synthetic',pythonExecutable:'/private/DO-NOT-EXPOSE',encoderSha256:'PRIVATE-HASH',remoteSurchargeKrw:5000}));
    const publicMetadata=await fetch(app.url+'/api/shipping-model').then(r=>r.text());assert.ok(!publicMetadata.includes('DO-NOT-EXPOSE'));assert.ok(!publicMetadata.includes('PRIVATE-HASH'));
    for(let attempt=0;attempt<2;attempt++){
      const failed=await fetch(app.url+'/api/shipping-estimate',{method:'POST',headers:{'content-type':'application/json','x-dobi-token':boot.token},body:JSON.stringify({items:[{title:'cup'}]})});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('DO-NOT-EXPOSE'));
    }
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
