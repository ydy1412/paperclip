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
    const bytes=Buffer.from('<table><tr><td>주문번호</td><td>운송장번호</td><td>받는사람</td><td>품목명</td><td>품목1</td><td>수량1</td><td>상품이미지1</td><td>배송비</td><td>Weight</td><td>전자상거래주소</td><td>HS CODE</td></tr><tr><td>PRIVATE-APPLICATION</td><td>PRIVATE-TRACKING</td><td>PRIVATE-RECIPIENT</td><td>cup</td><td>cup</td><td>1</td><td><img src="https://img.alicdn.com/cup.jpg"></td><td>6500</td><td>9999</td><td>https://item.taobao.com/item.htm?id=12345678</td><td>691110</td></tr></table>');
    const f=parseNext1688File('test.xls',bytes,1);store.importForwarderShipments({forwarderId:'11111111-1111-4111-8111-111111111111',providerId:'next1688',accountName:'Synthetic'},{...f,bytes,name:'test.xls'});
    const data=exportTrainingData(database),text=JSON.stringify(data);assert.equal(data.records[0].items[0].imageUrl,'https://img.alicdn.com/cup.jpg');assert.equal(data.records[0].category,'691110');assert.ok(data.records[0].productKey);
    for(const value of ['PRIVATE-APPLICATION','PRIVATE-TRACKING','PRIVATE-RECIPIENT','9999','12345678','weight','postcode'])assert.ok(!text.includes(value));
    const weights=exportTrainingData(database,{target:'weight'}),weightText=JSON.stringify(weights);
    assert.equal(weights.target,'recorded_single_item_shipment_weight_kg');assert.equal(weights.records[0].weightKg,9999);
    assert.equal(weights.records[0].shippingFee,undefined);
    for(const value of ['PRIVATE-APPLICATION','PRIVATE-TRACKING','PRIVATE-RECIPIENT','12345678','shippingFee','postcode','volume'])assert.ok(!weightText.includes(value));
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('예측 입력은 상품·이미지 크기·산간 boolean을 검증하며 URL·호스트 파일을 전달하지 않는다',()=>{
  assert.deepEqual(validateEstimate({items:[{title:' cup ',quantity:2,imageUrl:'file:///private'}],category:'691110',remoteArea:true}),{items:[{title:'cup',quantity:2}],category:'691110',remoteArea:true});
  for(const input of [{items:[]},{items:[{title:'x',quantity:-1}]},{items:[{title:'x',imageBase64:'bad'}]},{items:[{title:'x'}],remoteArea:'false'}])assert.throws(()=>validateEstimate(input));
});

test('무게 학습은 합배송·중량 누락·수량 누락을 제외하며 배송비 없는 중량도 보존한다',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dobi-weight-data-')),database=path.join(dir,'orders.sqlite'),store=createStore(database);
  try{
    const rows=[['a','cup','1','','','2'],['b','cup','0','','','2'],['c','cup','1','plate','1','3'],['d','cup','1','','','']];
    const bytes=Buffer.from('<table><tr>'+['주문번호','품목1','수량1','품목2','수량2','Weight','품목명','운송장번호','받는사람'].map(x=>`<td>${x}</td>`).join('')+'</tr>'+rows.map(row=>'<tr>'+[...row,'cup','',''].map(x=>`<td>${x}</td>`).join('')+'</tr>').join('')+'</table>');
    const f=parseNext1688File('test.xls',bytes,4);store.importForwarderShipments({forwarderId:'11111111-1111-4111-8111-111111111111',providerId:'next1688',accountName:'Synthetic'},{...f,bytes,name:'test.xls'});
    const weights=exportTrainingData(database,{target:'weight'});
    assert.deepEqual(weights.sourceSummary,{records:1,excludedNoWeight:1,excludedMixedItems:1,excludedInvalidQuantity:1});
    assert.equal(weights.records[0].weightKg,2);assert.equal(exportTrainingData(database).records.length,0);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('학습되지 않은 scoped 모델은 unavailable로 보이며 예측 실패 시 주문을 변경하지 않는다',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dobi-shipping-'));const app=await createApp({dbPath:':memory:',dataRoot:dir});
  try{
    const boot=await fetch(app.url+'/api/bootstrap').then(r=>r.json());
    const metadata=await fetch(app.url+'/api/shipping-model').then(r=>r.json());assert.equal(metadata.available,false);assert.equal(metadata.remoteSurchargeKrw,5000);
    const weightMetadata=await fetch(app.url+'/api/weight-model').then(r=>r.json());assert.equal(weightMetadata.available,false);assert.deepEqual(weightMetadata.coverageLevels,[.8,.9]);
    const response=await fetch(app.url+'/api/shipping-estimate',{method:'POST',headers:{'content-type':'application/json','x-dobi-token':boot.token},body:JSON.stringify({items:[{title:'cup'}],remoteArea:false})});assert.equal(response.status,503);assert.equal(app.store.all().length,0);
    await mkdir(path.join(dir,'shipping-model'));await writeFile(path.join(dir,'shipping-model','manifest.json'),JSON.stringify({model:'synthetic',pythonExecutable:'/private/DO-NOT-EXPOSE',encoderSha256:'PRIVATE-HASH',remoteSurchargeKrw:5000}));
    const publicMetadata=await fetch(app.url+'/api/shipping-model').then(r=>r.text());assert.ok(!publicMetadata.includes('DO-NOT-EXPOSE'));assert.ok(!publicMetadata.includes('PRIVATE-HASH'));
    for(let attempt=0;attempt<2;attempt++){
      const failed=await fetch(app.url+'/api/shipping-estimate',{method:'POST',headers:{'content-type':'application/json','x-dobi-token':boot.token},body:JSON.stringify({items:[{title:'cup'}]})});assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('DO-NOT-EXPOSE'));
    }
    await mkdir(path.join(dir,'weight-model'));await writeFile(path.join(dir,'weight-model','manifest.json'),JSON.stringify({pythonExecutable:'/private/DO-NOT-EXPOSE',unit:'kg',calibration:{groups:23,logRadii:{'0.8':1,'0.9':2}}}));
    const post=items=>fetch(app.url+'/api/weight-estimate',{method:'POST',headers:{'content-type':'application/json','x-dobi-token':boot.token},body:JSON.stringify({items})});
    for(const items of [[{title:'a'},{title:'b'}],[{title:'a',quantity:1.2}]])assert.equal((await post(items)).status,400);
    for(let attempt=0;attempt<2;attempt++){const failed=await post([{title:'cup'}]);assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('DO-NOT-EXPOSE'));}
    assert.equal(app.store.all().length,0);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
