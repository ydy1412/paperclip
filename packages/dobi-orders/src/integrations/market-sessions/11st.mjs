import {array,bad,baseOrder,browserRequired,fail,id,identity,integer,json,mergeOrders,newTransport,object,orderDate,range,scalar,text,addDays} from './common.mjs';
import {createHash} from 'node:crypto';
const OFFICE='https://soffice.11st.co.kr',IDENTITY='https://apis.11st.co.kr/product/bruce/selleroffice/v1/main/login-seller';
const NORMAL=[['202','신규'],['301','발송대기'],['401','배송중'],['501','배송완료']];
// Original WebView fallback and IsLoginOneTimeAsync 0x06000d87/8d; order contracts d43/49/57/59/5d/61.
const first=(row,keys,{required=false}={})=>{for(const key of keys)if(row[key]!==null&&row[key]!==undefined&&scalar(row[key],{optional:true})!=='')return row[key];if(required)bad();return '';};
function hasExactLeaf(value,target,depth=0){if(depth>12)bad();if(typeof value==='string')return value===target;if(!value||typeof value!=='object')return false;return Object.values(value).some(v=>hasExactLeaf(v,target,depth+1));}
export function create11stClient({credentials={},session}){
 const request=newTransport(session);
 async function verifyIdentity(){
  if(!credentials.sellerId)fail('11번가 판매자 아이디를 입력해주세요.','MISSING_CREDENTIALS',400);const raw=await request(IDENTITY,{format:'text'});if(/^\s*</.test(raw))fail('11번가에 다시 로그인해주세요.','SESSION_REQUIRED',401);const body=json(raw);
  if(!hasExactLeaf(body,credentials.sellerId))fail('11번가 서버의 로그인 계정이 입력한 판매자 아이디와 다릅니다.','IDENTITY_MISMATCH',409);
  return identity(credentials,'login:'+id(credentials.sellerId),credentials.sellerId);
 }
 const login=async()=>browserRequired('11번가의 RSA·추가 인증은 원본과 같은 정상 로그인창에서 완료해주세요.');
 function normalize(row,{status,claimType='없음',code}={}){
  object(row);const orderNo=id(first(row,['ORD_NO','ordNo'],{required:true})),sequence=id(first(row,['ORD_PRD_SEQ','ordPrdSeq'],{required:true}));
  const quantity=integer(first(row,['ORD_QTY','ordQty','CLM_REQ_QTY','ORD_CN_QTY','OrdCnQty','clmReqQty'],{required:true}),{positive:true}),amount=integer(first(row,['ORDER_AMT','CLM_PRD_AMT','selPrcAmt'],{required:true}));
  const sourceStatus=text(first(row,['ORD_PRD_STAT_NM','ORD_PRD_STAT_NAME','CLM_STAT_NAME','ORD_CN_STAT_CD_NAME','ordPrdStat','ORD_PRD_STAT']));
  const result=baseOrder('11번가',credentials.account||credentials.sellerId,{providerId:'11st',orderNo,lineId:sequence+':'+(text(row.ADD_PRD_NO)||'0'),orderedAt:orderDate(first(row,['ORD_DT','ordStlEndDt','ORD_STL_END_DT'],{required:true})),product:text(first(row,['PRD_NM','prdNm'],{required:true})),option:text(first(row,['OPT_NM','SLCT_PRD_OPT_NM','slctPrdOptNm'])),sku:text(row.SELLER_PRD_CD),quantity,amount,buyer:text(first(row,['ORD_NM','memNm','BUYER_NM'])),recipient:text(row.RCVR_NM),phone:text(first(row,['RCVR_PRTBL_NO2','RCVR_PRTBL_NO','RCVR_TLPHN2','RCVR_TLPHN'])),postcode:text(first(row,['RCVR_MAIL_NO2','RCVR_MAIL_NO'])).replaceAll('-',''),address:text(first(row,['RCVR_BASE_ADDR2_VIEW','RCVR_BASE_ADDR2','RCVR_BASE_ADDR'])),deliveryMemo:text(row.ORD_DLV_REQ_CONT),carrier:text(first(row,['DLV_MTHD_CD_NM','DLV_ETPRS_NM'])),tracking:text(first(row,['INVC_NO','invcNo'])),status,sourceStatus,claimType,sourceIds:{productId:id(first(row,['PRD_NO','prdNo'],{required:true})),deliveryId:text(first(row,['DLV_NO','dlvNo'])),sequence}});
  if(/취소|반품|교환/.test(sourceStatus)){result.claimType=/반품/.test(sourceStatus)?'반품요청':/교환/.test(sourceStatus)?'교환요청':'취소요청';result.status=result.claimType==='교환요청'?'발송대기':'취소';}
  if(result.claimType!=='없음'||code&&text(first(row,['ORD_PRD_STAT','ordPrdStat']))!==code){result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;}
  return result;
 }
 async function collectOrders(input){
  const {from,to}=range(input);await verifyIdentity();const orders=new Map();
  async function pages(path,key,query,state){
   const seen=new Set(),pageHashes=new Set(),feeRows=new Set();let expectedTotal,received=0;for(let start=0,page=0;page<100;start+=500,page++){
    const q=new URLSearchParams(query);q.set('start',String(start));q.set('limit','500');const body=await request(OFFICE+path+'?'+q),rows=array(body[key]);let total;
    if(rows.length>500)bad();if(body.totalCount!==undefined){total=integer(body.totalCount);if(total>10000)fail('11번가 조회 결과가 너무 많습니다. 기간을 줄여주세요.','LIMIT_EXCEEDED',400);if(expectedTotal!==undefined&&expectedTotal!==total)bad();expectedTotal=total;}
    if(!rows.length){if(expectedTotal!==undefined&&received!==expectedTotal)bad();break;}const hash=createHash('sha256').update(JSON.stringify(rows)).digest('hex');if(pageHashes.has(hash))bad();pageHashes.add(hash);received+=rows.length;
    for(const row of rows){
     // The source merges zero-quantity purchase-confirmation fee rows into a real
     // product row; they must never become zero-quantity or invented products.
     if(state.status==='구매확정'&&integer(first(object(row),['ORD_QTY','ordQty'],{required:true}))===0){feeRows.add(id(first(row,['ORD_NO','ordNo'],{required:true}))+'\0'+id(first(row,['ORD_PRD_SEQ','ordPrdSeq'],{required:true})));continue;}
     const order=normalize(row,state),rowKey=order.orderNo+'\0'+order.lineId;if(seen.has(rowKey))bad();seen.add(rowKey);mergeOrders(orders,order);
    }
    if(expectedTotal!==undefined&&received>expectedTotal)bad();if(rows.length<500&&(expectedTotal===undefined||received===expectedTotal))break;if(page===99)fail('11번가 페이지 수집 제한에 도달했습니다.','LIMIT_EXCEEDED',400);
   }
   for(const feeKey of feeRows)if(![...seen].some(key=>key.startsWith(feeKey+':')))bad();
  }
  for(let start=from;start<=to;start=addDays(start,90)){
   const end=addDays(start,89)>to?to:addDays(start,89),dates={shDateFrom:start.replaceAll('-','/'),shDateTo:end.replaceAll('-','/')};
   for(const [code,status] of NORMAL)for(const mode of [{shGblDlv:'N',shDlvClfCd:'',isAbrdSellerYn:''},{shGblDlv:'Y',shDlvClfCd:'',isAbrdSellerYn:''},{shGblDlv:'N',shDlvClfCd:'04',isAbrdSellerYn:'N'}]){
    await pages('/escrow/OrderingLogisticsAction.tmall','orderingLogistics',{method:'getOrderLogisticsList',listType:'orderingLogistics',shDateType:'01',...dates,shBuyerType:'',shBuyerText:'',shProductStat:code,shDelayReport:'',shPurchaseConfirm:'',prdNo:'',shStckNo:'',shOrderType:'on',addrSeq:'',abrdOrdPrdStat:'',isItalyAgencyYn:'',shErrYN:'',gblRcvrNm:'',gblRcvrMailNo:'',gblRcvrBaseAddr:'',gblRcvrDtlsAddr:'',gblRcvrTlphn:'',gblRcvrPrtblNo:'',shOrdLang:'',shVisitDlvYn:'N',shUsimDlvYn:'N',...mode},{status,code});
   }
   await pages('/escrow/SaleEndList.tmall','completelist',{method:'getSellAjaxList',listType:'end',shDateType:'01',...dates,shBuyerType:'',shBuyerText:'',addrSeq:'',shGblDlv:'',isItalyAgencyYn:'',key:'901',shOrdLang:''},{status:'구매확정'});
   for(const key of ['01','03','02'])await pages('/escrow/OrderCancelManageList.tmall','dataList',{method:'getSellAjaxList',listType:'cancel',shDateType:'05',...dates,key,shBuyerType:'',shBuyerText:'',isPaging:'Y'},{status:'취소',claimType:'취소요청'});
   for(const [type,codes,claimType] of [['01',['105','104','106','109'],'반품요청'],['02',['201','212','221','214','233','232','8888'],'교환요청']])for(const clmStat of codes)await pages('/escrow/AuthSellerClaimManager.tmall','claimList',{method:'getClaimAjaxList',isPaging:'Y',shDateType:'reqDt',shDateFrom:start.replaceAll('-',''),shDateTo:end.replaceAll('-',''),key:'searchALL',keyValue:'',clmStat,clmOccrTyp:type,chinaSaleYn:'',shDlvClfCd:''},{status:claimType==='교환요청'?'발송대기':'취소',claimType});
  }await verifyIdentity();return {complete:true,notes:['정상 로그인창으로 인증합니다. RSA 로그인 스크립트를 임의 실행하지 않습니다.'],orders:[...orders.values()],summary:{message:'11번가 국내·해외·USIM 주문과 구매확정·취소·반품·교환 조회 완료',count:orders.size}};
 }
 return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:'{}'}),cancel:()=>session.cancel?.()};
}
