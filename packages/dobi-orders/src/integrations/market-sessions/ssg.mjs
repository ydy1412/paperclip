import {attr,bad,baseOrder,browserRequired,fail,html,id,identity,integer,loginForm,mergeOrders,newTransport,nodes,object,orderDate,range,scalar,text,array} from './common.mjs';
import {downloadRecords} from './tables.mjs';
// SsgOpen: 13c0/13c6 normal login + vendor, 13da/ec/ee grid, 13dc/de/e2 Excel, 1408/a/c claims.
const HOST='https://po.ssgadm.com';
const MEMBER='/cm/mgmt/apimbr/editApimbrUserForm?callFromType=lnbMenu&from=po&menuId=5000002396&pageNo=1';
const get=(r,...keys)=>{for(const k of keys)if(r[k]!==undefined&&r[k]!==''&&r[k]!=='알수없음')return text(r[k]);return '';};
export function createSsgClient({credentials={},session}={}){
  const request=newTransport(session);let vendor;
  async function verifyIdentity(){const raw=await request(HOST+MEMBER,{format:'text'}),doc=html(raw);if(loginForm(doc))fail('SSG 로그인창에서 로그인을 완료해주세요.','SESSION_REQUIRED',401);
    const input=key=>{const found=[...nodes(doc)].filter(n=>n.tagName==='input'&&attr(n,'id')===key);if(found.length!==1)bad();return attr(found[0],'value');};
    vendor={id:id(input('venId')),name:scalar(input('venNm')).replace(/\(\d{4,}\)$/,'').trim()};if(!vendor.name)bad();return identity(credentials,vendor.id,vendor.name);
  }
  async function login(){if(!credentials.sellerId||!credentials.password)fail('SSG ID와 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);
    const result=await request(HOST+'/authentication/check.ssg',{method:'POST',body:new URLSearchParams({userId:credentials.sellerId,userPwd:credentials.password,captchaResponse:''}).toString()});
    if(result.userId!==undefined&&scalar(result.userId)!==credentials.sellerId)fail('SSG 로그인 ID가 선택한 계정과 다릅니다.','IDENTITY_MISMATCH',409);
    if(result.fsId||['CHANG_PW','DORM','inprogress','RSTOR_USER2','ACCOUNT_LOCK','RSTOR_USER'].includes(result.login))return browserRequired('SSG 로그인창에서 추가 인증 또는 계정 안내를 정상 완료해주세요.');
    try{return await verifyIdentity();}catch(e){if(['SESSION_REQUIRED','INVALID_RESPONSE'].includes(e.code))return browserRequired('SSG 로그인창에서 문자·이메일 인증을 완료해주세요.');throw e;}
  }
  function normalize(r,status,claimType='없음',source={}){
    const orderNo=id(get(r,'원주문번호','주문번호')),qty=integer(get(r,'취소요청수량','지시수량','반품수량','교환수량','주문수량'),{positive:true}),itemSeq=id(source.ordItemSeq||get(r,'주문상품순번')),shippingNo=get(r,'배송번호'),shippingSeq=source.shppSeq||get(r,'배송순번');
    const amountValue=get(r,'주문금액'),priceValue=get(r,'판매가'),price=integer(priceValue||amountValue),amount=amountValue?integer(amountValue):price*qty;if(!Number.isSafeInteger(amount))bad();
    const sourceStatus=get(r,'상세배송진행상태','주문상태','반품처리상태','교환처리상태')||status,cancelCount=get(r,'취소수량'),recipient=get(r,'수취인'),phone=get(r,'수취인휴대전화번호','수취인 휴대폰번호','수취인전화번호'),address=get(r,'수취인주소','수취인도로명주소','수취인지번주소'),postcode=get(r,'우편번호','구우편번호');
    const unsafe=Boolean(cancelCount&&integer(cancelCount)>0||/\*|●/.test(recipient+phone+address)||/취소|반품|교환/.test(sourceStatus));
    return baseOrder('SSG',credentials.account||credentials.sellerId,{providerId:'ssg',orderNo,lineId:[itemSeq,shippingNo,shippingSeq].filter(Boolean).join(':'),orderedAt:orderDate(get(r,'결제완료일자')||orderNo.slice(0,8)),product:get(r,'상품명'),sku:get(r,'협력업체상품ID','협력업체단품ID'),option:get(r,'옵션명','옵션'),quantity:qty,amount,recipient,phone,postcode,address,buyer:get(r,'주문자','주문자명'),deliveryMemo:get(r,'고객배송메모','배송업무메모'),carrier:get(r,'택배사'),tracking:get(r,'운송장번호'),status,sourceStatus,claimType,sourceIds:{vendorId:vendor.id,itemSeq,shippingNo,shippingSeq,...(unsafe?{fulfillableQty:0,needsReview:true}:{})}});
  }
  async function columns(path){const raw=await request(HOST+path,{format:'text'});if(loginForm(html(raw)))fail('SSG 로그인이 만료되었습니다.','SESSION_REQUIRED',401);const candidates=[];
    for(const match of raw.matchAll(/GridUtil\.newGrid\s*\(\s*\{([\s\S]*?\})\s*\);/g)){const names=[...match[1].matchAll(/header\s*:[\s\S]*?label\s*:\s*"([^"]*)"/g)].map(m=>text(m[1]));if(names.includes('상품명')&&(names.includes('주문번호')||names.includes('원주문번호'))){if(new Set(names.filter(Boolean)).size!==names.filter(Boolean).length)bad();candidates.push(names);}}
    if(candidates.length!==1)bad();return candidates[0];
  }
  async function grids(pagePath,readPath,query,status,claimType,orders){const names=await columns(pagePath),seen=new Set();
    for(let page=1;page<=500;page++){query.set('page',String(page));query.set('pageSize','500');const result=await request(HOST+readPath+'?'+query),rows=array(result.gridRows);if(!rows.length)break;
      for(const row of rows){object(row);const cells=array(row.gridCells);if(cells.length!==names.length)bad();const values=Object.fromEntries(names.map((name,i)=>[name,scalar(object(cells[i]).value,{optional:true})]).filter(([name])=>name));const source={};if(row.gridRowUserDatas!==undefined)for(const v of array(row.gridRowUserDatas)){object(v);const key=scalar(v.name);if(Object.hasOwn(source,key))bad();source[key]=scalar(v.data,{optional:true});}
        const order=normalize(values,status,claimType,source),key=order.orderNo+'\0'+order.lineId;if(seen.has(key))bad();seen.add(key);mergeOrders(orders,order);
      }if(rows.length<500)break;if(page===500)fail('SSG 조회 페이지 한도에 도달했습니다. 기간을 줄여주세요.','LIMIT_EXCEEDED',400);
    }
  }
  async function collectOrders(input){const {from,to}=range(input);await verifyIdentity();const out=new Map();
    const q=new URLSearchParams({searchDtsType:'01',searchEvntStrtDts:from,searchEvntEndDts:to,choicePeriod:'08',searchOmYns:'',searchType:'01',searchVenId:vendor.id,searchVenNm:vendor.name,searchShppStatCd:'10',searchShppProgStatDtlCd:'11',searchShortgRsnCd:'00',searchTypeFlag:'01',searchShppStatCds:'10',occuCd:'701,746'});for(const value of ['11','15','16'])q.append('searchShppDivDtlCd',value);
    await grids('/pdo/ven/order/venOrderConfirmList.ssg','/pdo/ven/order/getVenOrderConfirmXmlData.ssg',q,'신규','없음',out);
    for(const [flag,step,dateType,status]of [['06','22','03','발송대기'],['08','22','03','배송중'],['01','51','01','구매확정']]){const query=new URLSearchParams({searchDtsType:dateType,searchEvntStrtDts:from,searchEvntEndDts:to,searchShppProgStatDtlCds:step,searchTypeFlag:flag,searchVenId:vendor.id,choicePeriod:'08',searchOmYns:'N',searchShppStatCds:'10',searchShppDivDtlCds:'11,15,16',searchFrgShppYns:'',searchItemDivCds:'10,20,30,40',searchExcel:'1,2,3,4,5,6,7,9,10,11,12,14,15,16,17,18,19,20,21,22,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67'});if(step==='51')query.set('searchShppProgStatDtlCd','51');const rows=await downloadRecords(session,HOST+'/pdo/ven/whout/getVenWhoutShppXmlDataExcel.ssg?'+query,{required:['주문번호','배송순번','주문상품순번','상품명']});for(const r of rows)mergeOrders(out,normalize(r,status));}
    // The source's delivered entry deliberately returns no separate read path; closed/normal grids retain source status.
    const start=from.replaceAll('-',''),end=to.replaceAll('-','');
    for(const [page,kind,code,status]of [['listVenCncl','cancel','','취소요청'],['venReturnItemList','return','030','반품요청'],['venExchangeItemList','exchange','040','교환요청']]){
      const query=new URLSearchParams({searchStartDt:start,searchEndDt:end,searchVenId:vendor.id,ordItemStatChngStartDt:'',ordItemStatChngEndDt:'',searchRfdAutoProcPsblYn:''});if(code)query.set('searchOrdDivCd',code);
      if(kind==='cancel'){for(const tail of ['?searchDateType=01&searchOrdItemStatCd=&searchOrdProcDemndStatCd=10','?searchDateType=02&searchOrdItemStatCd=180&searchOrdProcDemndStatCd=10%2C60']){const all=new URLSearchParams(query);for(const [k,v]of new URLSearchParams(tail.slice(1)))all.set(k,v);await grids('/ms/order/'+page+'.ssg','/ms/order/getVenCnclList.ssg',all,status,status,out);}}
      else for(const codes of kind==='return'?['230','235,246','250','299','260','270']:['330,335','340,350,336,360,338','390','336','399','340','380']){const all=new URLSearchParams(query);all.set('searchOrdItemStatCd',codes);await grids('/ms/order/'+page+'.ssg','/ms/order/getClmItemList.ssg',all,status,status,out);}
    }
    await verifyIdentity();return {complete:true,orders:[...out.values()],notes:['SSG 관리자 주문 그리드와 Excel, 취소·반품·교환 목록을 조회했습니다. 원본의 배송완료 전용 조회는 구현되어 있지 않아 별도 성공으로 표시하지 않습니다.'],summary:{count:out.size,message:'SSG 전체 지원 목록 수집 완료'}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies()}),cancel:()=>session.cancel?.()};
}
