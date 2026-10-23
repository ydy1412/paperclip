import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import { createVault,memoryVault } from './src/integrations/vault.mjs';
import { createIntegrations,esmMetadata,wingMetadata,connectionIdentity } from './src/integrations/service.mjs';
import {sellerMetadata} from './src/integrations/seller-logins.mjs';
import {SELLER_PROVIDERS} from './src/integrations/seller-factory.mjs';
import { integrationCatalog,mergeIntegrationCatalog } from './src/integrations/catalog.mjs';
import { RECIPE_EXAMPLE,FORWARDER_EXAMPLE,validateRecipe } from './src/integrations/recipe.mjs';
import { createStore,AppError,STATUSES,WORK_STATES,CLAIMS,CHANNELS,CARRIERS } from './src/store.mjs';
import { parseFile,mapRows,exportOrders,FIELDS } from './src/files.mjs';
import { parseNext1688File } from './src/forwarder-files.mjs';

export async function createApp({dbPath,port=0,vault:providedVault,fetchImpl,officialFactory,esmFactory,wingFactory,wingSessionFactory,nativeLogin,sellerFactory,nativeSellerLogin,resolveHost=true,hosted=false,dataRoot,bridgeBase,authorizeBridge=async()=>true}={}) {
  const root=path.dirname(fileURLToPath(import.meta.url));
  const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
  const dataDir=dataRoot||path.join(root,'data');await mkdir(dataDir,{recursive:true});
  const store=createStore(dbPath||process.env.DOBI_DB||path.join(dataDir,'orders.sqlite'),path.join(dataDir,'backups'));
  const vault=providedVault||(dbPath===':memory:'?memoryVault():await createVault(path.join(dbPath?path.dirname(dbPath):dataDir,'credentials.dpapi.json')));
  const catalog=mergeIntegrationCatalog(store.reference('catalog',integrationCatalog));
  store.saveReference('catalog',catalog);
  const integrations=createIntegrations({store,vault,catalog,fetchImpl,officialFactory,esmFactory,wingFactory,wingSessionFactory,nativeLogin,sellerFactory,nativeSellerLogin,sessionOrdersOnly:hosted,resolveHost});
  const token=randomBytes(32).toString('hex'),imports=new Map();
  let pairCode=null,pairAttempts=0;const bridgeTokens=new Map(),sessionGrants=new Map();
  function csvCell(v){let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
  function forwardCsv(d){const headers=['배송대행지','접수번호','주문번호','품목번호','상품명','옵션','수량','단가','수령인','전화번호','우편번호','주소','배송메모','개인통관고유부호','센터'];return Buffer.from('\uFEFF'+[headers,...d.items.map(i=>[store.connection(d.connectionId)?.channel,d.applicationId,i.orderNo,i.lineId,i.product,i.option,i.quantity,i.unitPrice,d.recipient,d.phone,d.postcode,d.address,d.deliveryMemo,d.customsCode,d.warehouse])].map(r=>r.map(csvCell).join(',')).join('\r\n'),'utf8');}
  const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function body(req){if(req.body!==undefined)return req.body;let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>15*1024*1024)throw new AppError('요청이 너무 큽니다.',413);parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}catch{throw new AppError('데이터 형식을 확인해주세요.');}}
  async function download(res,file,name){res.writeHead(200,{'Content-Type':file.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name+'.'+file.extension)}`,'Cache-Control':'no-store'});res.end(file.bytes);}
  function previewEntry(id){const entry=imports.get(id);if(!entry||Date.now()-entry.createdAt>20*60*1000)throw new AppError('가져오기 미리보기가 만료됐습니다. 파일을 다시 선택해주세요.');return entry;}
  const handler=async(req,res)=>{
    if(!hosted)res.setHeader('X-Content-Type-Options','nosniff');if(!hosted)res.setHeader('Referrer-Policy','no-referrer');if(!hosted)res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    try{
      const host=req.headers.host;
      if(!hosted&&(!host||!/^(127\.0\.0\.1|localhost):\d+$/.test(host)))throw new AppError('이 PC에서만 접근할 수 있습니다.',403);
      const url=new URL(req.url,`http://${host}`),pathname=url.pathname,params=Object.fromEntries(url.searchParams);
      Object.assign(catalog,mergeIntegrationCatalog(store.reference('catalog',integrationCatalog)));
      const bridgePath=pathname.startsWith('/api/bridge/'),extensionOrigin=/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin||'');
      if(!hosted&&req.headers.origin && req.headers.origin!==`http://${host}`&&!(bridgePath&&extensionOrigin))throw new AppError('허용되지 않은 요청입니다.',403);
      if(!hosted&&!['GET','HEAD'].includes(req.method)&&!(bridgePath&&pathname!=='/api/bridge/pair-code')&&req.headers['x-dobi-token']!==token)throw new AppError('화면을 새로고침한 다음 다시 시도해주세요.',403);
      if(pathname==='/api/health')return json(res,{ok:true,app:'dobi-orders',version});
      if(req.method==='GET'&&pathname==='/api/bootstrap')return json(res,{token,statuses:STATUSES,workStates:WORK_STATES,claims:CLAIMS,channels:store.reference('channels',CHANNELS),carriers:store.reference('carriers',CARRIERS),fields:FIELDS,settings:store.settings(),accounts:store.accounts(),accountBusinesses:store.accountBusinesses()});
      if(req.method==='GET'&&pathname==='/api/stats')return json(res,store.stats());
      if(req.method==='GET'&&pathname==='/api/orders')return json(res,store.query(params));
      if(req.method==='POST'&&pathname==='/api/orders')return json(res,store.insert(await body(req)),201);
      const match=pathname.match(/^\/api\/orders\/([a-f0-9-]+)$/);
      if(match&&req.method==='GET'){const order=store.get(match[1]);if(!order)throw new AppError('주문이 없습니다.',404);return json(res,{order,history:store.history(order.id)});}
      if(match&&req.method==='PATCH'){const data=await body(req);return json(res,store.update(match[1],data.patch,data.expectedVersion));}
      if(pathname==='/api/bulk'&&req.method==='POST'){const data=await body(req);return json(res,store.bulk(data.ids,data.patch));}
      if(pathname==='/api/history'&&req.method==='GET')return json(res,store.history());
      if(pathname==='/api/accounts'&&req.method==='POST'){const data=await body(req);if(data.businessId&&!store.businesses().some(b=>b.id===data.businessId))throw new AppError('사업자를 확인해주세요.');store.addAccount(data.channel,data.name);if(data.businessId)store.assignBusiness(data.channel,data.name,data.businessId);return json(res,store.accounts());}
      if(pathname==='/api/settings'&&req.method==='POST')return json(res,store.saveSettings(await body(req)));
      if(pathname==='/api/integrations/catalog'&&req.method==='GET')return json(res,catalog);
      if(pathname==='/api/integrations/recipe-example'&&req.method==='GET')return json(res,params.kind==='forwarder'?FORWARDER_EXAMPLE:RECIPE_EXAMPLE);
      if(pathname==='/api/connections'&&req.method==='GET')return json(res,integrations.list());
      if(pathname==='/api/connections'&&req.method==='POST'){const input=await body(req);if(input.businessId&&!store.businesses().some(b=>b.id===input.businessId))throw new AppError('사업자를 확인해주세요.');const saved=await integrations.save(input);if(input.businessId)store.assignBusiness(saved.channel,saved.name,input.businessId);return json(res,saved,201);}
      const sellerLoginMatch=pathname.match(/^\/api\/connections\/([a-f0-9-]+)\/seller-login$/);
      if(sellerLoginMatch&&req.method==='GET')return json(res,integrations.sellerStatus(sellerLoginMatch[1]));
      if(sellerLoginMatch&&req.method==='POST'){const data=await body(req);if(hosted&&data.step==='native')throw new AppError('이 서버에서는 별도 로그인창을 지원하지 않습니다. 아이디·비밀번호 로그인을 사용해주세요.',409);return json(res,data.step==='cancel'?integrations.cancelSellerLogin(sellerLoginMatch[1]):await integrations.sellerLogin(sellerLoginMatch[1],data));}
      const wingLoginMatch=pathname.match(/^\/api\/connections\/([a-f0-9-]+)\/wing-login$/);
      if(wingLoginMatch&&req.method==='GET')return json(res,integrations.wingStatus(wingLoginMatch[1]));
      if(wingLoginMatch&&req.method==='POST'){const data=await body(req);if(hosted&&data.step==='native')throw new AppError('이 서버에서는 별도 로그인창을 지원하지 않습니다. 아이디·비밀번호 로그인을 사용해주세요.',409);return json(res,data.step==='cancel'?integrations.cancelWingLogin(wingLoginMatch[1]):await integrations.wingLogin(wingLoginMatch[1],data));}
      const sessionRequestMatch=pathname.match(/^\/api\/connections\/([a-f0-9-]+)\/session-request$/);
      if(sessionRequestMatch&&req.method==='POST'){
        const c=store.connection(sessionRequestMatch[1]);if(!c||c.kind!=='market'||!(c.providerId==='esm'&&c.mode==='session'||c.providerId==='coupang'&&c.mode==='wing'))throw new AppError('브라우저 세션 연결 계정을 선택해주세요.');
        if(integrations.list().find(x=>x.id===c.id)?.busy)throw new AppError('이 계정에서 연동 작업이 진행 중입니다.',409);
        if(c.mode==='wing'){wingMetadata(c);if(!c.vendorId)throw new AppError('최초 연결은 윙 로그인과 판매자코드 확인을 먼저 완료해주세요.');}else esmMetadata(c);const grant={connectionId:c.id,providerId:c.providerId,mode:c.mode,grant:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+5*60*1000).toISOString(),site:c.site,sellerId:c.sellerId,name:c.name,identity:connectionIdentity(c)};
        sessionGrants.set(c.id,grant);const {identity,...publicGrant}=grant;return json(res,publicGrant);
      }
      const connectionMatch=pathname.match(/^\/api\/connections\/([a-f0-9-]+)\/(test|collect|tracking)$/);
      if(connectionMatch&&req.method==='POST'){const data=await body(req);return json(res,await integrations[connectionMatch[2]](connectionMatch[1],data));}
      if(pathname==='/api/integration-runs'&&req.method==='GET')return json(res,integrations.runs());
      if(pathname==='/api/forwarding'&&req.method==='GET')return json(res,store.forwarding());
      if(pathname==='/api/forwarder-shipments/import'&&req.method==='POST'){
        const data=await body(req);
        if(typeof data.content!=='string'||data.content.length>14*1024*1024||data.content.length%4||!data.content.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(data.content))throw new AppError('엑셀 원본 전송 형식을 확인해주세요.');
        const bytes=Buffer.from(data.content,'base64'),name=typeof data.name==='string'?data.name:'';
        const file=parseNext1688File(name,bytes,data.expectedCount);
        return json(res,store.importForwarderShipments(data.source,{...file,name,bytes}),201);
      }
      if(pathname==='/api/forwarder-shipments'&&req.method==='GET')return json(res,store.forwarderShipments(params));
      if(pathname==='/api/forwarder-shipments/imports'&&req.method==='GET')return json(res,store.forwarderImports());
      const shipmentMatch=pathname.match(/^\/api\/forwarder-shipments\/([a-f0-9-]+)$/);
      if(shipmentMatch&&req.method==='GET'){const shipment=store.forwarderShipment(shipmentMatch[1]);if(!shipment)throw new AppError('입출고 내역을 찾을 수 없습니다.',404);return json(res,shipment);}
      if(pathname==='/api/forwarding'&&req.method==='POST'){const data=await body(req);return json(res,store.createForward(data.connectionId,data.orderIds,data),201);}
      const forwardMatch=pathname.match(/^\/api\/forwarding\/([a-f0-9-]+)(?:\/(submit|receipt|export|archive))?$/);
      if(forwardMatch){const draft=store.forward(forwardMatch[1]);if(!draft)throw new AppError('배송신청 초안을 찾을 수 없습니다.',404);if(req.method==='GET'){if(forwardMatch[2]==='export')return download(res,{mime:'text/csv; charset=utf-8',extension:'csv',bytes:forwardCsv(draft)},'배송대행_신청_'+draft.id.slice(0,8));return json(res,draft);}if(req.method==='PATCH'&&!forwardMatch[2]){if(draft.state!=='작성중')throw new AppError('전송한 배송신청 초안은 변경할 수 없습니다.',409);const data=await body(req),patch=Object.fromEntries(['customsCode','warehouse','memo'].filter(k=>data[k]!==undefined).map(k=>[k,String(data[k]).trim().slice(0,2000)]));return json(res,store.updateForward(draft.id,patch,data.expectedVersion));}if(req.method==='POST'&&forwardMatch[2]==='archive'){if(draft.state!=='작성중')throw new AppError('작성중인 초안만 보관할 수 있습니다.',409);const data=await body(req);return json(res,store.updateForward(draft.id,{state:'보관됨'},data.expectedVersion));}if(req.method==='POST'&&['submit','receipt'].includes(forwardMatch[2]))return json(res,await integrations[forwardMatch[2]](draft.id,await body(req)));}
      if(pathname==='/api/bridge/pair-code'&&req.method==='POST'){pairCode={value:randomBytes(10).toString('hex'),expiresAt:Date.now()+10*60*1000,ownerId:req.dobiOwnerId||'standalone'};pairAttempts=0;return json(res,{code:pairCode.value,expiresAt:new Date(pairCode.expiresAt).toISOString()});}
      if(pathname==='/api/bridge/pair'&&req.method==='POST'){const data=await body(req);if(++pairAttempts>10||!pairCode||Date.now()>pairCode.expiresAt||data.code!==pairCode.value)throw new AppError('페어링 코드가 없거나 만료됐습니다. 프로그램에서 새 코드를 발급해주세요.',403);if(!await authorizeBridge(pairCode.ownerId))throw new AppError('앱에서 다시 로그인하고 페어링해주세요.',403);req.dobiOwnerId=pairCode.ownerId;const value=randomBytes(32).toString('hex');bridgeTokens.set(value,{ownerId:pairCode.ownerId,expiresAt:Date.now()+24*60*60*1000});pairCode=null;return json(res,{token:value});}
      if(bridgePath){const grant=bridgeTokens.get(req.headers['x-dobi-bridge']);if(!grant||grant.expiresAt<Date.now()||!await authorizeBridge(grant.ownerId))throw new AppError('브라우저 도우미를 프로그램에서 페어링해주세요.',403);req.dobiOwnerId=grant.ownerId;
        if(pathname==='/api/bridge/context'&&req.method==='GET'){
          for(const [id,g]of sessionGrants)if(Date.parse(g.expiresAt)<=Date.now()||connectionIdentity(store.connection(id))!==g.identity)sessionGrants.delete(id);
          return json(res,{providers:catalog.providers.map(p=>({id:p.id,name:p.name,kind:p.kind,browserUrl:p.browserUrl,allowedOrigins:p.allowedOrigins,formMapping:p.formMapping})),connections:integrations.list().map(c=>({id:c.id,name:c.name,providerId:c.providerId,kind:c.kind,mode:c.mode,site:c.site,sellerId:c.sellerId})),sessionImports:[...sessionGrants.values()].map(({identity,...g})=>g),drafts:store.forwarding().filter(d=>d.state==='작성중').map(d=>({id:d.id,connectionId:d.connectionId,state:d.state,itemCount:d.items.length,createdAt:d.createdAt}))});
        }
        if(['/api/bridge/esm-session','/api/bridge/coupang-session'].includes(pathname)&&req.method==='POST'){
          const data=await body(req),grant=sessionGrants.get(data.connectionId);
          const wing=pathname.endsWith('/coupang-session');
          if(data.confirmed!==true||!grant||grant.providerId!==(wing?'coupang':'esm')||grant.mode!==(wing?'wing':'session')||grant.grant!==data.grant||Date.parse(grant.expiresAt)<=Date.now()||grant.identity!==connectionIdentity(store.connection(data.connectionId)))throw new AppError('세션 연결 요청이 없거나 만료·변경되었습니다. 프로그램에서 다시 요청해주세요.',403);
          if(!(wing?['https://wing.coupang.com']:['https://www.esmplus.com','https://seller.esmplus.com','https://post-tx.esmplus.com','https://signin.esmplus.com']).includes(data.origin))throw new AppError('연결할 판매처에 로그인한 탭에서 세션을 연결해주세요.',403);
          sessionGrants.delete(data.connectionId);
          return json(res,await integrations[wing?'importWingSession':'importEsmSession'](data.connectionId,{cookies:data.cookies}));
        }
        const bridgeDraft=pathname.match(/^\/api\/bridge\/draft\/([a-f0-9-]+)$/);if(bridgeDraft&&req.method==='GET'){const draft=store.forward(bridgeDraft[1]);if(!draft)throw new AppError('배송신청 초안을 찾을 수 없습니다.',404);if(draft.state!=='작성중'||draft.orderIds.some(id=>store.get(id)?.demo))throw new AppError('작성중인 실제 주문의 신청 초안만 브라우저로 보낼 수 있습니다.');const c=store.connection(draft.connectionId),provider=catalog.providers.find(p=>p.id===c?.providerId);return json(res,{draft,provider});}
        if(pathname==='/api/bridge/browser-orders'&&req.method==='POST'){const data=await body(req);return json(res,integrations.browserImport(data.connectionId,data));}
        throw new AppError('브라우저 도우미 기능을 찾을 수 없습니다.',404);
      }
      if(pathname==='/api/browser-helper/download'&&req.method==='GET'){const zip=new JSZip();for(const name of ['manifest.json','popup.html','popup.js','popup.css','README.md'])zip.file(name,name==='manifest.json'&&bridgeBase?JSON.stringify({...JSON.parse(await readFile(path.join(root,'browser-helper',name),'utf8')),host_permissions:[new URL(bridgeBase).origin+'/*']}):name==='popup.js'&&bridgeBase?(await readFile(path.join(root,'browser-helper',name),'utf8')).replace(/const BASE\s*=\s*'http:\/\/127\.0\.0\.1:4317';/,'const BASE = '+JSON.stringify(bridgeBase)+';'):await readFile(path.join(root,'browser-helper',name)));return download(res,{mime:'application/zip',extension:'zip',bytes:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})},'도비_브라우저_도우미');}
      if(pathname==='/api/demo'&&req.method==='POST')return json(res,store.seedDemo());
      if(pathname==='/api/demo'&&req.method==='DELETE')return json(res,store.clearDemo());
      if(pathname==='/api/import/sample'&&req.method==='POST'){
        const csv='주문번호,품목번호,판매처,계정명,상품명,수량,단가,수령자,연락처,우편번호,주소,주문일,주문상태\nIMPORT-DEMO-001,01,스마트스토어,예제 스토어,예제 파일 상품,2,18000,예제 수령인,010-0000-0000,01234,예제 주소,,신규';
        const file=await parseFile('예제_주문.csv',Buffer.from(csv,'utf8')),id=randomBytes(16).toString('hex');
        imports.set(id,{...file,createdAt:Date.now(),name:'예제_주문.csv',mode:'orders',demo:true});
        return json(res,{id,headers:file.headers,mapping:file.mapping,total:file.rows.length,sample:file.rows.slice(0,5),rowOffset:file.rowOffset});
      }
      if(pathname==='/api/import/parse'&&req.method==='POST'){
        const data=await body(req);if(!data.name||typeof data.content!=='string')throw new AppError('파일을 선택해주세요.');
        const file=await parseFile(data.name,Buffer.from(data.content,'base64')),id=randomBytes(16).toString('hex');
        for(const [key,value]of imports)if(Date.now()-value.createdAt>20*60*1000)imports.delete(key);
        if(imports.size>=20)imports.delete(imports.keys().next().value);
        imports.set(id,{...file,createdAt:Date.now(),name:data.name,mode:data.mode==='tracking'?'tracking':'orders'});
        return json(res,{id,headers:file.headers,mapping:file.mapping,total:file.rows.length,sample:file.rows.slice(0,5),rowOffset:file.rowOffset});
      }
      if(pathname==='/api/import/preview'&&req.method==='POST'){const data=await body(req),file=previewEntry(data.id),mapped=mapRows(file,data.mapping,data.defaults,file.mode);return json(res,{total:mapped.total,valid:mapped.rows.length,errors:mapped.errors.slice(0,100),errorCount:mapped.errors.length,warnings:mapped.warnings,rows:mapped.rows.slice(0,6)});}
      if(pathname==='/api/import/commit'&&req.method==='POST'){const data=await body(req),file=previewEntry(data.id),mapped=mapRows(file,data.mapping,data.defaults,file.mode);if(mapped.errors.length)throw new AppError(`${mapped.errors.length}개 행을 수정한 다음 다시 가져와주세요. 첫 오류: ${mapped.errors[0].row}행 ${mapped.errors[0].message}`);if(file.demo)for(const row of mapped.rows)row.demo=true;const result=file.mode==='tracking'?store.importTracking(mapped.rows):store.importOrders(mapped.rows);imports.delete(data.id);return json(res,result);}
      if(pathname==='/api/export'&&req.method==='GET'){
        let orders=store.query({...params,all:'true'}).orders;if(params.ids){const ids=new Set(params.ids.split(','));orders=orders.filter(o=>ids.has(o.id));}
        if(orders.length>100000)throw new AppError('내보내기 범위를 줄여주세요.');const file=await exportOrders(orders,params.format==='csv'?'csv':'xlsx',params.mode==='tracking');return download(res,file,'도비_주문_'+new Date().toISOString().slice(0,10));
      }
      if(pathname==='/api/template'&&req.method==='GET'){const sample={orderNo:'EXAMPLE-001',lineId:'1',channel:'스마트스토어',account:'내 스토어',product:'예제 상품',quantity:1,unitPrice:10000,amount:10000,buyer:'예제 구매자',recipient:'예제 수령인',phone:'010-0000-0000',postcode:'00000',address:'예제 주소',status:'신규',orderedAt:new Date().toISOString().slice(0,10),carrier:'CJ대한통운',tracking:params.mode==='tracking'?'EXAMPLE-123':''};return download(res,await exportOrders([sample],'xlsx',params.mode==='tracking'),params.mode==='tracking'?'송장_가져오기_양식':'주문_가져오기_양식');}
      if(pathname==='/api/backup'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="dobi-backup-'+Date.now()+'.json"'});return res.end(JSON.stringify(store.snapshot(),null,2));}
      if(pathname==='/api/restore'&&req.method==='POST'){const data=await body(req);if(integrations.isBusy())throw new AppError('연동 작업이 끝난 뒤 백업을 복원해주세요.',409);for(const c of data.connections||[]){if(!catalog.providers.some(p=>p.id===c.providerId))throw new AppError('백업에 알 수 없는 연동 대상이 있습니다.');if(c.mode==='api')validateRecipe(c.recipe,c.kind);if(c.mode==='session'){if(c.providerId!=='esm'||c.kind!=='market'||esmMetadata(c).channel!==c.channel)throw new AppError('백업의 ESM 연결 정보를 확인해주세요.');}if(c.mode==='wing')wingMetadata(c);if(c.mode==='seller')sellerMetadata(c,catalog.providers.find(p=>p.id===c.providerId));}const result=store.restore(data);sessionGrants.clear();return json(res,result);}
      if(pathname==='/api/reference'&&req.method==='GET')return json(res,{channels:store.reference('channels',CHANNELS),carriers:store.reference('carriers',CARRIERS),catalog});
      const referenceMatch=pathname.match(/^\/api\/reference\/(channels|carriers|catalog)$/);
      if(referenceMatch&&req.method==='PUT'){const value=await body(req);store.saveReference(referenceMatch[1],value);return json(res,value);}
      const draftMatch=pathname.match(/^\/api\/drafts\/([a-zA-Z0-9_-]{1,100})$/);
      if(draftMatch){const owner=req.dobiOwnerId||'standalone';if(req.method==='GET')return json(res,store.draft(owner,draftMatch[1]));if(req.method==='DELETE'){store.removeDraft(owner,draftMatch[1]);return json(res,{ok:true});}if(req.method==='PUT'){const data=await body(req);if(!data||typeof data!=='object'||!data.values||typeof data.values!=='object'||Array.isArray(data.values)||Object.keys(data).some(k=>!['values','version'].includes(k))||Object.entries(data.values).some(([k,v])=>!['orderNo','lineId','channel','account','product','sku','option','quantity','unitPrice','amount','fee','expectedAmount','shippingFee','buyer','recipient','phone','postcode','address','deliveryMemo','orderedAt','status','carrier','tracking','workMemo','workStatus','onHold','holdReason','holdUntil','claimType','claimNote','customsCode','warehouse','memo','connectionId'].includes(k)||typeof v!=='string'))throw new AppError('임시 저장 항목을 확인해주세요.');if(JSON.stringify(data).length>100000)throw new AppError('임시 저장 내용이 너무 큽니다.');store.saveDraft(owner,draftMatch[1],data);return json(res,{ok:true});}}
      if(pathname==='/api/businesses'&&req.method==='GET')return json(res,store.businesses());
      if(pathname==='/api/businesses'&&req.method==='POST')return json(res,store.saveBusiness(await body(req)),201);
      if(pathname==='/api/account-business'&&req.method==='POST'){const data=await body(req);store.assignBusiness(data.channel,data.account,data.businessId);return json(res,{ok:true});}
      if(pathname.startsWith('/api/'))throw new AppError('요청한 기능을 찾을 수 없습니다.',404);
      if(hosted)throw new AppError('요청한 기능을 찾을 수 없습니다.',404);
      if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('지원하지 않는 요청입니다.',405);
      const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg','/integrations.js':'integrations.js','/integrations.css':'integrations.css'};
      if(!files[pathname])throw new AppError('페이지가 없습니다.',404);
      const bytes=await readFile(path.join(root,'public',files[pathname])),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[path.extname(files[pathname])];res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(e){if(!res.headersSent)json(res,{error:e instanceof AppError?e.message:'처리하지 못했습니다. 입력 파일이나 실행 로그를 확인해주세요.'},e.status||500);else res.end();if(!(e instanceof AppError))console.error(e.stack);}
  };
  if(hosted)return {handler,store,token,integrations,close:async()=>{integrations.dispose();store.close();}};
  const server=http.createServer(handler);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {handler,server,store,token,integrations,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{integrations.dispose();await new Promise(r=>server.close(r));store.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createApp({port:Number(process.env.DOBI_PORT)||4317});console.log('도비 오더스 '+app.url);
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
