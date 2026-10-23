import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseNext1688File} from '../src/forwarder-files.mjs';
import {createStore} from '../src/store.mjs';
import {createApp} from '../server.mjs';

const source={providerId:'next1688',forwarderId:'11111111-1111-4111-8111-111111111111',accountName:'합성 넥스트배송'};
const headers=['주문번호','운송장번호','받는사람','품목명','받는분전화','받는분우편번호','개인통관부호','배송비','품목1','수량1','가격1','오픈마켓 주문번호1','품목2','수량2'];
const data=['00001234567','00004567890','합성 수령인','Test product','01000000000','01234','SYNTHETIC-CUSTOMS','6,500','Product A','2','12.50','00000012345678901234','Product B','1'];
const html=(rows=[data])=>Buffer.from('<table>'+[headers,...rows].map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table>','utf8');
const file=(rows=[data])=>{const bytes=html(rows);return {...parseNext1688File('original.xls',bytes,rows.length),name:'original.xls',bytes};};

test('HTML XLS의 접수번호·긴 마켓번호·우편번호와 여러 품목을 원문 그대로 보존한다',()=>{
  const f=file(),row=f.rows[0];assert.equal(row.applicationNo,data[0]);assert.equal(row.tracking,data[1]);assert.equal(row.postcode,'01234');assert.equal(row.items[0].marketOrderNo,data[11]);assert.equal(row.items[0].quantity,2);assert.equal(row.shippingFee,6500);assert.equal(row.raw['개인통관부호'],'SYNTHETIC-CUSTOMS');assert.equal(f.itemCount,2);assert.equal(row.status,null);assert.equal(f.statusAvailable,false);
  assert.throws(()=>parseNext1688File('partial.xls',f.bytes,2666),/2666.*1건/);
  assert.throws(()=>parseNext1688File('duplicate.xls',html([data,data]),2),/중복/);
});

test('동일 파일 재등록은 중복 없이 종료하고 다른 원본 갱신도 같은 접수 ID를 유지한다',()=>{
  const s=createStore(':memory:');try{
    const f=file(),first=s.importForwarderShipments(source,f);assert.equal(first.inserted,1);
    assert.equal(s.importForwarderShipments(source,f).alreadyImported,true);const before=s.forwarderShipments().shipments[0];
    const changed=[...data];changed[1]='00009999999';const update=s.importForwarderShipments(source,file([changed]));assert.equal(update.updated,1);const after=s.forwarderShipment(before.id);assert.equal(after.id,before.id);assert.equal(after.tracking,changed[1]);assert.equal(after.version,2);assert.equal(s.forwarderShipments().total,1);
    assert.equal(s.forwarderShipments({q:changed[1]}).total,1);assert.equal(s.forwarderShipments({status:'unknown'}).total,1);
    s.importForwarderShipments({...source,forwarderId:'22222222-2222-4222-8222-222222222222'},f);assert.equal(s.forwarderShipments({forwarderId:source.forwarderId}).total,1);assert.equal(s.all().length,0);assert.equal(s.forwarding().length,0);
  }finally{s.close();}
});

test('실패한 일괄 가져오기는 원본·접수 모두 롤백한다',()=>{
  const s=createStore(':memory:');try{
    const f=file();f.rows.push({...f.rows[0]});assert.throws(()=>s.importForwarderShipments(source,f),/접수번호/);assert.equal(s.forwarderShipments().total,0);assert.equal(s.forwarderImports().length,0);
  }finally{s.close();}
});

test('재시작·백업 복원 후 원본 바이트와 해시·품목이 일치하고 잘못된 백업은 기존 자료를 보존한다',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'dobi-forwarder-'));let s=createStore(path.join(dir,'orders.sqlite'),dir);
  try{
    const f=file();s.importForwarderShipments(source,f);s.close();s=createStore(path.join(dir,'orders.sqlite'),dir);assert.equal(s.forwarderShipments().total,1);
    const snap=s.snapshot(),row=snap.shipmentHistory.imports[0];assert.deepEqual(Buffer.from(row.source,'base64'),f.bytes);assert.equal(row.source_hash,createHash('sha256').update(f.bytes).digest('hex'));
    const bad=structuredClone(snap);bad.shipmentHistory.imports[0].source='broken';assert.throws(()=>s.restore(bad),/해시/);assert.equal(s.forwarderShipments().total,1);
    s.restore(snap);assert.equal(s.forwarderShipments().shipments[0].items.length,2);assert.deepEqual(Buffer.from(s.snapshot().shipmentHistory.imports[0].source,'base64'),f.bytes);
    const legacy={...snap};delete legacy.shipmentHistory;s.restore(legacy);assert.equal(s.forwarderShipments().total,1);assert.ok(readFileSync(path.join(dir,'orders.sqlite')).length>0);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('가져오기 HTTP API는 전체 건수 불일치를 반영하지 않고 목록·상세·원본 메타데이터를 조회한다',async()=>{
  const app=await createApp({dbPath:':memory:'});try{
    const boot=await fetch(app.url+'/api/bootstrap').then(r=>r.json());
    const call=(p,body)=>fetch(app.url+'/api'+p,{...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Dobi-Token':boot.token},body:JSON.stringify(body)}:{})});
    const body={source,name:'original.xls',content:html().toString('base64'),expectedCount:2666};
    assert.equal((await call('/forwarder-shipments/import',body)).status,409);assert.equal((await call('/forwarder-shipments')).status,200);
    body.expectedCount=1;assert.equal((await call('/forwarder-shipments/import',body)).status,201);const rows=await(await call('/forwarder-shipments')).json();assert.equal(rows.total,1);assert.equal((await(await call('/forwarder-shipments/'+rows.shipments[0].id)).json()).applicationNo,data[0]);
    const imports=await(await call('/forwarder-shipments/imports')).json();assert.equal(imports[0].bytes,html().length);assert.equal(imports[0].source,undefined);
  }finally{await app.close();}
});
