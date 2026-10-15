import { randomUUID } from 'node:crypto';
import { AppError } from '../store.mjs';
import { createOfficialClient } from './official.mjs';
import { createRecipeClient,validateRecipe } from './recipe.mjs';
import { createEsmClient,validateEsmCookies } from './esm.mjs';

export function esmMetadata(input){
  if(!['gmarket','auction'].includes(input.site))throw new AppError('지마켓 또는 옥션을 선택해주세요.');
  const sellerId=String(input.sellerId||'').trim();
  if(!sellerId||sellerId.length>100||/[\s\x00-\x1f\x7f]/.test(sellerId))throw new AppError('ESM에 등록된 판매자 ID를 입력해주세요.');
  return {site:input.site,sellerId,channel:input.site==='gmarket'?'지마켓':'옥션'};
}
export const connectionIdentity=c=>JSON.stringify([c?.id,c?.providerId,c?.name,c?.mode,c?.site,c?.sellerId,c?.credentialRef,c?.recipe]);

export function dateRange(from,to){for(const v of [from,to])if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new AppError('수집 시작일과 종료일을 확인해주세요.');if(from>to||Date.parse(to)-Date.parse(from)>92*86400000)throw new AppError('수집 기간은 순서대로 최대 93일을 지정해주세요.');return {from,to};}
export function createIntegrations({store,vault,catalog,fetchImpl=fetch,officialFactory=createOfficialClient,esmFactory=createEsmClient,resolveHost=true}){
  const busy=new Set();
  const credentialKey=c=>c.credentialRef||c.id;
  const provider=id=>{const p=catalog.providers.find(x=>x.id===id);if(!p)throw new AppError('연동 대상을 찾을 수 없습니다.');return p;};
  const connection=id=>{const c=store.connection(id);if(!c)throw new AppError('연결 계정을 찾을 수 없습니다.',404);return c;};
  function publicConnection(c){const keys=['id','providerId','channel','kind','name','mode','recipe','site','sellerId','sessionImportedAt','state','lastError','lastRunAt','createdAt','updatedAt'];return {...Object.fromEntries(keys.filter(k=>c[k]!==undefined&&(k!=='recipe'||c.mode==='api')).map(k=>[k,c[k]])),hasCredentials:vault.has(credentialKey(c)),busy:busy.has(c.id)};}
  function safeMessage(e,secrets){let s=e?.message||'연동 처리에 실패했습니다.';const values=Object.values(secrets||{}).filter(v=>typeof v==='string'&&v.length>=4);try{for(const c of JSON.parse(secrets?.cookies||'[]'))if(typeof c.value==='string'&&c.value)values.push(c.value);}catch{}for(const v of values)s=s.split(v).join('[인증값]');if(/<!doctype|<html|stack|password\s*[:=]|secret\s*[:=]|access_token\s*[:=]/i.test(s)||s.length>350)s='API 응답을 처리하지 못했습니다. 인증·권한·응답 규칙을 확인해주세요.';return s;}
  function assertCurrent(c){if(connectionIdentity(store.connection(c.id))!==connectionIdentity(c))throw new AppError('연결 정보가 변경되었습니다. 새 연결 상태에서 다시 시도해주세요.',409);}
  async function client(c){const credentials={...await vault.get(credentialKey(c)),account:c.name};if(c.mode==='session')return esmFactory({credentials:{...credentials,site:c.site,sellerId:c.sellerId},fetchImpl,resolveHost});if(c.mode==='official')return officialFactory({provider:c.providerId,credentials,fetchImpl});if(c.mode==='api')return createRecipeClient({recipe:c.recipe,credentials,kind:c.kind,fetchImpl,resolveHost});throw new AppError('브라우저 연결은 브라우저 도우미에서 로그인한 탭을 확인해주세요.');}
  async function callClient(c,method,args){const api=await client(c);try{return await api[method](args);}finally{if(c.mode==='session'){assertCurrent(c);const stored=await vault.get(credentialKey(c)),cookies=api.getSessionCookies();if(stored.cookies!==cookies){assertCurrent(c);await vault.set(credentialKey(c),{...stored,cookies});assertCurrent(c);}}}}
  async function execute(id,kind,fn,extraSecrets){if(busy.has(id))throw new AppError('이 계정에서 연동 작업이 진행 중입니다.',409);const c=connection(id);busy.add(id);let secrets=extraSecrets;try{if(vault.has(credentialKey(c)))secrets={...await vault.get(credentialKey(c)),...extraSecrets};const result=await fn(c);assertCurrent(c);store.saveConnection({id,state:['인증 확인','세션 연결'].includes(kind)?'인증 확인됨':'수집 완료',lastError:'',lastRunAt:new Date().toISOString()});store.integrationRun(id,kind,'완료',result.summary||result);return result;}catch(e){const message=safeMessage(e,secrets);if(connectionIdentity(store.connection(id))===connectionIdentity(c)){store.saveConnection({id,state:'확인 필요',lastError:message,lastRunAt:new Date().toISOString()});store.integrationRun(id,kind,'실패',{message});}throw new AppError(message,e.status||502);}finally{busy.delete(id);}}
  return {
    catalog,
    isBusy:()=>busy.size>0,
    list:()=>store.connections().map(publicConnection),
    async save(input){
      const p=provider(input.providerId),before=input.id?connection(input.id):null,name=String(input.name||'').trim();
      if(!name||name.length>100)throw new AppError('계정 이름은 1~100자로 입력해주세요.');
      if(!['official','api','browser','session'].includes(input.mode))throw new AppError('연결 방식을 선택해주세요.');
      if(input.mode==='official'&&!p.official)throw new AppError('이 판매처는 공식 API 클라이언트가 구현되지 않았습니다.');
      if(input.mode==='browser'&&!p.browserUrl)throw new AppError('이 대상의 로그인/신청 페이지 주소는 아직 확인되지 않았습니다.');
      if(input.mode==='session'&&(p.id!=='esm'||p.kind!=='market'))throw new AppError('ESM에서만 지마켓·옥션 세션 API를 사용할 수 있습니다.');
      const meta=input.mode==='session'?esmMetadata(input):{site:undefined,sellerId:undefined,channel:p.name};
      const hasOrders=before&&store.all().some(o=>o.sourceConnectionId===before.id);
      if(hasOrders&&(before.name!==name||before.providerId!==p.id||before.channel!==meta.channel||before.site!==meta.site||before.sellerId!==meta.sellerId))throw new AppError('수집된 주문이 있는 계정의 판매처·판매자 ID·이름은 변경할 수 없습니다. 새 연결을 추가해주세요.');
      if(input.mode==='session'&&store.connections().some(c=>c.id!==before?.id&&c.providerId==='esm'&&c.mode==='session'&&c.site===meta.site&&c.sellerId?.toLowerCase()===meta.sellerId.toLowerCase()))throw new AppError('같은 ESM 판매자 ID의 연결 계정이 이미 있습니다. 기존 계정을 사용해주세요.');
      const recipe=input.mode==='api'?validateRecipe(input.recipe,p.kind):undefined,credentials=input.credentials||{};
      if(typeof credentials!=='object'||Array.isArray(credentials)||Object.keys(credentials).length>20)throw new AppError('인증 정보 형식을 확인해주세요.');
      for(const [k,v]of Object.entries(credentials))if(!/^[A-Za-z][\w]{0,40}$/.test(k)||typeof v!=='string'||v.length>30000||/[\r\n]/.test(v))throw new AppError('인증 항목을 확인해주세요.');
      if(input.mode==='session'&&Object.keys(credentials).length)throw new AppError('ESM 세션은 브라우저 도우미의 확인 버튼에서 연결해주세요.');
      if(before&&busy.has(before.id))throw new AppError('이 계정에서 연동 작업이 진행 중입니다.',409);
      if(before)busy.add(before.id);
      try{
        const changed=before&&(before.providerId!==p.id||before.mode!==input.mode||before.site!==meta.site||before.sellerId!==meta.sellerId||JSON.stringify(before.recipe)!==JSON.stringify(recipe));
        if(changed)await vault.remove(credentialKey(before));
        const c=store.saveConnection({...(before?{id:before.id}:{}),credentialRef:before&&!changed?credentialKey(before):randomUUID(),providerId:p.id,kind:p.kind,name,mode:input.mode,recipe,...meta,state:input.mode==='browser'?'브라우저 확인 필요':input.mode==='session'?'브라우저 세션 연결 필요':'인증 필요',lastError:''});
        if(!['browser','session'].includes(input.mode)&&(Object.keys(credentials).length||recipe?.auth?.type==='none')){const retained=before&&!changed&&vault.has(credentialKey(c))?await vault.get(credentialKey(c)):{};await vault.set(credentialKey(c),{...retained,...credentials});}
        return {...publicConnection(c),busy:false};
      }finally{if(before)busy.delete(before.id);}
    },
    test:id=>execute(id,'인증 확인',async c=>{const result=await callClient(c,'testConnection');if(!result?.ok)throw new AppError('연결 API가 인증 성공을 확인하지 못했습니다.');return {ok:true,summary:{message:'인증과 읽기 응답을 확인했습니다.'}};}),
    collect:(id,dates)=>execute(id,'주문 수집',async c=>{if(c.kind!=='market')throw new AppError('주문수집은 쇼핑몰 계정에서 실행해주세요.');const range=dateRange(dates.from,dates.to),result=await callClient(c,'collectOrders',range);assertCurrent(c);if(result.complete!==true||!Array.isArray(result.orders))throw new AppError('전체 페이지 수집을 확인하지 못해 주문을 저장하지 않았습니다.');const summary=store.syncOrders(c,result.orders);return {summary,notes:result.notes||[]};}),
    async importEsmSession(id,data){const cookies=JSON.stringify(validateEsmCookies(data.cookies));return execute(id,'세션 연결',async c=>{if(c.providerId!=='esm'||c.mode!=='session'||c.kind!=='market')throw new AppError('ESM 세션 연결 계정을 선택해주세요.');esmMetadata(c);const api=esmFactory({credentials:{site:c.site,sellerId:c.sellerId,cookies,account:c.name},fetchImpl,resolveHost});const result=await api.testConnection();if(!result?.ok)throw new AppError('ESM 세션과 판매자 계정을 확인하지 못했습니다.');assertCurrent(c);await vault.set(credentialKey(c),{cookies:api.getSessionCookies()});assertCurrent(c);store.saveConnection({id,sessionImportedAt:new Date().toISOString()});return {ok:true,summary:{message:'ESM 세션과 선택한 판매자 계정을 확인했습니다.'}};},{cookies});},
    tracking:(id,dates)=>execute(id,'송장 회수',async c=>{if(c.kind!=='forwarder')throw new AppError('배송대행지를 선택해주세요.');const result=await (await client(c)).collectTracking(dateRange(dates.from,dates.to));if(result.complete!==true)throw new AppError('송장 목록 수집이 완료되지 않았습니다.');return {summary:store.applyForwardTracking(c,result.orders)};}),
    async submit(id,{expectedVersion,confirmed}={}){const d=store.forward(id);if(!d)throw new AppError('배송신청 초안을 찾을 수 없습니다.',404);if(!confirmed)throw new AppError('수령인·상품·배송대행지를 검토한 뒤 전송을 확인해주세요.');if(d.state!=='작성중')throw new AppError('이미 전송했거나 결과 확인이 필요한 배송신청입니다.',409);if(expectedVersion!==d.version)throw new AppError('초안이 변경됐습니다. 다시 확인해주세요.',409);const c=connection(d.connectionId);if(c.mode!=='api'||!c.recipe?.operations?.submit)throw new AppError('이 배송대행지에는 확인된 배송신청 API 규칙이 없습니다. 브라우저 신청서 또는 파일을 사용해주세요.');if(busy.has(c.id))throw new AppError('이 배송대행지에서 다른 작업이 진행 중입니다.',409);for(const id of d.orderIds){const order=store.get(id);if(order?.demo)throw new AppError('예제 주문은 실제 배송대행지에 전송할 수 없습니다.');if(['취소요청','반품요청','교환요청'].includes(order?.sourceClaimType||order?.claimType)||(order?.sourceFulfillableQty!==undefined&&order.sourceFulfillableQty<order.quantity))throw new AppError('판매처 클레임·부분 수량을 확인한 뒤 배송신청해주세요.');if(!order||order.version!==d.orderVersions[id]||order.onHold||order.status==='취소')throw new AppError('초안 생성 뒤 주문이 변경됐습니다. 새 초안을 만들어 검토해주세요.',409);}
      if(store.forwarding().some(f=>f.id!==d.id&&f.state!=='보관됨'&&f.orderIds.some(id=>d.orderIds.includes(id))))throw new AppError('같은 주문의 다른 배송신청이 있어 전송할 수 없습니다.',409);const api=await client(c);busy.add(c.id);store.updateForward(d.id,{state:'전송중'},d.version);try{const result=await api.submit(d);if(!result.applicationId)throw new AppError('접수번호를 확인하지 못했습니다.');if(store.forwarding().some(f=>f.id!==d.id&&f.connectionId===c.id&&f.applicationId===String(result.applicationId)))throw new AppError('배송대행지가 이미 등록된 접수번호를 반환했습니다.');const next=store.updateForward(d.id,{state:'신청완료',applicationId:String(result.applicationId)});store.integrationRun(c.id,'배송신청','완료',{draftId:d.id});return next;}catch(e){store.updateForward(d.id,{state:'결과미확인'});store.integrationRun(c.id,'배송신청','확인 필요',{draftId:d.id,message:'배송대행지에서 접수 여부를 확인한 뒤 접수번호를 등록해주세요.'});throw new AppError('배송신청 결과를 확인하지 못했습니다. 재전송 전에 배송대행지에서 접수 여부를 확인해주세요.',502);}finally{busy.delete(c.id);}},
    receipt(id,{applicationId,carrier='',tracking='',expectedVersion,confirmed}){if(!confirmed)throw new AppError('배송대행지에서 확인한 접수번호임을 확인해주세요.');return store.registerForwardReceipt(id,{applicationId,carrier,tracking,expectedVersion});},
    browserImport(id,{orders,complete,confirmed}){const c=connection(id);if(c.mode!=='browser'||c.kind!=='market')throw new AppError('브라우저 수집 계정을 선택해주세요.');if(!complete||!confirmed)throw new AppError('화면에서 가져온 목록과 현재 페이지 범위를 확인해주세요.');const summary=store.syncOrders(c,orders);store.integrationRun(id,'브라우저 화면 수집','완료',{...summary,scope:'사용자가 확인한 현재 화면/응답'});store.saveConnection({id,state:'화면 수집 완료',lastError:'',lastRunAt:new Date().toISOString()});return {summary};},
    runs:()=>store.runs()
  };
}
