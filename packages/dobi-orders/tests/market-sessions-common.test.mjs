import test from 'node:test';import assert from 'node:assert/strict';
import {baseOrder,newTransport} from '../src/integrations/market-sessions/common.mjs';
import {normalizeOrder,STATUSES} from '../src/store.mjs';
test('market order canonical day and numeric values survive raw source field spread',()=>{
 const o=baseOrder('합성 판매처','합성 계정',{orderNo:'0000123',lineId:'0001',orderedAt:'2026-10-01T23:59:59+09:00',product:'<b>합성 상품</b>',quantity:'2',amount:'19,999',unitPrice:'9,999'});assert.equal(o.orderedAt,'2026-10-01');assert.equal(o.quantity,2);assert.equal(o.amount,19999);assert.equal(o.unitPrice,9999);assert.equal(o.product,'합성 상품');assert.equal(o.orderNo,'0000123');
});
test('market transport preserves authentication classification but never lower-level raw error',async()=>{
 const request=newTransport({request(){const e=Error('private token and response');e.code='SESSION_REQUIRED';e.status=401;throw e;}});await assert.rejects(request('https://example.invalid'),e=>e.code==='SESSION_REQUIRED'&&e.status===401&&!e.message.includes('private'));
});
test('market masked destination cannot be made fulfillable by provider source metadata',()=>{
 const o=baseOrder('합성 판매처','합성 계정',{orderNo:'123',lineId:'1',orderedAt:'2026-10-01',product:'합성 상품',quantity:1,amount:10000,status:'신규',recipient:'합성*',phone:'010-****-1234',postcode:'00123',address:'합성 주소',sourceIds:{fulfillableQty:1}});assert.equal(o.sourceIds.fulfillableQty,0);assert.equal(o.sourceIds.needsReview,true);
});
test('market masked invoice is not stored as an invalid shipment number',()=>{
 const order=baseOrder('합성 판매처','합성 계정',{orderNo:'123',lineId:'1',orderedAt:'2026-10-01',product:'합성 상품',quantity:1,amount:10000,status:'배송중',tracking:'0000****1234'});assert.equal(order.tracking,'');assert.equal(order.sourceIds.trackingMasked,true);assert.equal(order.sourceIds.fulfillableQty,0);assert.equal(normalizeOrder(order,{},{remote:true}).status,'배송중');
});
test('market claim-status aliases normalize into actual store-supported order and claim values',()=>{
 for(const [remote,status,claimType] of [['취소요청','취소','취소요청'],['반품요청','배송완료','반품요청'],['교환요청','발송대기','교환요청'],...STATUSES.map(s=>[s,s,'없음'])]){
  const order=baseOrder('합성 판매처','합성 계정',{orderNo:'123',lineId:'1',orderedAt:'2026-10-01T23:59:59+09:00',product:'합성 상품',quantity:'2',amount:'10000',status:remote});const saved=normalizeOrder(order,{},{remote:true});assert.equal(saved.status,status);assert.equal(saved.claimType,claimType);assert.equal(saved.orderedAt,'2026-10-01');assert.equal(saved.sourceStatus,remote);if(claimType!=='없음')assert.equal(saved.sourceIds.fulfillableQty,0);
 }
 assert.throws(()=>baseOrder('합성 판매처','합성 계정',{orderNo:'123',lineId:'1',orderedAt:'2026-10-01',product:'합성 상품',quantity:1,amount:10000,status:'알 수 없는 상태'}),e=>e.code==='INVALID_RESPONSE');
});
