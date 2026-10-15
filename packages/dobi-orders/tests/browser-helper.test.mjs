import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../browser-helper/popup.js',import.meta.url),'utf8')).replace(/\nrun\(load\);\s*$/,'');
const plain=value=>JSON.parse(JSON.stringify(value));
class Input {
  constructor(value='',options={}){this._value=value;this.type='text';this.name='';this.id='';this.autocomplete='';this.maxLength=-1;this.visible=true;this.disabled=false;this.readOnly=false;this.isConnected=true;this.events=[];this.writes=0;Object.assign(this,options);}
  get value(){return this._value;}
  set value(value){this._value=String(value);this.writes++;}
  getClientRects(){return this.visible?[{}]:[];}
  dispatchEvent(event){this.events.push(event.type);return true;}
}
class Textarea extends Input {
  get value(){return this._value;}
  set value(value){this._value=String(value);this.writes++;}
}
class Cell {
  constructor(text,visible=true){this.innerText=text;this.visible=visible;this.colSpan=1;this.rowSpan=1;}
  getClientRects(){return this.visible?[{}]:[];}
}
class Row {
  constructor(values,header=false,visible=true){this.cells=values.map(v=>new Cell(v));this.header=header;this.visible=visible;}
  getClientRects(){return this.visible?[{}]:[];}
  querySelectorAll(selector){return selector==='th'&&this.header?this.cells:[];}
  querySelector(selector){return selector==='th'&&this.header?this.cells[0]:null;}
}
class Table {
  constructor(headers,rows,visible=true){this.rows=[new Row(headers,true),...rows.map(r=>r instanceof Row?r:new Row(r))];this.visible=visible;}
  getClientRects(){return this.visible?[{}]:[];}
}
function harness({origin='https://vendor.test',nodes={},tables=[],tab={id:1,url:'https://vendor.test/apply'}}={}){
  const ui=new Map();
  const dummy=()=>({addEventListener(){},append(){},replaceChildren(){},classList:{toggle(){}}});
  const context=vm.createContext({URL,AbortSignal,Set,Map,console,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,location:{origin},CSS:{escape:value=>String(value)},Event:class{constructor(type){this.type=type;}},getComputedStyle:el=>({visibility:el.visible===false?'hidden':'visible',display:el.visible===false?'none':'block'}),document:{getElementById(id){if(!ui.has(id))ui.set(id,dummy());return ui.get(id);},querySelectorAll(selector){if(selector==='table')return tables;return nodes[selector]||[];},getElementsByName(name){return nodes['name:'+name]||[];}},chrome:{tabs:{query:async()=>[tab]}}});
  vm.runInContext(source,context);
  return {context,api:vm.runInContext('({prepareDraft,inspectDraftFields,fillDraftFields,scanVisibleOrders,activeTab,expectedOrigin})',context)};
}

test('브라우저 초안 후보는 인증·변환·분할·중복·비적격 매핑을 제외한다',()=>{
  const {api}=harness();
  const mapping=(field,selector,extra={})=>({field,selector,selector_type:'id',source_transform_calls:[],...extra});
  const prepared=plain(api.prepareDraft({items:[{orderNo:'A1',quantity:2}],recipient:'예제 수취인',postcode:'01234'}, {formMapping:[mapping('recipient','recipient'),mapping('quantity','quantity'),mapping('customsCode','password'),mapping('postcode','postcode',{source_transform_calls:[{name:'Substring'}]}),mapping('address','addr1'),mapping('address','addr2'),mapping('phone','phone',{autoEligible:false})]}));
  assert.deepEqual(prepared.candidates.map(m=>m.field),['recipient','quantity']);
  assert.equal(prepared.skipped.length,5);
  assert.equal(prepared.common.recipient,'예제 수취인');
  assert.equal(prepared.items[0].quantity,2);
});

test('초안 미리보기는 숨김·암호·체크박스·제출 요소를 읽거나 쓰지 않는다',()=>{
  const recipient=new Input('기존 수취인'),hidden=new Input('숨김',{visible:false}),password=new Input('',{type:'password'}),checkbox=new Input('on',{type:'checkbox'}),submit=new Input('신청',{type:'submit'}),product1=new Input('기존 상품1'),product2=new Input('기존 상품2'),qty=new Input('1'),otp=new Input('',{autocomplete:'one-time-code'});
  Object.defineProperty(password,'value',{get(){throw Error('암호 값을 읽으면 안 됩니다.');},set(){throw Error('암호 값을 쓰면 안 됩니다.');}});
  Object.defineProperty(otp,'value',{get(){throw Error('OTP 값을 읽으면 안 됩니다.');}});
  const nodes={'#recipient':[recipient],'#phone':[hidden],'#customs':[password],'#memo':[checkbox],'#order':[submit],'name:product':[product1,product2],'#qty':[qty],'#postcode':[otp]};
  const {api}=harness({nodes});
  const prepared={items:[{product:'상품1',quantity:1},{product:'상품2',quantity:2}],common:{recipient:'새 수취인',phone:'01000000000',customsCode:'P000000000000',deliveryMemo:'메모',orderNo:'A1',postcode:'01234'},candidates:[['recipient','#recipient'],['phone','#phone'],['customsCode','#customs'],['deliveryMemo','#memo'],['orderNo','#order'],['quantity','#qty'],['postcode','#postcode']].map(([field,selector])=>({field,selector,selector_type:'css'})).concat({field:'product',selector:'product',selector_type:'name'})};
  const plan=plain(api.inspectDraftFields('https://vendor.test',prepared));
  assert.deepEqual(plan.writes.map(w=>w.field),['recipient','product']);
  assert.equal(plan.skipped.length,6);
  assert.equal(recipient.value,'기존 수취인');
  assert.equal(product1.value,'기존 상품1');
  assert.equal(recipient.writes,0);
  assert.deepEqual(recipient.events,[]);
});

test('확인한 초안은 원값 변경·요소 수 변경을 건너뛰고 일반 input/change만 발생시킨다',()=>{
  const recipient=new Input('기존'),products=[new Input('기존1'),new Input('기존2')],postcode=new Input('01234');
  const nodes={'#recipient':[recipient],'name:product':products,'#postcode':[postcode]};
  const {api}=harness({nodes});
  const plan=plain(api.inspectDraftFields('https://vendor.test',{items:[{product:'상품1'},{product:'상품2'}],common:{recipient:'새 이름',postcode:'04567'},candidates:[{field:'recipient',selector:'#recipient',selector_type:'css'},{field:'product',selector:'product',selector_type:'name'},{field:'postcode',selector:'#postcode',selector_type:'css'}]}));
  recipient.value='사용자가 편집';nodes['#postcode']=[];
  const result=plain(api.fillDraftFields('https://vendor.test',plan));
  assert.deepEqual(result,{filled:2,skipped:2});
  assert.equal(recipient.value,'사용자가 편집');
  assert.deepEqual(products.map(p=>p.value),['상품1','상품2']);
  assert.deepEqual(products.map(p=>p.events),[['input','change'],['input','change']]);
});

test('다른 origin에서는 초안 읽기/쓰기가 즉시 거부된다',()=>{
  const recipient=new Input('보존');const {api}=harness({origin:'https://other.test',nodes:{'#recipient':[recipient]}});
  assert.match(api.inspectDraftFields('https://vendor.test',{items:[],common:{recipient:'변경'},candidates:[{field:'recipient',selector:'#recipient',selector_type:'css'}]}).error,/다릅니다/);
  assert.match(api.fillDraftFields('https://vendor.test',{writes:[{field:'recipient',selector:'#recipient',selector_type:'css',values:['변경'],previous:['보존']}]}).error,/다릅니다/);
  assert.equal(recipient.value,'보존');assert.equal(recipient.writes,0);
});

test('여러 주문 표를 분리해서 미리보고 18자리 ID와 문자열 우편번호를 보존한다',()=>{
  const hiddenRow=new Row(['비밀','숨김상품','1','9'],false,false);Object.defineProperty(hiddenRow.cells[0],'innerText',{get(){throw Error('숨김 행을 읽으면 안 됩니다.');}});
  const tables=[new Table(['주문번호','상품명','수량','결제금액'],[['999','숨김','1','900']],false),new Table(['주문번호','상품명','수량','결제금액','우편번호','주문일시'],[['123456789012345678','예제 상품','2','₩1,200','01234','2026-10-13 09:00'],['INVALID-QTY','상품','x','900','01234','2026-10-13'],['INVALID-MONEY','상품','1','미정','01234','2026-10-13']]),new Table(['주문번호','상품명','수량','금액'],[['B-0001','다른 표','1','500'],hiddenRow]),new Table(['주문번호','상품명','수량','수량'],[['DUP','모호한 표','1','2']])];
  const {api}=harness({tables});const result=plain(api.scanVisibleOrders('https://vendor.test'));
  assert.equal(result.tables.length,2);assert.equal(result.tables[0].skipped,2);
  assert.equal(result.tables[0].orders[0].orderNo,'123456789012345678');
  assert.equal(result.tables[0].orders[0].postcode,'01234');
  assert.equal(result.tables[0].orders[0].amount,1200);assert.equal(result.tables[0].orders[0].quantity,2);
  assert.equal(result.tables[0].orders[0].orderedAt,'2026-10-13');
  assert.equal(result.tables[1].orders[0].orderNo,'B-0001');
  assert.match(api.scanVisibleOrders('https://other.test').error,/다릅니다/);
});

test('주문 표의 모호한 배송 상태·날짜·복수 토큰 주문번호는 안전하게 제외한다',()=>{
  const table=new Table(['주문번호','상품명','수량','주문상태','주문일'],[['SHIPPED','상품','1','배송중','2026-10-13'],['BADDATE','상품','1','신규','2026-02-30'],['123\n복사','상품','1','신규','2026-10-13'],['VALID','상품','1','발송대기','2026-10-13']]);
  const {api}=harness({tables:[table]});const result=plain(api.scanVisibleOrders('https://vendor.test'));
  assert.equal(result.tables[0].orders.length,1);assert.equal(result.tables[0].skipped,3);assert.equal(result.tables[0].orders[0].orderNo,'VALID');
});

test('현재 탭은 origin 전체와 미리보기 당시 ID/URL이 모두 일치해야 한다',async()=>{
  let {api}=harness({tab:{id:3,url:'https://vendor.test/orders?page=1'}});
  assert.deepEqual(plain(await api.activeTab('https://vendor.test')),{id:3,url:'https://vendor.test/orders?page=1'});
  await assert.rejects(api.activeTab('https://vendor.test',{id:3,url:'https://vendor.test/orders?page=2'}),/미리보기/);
  ({api}=harness({tab:{id:3,url:'https://vendor.test.evil.test/orders'}}));
  await assert.rejects(api.activeTab('https://vendor.test'),/다릅니다/);
});
