import {array,attr,bad,baseOrder,browserRequired,fail,html,id,identity,integer,loginForm,mergeOrders,newTransport,nodes,nodeText,object,range,scalar,text,orderDate} from './common.mjs';
const NORMAL={p1:'신규',g1:'발송대기',d1:'배송중',d2:'배송완료',s1:'구매확정'};
const CLAIM={r1:'취소요청',r2:'취소요청',f2:'취소요청',f3:'취소요청',f4:'취소요청',c1:'취소요청',c2:'취소요청',c3:'취소요청',c4:'취소요청',b1:'반품요청',b2:'반품요청',b3:'반품요청',b4:'반품요청',r3:'반품요청',e1:'교환요청',e2:'교환요청',e3:'교환요청',e4:'교환요청',e5:'교환요청',z1:'교환요청',z2:'교환요청',z3:'교환요청',z4:'교환요청',z5:'교환요청'};
const CODE=/^(?:[pgds][12]|[rbcefz][1-5])$/;
const listPath='/order/order_list_all.php';
function money(v){return integer(text(v).replace(/[\s￦원]/g,''));}
function koreanDate(v){const s=text(v).replace(/년\s*/g,'-').replace(/월\s*/g,'-').replace(/일\s*/g,' ').replace(/시\s*/g,':').replace(/분\s*/g,':').trim();const m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);if(!m)bad();return orderDate(m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'));}
function directCells(node){return (node.childNodes??[]).filter(n=>['td','th'].includes(n.tagName));}
function field(doc,name){const fields=[...nodes(doc)].filter(n=>n.tagName==='input'&&attr(n,'name')===name);if(fields.length>1)bad();return fields[0]?text(attr(fields[0],'value')):'';}

// Godo5 selected CIL 0x06001082/88/8a/a6/a8. Uses read HTML paths;
// deliberately does not reproduce the original remote Excel-template modification.
export function createGodo5Client({credentials={},session,now=()=>new Date()}){
  const request=newTransport(session);let origin;
  try{const u=new URL(credentials.host?.includes('://')?credentials.host:'https://'+credentials.host);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/')bad();origin=u.origin;}catch{fail('고도몰 관리자 HTTPS 호스트를 입력해주세요.','MISSING_CREDENTIALS',400);}
  let prefix=credentials.loginType==='provider'?'/provider':'',submitted=false,labels=new Map();
  const page=(path,options={})=>request(origin+path,{...options,format:'text',headers:{Referer:origin+prefix+listPath,...options.headers}});
  function listUrl(from,to,code,pageNum=2000){const q=new URLSearchParams({detailSearch:'y',key:'o.orderNo',keyword:'',treatDateFl:'og.regDt',searchPeriod:'6',sort:'og.orderNo desc',pageNum:String(pageNum),view:'orderGoods',searchFl:'y',applyPath:'/order/order_list_all.php?view=orderGoods'});q.append('treatDate[]',from);q.append('treatDate[]',to);q.append('orderStatus[]',code??'');return prefix+listPath+'?'+q;}
  function count(doc){const raw=nodeText(doc),match=/검색\s*([\d,]+)\s*개/.exec(raw);if(!match)bad();return integer(match[1]);}
  function labelMap(doc){const map=new Map();for(const n of nodes(doc)){if(n.tagName!=='label')continue;const input=[...nodes(n)].find(x=>x.tagName==='input'&&CODE.test(attr(x,'value')??''));if(input){const label=text(nodeText(n)),code=attr(input,'value');if(!label)bad();if(map.has(label)&&map.get(label)!==code)bad();map.set(label,code);}}return map;}
  async function verifyIdentity(){
    const today=new Date(new Date(now()).getTime()+9*3600000).toISOString().slice(0,10);let raw=await page(listUrl(today,today));
    if(/location\.replace\(['"]https?:\/\/[^'"\s]+\/provider\/index\.php['"]\)/.test(raw)&&!prefix){prefix='/provider';raw=await page(listUrl(today,today));}
    const doc=html(raw);if(loginForm(doc)||/location\.(?:href|replace).*login\.php/.test(raw))fail('고도몰 관리자 로그인이 필요합니다.','SESSION_REQUIRED',401);
    count(doc);labels=labelMap(doc);if(![...labels.values()].some(x=>NORMAL[x]))fail('고도몰 주문 상태·접근 권한을 확인할 수 없습니다.','IDENTITY_REQUIRED',409);
    return identity(credentials,'host:'+new URL(origin).hostname+':login:'+id(credentials.sellerId),new URL(origin).hostname+' / '+credentials.sellerId,submitted?'credential-login':'user-confirmation');
  }
  async function login(){
    if(!credentials.password)return browserRequired('고도몰 관리자 로그인창에서 보안 인증을 완료해주세요.');
    await page('/base/login.php',{followRedirects:true});
    const raw=await page('/base/login_ps.php',{method:'POST',body:new URLSearchParams({mode:'login',returnUrl:'',managerId:credentials.sellerId,managerPw:credentials.password}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},followRedirects:true});
    if(/인증에 필요한 요소|보안 인증|security.*auth|인증번호/.test(raw))return browserRequired('고도몰 로그인창에서 보안 인증을 완료해주세요.');submitted=true;return verifyIdentity();
  }
  function readItem(row,basic,orderNo){
    const checkbox=[...nodes(row)].find(n=>n.tagName==='input'&&/^statusCheck_.+_/.test(attr(n,'id')??''));if(!checkbox)return undefined;
    const line=id((attr(checkbox,'id')??'').replace(/^statusCheck_._/,'')),cells=directCells(row);if(cells.length<7)bad();
    const productNode=[...nodes(row)].find(n=>n.tagName==='a'&&/상품명$/.test(attr(n,'title')??''));if(!productNode)bad();
    const product=text(nodeText(productNode));let sourceStatus='';
    const commentNodes=row.childNodes??[];for(let i=0;i<commentNodes.length;i++){if(commentNodes[i].nodeName==='#comment'&&commentNodes[i].data.trim()==='처리상태'){const next=commentNodes.slice(i+1).find(n=>n.tagName==='td');if(next){sourceStatus=text(nodeText(next));break;}}}
    if(!sourceStatus){const candidates=cells.map(n=>text(nodeText(n))).filter(v=>labels.has(v));if(candidates.length!==1)bad();sourceStatus=candidates[0];}
    const code=labels.get(sourceStatus);if(!code||!NORMAL[code]&&!CLAIM[code])bad();
    const claimType=CLAIM[code]??'없음',status=NORMAL[code]??(claimType==='취소요청'?'취소':claimType==='교환요청'?'발송대기':'배송완료');
    let quantityCell;for(let i=0;i<commentNodes.length;i++)if(commentNodes[i].nodeName==='#comment'&&commentNodes[i].data.trim()==='수량'){quantityCell=commentNodes.slice(i+1).find(n=>n.tagName==='td');if(quantityCell)break;}
    const qtyNodes=[...nodes(quantityCell??row)].filter(n=>n.tagName==='strong'&&/^\s*[\d,]+\s*$/.test(nodeText(n)));if(qtyNodes.length!==1)fail('고도몰 품목 수량을 하나로 확인할 수 없습니다. 전체 수집을 중단했습니다.','AMBIGUOUS_ITEM',409);
    const quantity=integer(text(nodeText(qtyNodes[0])),{positive:true}),amount=money(nodeText(cells[6]));
    const optionNode=cells.flatMap(c=>[...nodes(c)]).find(n=>n.tagName==='div'&&attr(n,'class')?.split(/\s+/).includes('info'));
    const option=text(optionNode?nodeText(optionNode):''),sku=text(optionNode?[...nodes(optionNode)].find(n=>attr(n,'title')==='상품코드')?nodeText([...nodes(optionNode)].find(n=>attr(n,'title')==='상품코드')):'':'').replace(/^\[|\]$/g,'');
    const trace=[...nodes(row)].map(n=>attr(n,'onclick')??attr(n,'href')??'').map(v=>/delivery_trace\('([^']*)',\s*'([^']*)'\)/.exec(v)).find(Boolean);
    return baseOrder('고도몰',credentials.account||credentials.sellerId,{providerId:'godo5',orderNo,lineId:line,orderedAt:basic.date,product,option,sku,quantity,amount,buyer:basic.buyer,recipient:basic.recipient,phone:basic.phone,postcode:basic.postcode,address:basic.address,deliveryMemo:basic.memo,carrier:trace?text(trace[1]):'',tracking:trace?text(trace[2]):'',status,claimType,sourceStatus,sourceIds:{adminHost:new URL(origin).hostname,statusCode:code}});
  }
  async function detail(orderNo){
    const raw=await page(prefix+'/order/order_view.php?orderNo='+encodeURIComponent(orderNo)),doc=html(raw);if(loginForm(doc))fail('고도몰 세션이 만료되었습니다.','SESSION_REQUIRED',401);
    const modes=new Set();for(const a of nodes(doc))if(a.tagName==='a'){const m=/^#tab-(?:status|claim)-([-a-zA-Z0-9_]+)$/.exec(attr(a,'href')??'');if(m)modes.add(m[1]);}
    if(!modes.size||modes.size>20)bad();
    const dateMatch=/주문일시\s*:\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(raw);if(!dateMatch)bad();
    const buyer=/주문자명<\/th>\s*<td>\s*<span[^>]*>([\s\S]*?)<\/span>/i.exec(raw)?.[1]??'';
    const memo=/배송 메세지<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(raw)?.[1]??'';
    const basic={date:koreanDate(dateMatch[1]),buyer:text(buyer),recipient:field(doc,'info[receiverName]'),phone:field(doc,'info[receiverCellPhone]')||field(doc,'info[receiverPhone]'),postcode:field(doc,'info[receiverZonecode]')||field(doc,'info[receiverZipcode]'),address:[field(doc,'info[receiverAddress]'),field(doc,'info[receiverAddressSub]')].filter(Boolean).join(' '),memo:text(memo)};
    const result=new Map();for(const mode of modes){const body=new URLSearchParams({orderNo,orderStatusMode:mode,isUseMall:'false'}).toString(),inc=await page(prefix+'/order/inc_order_view.php',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}});if(loginForm(html(inc)))fail('고도몰 세션이 만료되었습니다.','SESSION_REQUIRED',401);for(const row of nodes(html(inc))){if(row.tagName!=='tr')continue;const order=readItem(row,basic,orderNo);if(order)mergeOrders(result,order);}}
    if(!result.size)bad();return [...result.values()];
  }
  async function collectOrders(input){
    const {from,to}=range(input),before=await verifyIdentity(),orders=new Map(),details=new Map();
    for(const code of [...new Set(labels.values())].filter(c=>NORMAL[c]||CLAIM[c])){
      let url=listUrl(from,to,code),expected,seen=new Set(),counted=0;const visited=new Set();
      for(let pageNo=1;pageNo<=100;pageNo++){
        if(visited.has(url))bad();visited.add(url);const raw=await page(url),doc=html(raw);if(loginForm(doc))fail('고도몰 세션이 만료되었습니다.','SESSION_REQUIRED',401);
        const total=count(doc);if(total>10000)fail('고도몰은 한 번에 10,000품목까지 수집할 수 있습니다.','LIMIT_EXCEEDED',400);if(expected!==undefined&&expected!==total)bad();expected=total;
        const selected=[...nodes(doc)].filter(n=>n.tagName==='input'&&/^statusCheck\[.\]\[\]$/.test(attr(n,'name')??''));counted+=selected.length;
        for(const check of selected){const value=scalar(attr(check,'value'));if(seen.has(value))bad();seen.add(value);const orderNo=id(value.split('|')[0]);if(!details.has(orderNo))details.set(orderNo,await detail(orderNo));for(const order of details.get(orderNo)){if(order.orderedAt>=from&&order.orderedAt<=to)mergeOrders(orders,order);}}
        if(counted===total)break;if(!selected.length||counted>total||pageNo===100)bad();
        const candidates=[],current=new URL(origin+url);for(const a of nodes(doc)){if(a.tagName!=='a')continue;const href=attr(a,'href');if(!href)continue;let u;try{u=new URL(href,origin+url);}catch{continue;}if(u.origin!==origin||u.pathname!==prefix+listPath||u.username||u.password||u.hash)continue;if(['orderStatus[]','treatDate[]','treatDateFl','view'].some(k=>JSON.stringify(u.searchParams.getAll(k).sort())!==JSON.stringify(current.searchParams.getAll(k).sort())))continue;const path=u.pathname+u.search;if(!visited.has(path)&&/^(?:다음|>|›|»|\d+)$/.test(text(nodeText(a))))candidates.push(path);}
        if(!candidates.length)fail('고도몰 다음 페이지를 확인할 수 없습니다. 전체 수집을 중단했습니다.','INCOMPLETE_PAGE',409);url=candidates[0];
      }
    }
    const after=await verifyIdentity();if(before.identityId!==after.identityId)bad();return {complete:true,orders:[...orders.values()],notes:['고도몰 관리자 호스트와 서버 상태 라벨을 사용하며 원격 엑셀 양식을 변경하지 않습니다.'],summary:{message:'고도몰 주문 상태별 HTML 전체 조회 완료. 엑셀 설정은 변경하지 않았습니다.',count:orders.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:{prefix}}),cancel:()=>session.cancel?.()};
}
