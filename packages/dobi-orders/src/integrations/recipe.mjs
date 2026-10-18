import { parse as parseLossless } from 'lossless-json';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { gunzipSync,inflateSync,brotliDecompressSync } from 'node:zlib';
import { AppError } from '../store.mjs';

export const RECIPE_EXAMPLE={version:1,baseUrl:'https://api.example.com',auth:{type:'bearer'},operations:{test:{method:'GET',path:'/account',success:{path:'ok',equals:true}},collect:{method:'GET',path:'/orders',query:{from:'{{from}}',to:'{{to}}',page:'{{page}}'},itemsPath:'data.orders',pagination:{type:'page',start:1,pageSize:100,limit:100},mapping:{orderNo:'orderNo',lineId:'lineId',product:'product',quantity:'quantity',unitPrice:'unitPrice',amount:'amount',orderedAt:'orderedAt',buyer:'buyer',recipient:'recipient',phone:'phone',postcode:'postcode',address:'address',carrier:'carrier',tracking:'tracking',deliveryMemo:'deliveryMemo',status:'status'}}}};
export const FORWARDER_EXAMPLE={version:1,baseUrl:'https://api.example.com',auth:{type:'bearer'},operations:{test:{method:'GET',path:'/account',success:{path:'ok',equals:true}},tracking:{method:'GET',path:'/shipments',query:{from:'{{from}}',to:'{{to}}',page:'{{page}}'},itemsPath:'data.shipments',pagination:{type:'page',start:1,pageSize:100,limit:100},mapping:{applicationId:'applicationId',orderNo:'orderNo',lineId:'lineId',carrier:'carrier',tracking:'tracking'}},submit:{method:'POST',path:'/shipments',body:{recipient:'{{recipient}}',phone:'{{phone}}',postcode:'{{postcode}}',address:'{{address}}',items:'{{items}}',clientReference:'{{clientReference}}'},success:{path:'ok',equals:true},applicationIdPath:'data.applicationId'}}};
const blockedName=/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;
function privateAddress(ip){return ip==='::1'||ip==='::'||/^(fc|fd|fe8|fe9|fea|feb)/i.test(ip)||/^::ffff:/i.test(ip)||/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(ip);}
// Validate the address in the resolver used by the actual TLS connection. A preflight
// lookup followed by an independent fetch lookup does not prevent DNS rebinding.
export function publicHttpsFetch(url,options){const responseLimit=Number.isSafeInteger(options.maxResponseBytes)&&options.maxResponseBytes>0&&options.maxResponseBytes<=32*1024*1024?options.maxResponseBytes:12*1024*1024;return new Promise((resolve,reject)=>{
  const checkedLookup=(hostname,opts,callback)=>{lookup(hostname,{all:true}).then(addresses=>{if(!addresses.length||addresses.some(x=>privateAddress(x.address)))throw new AppError('공개 API 서버만 연결할 수 있습니다.');if(opts.all)callback(null,addresses);else{const selected=addresses.find(x=>x.family===(opts.family||4))||addresses[0];callback(null,selected.address,selected.family);}}).catch(e=>callback(e));};
  const req=httpsRequest(url,{method:options.method,headers:{...options.headers,'Accept-Encoding':'identity'},signal:options.signal,lookup:checkedLookup,agent:false},res=>{const chunks=[];let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>responseLimit){req.destroy(new AppError('API 응답이 너무 큽니다.'));return;}chunks.push(b);});res.on('error',reject);res.on('end',()=>{try{let buffer=Buffer.concat(chunks);const encoding=res.headers['content-encoding'];const limit={maxOutputLength:responseLimit};if(encoding==='gzip')buffer=gunzipSync(buffer,limit);else if(encoding==='deflate')buffer=inflateSync(buffer,limit);else if(encoding==='br')buffer=brotliDecompressSync(buffer,limit);else if(encoding&&encoding!=='identity')throw new AppError('API 응답 압축 형식을 지원하지 않습니다.');const headers=new Headers();for(const [key,value] of Object.entries(res.headers)){if(['content-encoding','content-length'].includes(key))continue;for(const entry of Array.isArray(value)?value:[value])if(entry!==undefined)headers.append(key,String(entry));}const status=res.statusCode||502;resolve(new Response([204,205,304].includes(status)?null:buffer,{status,headers}));}catch(e){reject(e);}});});req.on('error',reject);req.end(options.body);
});}
export function validateRecipe(input,kind='market'){
  if(!input||input.version!==1)throw new AppError('API 연결 규칙 version은 1이어야 합니다.');
  if(Object.keys(input).some(k=>!['version','baseUrl','auth','operations'].includes(k)))throw new AppError('API 연결 규칙에는 주소·인증 방식·작업 규칙만 저장할 수 있습니다.');
  if(input.auth&&Object.keys(input.auth).some(k=>!['type','name'].includes(k)))throw new AppError('API 인증 값은 암호화된 인증 정보 칸에 입력해주세요.');
  let url;try{url=new URL(input.baseUrl);}catch{throw new AppError('API 기본 주소를 확인해주세요.');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443'||isIP(url.hostname)||blockedName.test(url.hostname)||!url.hostname.includes('.'))throw new AppError('공개 HTTPS API 기본 주소를 입력해주세요.');
  if(!['none','bearer','cookie','header','basic'].includes(input.auth?.type||'none'))throw new AppError('지원하지 않는 API 인증 방식입니다.');
  if(input.auth?.type==='header'&&(!/^[A-Za-z0-9-]{1,80}$/.test(input.auth.name||'')||/^(Host|Content-Length|Connection|Origin)$/i.test(input.auth.name)))throw new AppError('API 키 헤더 이름을 확인해주세요.');
  if(JSON.stringify(input).length>100000)throw new AppError('API 연결 규칙이 너무 큽니다.');
  const ops=input.operations;if(!ops||!ops.test||!(kind==='market'?ops.collect:ops.tracking))throw new AppError('인증 확인과 주문수집/송장조회 규칙이 필요합니다.');
  for(const [name,op]of Object.entries(ops)){
    if(!['test','collect','tracking','submit'].includes(name))throw new AppError('지원하지 않는 API 작업입니다.');
    if(!['GET','POST'].includes(op.method)||!op.path?.startsWith('/')||op.path.startsWith('//')||/[\r\n\\]/.test(op.path))throw new AppError('API 작업은 GET/POST와 상대 경로를 사용해주세요.');
    if(name==='submit'&&op.method!=='POST')throw new AppError('배송신청은 명시적인 POST 작업이어야 합니다.');
    if(name==='submit'&&(!op.success||!op.applicationIdPath))throw new AppError('배송신청 성공 조건과 접수번호 경로가 필요합니다.');
    if(name==='test'&&!op.success)throw new AppError('연결 확인 응답의 성공 조건이 필요합니다.');
    if(name==='collect'&&['orderNo','product','quantity','orderedAt'].some(k=>!op.mapping?.[k]))throw new AppError('주문번호·상품명·수량·주문일 응답 경로를 지정해주세요.');
    if(name==='tracking'&&(!op.mapping?.tracking||!op.mapping?.carrier||!(op.mapping?.orderNo||op.mapping?.applicationId)))throw new AppError('송장·택배사·접수번호 또는 주문번호 매핑이 필요합니다.');
    if(op.pagination&&!['page','cursor','none'].includes(op.pagination.type))throw new AppError('페이지 방식은 page/cursor/none입니다.');
    for(const [key,v]of Object.entries(op.headers||{}))if(/authorization|cookie|api.?key|token|secret/i.test(key)&&!/\{\{auth\./.test(String(v)))throw new AppError('인증 값은 암호화된 인증 정보 칸에 입력해주세요.');
    function rejectEmbeddedSecrets(value){if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){if(/authorization|cookie|api.?key|token|secret|password|passwd/i.test(key)&&typeof v==='string'&&v&&!/\{\{[\w.]+\}\}/.test(v))throw new AppError('API 규칙에 인증 값을 직접 저장할 수 없습니다. 암호화된 인증 항목을 사용해주세요.');if(v&&typeof v==='object')rejectEmbeddedSecrets(v);}}
    rejectEmbeddedSecrets(op.query);rejectEmbeddedSecrets(op.body);
  }
  return structuredClone(input);
}
export function getPath(value,key){if(!key)return value;const parts=String(key).split('.');if(parts.some(p=>['__proto__','constructor','prototype'].includes(p)))throw new AppError('응답 필드 경로가 잘못됐습니다.');return parts.reduce((v,p)=>v?.[p],value);}
function expand(value,context){if(Array.isArray(value))return value.map(v=>expand(v,context));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,expand(v,context)]));if(typeof value!=='string')return value;const exact=value.match(/^\{\{([\w.]+)\}\}$/);if(exact){const v=getPath(context,exact[1]);if(v===undefined)throw new AppError(`API 규칙에 필요한 ${exact[1].startsWith('auth.')?'인증 항목':exact[1]} 값이 없습니다.`);return v;}return value.replace(/\{\{([\w.]+)\}\}/g,(_,key)=>{const v=getPath(context,key);if(v===undefined)throw new AppError('API 규칙에 필요한 값이 없습니다.');return String(v);});}
const parseJson=text=>parseLossless(text,null,v=>{const n=Number(v);return Number.isSafeInteger(n)||!/^-?\d+$/.test(v)?n:v;});
async function responseJson(response){const responseLimit=12*1024*1024;if(!response.ok)throw new AppError(response.status===401||response.status===403?'API 인증에 실패했습니다. 인증 정보와 연결 권한을 확인해주세요.':`API 조회에 실패했습니다. HTTP ${response.status}`,502);let raw='';if(response.body?.getReader){const reader=response.body.getReader();let bytes=0;const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>responseLimit)throw new AppError('API 응답이 너무 큽니다. 수집 기간을 줄여주세요.');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}}else raw=await response.text();if(raw.length>12*1024*1024)throw new AppError('API 응답이 너무 큽니다.');try{return parseJson(raw);}catch{throw new AppError('JSON API 응답을 읽지 못했습니다. 로그인 페이지 또는 응답 규칙을 확인해주세요.',502);}}
export function createRecipeClient({recipe,credentials={},kind='market',fetchImpl=fetch,resolveHost=true}){
  recipe=validateRecipe(recipe,kind);const base=new URL(recipe.baseUrl);
  async function request(name,context={}){
    const op=recipe.operations[name];if(!op)throw new AppError('이 API 연결 규칙에는 해당 기능이 없습니다.');
    const vars={...context,auth:credentials},url=new URL(base.href);url.pathname=base.pathname.replace(/\/$/,'')+expand(op.path,vars);url.search='';for(const [k,v]of Object.entries(expand(op.query||{},vars)))if(v!==''&&v!==null&&v!==undefined)url.searchParams.set(k,String(v));
    const headers={Accept:'application/json',...expand(op.headers||{},vars)};for(const v of Object.values(headers))if(/[\r\n]/.test(String(v)))throw new AppError('API 헤더 값에 줄바꿈을 사용할 수 없습니다.');
    const auth=recipe.auth||{type:'none'};
    if(auth.type==='bearer'){if(!credentials.token)throw new AppError('API 토큰을 입력해주세요.');headers.Authorization='Bearer '+credentials.token;}
    if(auth.type==='cookie'){if(!credentials.cookie)throw new AppError('이 API용 로그인 세션을 입력해주세요.');headers.Cookie=credentials.cookie;}
    if(auth.type==='header'){if(!credentials.apiKey)throw new AppError('API 키를 입력해주세요.');headers[auth.name]=credentials.apiKey;}
    if(auth.type==='basic'){if(!credentials.username||!credentials.password)throw new AppError('API 사용자 이름과 비밀번호를 입력해주세요.');headers.Authorization='Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64');}
    const options={method:op.method,headers,redirect:'error',signal:AbortSignal.timeout(30000)};if(op.method==='POST'){headers['Content-Type']='application/json';options.body=JSON.stringify(expand(op.body||{},vars));}
    let response;try{response=await (resolveHost?publicHttpsFetch:fetchImpl)(url.href,options);}catch(e){if(e instanceof AppError)throw e;throw new AppError(name==='submit'?'배송신청 결과를 확인하지 못했습니다. 배송대행지에서 접수 여부를 먼저 확인해주세요.':'API 서버에 연결하지 못했습니다. 주소·세션·접속 권한을 확인해주세요.',502);}
    const data=await responseJson(response);if(op.success&&JSON.stringify(getPath(data,op.success.path))!==JSON.stringify(op.success.equals))throw new AppError('API가 성공 응답을 반환하지 않았습니다. 응답 규칙과 인증을 확인해주세요.',502);return data;
  }
  async function rows(name,{from,to}={}){const op=recipe.operations[name];if(!op)throw new AppError('이 API 연결에는 수집 기능이 없습니다.');const p=op.pagination||{type:'none'},all=[],seen=new Set();let page=Number(p.start)||1,cursor='';const limit=Math.min(1000,Math.max(1,Number(p.limit)||100));let complete=false;
    for(let count=0;count<limit;count++,page++){const data=await request(name,{from,to,page,cursor});let list=getPath(data,op.itemsPath);if(!Array.isArray(list))throw new AppError('응답에서 주문/배송 목록을 찾지 못했습니다. itemsPath를 확인해주세요.',502);if(all.length+list.length>10000)throw new AppError('한 번에 10,000품목까지 수집할 수 있습니다. 기간을 줄여주세요.');for(const item of list){const row=Object.fromEntries(Object.entries(op.mapping).map(([k,v])=>[k,getPath(item,v)]));if(name==='collect'&&['orderNo','product','quantity','orderedAt'].some(k=>row[k]===undefined||row[k]===null||row[k]===''))throw new AppError('API 주문의 필수 값이 응답에 없습니다. 수량·주문일 매핑을 확인해주세요.',502);if(op.statusMap&&row.status!==undefined){if(!(String(row.status)in op.statusMap))throw new AppError('매핑하지 않은 원격 주문상태가 있습니다.');row.status=op.statusMap[String(row.status)];}all.push(row);}
      if(p.type==='none'){complete=true;break;}if(p.type==='cursor'){const next=getPath(data,p.nextPath);if(next===undefined||next===null||next===''){complete=true;break;}if(seen.has(String(next)))throw new AppError('API가 같은 페이지 토큰을 반복했습니다.',502);seen.add(String(next));cursor=next;}else{const size=Number(p.pageSize);if(!size||size<1)throw new AppError('페이지 수집에는 pageSize가 필요합니다.');if(list.length<size){complete=true;break;}}
    }
    if(!complete)throw new AppError('페이지 수집 한도에 도달했습니다. 기간을 줄이거나 페이지 규칙을 확인해주세요.',502);return {orders:all,complete:true};
  }
  return {testConnection:async()=>{await request('test');return {ok:true};},collectOrders:dates=>rows('collect',dates),collectTracking:dates=>rows('tracking',dates),submit:async values=>{const data=await request('submit',values);const id=getPath(data,recipe.operations.submit.applicationIdPath);if(id===undefined||id===null||String(id)==='')throw new AppError('배송신청 접수번호가 없습니다. 접수 여부를 확인해주세요.',502);return {applicationId:String(id)};}};
}
