import { validateReference } from "./reference.mjs";
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const STATUSES = ['신규','발송대기','배송중','배송완료','구매확정','취소'];
export const WORK_STATES = ['미지정','대기중','진행중','지연됨','완료됨'];
export const CLAIMS = ['없음','취소요청','반품요청','교환요청','처리완료'];
export const CHANNELS = ['스마트스토어','쿠팡','지마켓','옥션','11번가','롯데온','카페24','기타'];
export const CARRIERS = ['CJ대한통운','한진택배','롯데택배','우체국택배','로젠택배','경동택배','직접배송'];
export class AppError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
const text = (v,max=2000) => String(v??'').trim().slice(0,max);
const now = () => new Date().toISOString();
export function orderKey(o) { return JSON.stringify([o.channel,o.account,o.orderNo,o.lineId]); }
export function normalizeOrder(input, existing={}, options={}) {
  const o={...existing,...input};
  for(const f of ['channel','account','orderNo','lineId','product','sku','option','buyer','recipient','phone','postcode','address','deliveryMemo','carrier','tracking','holdReason','workMemo','claimNote']) o[f]=text(o[f],f==='address'||f.endsWith('Memo')||f.endsWith('Note')?4000:400);
  o.channel ||= '기타'; o.account ||= '기본 계정';
  if(!o.orderNo || !o.product) throw new AppError('주문번호와 상품명을 입력해주세요.');
  if(!o.lineId&&!(o.sourceConnectionId&&o.sourceIds?.provider==='esm'))o.lineId=createHash('sha256').update(JSON.stringify([o.product,o.option,o.sku])).digest('hex').slice(0,16);
  o.status ||= '신규'; o.workStatus ||= '미지정'; o.claimType ||= '없음';
  if(!STATUSES.includes(o.status)||!WORK_STATES.includes(o.workStatus)||!CLAIMS.includes(o.claimType)) throw new AppError('지원하지 않는 주문·작업·클레임 상태입니다.');
  o.quantity=Number(o.quantity??1); o.unitPrice=Number(o.unitPrice??0); o.shippingFee=Number(o.shippingFee??0); o.fee=Number(o.fee??0);
  o.amount=Number(o.amount??o.quantity*o.unitPrice); o.expectedAmount=Number(o.expectedAmount??o.amount-o.fee);
  if(!Number.isInteger(o.quantity)||o.quantity<1||o.quantity>100000) throw new AppError('수량은 1~100,000 사이 정수여야 합니다.');
  for(const f of ['unitPrice','shippingFee','fee','amount','expectedAmount']) if(!Number.isFinite(o[f])||!Number.isSafeInteger(o[f])||o[f]<0||o[f]>1e12) throw new AppError('금액은 0 이상인 정수로 입력해주세요.');
  o.onHold=Boolean(o.onHold); o.demo=Boolean(o.demo);
  if(o.onHold && !o.holdReason) throw new AppError('보류 사유를 입력해주세요.');
  if(o.tracking && !/^[\w -]{3,60}$/u.test(o.tracking)) throw new AppError('송장번호 형식을 확인해주세요.');
  if(['배송중','배송완료','구매확정'].includes(o.status) && (!o.tracking||!o.carrier) && !options.remote && !(existing.sourceConnectionId&&existing.status===o.status)) throw new AppError('배송 상태를 변경하려면 택배사와 송장번호가 필요합니다.');
  if(o.onHold && o.status==='배송중' && existing.status!=='배송중' && !options.remote) throw new AppError('보류를 해제한 다음 발송 처리해주세요.');
  const rawDate=text(o.orderedAt)||new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}/.test(rawDate)||!Number.isFinite(Date.parse(rawDate))) throw new AppError('주문일은 YYYY-MM-DD 형식으로 입력해주세요.');
  o.orderedAt=rawDate.slice(0,10);
  o.holdUntil=text(o.holdUntil,10);
  if(o.holdUntil && !/^\d{4}-\d{2}-\d{2}$/.test(o.holdUntil)) throw new AppError('보류 예정일 형식을 확인해주세요.');
  return Object.fromEntries(Object.entries(o).filter(([k])=>!['id','version','createdAt','updatedAt','expectedVersion'].includes(k)));
}

export function createStore(filename, backupDir) {
  if(filename!==':memory:') mkdirSync(path.dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, external_key TEXT UNIQUE NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, channel TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(channel,name));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS integration_runs (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS forwarding (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS reference_data (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_drafts (owner_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner_id,key));
    CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, registration_number TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_business (channel TEXT NOT NULL, account TEXT NOT NULL, business_id TEXT NOT NULL, PRIMARY KEY(channel,account));`);
  db.exec(`CREATE TABLE IF NOT EXISTS forwarder_imports (id TEXT PRIMARY KEY, forwarder_id TEXT NOT NULL, provider_id TEXT NOT NULL, account_name TEXT NOT NULL, filename TEXT NOT NULL, source_hash TEXT NOT NULL, source BLOB NOT NULL, counts TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(forwarder_id,source_hash));
    CREATE TABLE IF NOT EXISTS forwarder_shipments (id TEXT PRIMARY KEY, forwarder_id TEXT NOT NULL, application_no TEXT NOT NULL, status TEXT, tracking TEXT NOT NULL, data TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES forwarder_imports(id), version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(forwarder_id,application_no));
    CREATE INDEX IF NOT EXISTS forwarder_shipments_lookup ON forwarder_shipments(forwarder_id,status);`);
  function reference(key,seed){const row=db.prepare('SELECT value FROM reference_data WHERE key=?').get(key);if(row){try{return validateReference(key,JSON.parse(row.value));}catch{throw new AppError('목록 데이터를 확인해주세요.');}}saveReference(key,seed);return structuredClone(seed);}
  function saveReference(key,value){try{validateReference(key,value);}catch{throw new AppError('목록 데이터를 확인해주세요.');}db.prepare('INSERT INTO reference_data VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  function draft(owner,key){const row=db.prepare('SELECT data FROM workspace_drafts WHERE owner_id=? AND key=?').get(owner,key);return row?JSON.parse(row.data):null;}
  function saveDraft(owner,key,data){db.prepare('INSERT INTO workspace_drafts VALUES(?,?,?) ON CONFLICT(owner_id,key) DO UPDATE SET data=excluded.data').run(owner,key,JSON.stringify(data));}
  function removeDraft(owner,key){db.prepare('DELETE FROM workspace_drafts WHERE owner_id=? AND key=?').run(owner,key);}
  function accountBusinesses(){return db.prepare('SELECT channel,account,business_id AS businessId FROM account_business').all();}
  function businesses(){return db.prepare('SELECT id,name,registration_number AS registrationNumber FROM businesses ORDER BY name').all();}
  function saveBusiness(input){const name=text(input.name,120),number=text(input.registrationNumber,20);if(!name)throw new AppError('사업자명을 입력해주세요.');const id=randomUUID();db.prepare('INSERT INTO businesses VALUES(?,?,?)').run(id,name,number);return businesses().find(x=>x.id===id);}
  function assignBusiness(channel,account,businessId){if(!businesses().some(b=>b.id===businessId))throw new AppError('사업자를 확인해주세요.');db.prepare('INSERT INTO account_business VALUES(?,?,?) ON CONFLICT(channel,account) DO UPDATE SET business_id=excluded.business_id').run(text(channel,200),text(account,200),businessId);}
  const unpack=r=>r?{...JSON.parse(r.data),id:r.id,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at}:null;
  const get=id=>unpack(db.prepare('SELECT * FROM orders WHERE id=?').get(id));
  const all=()=>db.prepare('SELECT * FROM orders ORDER BY updated_at DESC,id').all().map(unpack);
  let transactionDepth=0;
  function transaction(fn) { if(transactionDepth)return fn();db.exec('BEGIN IMMEDIATE');transactionDepth++;try {const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}finally{transactionDepth--;} }
  function history(id,kind,message) { db.prepare('INSERT INTO history(order_id,kind,message,created_at) VALUES(?,?,?,?)').run(id,kind,message,now()); }
  function addAccount(channel,name) { channel=text(channel,200);name=text(name,200);if(!channel||!name) throw new AppError('판매처와 계정 이름을 입력해주세요.'); db.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?,?)').run(randomUUID(),channel,name); }
  function insert(input,kind='주문 등록') {
    const o=normalizeOrder(input), key=orderKey(o);
    if(db.prepare('SELECT id FROM orders WHERE external_key=?').get(key)) throw new AppError('같은 판매처·계정·주문번호·품목의 주문이 이미 있습니다.',409);
    const id=randomUUID(),timestamp=now();
    db.prepare('INSERT INTO orders VALUES(?,?,?,1,?,?)').run(id,key,JSON.stringify(o),timestamp,timestamp);addAccount(o.channel,o.account);history(id,kind,`${o.orderNo} / ${o.product}`);return get(id);
  }
  function update(id,patch,expectedVersion) {
    const before=get(id); if(!before) throw new AppError('주문을 찾을 수 없습니다.',404);
    if(expectedVersion!==undefined && Number(expectedVersion)!==before.version) throw new AppError('다른 화면에서 주문이 변경되었습니다. 새로고침 후 다시 저장해주세요.',409);
    const data=normalizeOrder(patch,before);
    if(db.prepare('SELECT id FROM orders WHERE external_key=? AND id<>?').get(orderKey(data),id)) throw new AppError('동일한 주문 품목이 이미 존재합니다.',409);
    const changes=Object.keys(data).filter(k=>JSON.stringify(data[k])!==JSON.stringify(before[k]));
    if(!changes.length) return before;
    db.prepare('UPDATE orders SET external_key=?,data=?,version=version+1,updated_at=? WHERE id=?').run(orderKey(data),JSON.stringify(data),now(),id);
    addAccount(data.channel,data.account);
    const labels={status:'주문상태',workStatus:'작업상태',onHold:'보류',holdReason:'보류 사유',tracking:'송장번호',carrier:'택배사',workMemo:'작업 메모',claimType:'클레임',claimNote:'클레임 메모'};
    history(id,'주문 수정',changes.map(k=>labels[k]||k).join(', ')+' 변경');return get(id);
  }
  function query(params={}) {
    let orders=all();
    const q=text(params.q).toLocaleLowerCase();
    if(q) orders=orders.filter(o=>['orderNo','lineId','product','sku','option','buyer','recipient','phone','tracking','address','workMemo','claimNote','account'].some(f=>String(o[f]||'').toLocaleLowerCase().includes(q)));
    for(const f of ['status','channel','account','workStatus']) if(params[f]) orders=orders.filter(o=>o[f]===params[f]);
    if(params.onHold==='true') orders=orders.filter(o=>o.onHold);
    if(params.onHold==='false') orders=orders.filter(o=>!o.onHold);
    if(params.claim==='active') orders=orders.filter(o=>!['없음','처리완료'].includes(o.claimType));
    if(params.claim==='any') orders=orders.filter(o=>o.claimType!=='없음');
    if(params.memo==='true') orders=orders.filter(o=>o.workMemo||o.claimNote);
    if(params.tracking==='missing') orders=orders.filter(o=>!o.tracking);
    if(params.from) orders=orders.filter(o=>o.orderedAt>=params.from);
    if(params.to) orders=orders.filter(o=>o.orderedAt<=params.to);
    if(params.sort==='date') orders.sort((a,b)=>b.orderedAt.localeCompare(a.orderedAt));
    if(params.sort==='amount') orders.sort((a,b)=>b.amount-a.amount);
    if(params.businessId)orders=orders.filter(o=>db.prepare('SELECT business_id FROM account_business WHERE channel=? AND account=?').get(o.channel,o.account)?.business_id===params.businessId);
    const total=orders.length,amount=orders.reduce((s,o)=>s+o.amount,0),quantity=orders.reduce((s,o)=>s+o.quantity,0);
    const limit=Math.min(500,Math.max(1,Number(params.limit)||50)),page=Math.max(1,Number(params.page)||1);
    return {orders:params.all==='true'?orders:orders.slice((page-1)*limit,page*limit),total,amount,quantity,page,limit};
  }
  function stats() {
    const orders=all(),counts=Object.fromEntries(STATUSES.map(s=>[s,0])),channels={},daily={};
    for(const o of orders){ counts[o.status]++;(channels[o.channel]??={count:0,amount:0}).count++;channels[o.channel].amount+=o.amount;(daily[o.orderedAt]??={count:0,amount:0}).count++;daily[o.orderedAt].amount+=o.amount; }
    return {total:orders.length,counts,onHold:orders.filter(o=>o.onHold).length,activeClaims:orders.filter(o=>!['없음','처리완료'].includes(o.claimType)).length,missingTracking:orders.filter(o=>['신규','발송대기'].includes(o.status)&&!o.tracking&&!o.onHold).length,amount:orders.reduce((s,o)=>s+o.amount,0),expectedAmount:orders.reduce((s,o)=>s+o.expectedAmount,0),demo:orders.filter(o=>o.demo).length,channels,daily};
  }
  function importOrders(rows) { return transaction(()=>{let inserted=0,duplicates=0;for(const row of rows){const o=normalizeOrder(row);if(db.prepare('SELECT id FROM orders WHERE external_key=?').get(orderKey(o))){duplicates++;continue;}insert(o,'파일 가져오기');inserted++;}history(null,'주문 가져오기',`${inserted}건 등록, 중복 ${duplicates}건 건너뜀`);return {inserted,duplicates};}); }
  function bulk(ids,patch) { if(!Array.isArray(ids)||!ids.length||ids.length>500)throw new AppError('1~500건의 주문을 선택해주세요.');return transaction(()=>{const result=[...new Set(ids)].map(id=>update(id,patch));history(null,'일괄 처리',`${result.length}건 처리`);return {updated:result.length};}); }
  function importTracking(rows) {return transaction(()=>{let updated=0;for(const row of rows){let matches=all().filter(o=>o.orderNo===row.orderNo&&(!row.channel||o.channel===row.channel)&&(!row.account||o.account===row.account)&&(!row.lineId||o.lineId===row.lineId));if(!matches.length)throw new AppError(`${row.orderNo}: 일치하는 주문이 없습니다.`);const groups=new Set(matches.map(o=>JSON.stringify([o.channel,o.account])));if(groups.size>1)throw new AppError(`${row.orderNo}: 판매처/계정을 지정해주세요.`);for(const o of matches){update(o.id,{carrier:row.carrier,tracking:row.tracking});updated++;}}return {updated};});}
  function connections(){return db.prepare('SELECT data FROM connections ORDER BY rowid').all().map(r=>JSON.parse(r.data));}
  function connection(id){return connections().find(c=>c.id===id);}
  function saveConnection(input){const before=input.id?connection(input.id):null;if(input.id&&!before)throw new AppError('연결 계정을 찾을 수 없습니다.',404);const c={...before,...input,id:before?.id||randomUUID(),updatedAt:now(),createdAt:before?.createdAt||now()};db.prepare('INSERT INTO connections VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(c.id,JSON.stringify(c));return c;}
  function integrationRun(connectionId,kind,state,summary){const r={id:randomUUID(),connectionId,kind,state,summary,createdAt:now()};db.prepare('INSERT INTO integration_runs VALUES(?,?,?,?,?,?)').run(r.id,connectionId,kind,state,JSON.stringify(summary),r.createdAt);return r;}
  function runs(id){return db.prepare('SELECT * FROM integration_runs'+(id?' WHERE connection_id=?':'')+' ORDER BY created_at DESC,rowid DESC LIMIT 100').all(...(id?[id]:[])).map(r=>({id:r.id,connectionId:r.connection_id,kind:r.kind,state:r.state,summary:JSON.parse(r.summary),createdAt:r.created_at}));}
  function syncOrders(c,rows){if(!Array.isArray(rows)||rows.length>10000)throw new AppError('수집 주문은 10,000품목 이하이어야 합니다.');return transaction(()=>{let inserted=0,updated=0,unchanged=0;const seen=new Set();for(const row of rows){const remote={...row,channel:c.channel,account:c.name,sourceConnectionId:c.id,demo:false};delete remote.qty;if(row.claimType!==undefined){if(!CLAIMS.includes(row.claimType))throw new AppError('알 수 없는 판매처 클레임 상태입니다.');remote.sourceClaimType=row.claimType;}const available=row.sourceIds?.fulfillableQty??row.sourceIds?.remainQuantity;if(available!==undefined&&Number.isSafeInteger(Number(available)))remote.sourceFulfillableQty=Number(available);for(const field of ['workStatus','onHold','holdReason','holdUntil','workMemo','claimType','claimNote'])delete remote[field];if(remote.sourceClaimType!==undefined)remote.claimType=remote.sourceClaimType;const preliminary=normalizeOrder(remote,{}, {remote:true}),key=orderKey(preliminary);if(seen.has(key))throw new AppError('수집 결과에 같은 주문 품목이 반복됩니다. 페이지·품목번호 매핑을 확인해주세요.');seen.add(key);const record=db.prepare('SELECT * FROM orders WHERE external_key=?').get(key),before=unpack(record);if(before?.sourceConnectionId&&before.sourceConnectionId!==c.id)throw new AppError('다른 연결 계정이 관리하는 주문과 중복됩니다. 계정 이름을 구분해주세요.');if(before){if(remote.sourceClaimType!==undefined&&before.claimType!==(before.sourceClaimType||'없음'))delete remote.claimType;if(!remote.tracking&&before.tracking)remote.tracking=before.tracking;if(!remote.carrier&&before.carrier)remote.carrier=before.carrier;const next=normalizeOrder(remote,before,{remote:true});const changed=Object.keys(next).some(k=>JSON.stringify(next[k])!==JSON.stringify(before[k]));if(changed){db.prepare('UPDATE orders SET data=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(next),now(),before.id);history(before.id,'API 수집 갱신','판매처 주문 정보 갱신');updated++;}else unchanged++;}else{const id=randomUUID(),timestamp=now();db.prepare('INSERT INTO orders VALUES(?,?,?,1,?,?)').run(id,key,JSON.stringify(preliminary),timestamp,timestamp);history(id,'API 주문 수집','판매처에서 주문 품목 수집');inserted++;}addAccount(c.channel,c.name);}history(null,'API 주문 수집',`${c.channel} ${inserted}건 추가, ${updated}건 갱신, ${unchanged}건 동일`);return {inserted,updated,unchanged,total:rows.length};});}
  const unpackForward=r=>r?{...JSON.parse(r.data),id:r.id,connectionId:r.connection_id,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at}:null;
  function forwarding(){return db.prepare('SELECT * FROM forwarding ORDER BY created_at DESC').all().map(unpackForward);}
  function forward(id){return unpackForward(db.prepare('SELECT * FROM forwarding WHERE id=?').get(id));}
  function hasRemoteClaim(order){if(!order)return false;const active=o=>['취소요청','반품요청','교환요청'].includes(o.sourceClaimType||o.claimType);return active(order)||(order.sourceFulfillableQty!==undefined&&order.sourceFulfillableQty<order.quantity)||Boolean(order.sourceConnectionId&&all().some(other=>other.sourceConnectionId===order.sourceConnectionId&&other.orderNo===order.orderNo&&other.sourceIds?.orderLevelClaim===true&&active(other)));}
  function createForward(connectionId,ids,extra={}){const c=connection(connectionId);if(c?.kind!=='forwarder')throw new AppError('배송대행지 연결을 선택해주세요.');if(!Array.isArray(ids)||!ids.length||ids.length>100)throw new AppError('1~100품목을 선택해주세요.');const orders=[...new Set(ids)].map(id=>{const o=get(id);if(!o)throw new AppError('선택 주문을 찾을 수 없습니다.');if(o.onHold||o.status==='취소')throw new AppError('보류·취소 주문은 배송신청에서 제외해주세요.');if(hasRemoteClaim(o))throw new AppError('판매처 클레임·부분 수량을 확인한 뒤 배송신청해주세요.');return o;});if(orders.some(o=>[o.recipient,o.phone,o.postcode,o.address].some(v=>!v)))throw new AppError('배송신청에는 수령인·전화·우편번호·주소가 필요합니다.');if(forwarding().some(d=>d.state!=='보관됨'&&d.orderIds.some(id=>orders.some(o=>o.id===id))))throw new AppError('선택 주문의 배송신청 초안 또는 접수 내역이 이미 있습니다. 작성중 초안은 먼저 보관해주세요.');const groups=Map.groupBy(orders,o=>JSON.stringify([o.recipient,o.phone,o.postcode,o.address]));return transaction(()=>{const drafts=[];for(const group of groups.values()){const first=group[0],id=randomUUID(),timestamp=now(),data={state:'작성중',orderIds:group.map(o=>o.id),orderVersions:Object.fromEntries(group.map(o=>[o.id,o.version])),recipient:first.recipient,phone:first.phone,postcode:first.postcode,address:first.address,deliveryMemo:first.deliveryMemo,customsCode:text(extra.customsCode,100),warehouse:text(extra.warehouse,200),items:group.map(o=>({orderNo:o.orderNo,lineId:o.lineId,product:o.product,option:o.option,sku:o.sku,quantity:o.quantity,unitPrice:o.unitPrice,amount:o.amount})),clientReference:id,applicationId:'',carrier:'',tracking:'',memo:text(extra.memo,2000)};db.prepare('INSERT INTO forwarding VALUES(?,?,?,1,?,?)').run(id,c.id,JSON.stringify(data),timestamp,timestamp);drafts.push(forward(id));}history(null,'배송대행 초안',`${drafts.length}개 배송지 초안 생성`);return drafts;});}
  function updateForward(id,patch,version){const before=forward(id);if(!before)throw new AppError('배송신청 초안을 찾을 수 없습니다.',404);if(version!==undefined&&version!==before.version)throw new AppError('배송신청이 변경되었습니다. 다시 확인해주세요.',409);const next={...before,...patch};delete next.id;delete next.connectionId;delete next.version;delete next.createdAt;delete next.updatedAt;db.prepare('UPDATE forwarding SET data=?,version=version+1,updated_at=? WHERE id=?').run(JSON.stringify(next),now(),id);return forward(id);}
  function applyForwardTracking(c,rows){if(!Array.isArray(rows)||rows.length>10000)throw new AppError('송장 조회 범위를 줄여주세요.');return transaction(()=>{let updated=0,unmatched=0;const seen=new Map();for(const row of rows){if(!row.tracking||!row.carrier)continue;let matches=forwarding().filter(d=>d.connectionId===c.id&&d.state!=='작성중'&&(row.applicationId?d.applicationId===String(row.applicationId):d.items.some(i=>i.orderNo===String(row.orderNo)&&(!row.lineId||i.lineId===String(row.lineId)))));if(!matches.length){unmatched++;continue;}if(matches.length!==1)throw new AppError('배송대행 송장의 주문 매칭이 모호합니다. 접수번호를 지정해주세요.');const d=matches[0];const pair=JSON.stringify([row.carrier,row.tracking]);if(seen.has(d.id)&&seen.get(d.id)!==pair)throw new AppError('한 배송신청에 서로 다른 송장이 있습니다. 품목별로 확인해주세요.');seen.set(d.id,pair);if(d.tracking===String(row.tracking)&&d.carrier===String(row.carrier))continue;for(const id of d.orderIds)update(id,{tracking:String(row.tracking),carrier:String(row.carrier)});updateForward(d.id,{state:'송장회수',carrier:String(row.carrier),tracking:String(row.tracking)});updated++;}return {updated,unmatched};});}
  function registerForwardReceipt(id,values){return transaction(()=>{const d=forward(id);if(!d)throw new AppError('배송신청을 찾을 수 없습니다.',404);if(d.state==='전송중'||d.state==='보관됨')throw new AppError('전송중 또는 보관된 배송신청은 접수 등록할 수 없습니다.',409);const number=text(values.applicationId,200);if(!number)throw new AppError('접수번호를 입력해주세요.');if(forwarding().some(f=>f.id!==id&&f.connectionId===d.connectionId&&f.applicationId===number))throw new AppError('같은 배송대행지의 다른 신청에서 사용 중인 접수번호입니다.');if(Boolean(values.tracking)!==Boolean(values.carrier))throw new AppError('택배사와 송장번호를 함께 입력해주세요.');updateForward(id,{applicationId:number,state:'신청완료'},values.expectedVersion);if(values.tracking)applyForwardTracking(connection(d.connectionId),[{applicationId:number,tracking:values.tracking,carrier:values.carrier}]);return forward(id);});}
  function snapshot() {return {shipmentHistory:forwarderSnapshot(),workspaceData:{businesses:businesses(),accountBusinesses:db.prepare('SELECT * FROM account_business').all(),references:db.prepare('SELECT * FROM reference_data').all(),drafts:db.prepare('SELECT * FROM workspace_drafts').all()},format:'dobi-orders',version:1,exportedAt:now(),orders:all(),accounts:db.prepare('SELECT * FROM accounts').all(),history:db.prepare('SELECT * FROM history').all(),connections:connections().map(c=>({...Object.fromEntries(['id','providerId','channel','kind','name','mode','recipe','site','sellerId','vendorId','host','shopNo','loginType','storeName','identityId','identityLabel','identitySource','sessionImportedAt','lastRunAt','createdAt','updatedAt'].filter(k=>c[k]!==undefined&&(k!=='recipe'||c.mode==='api')).map(k=>[k,c[k]])),state:'인증 필요',lastError:''})),forwarding:forwarding(),settings:JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('settings')?.value||'{}')};}
  function restore(input) {
    if(input?.format!=='dobi-orders'||input.version!==1||!Array.isArray(input.orders)||input.orders.length>100000||!Array.isArray(input.accounts)||!Array.isArray(input.history)||input.history.length>500000)throw new AppError('지원하는 도비 오더스 백업 파일이 아닙니다.');
    const shipmentHistory=validateForwarderSnapshot(input.shipmentHistory);
    const workspace=input.workspaceData;
    if(workspace&&(!Array.isArray(workspace.businesses)||!Array.isArray(workspace.accountBusinesses)||!Array.isArray(workspace.references)||!Array.isArray(workspace.drafts)||Object.values(workspace).some(v=>!Array.isArray(v)||v.length>100000)))throw new AppError('작업실 백업을 확인해주세요.');
    if(workspace){for(const b of workspace.businesses)if(typeof b.id!=='string'||typeof b.name!=='string'||!b.name)throw new AppError('사업자 백업을 확인해주세요.');for(const r of workspace.references){if(!['catalog','channels','carriers'].includes(r.key)||typeof r.value!=='string')throw new AppError('목록 백업을 확인해주세요.');try{JSON.parse(r.value);}catch{throw new AppError('목록 백업을 확인해주세요.');}}for(const d of workspace.drafts){if(typeof d.owner_id!=='string'||typeof d.key!=='string'||typeof d.data!=='string')throw new AppError('임시 저장 백업을 확인해주세요.');try{JSON.parse(d.data);}catch{throw new AppError('임시 저장 백업을 확인해주세요.');}}}
    const validated=input.orders.map(o=>({...normalizeOrder(o,{}, {remote:Boolean(o.sourceConnectionId)}),id:text(o.id,100),version:Number(o.version)||1,createdAt:o.createdAt||now(),updatedAt:o.updatedAt||now()}));
    if(validated.some(o=>!o.id)||new Set(validated.map(o=>o.id)).size!==validated.length||new Set(validated.map(orderKey)).size!==validated.length)throw new AppError('백업 파일에 중복 또는 잘못된 주문이 있습니다.');
    if(input.connections!==undefined&&(!Array.isArray(input.connections)||input.connections.length>5000))throw new AppError('연결 계정 백업을 확인해주세요.');
    if(input.forwarding!==undefined&&(!Array.isArray(input.forwarding)||input.forwarding.length>100000))throw new AppError('배송대행 백업을 확인해주세요.');
    const restoredConnections=(input.connections||[]).map(c=>{if(!c.id||!c.providerId||!['market','forwarder'].includes(c.kind)||!['official','api','browser','session','wing','seller'].includes(c.mode))throw new AppError('연결 계정 백업을 확인해주세요.');if(c.mode==='session'&&(c.providerId!=='esm'||c.kind!=='market'||!['gmarket','auction'].includes(c.site)||typeof c.sellerId!=='string'||!c.sellerId||c.sellerId.length>100||/[\s\x00-\x1f\x7f]/.test(c.sellerId)||c.channel!==(c.site==='gmarket'?'지마켓':'옥션')))throw new AppError('백업의 ESM 연결 정보를 확인해주세요.');if(c.mode==='seller'&&(c.kind!=='market'||typeof c.sellerId!=='string'||!c.sellerId||c.sellerId.length>100||/[\s<>;\x00-\x1f\x7f]/.test(c.sellerId)||['host','shopNo','loginType','storeName','identityId','identityLabel','identitySource'].some(k=>c[k]!==undefined&&(typeof c[k]!=='string'||c[k].length>300||/[\x00-\x1f\x7f<>]/.test(c[k])))))throw new AppError('백업의 판매처 로그인 연결 정보를 확인해주세요.');if(c.mode==='wing'&&(c.providerId!=='coupang'||c.kind!=='market'||c.channel!=='쿠팡'||typeof c.sellerId!=='string'||!c.sellerId||c.sellerId.length>100||/[\s<>;\x00-\x1f\x7f]/.test(c.sellerId)||c.vendorId!==undefined&&!/^[-A-Za-z0-9_]{1,100}$/.test(c.vendorId)))throw new AppError('백업의 쿠팡 윙 연결 정보를 확인해주세요.');return {...Object.fromEntries(['id','providerId','channel','kind','name','mode','recipe','site','sellerId','vendorId','host','shopNo','loginType','storeName','identityId','identityLabel','identitySource','sessionImportedAt','createdAt','updatedAt'].filter(k=>c[k]!==undefined&&(k!=='recipe'||c.mode==='api')).map(k=>[k,c[k]])),credentialRef:randomUUID(),state:'인증 필요',lastError:''};});
    if(new Set(restoredConnections.map(c=>c.id)).size!==restoredConnections.length)throw new AppError('연결 계정 백업이 중복되었습니다.');
    const restoredIds=new Set(restoredConnections.map(c=>c.id)),orderIds=new Set(validated.map(o=>o.id));
    const restoredForwarding=(input.forwarding||[]).map(d=>{if(!d.id||!restoredIds.has(d.connectionId)||!Array.isArray(d.orderIds)||!d.orderIds.length||d.orderIds.some(id=>!orderIds.has(id))||!Array.isArray(d.items)||!['작성중','전송중','신청완료','송장회수','결과미확인','보관됨'].includes(d.state))throw new AppError('배송대행 백업의 주문·계정 연결을 확인해주세요.');const next=structuredClone(d);if(next.state==='전송중')next.state='결과미확인';return next;});
    if(new Set(restoredForwarding.map(d=>d.id)).size!==restoredForwarding.length)throw new AppError('배송대행 백업이 중복되었습니다.');
    const dir=backupDir||path.dirname(filename);mkdirSync(dir,{recursive:true});const backupPath=path.join(dir,`before-restore-${Date.now()}.json`);writeFileSync(backupPath,JSON.stringify(snapshot(),null,2),{mode:0o600});
    transaction(()=>{db.exec('DELETE FROM orders;DELETE FROM accounts;DELETE FROM history;DELETE FROM connections;DELETE FROM forwarding;DELETE FROM integration_runs;');for(const o of validated){const {id,version,createdAt,updatedAt,...data}=o;db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(id,orderKey(data),JSON.stringify(data),version,createdAt,updatedAt);addAccount(o.channel,o.account);}for(const a of input.accounts)addAccount(a.channel,a.name);for(const h of input.history){const timestamp=Number.isFinite(Date.parse(h.created_at))?h.created_at:now();db.prepare('INSERT INTO history(order_id,kind,message,created_at) VALUES(?,?,?,?)').run(h.order_id||null,text(h.kind,100),text(h.message,4000),timestamp);}for(const c of restoredConnections)db.prepare('INSERT INTO connections VALUES(?,?)').run(c.id,JSON.stringify(c));for(const d of restoredForwarding){const {id,connectionId,version,createdAt,updatedAt,...data}=d;db.prepare('INSERT INTO forwarding VALUES(?,?,?,?,?,?)').run(id,connectionId,JSON.stringify(data),Number(version)||1,createdAt||now(),updatedAt||now());}if(workspace){db.exec('DELETE FROM businesses;DELETE FROM account_business;DELETE FROM reference_data;DELETE FROM workspace_drafts;');for(const b of workspace.businesses)db.prepare('INSERT INTO businesses VALUES(?,?,?)').run(b.id,text(b.name,120),text(b.registrationNumber,20));for(const a of workspace.accountBusinesses)assignBusiness(a.channel,a.account,a.business_id);for(const r of workspace.references)saveReference(r.key,JSON.parse(r.value));for(const d of workspace.drafts)saveDraft(d.owner_id,d.key,JSON.parse(d.data));}restoreForwarderHistory(shipmentHistory);saveSettings(input.settings||{});history(null,'백업 복원',`${validated.length}건 복원`);});return {restored:validated.length,backupPath};
  }
  function importForwarderShipments(source,file){
    if(source?.providerId!=='next1688'||!/^[-a-f0-9]{36}$/.test(source.forwarderId||'')||!text(source.accountName,200))throw new AppError('연결된 넥스트배송 계정을 선택해주세요.');
    if(!Buffer.isBuffer(file.bytes)||!file.bytes.length||file.bytes.length>10*1024*1024||!Array.isArray(file.rows)||!file.rows.length||file.rows.length>10000)throw new AppError('입출고 원본 데이터를 확인해주세요.');
    const sourceHash=createHash('sha256').update(file.bytes).digest('hex');
    return transaction(()=>{
      const previous=db.prepare('SELECT id,counts FROM forwarder_imports WHERE forwarder_id=? AND source_hash=?').get(source.forwarderId,sourceHash);
      const parserVersion=file.parserVersion||1;
      if(previous&&(JSON.parse(previous.counts).parserVersion||1)>=parserVersion)return {...JSON.parse(previous.counts),importId:previous.id,sourceHash,alreadyImported:true};
      const id=previous?.id||randomUUID(),timestamp=now(),counts={total:file.rows.length,itemCount:file.itemCount,inserted:0,updated:0,unchanged:0,statusAvailable:file.statusAvailable,parserVersion};
      if(!previous)db.prepare('INSERT INTO forwarder_imports VALUES(?,?,?,?,?,?,?,?,?)').run(id,source.forwarderId,source.providerId,text(source.accountName,200),path.basename(file.name).slice(0,200),sourceHash,file.bytes,'{}',timestamp);
      const seen=new Set();
      for(const row of file.rows){
        if(!/^[A-Za-z0-9_-]{1,80}$/.test(row.applicationNo||'')||seen.has(row.applicationNo)||!Array.isArray(row.items)||!row.raw)throw new AppError('입출고 접수번호와 상품 정보를 확인해주세요.');
        seen.add(row.applicationNo);
        const data=JSON.stringify(row),before=db.prepare('SELECT id,data FROM forwarder_shipments WHERE forwarder_id=? AND application_no=?').get(source.forwarderId,row.applicationNo);
        if(before){if(before.data===data)counts.unchanged++;else{db.prepare('UPDATE forwarder_shipments SET status=?,tracking=?,data=?,import_id=?,version=version+1,updated_at=? WHERE id=?').run(row.status,text(row.tracking,100),data,id,timestamp,before.id);counts.updated++;}}
        else{db.prepare('INSERT INTO forwarder_shipments VALUES(?,?,?,?,?,?,?,1,?,?)').run(randomUUID(),source.forwarderId,row.applicationNo,row.status,text(row.tracking,100),data,id,timestamp,timestamp);counts.inserted++;}
      }
      db.prepare('UPDATE forwarder_imports SET counts=? WHERE id=?').run(JSON.stringify(counts),id);
      history(null,'배송대행 입출고 가져오기',`${counts.inserted}건 추가, ${counts.updated}건 갱신, ${counts.unchanged}건 동일`);
      return {...counts,importId:id,sourceHash,alreadyImported:false};
    });
  }
  const unpackShipment=row=>row?{...JSON.parse(row.data),id:row.id,forwarderId:row.forwarder_id,importId:row.import_id,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at}:null;
  function forwarderShipment(id){return unpackShipment(db.prepare('SELECT * FROM forwarder_shipments WHERE id=?').get(id));}
  function forwarderShipments(params={}){
    const clauses=[],args=[];
    if(params.forwarderId){if(!/^[-a-f0-9]{36}$/.test(params.forwarderId))throw new AppError('배송대행지 ID를 확인해주세요.');clauses.push('forwarder_id=?');args.push(params.forwarderId);}
    if(params.status){clauses.push(params.status==='unknown'?'status IS NULL':'status=?');if(params.status!=='unknown')args.push(text(params.status,100));}
    if(params.q){clauses.push("(application_no LIKE ? OR tracking LIKE ? OR json_extract(data,'$.recipient') LIKE ?)");const q='%'+text(params.q,120)+'%';args.push(q,q,q);}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'',page=Math.max(1,Math.min(100000,Number(params.page)||1)),limit=Math.max(1,Math.min(200,Number(params.limit)||50));
    if(!Number.isInteger(page)||!Number.isInteger(limit))throw new AppError('페이지 범위를 확인해주세요.');
    const total=db.prepare('SELECT count(*) AS n FROM forwarder_shipments'+where).get(...args).n;
    const statuses=db.prepare('SELECT status,count(*) AS count FROM forwarder_shipments'+where+' GROUP BY status').all(...args);
    const rows=db.prepare('SELECT * FROM forwarder_shipments'+where+' ORDER BY application_no DESC,id LIMIT ? OFFSET ?').all(...args,limit,(page-1)*limit).map(unpackShipment);
    return {shipments:rows,total,statuses,page,limit};
  }
  function forwarderImports(){return db.prepare('SELECT id,forwarder_id AS forwarderId,provider_id AS providerId,account_name AS accountName,filename,source_hash AS sourceHash,length(source) AS bytes,counts,created_at AS createdAt FROM forwarder_imports ORDER BY created_at DESC LIMIT 100').all().map(row=>({...row,counts:JSON.parse(row.counts)}));}
  function forwarderSnapshot(){return {imports:db.prepare('SELECT * FROM forwarder_imports').all().map(row=>({...row,source:Buffer.from(row.source).toString('base64')})),shipments:db.prepare('SELECT * FROM forwarder_shipments').all()};}
  function validateForwarderSnapshot(input){
    if(input===undefined)return null;
    if(!Array.isArray(input.imports)||input.imports.length>10000||!Array.isArray(input.shipments)||input.shipments.length>100000)throw new AppError('배송대행 입출고 백업을 확인해주세요.');
    const imports=input.imports.map(row=>{if(typeof row.source!=='string'||row.source.length>14*1024*1024||!/^[-a-f0-9]{36}$/.test(row.id||'')||!/^[-a-f0-9]{36}$/.test(row.forwarder_id||'')||row.provider_id!=='next1688')throw new AppError('입출고 원본 백업을 확인해주세요.');const source=Buffer.from(row.source,'base64');if(!source.length||source.length>10*1024*1024||createHash('sha256').update(source).digest('hex')!==row.source_hash)throw new AppError('입출고 원본 해시가 다릅니다.');try{JSON.parse(row.counts);}catch{throw new AppError('입출고 백업 집계를 확인해주세요.');}return {...row,source};});
    const byId=new Map(imports.map(row=>[row.id,row]));if(byId.size!==imports.length||new Set(imports.map(row=>JSON.stringify([row.forwarder_id,row.source_hash]))).size!==imports.length)throw new AppError('입출고 원본 백업이 중복되었습니다.');
    const ids=new Set(),keys=new Set();
    for(const row of input.shipments){let data;try{data=JSON.parse(row.data);}catch{throw new AppError('입출고 백업 내용을 확인해주세요.');}const key=JSON.stringify([row.forwarder_id,row.application_no]);if(!row.id||ids.has(row.id)||keys.has(key)||byId.get(row.import_id)?.forwarder_id!==row.forwarder_id||data.applicationNo!==row.application_no||!Array.isArray(data.items)||!data.raw||row.status!==data.status||row.tracking!==data.tracking||!Number.isSafeInteger(row.version)||row.version<1)throw new AppError('입출고 백업 연결을 확인해주세요.');ids.add(row.id);keys.add(key);}
    return {imports,shipments:input.shipments};
  }
  function restoreForwarderHistory(input){
    if(!input)return;
    db.exec('DELETE FROM forwarder_shipments;DELETE FROM forwarder_imports;');
    for(const r of input.imports)db.prepare('INSERT INTO forwarder_imports VALUES(?,?,?,?,?,?,?,?,?)').run(r.id,r.forwarder_id,r.provider_id,r.account_name,r.filename,r.source_hash,r.source,r.counts,r.created_at);
    for(const r of input.shipments)db.prepare('INSERT INTO forwarder_shipments VALUES(?,?,?,?,?,?,?,?,?,?)').run(r.id,r.forwarder_id,r.application_no,r.status,r.tracking,r.data,r.import_id,r.version,r.created_at,r.updated_at);
  }
  function saveSettings(input) {const settings={title:text(input.title||'도비 오더스',50),company:text(input.company,100)};db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('settings',JSON.stringify(settings));return settings;}
  function seedDemo() {return transaction(()=>{if(all().some(o=>o.demo))throw new AppError('예제 데이터가 이미 있습니다.');const products=['무선 키보드','접이식 노트북 거치대','스테인리스 텀블러','데스크 수납함','USB-C 충전 케이블','메모 패드'];for(let i=0;i<18;i++){const status=STATUSES[i%5],shipping=['배송중','배송완료','구매확정'].includes(status);insert({orderNo:`DEMO-${String(i+1).padStart(4,'0')}`,lineId:'1',product:products[i%products.length],option:i%2?'화이트':'블랙',channel:CHANNELS[i%3],account:'예제 스토어',buyer:`예제 구매자 ${i+1}`,recipient:`예제 수령인 ${i+1}`,phone:'010-0000-0000',postcode:'00000',address:'예제 주소 (실제 배송 불가)',quantity:i%3+1,unitPrice:19000+i*1000,orderedAt:new Date(Date.now()-i*86400000).toISOString().slice(0,10),status,carrier:shipping?'CJ대한통운':'',tracking:shipping?`DEMO-${10000+i}`:'',onHold:i===5,holdReason:i===5?'입고 대기':'',claimType:i===8?'반품요청':'없음',claimNote:i===8?'예제 반품 상담':'',workMemo:i===3?'예제: 배송 전에 포장 상태 확인':'',demo:true},'예제 생성');}return {inserted:18};});}
  function clearDemo(){return transaction(()=>{const ids=all().filter(o=>o.demo).map(o=>o.id);for(const id of ids){db.prepare('DELETE FROM orders WHERE id=?').run(id);db.prepare('DELETE FROM history WHERE order_id=?').run(id);}db.prepare('DELETE FROM accounts WHERE name=?').run('예제 스토어');history(null,'예제 삭제',`${ids.length}건 삭제`);return {removed:ids.length};});}
  return {db,get,all,query,stats,importForwarderShipments,forwarderShipment,forwarderShipments,forwarderImports,reference,saveReference,draft,saveDraft,removeDraft,businesses,accountBusinesses,saveBusiness,assignBusiness,insert:input=>transaction(()=>insert(input)),update:(id,p,v)=>transaction(()=>update(id,p,v)),importOrders,bulk,importTracking,snapshot,restore,seedDemo,clearDemo,connections,connection,saveConnection,integrationRun,runs,syncOrders,hasRemoteClaim,forwarding,forward,createForward,updateForward,applyForwardTracking,registerForwardReceipt,addAccount:(c,n)=>transaction(()=>addAccount(c,n)),accounts:()=>db.prepare('SELECT * FROM accounts ORDER BY channel,name').all(),settings:()=>JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('settings')?.value||'{"title":"도비 오더스","company":""}'),saveSettings,history:id=>db.prepare(id?'SELECT * FROM history WHERE order_id=? ORDER BY id DESC LIMIT 100':'SELECT * FROM history ORDER BY id DESC LIMIT 100').all(...(id?[id]:[])),close:()=>db.close()};
}
