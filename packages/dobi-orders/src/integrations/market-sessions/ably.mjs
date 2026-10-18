import {array,bad,baseOrder,browserRequired,id,identity,integer,jsonState,jwtPayload,mergeOrders,newTransport,object,orderDate,range,scalar,text,token,addDays,fail} from './common.mjs';

// ShopMine ABLY, selected IL 0x060014e6/e8/ee and 0x06001504/08/14/16/18.
// JWT claims select the meta URL only; authenticated meta sno AND email establish identity.
const API='https://api.a-bly.com';
const STATES=[['1','checked_at','신규'],['2','checked_at','발송대기'],['3','goods_sent_at','배송중'],['4','delivery_completed_at','배송완료'],['5','purchase_confirmed_at','구매확정']];
const CLAIMS=[['cancel','취소요청'],['return','반품요청']];
const STATUS={'신규주문':'신규','결제완료':'신규','발송대기':'발송대기','배송중':'배송중','배송완료':'배송완료','구매확정':'구매확정','취소주문':'취소','취소완료':'취소','반품주문':'취소','교환주문':'발송대기'};
export function createAblyClient({credentials={},session,now=()=>new Date()}){
  const request=newTransport(session);let accessToken=jsonState(credentials).token||'';
  const headers=()=>({'Authorization':'JWT '+token(accessToken),'Origin':'https://seller-admin.a-bly.com','Referer':'https://seller-admin.a-bly.com/'});
  const api=(path,options={})=>request(API+path,{...options,headers:{...headers(),...options.headers}});
  async function verifyIdentity(){
    if(!accessToken)fail('에이블리에 먼저 로그인해주세요.','SESSION_REQUIRED',401);
    const sellerId=id(jwtPayload(accessToken).seller_id),meta=await api('/seller/accounts/'+encodeURIComponent(sellerId)+'/meta/');
    if(id(meta.sno)!==sellerId||scalar(meta.email)!==credentials.sellerId)fail('에이블리 판매자 번호 또는 이메일이 연결 계정과 다릅니다.','IDENTITY_MISMATCH',409);
    return identity(credentials,sellerId,meta.email);
  }
  async function login(){
    if(!credentials.sellerId||!credentials.password)fail('에이블리 이메일과 비밀번호를 입력해주세요.','MISSING_CREDENTIALS',400);
    accessToken='';
    const body=await request(API+'/seller/login/',{method:'POST',body:JSON.stringify({email:credentials.sellerId,password:credentials.password}),headers:{'Content-Type':'application/json'}});
    if(body.code!==undefined&&['1','2'].includes(String(body.code)))return browserRequired('에이블리 로그인창에서 추가 인증을 완료해주세요.');
    accessToken=token(body.access_token);return verifyIdentity();
  }
  function normalize(detail,{status,claimType='없음'}={}){
    const row=object(detail.order_item),quantity=integer(row.ea,{positive:true}),sourceStatus=text(row.status);let normalized=STATUS[sourceStatus]??status;
    if(!normalized)bad();if(claimType!=='없음'&&claimType!=='교환요청')normalized='취소';
    const result=baseOrder('에이블리',credentials.account||credentials.sellerId,{providerId:'ably',orderNo:id(row.order_sno),lineId:id(row.sno),orderedAt:row.ordered_at,product:text(row.goods_name),option:text(row.option_info),sku:text(row.goods_custom_code),quantity,amount:integer(row.price),buyer:text(row.buyer_name),recipient:text(row.receiver_name),phone:text(row.receiver_tel),postcode:text(row.receiver_postcode),address:text(row.receiver_addr),deliveryMemo:text(row.memo),carrier:row.delivery?text(object(row.delivery).name):'',tracking:text(row.invoice),status:normalized,sourceStatus,claimType,sourceIds:{goodsId:id(row.goods_sno)}});
    // Any server status that already reports a claim takes precedence over a normal list.
    if(/취소|반품|교환/.test(sourceStatus)){result.claimType=/반품/.test(sourceStatus)?'반품요청':/교환/.test(sourceStatus)?'교환요청':'취소요청';result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;}
    if(!STATUS[sourceStatus]){result.sourceIds.fulfillableQty=0;result.sourceIds.needsReview=true;result.sourceIds.queryStatus=status;}
    return result;
  }
  async function detail(sno){const d=await api('/seller/order_items/'+encodeURIComponent(id(sno))+'/');if(id(object(d.order_item).sno)!==id(sno))bad();return d;}
  async function collectOrders(input){
    const {from,to}=range(input);await verifyIdentity();const orders=new Map(),seen=new Set();let requests=0;
    const obtain=async sno=>{if(++requests>20000)fail('수집 상세 조회가 너무 많습니다. 기간을 줄여주세요.','LIMIT_EXCEEDED',400);return detail(sno);};
    for(const [processing,dateType,status] of STATES){
      const end=['3','4','5'].includes(processing)?[addDays(to,30),new Date(new Date(now()).getTime()+9*3600000).toISOString().slice(0,10)].sort()[0]:to;
      for(let page=1;page<=500;page++){
        const q=new URLSearchParams();q.append('processing_status[]',processing);q.append('processing_sub_status[]','0');for(const t of ['standard','today','combine','reserved'])q.append('delivery_type[]',t);
        q.set('order','-'+dateType);q.set('page',String(page));q.set('per_page','100');q.set('start_date',from+' 00:00:00');q.set('end_date',end+' 23:59:59');q.set('date_type',dateType);
        const body=await api('/seller/order_items/?'+q),rows=array(body.order_items),max=integer(body.window_max_page_number);
        if(typeof body.has_more_window!=='boolean')bad();if(max>500)fail('에이블리 조회 페이지가 너무 많습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
        if(!rows.length){if((page===1?max>1:page<=max)||body.has_more_window)bad();break;}
        for(const r of rows){const sno=id(object(r).sno),key=processing+':'+sno;if(seen.has(key))bad();seen.add(key);const d=await obtain(sno),row=object(d.order_item);
          if(['3','4','5'].includes(processing)){const checked=orderDate(row.checked_at);if(checked<from||checked>to)continue;}
          mergeOrders(orders,normalize(d,{status}));
        }
        if(page>=max&&!body.has_more_window)break;if(page===500)fail('에이블리 페이지 수집 제한에 도달했습니다.','LIMIT_EXCEEDED',400);
      }
    }
    // Claims are queried through today so an older order's later cancellation remains protected.
    const claimTo=[to,new Date(new Date(now()).getTime()+9*3600000).toISOString().slice(0,10)].sort().at(-1);
    for(const [kind,claimType] of CLAIMS)for(const [statuses,dateType] of [[['41','42'],'cancel_received_at'],[['43'],'confirm_requested_at'],[['44'],'cancel_completed_at']]){
      for(let page=1;page<=500;page++){
        const q=new URLSearchParams({cancel_type:kind,order:'-'+dateType,date_type:dateType,page:String(page),per_page:'100',start_date:from,end_date:claimTo});for(const s of statuses)q.append('processing_sub_status[]',s);
        const body=await api('/seller/order_cancels/?'+q),rows=array(body.order_cancels),max=integer(body.max_page_number);if(max>500)bad();if(!rows.length){if(page<max)bad();break;}
        for(const group of rows)for(const item of array(object(group).order_items))mergeOrders(orders,normalize(await obtain(object(item).sno),{status:'취소',claimType}));
        if(page>=max)break;if(page===500)bad();
      }
    }
    for(const status of ['2','3','4','9','5','6'])for(let page=1;page<=500;page++){
      const q=new URLSearchParams({page:String(page),per_page:'100',requested_at_start:from+' 00:00:00',requested_at_end:claimTo+' 23:59:59'});q.append('status[]',status);
      const body=await api('/seller/exchanges/?'+q),rows=array(body.exchanges),max=integer(body.max_page_number);if(max>500)bad();if(!rows.length){if(page<max)bad();break;}
      for(const group of rows)for(const item of array(object(group).exchange_items))mergeOrders(orders,normalize(await obtain(object(item).order_item_sno),{status:'발송대기',claimType:'교환요청'}));
      if(page>=max)break;if(page===500)bad();
    }
    await verifyIdentity();return {complete:true,notes:[],orders:[...orders.values()],summary:{message:'에이블리 주문·취소·반품·교환 전체 조회 완료',count:orders.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:JSON.stringify({token:accessToken})}),cancel:()=>{accessToken='';session.cancel?.();}};
}
