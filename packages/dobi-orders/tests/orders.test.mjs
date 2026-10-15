import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import {createStore} from '../src/store.mjs';
import {parseFile,mapRows,exportOrders} from '../src/files.mjs';
import {createApp} from '../server.mjs';
const base={orderNo:'00001234567890123',lineId:'001',product:'테스트 상품',channel:'스마트스토어',account:'테스트',recipient:'예제 수령인',quantity:2,unitPrice:15000,orderedAt:'2026-10-13',phone:'010-0000-0000',postcode:'01234'};
test('중복 차단, 별도 품목 유지, 재시작 후 송장·메모·금액 보존',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'dobi-store-')),file=path.join(dir,'orders.sqlite');let s=createStore(file,dir);
  const o=s.insert(base);assert.equal(o.amount,30000);s.update(o.id,{workMemo:'상담 완료',carrier:'CJ대한통운',tracking:'00001234567'});
  assert.deepEqual(s.importOrders([base,{...base,lineId:'002',product:'다른 상품'}]),{inserted:1,duplicates:1});s.close();
  s=createStore(file,dir);assert.equal(s.all().length,2);assert.equal(s.get(o.id).tracking,'00001234567');assert.equal(s.get(o.id).workMemo,'상담 완료');assert.equal(s.get(o.id).postcode,'01234');s.close();
});
test('송장 필수·보류 발송 차단·일괄 롤백·동시 수정 충돌',()=>{
  const s=createStore(':memory:');const a=s.insert({...base,tracking:'000100',carrier:'한진택배'}),b=s.insert({...base,lineId:'2'});
  assert.throws(()=>s.bulk([a.id,b.id],{status:'배송중'}),/송장번호/);assert.equal(s.get(a.id).status,'신규');assert.equal(s.get(a.id).version,1);
  s.update(a.id,{onHold:true,holdReason:'입고 대기'});assert.throws(()=>s.update(a.id,{status:'배송중'}),/보류/);
  assert.throws(()=>s.update(a.id,{workMemo:'다른 화면'},1),/다른 화면/);s.update(a.id,{onHold:false,status:'배송중'},2);assert.equal(s.get(a.id).status,'배송중');s.close();
});
test('판매처별 같은 주문번호 송장 매칭 모호성 차단·입력 오류 롤백',()=>{
  const s=createStore(':memory:');const a=s.insert(base),b=s.insert({...base,channel:'쿠팡'});
  assert.throws(()=>s.importTracking([{orderNo:base.orderNo,carrier:'CJ대한통운',tracking:'000345'}]),/판매처/);
  assert.equal(s.get(a.id).tracking,'');
  assert.throws(()=>s.importTracking([{orderNo:base.orderNo,channel:'스마트스토어',carrier:'CJ대한통운',tracking:'000345'},{orderNo:'없음',carrier:'CJ대한통운',tracking:'000123'}]),/일치하는/);
  assert.equal(s.get(a.id).tracking,'');assert.deepEqual(s.importTracking([{orderNo:base.orderNo,channel:'쿠팡',carrier:'CJ대한통운',tracking:'000345'}]),{updated:1});assert.equal(s.get(b.id).tracking,'000345');s.close();
});
test('XLSX·CSV 헤더 연결·긴 문자열 보존·수량 검증·수식 안전 내보내기',async()=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('주문');ws.addRow(['주문번호','상품주문번호','상품명','선택사항','수량','단가','수취인휴대폰','우편번호']);ws.addRow([base.orderNo,'000001','=CMD(1)','화이트',2,15000,'010-0000-0000','01234']);
  const parsed=await parseFile('orders.xlsx',Buffer.from(await wb.xlsx.writeBuffer()));const mapped=mapRows(parsed,parsed.mapping,{channel:'쿠팡'});assert.equal(mapped.errors.length,0);assert.equal(mapped.rows[0].amount,30000);assert.equal(mapped.rows[0].lineId,'000001');assert.equal(mapped.rows[0].phone,'010-0000-0000');
  const csv=await exportOrders(mapped.rows,'csv');assert.match(csv.bytes.toString(),/"'=CMD\(1\)"/);
  const xlsx=await exportOrders(mapped.rows,'xlsx');const read=new ExcelJS.Workbook();await read.xlsx.load(xlsx.bytes);const pcol=read.worksheets[0].getRow(1).values.indexOf('상품명');assert.equal(read.worksheets[0].getRow(2).getCell(pcol).type,ExcelJS.ValueType.String);
  const invalid=await parseFile('orders.csv',Buffer.from('주문번호,상품名,상품명,수량\n0001,x,상품,-2'));assert.equal(mapRows(invalid,invalid.mapping).errors.length,1);
});
test('백업 검증·복원·기존 데이터 사본 유지',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'dobi-backup-')),s=createStore(path.join(dir,'orders.sqlite'),dir);s.insert(base);const snapshot=s.snapshot();s.insert({...base,lineId:'2'});
  assert.throws(()=>s.restore({...snapshot,orders:[base,base]}),/중복/);assert.equal(s.all().length,2);
  const result=s.restore(snapshot);assert.equal(result.restored,1);assert.equal(s.all().length,1);assert.ok(existsSync(result.backupPath));assert.equal(s.history(snapshot.orders[0].id)[0].created_at,snapshot.history[0].created_at);s.close();
});
test('HTTP 실제 저장·검색·변경, cross-origin 및 토큰 없는 쓰기 차단',async()=>{
  const app=await createApp({dbPath:':memory:'});try{
    const boot=await fetch(app.url+'/api/bootstrap').then(r=>r.json());
    assert.equal((await fetch(app.url+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base)})).status,403);
    const headers={'Content-Type':'application/json','X-Dobi-Token':boot.token};
    assert.equal((await fetch(app.url+'/api/orders',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:JSON.stringify(base)})).status,403);
    const response=await fetch(app.url+'/api/orders',{method:'POST',headers,body:JSON.stringify(base)});assert.equal(response.status,201);const o=await response.json();
    const list=await fetch(app.url+'/api/orders?q='+encodeURIComponent('테스트')).then(r=>r.json());assert.equal(list.total,1);
    const change=await fetch(app.url+'/api/orders/'+o.id,{method:'PATCH',headers,body:JSON.stringify({expectedVersion:1,patch:{workMemo:'브라우저 상담'}})});assert.equal(change.status,200);
    const detail=await fetch(app.url+'/api/orders/'+o.id).then(r=>r.json());assert.equal(detail.order.workMemo,'브라우저 상담');assert.equal(detail.history.length,2);
    assert.equal((await fetch(app.url+'/api/export?format=xlsx')).status,200);
  }finally{await app.close();}
});
test('실제 파일 업로드 API → 열 연결 → 검증 → 저장 → 중복 가져오기',async()=>{
  const app=await createApp({dbPath:':memory:'});try{
    const post=async(route,data)=>{const response=await fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Dobi-Token':app.token},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
    const csv='주문번호,품목번호,상품명,수량,단가,송장번호\n000000001,0001,테스트 상품,2,13000,0000002345\n000000001,0002,다른 상품,1,5000,';
    for(let i=0;i<2;i++){
      const parsed=await post('/api/import/parse',{name:'orders.csv',content:Buffer.from(csv).toString('base64')});assert.equal(parsed.status,200);
      const request={id:parsed.data.id,mapping:parsed.data.mapping,defaults:{channel:'스마트스토어',account:'검증 계정'}};
      const preview=await post('/api/import/preview',request);assert.equal(preview.data.valid,2);assert.equal(preview.data.rows[0].amount,26000);
      const result=await post('/api/import/commit',request);assert.deepEqual(result.data,i?{inserted:0,duplicates:2}:{inserted:2,duplicates:0});
    }
    const persisted=app.store.all();assert.equal(persisted.length,2);assert.equal(persisted.find(o=>o.lineId==='0001').tracking,'0000002345');
  }finally{await app.close();}
});
