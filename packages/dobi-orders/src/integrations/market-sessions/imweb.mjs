import {array,bad,baseOrder,browserRequired,fail,id,identity,integer,jsonState,mergeOrders,newTransport,object,range,scalar,text,token,orderDate} from './common.mjs';
const API='https://api.oms.imweb.me';
const STATES={OSS01:['신규','없음'],OSS02:['발송대기','없음'],OSS03:['배송중','없음'],OSS04:['배송완료','없음'],OSS05:['구매확정','없음'],OSS06:['신규','취소요청'],OSS07:['취소','취소요청'],OSS08:['배송완료','반품요청'],OSS09:['배송완료','반품요청'],OSS10:['배송완료','반품요청'],OSS11:['배송완료','반품요청'],OSS12:['취소','반품요청']};
function stamp(v){const s=scalar(v);if(/^\d{10}$|^\d{13}$/.test(s)){const d=new Date(Number(s)*(s.length===10?1000:1)+9*3600000);if(!Number.isFinite(d.getTime()))bad();return d.toISOString().slice(0,10);}return orderDate(s);}

// Imweb selected CIL 0x06001488/8c/94/96. No user DB/profile or live requests used.
export function createImwebClient({credentials={},session,now=()=>new Date()}){
  const request=newTransport(session);
  let host;try{const u=new URL(credentials.host?.includes('://')?credentials.host:'https://'+credentials.host);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!['/',''].includes(u.pathname))bad();host=u.hostname;}catch{fail('아임웹 쇼핑몰 HTTPS 호스트를 입력해주세요.','MISSING_CREDENTIALS',400);}
  const site='https://'+host;let accessToken=jsonState(credentials).token||'',submitted=false;
  const headers=()=>({'Authorization':'Bearer '+token(accessToken),Referer:site+'/admin',Origin:site});
  async function exchange(){const d=await request(site+'/_/api/auth/sign-in/legacy',{method:'POST',body:' ',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},format:'json'});accessToken=token(d.accessToken);}
  async function api(path){const d=await request(API+path,{headers:headers()});if(String(d.statusCode)!=='200')fail('아임웹 인증 또는 조회가 실패했습니다. 전체 수집을 중단했습니다.','REMOTE_ERROR');return object(d.data);}
  function listUrl(code,page,from,to){return '/admin/v1/order?'+new URLSearchParams({page:String(page),sort:'wtime','tOrderSectionStatusCd[]':code,fSearchDateType:'paymentDate',fDateRange:'CUSTOM',fStartDate:from+'T00:00:00Z',fEndDate:to+'T23:59:59Z'});}
  async function verifyIdentity(){
    if(!accessToken)await exchange();const today=new Date(new Date(now()).getTime()+9*3600000).toISOString().slice(0,10);array((await api(listUrl('OSS01',1,today,today))).list);
    // The original token path provides no server account identifier. Pin the host and
    // user-confirmed configured ID without calling a decoded JWT a verified identity.
    return identity(credentials,'host:'+host+':login:'+id(credentials.sellerId),host+' / '+credentials.sellerId,submitted?'credential-login':'user-confirmation');
  }
  async function login(){
    if(!credentials.password)return browserRequired('아임웹 관리자 로그인창에서 추가 인증을 완료해주세요.');
    accessToken='';submitted=false;
    const raw=await request(site+'/backpg/login.cm?back_url=L2FkbWluLz90eXBlPXBhZ2U%3D',{method:'POST',body:new URLSearchParams({uid:credentials.sellerId,passwd:credentials.password}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},format:'text',followRedirects:true});
    if(/아이디를 입력|잘못된 아이디|비밀번호를 입력|ERROR\s*:\s*1003/.test(raw))fail('아임웹 아이디·비밀번호를 확인해주세요.','SESSION_REQUIRED',401);
    if(raw.includes('admin_two_factor'))return browserRequired('아임웹 관리자 로그인창에서 2단계 인증을 완료해주세요.');
    submitted=true;await exchange();return verifyIdentity();
  }
  function normalize(data,section,item){
    const code=scalar(section.statusCd),state=STATES[code];if(!state)bad();
    const quantity=integer(item.qty,{positive:true}),amount=integer(item.itemPrice)*quantity;if(!Number.isSafeInteger(amount)||amount>1e12)bad();
    const deliveries=array(data.orderDeliveryList);if(deliveries.length!==1)fail('아임웹 다중 배송지의 품목별 연결을 확인할 수 없습니다. 전체 수집을 중단했습니다.','AMBIGUOUS_DELIVERY',409);const delivery=object(deliveries[0]);
    const options=item.optionInfo===null||item.optionInfo===undefined?'':array(item.optionInfo).map(o=>text(object(o).key)+': '+text(o.value)).join(' / ');
    const order=baseOrder('아임웹',credentials.account||credentials.sellerId,{providerId:'imweb',orderNo:id(data.orderNo),lineId:id(item.orderSectionItemCode),orderedAt:stamp(delivery.wtime),product:text(item.prodName),option:options,sku:text(item.prodSkuNo||item.optionSkuNo),quantity,amount,buyer:text(data.ordererName),recipient:text(delivery.receiverName),phone:text(delivery.receiverCall),postcode:text(delivery.zipcode),address:[text(delivery.addr1),text(delivery.addr2)].filter(Boolean).join(' '),deliveryMemo:text(delivery.memo),carrier:text(section.invoiceCode),tracking:text(section.invoice?.invoiceNo),status:state[0],sourceStatus:code,claimType:state[1],sourceIds:{orderCode:id(section.orderCode),orderSectionCode:id(section.orderSectionCode),orderSectionNo:id(section.orderSectionNo),...(data.unipassNumber?{customsCode:text(data.unipassNumber)}:{})}});
    if(delivery.isInput==='N'){order.sourceIds.fulfillableQty=0;order.sourceIds.needsReview=true;}return order;
  }
  async function collectOrders(input){
    const {from,to}=range(input),before=await verifyIdentity(),orders=new Map(),details=new Map();
    for(const code of Object.keys(STATES)){
      const seen=new Set();let finished=false;
      for(let page=1;page<=100;page++){
        const rows=array((await api(listUrl(code,page,from,to))).list);if(rows.length>50)bad();
        for(const value of rows){const orderCode=id(object(value).orderCode);if(seen.has(orderCode))bad();seen.add(orderCode);if(seen.size>10000)bad();
          let data=details.get(orderCode);if(!data){data=await api('/admin/v1/order/'+encodeURIComponent(orderCode));details.set(orderCode,data);}
          for(const section of array(data.orderSectionList)){object(section);if(id(section.orderCode)!==orderCode)bad();const actual=scalar(section.statusCd);if(!STATES[actual])bad();if(actual!==code)continue;
            for(const item of array(section.orderSectionItemList)){const order=normalize(data,section,object(item));if(order.orderedAt<from||order.orderedAt>to)continue;mergeOrders(orders,order);}
          }
        }
        if(rows.length<50){finished=true;break;}
      }
      if(!finished)fail('아임웹 조회 한도에 도달했습니다. 기간을 나누어주세요.','LIMIT_EXCEEDED',400);
    }
    const after=await verifyIdentity();if(before.identityId!==after.identityId)bad();return {complete:true,orders:[...orders.values()],notes:['원본은 교환 전용 조회 계약을 제공하지 않습니다.','다중 배송지의 품목 연결이 모호하면 전체 수집을 중단합니다.'],summary:{message:'아임웹 주문·취소·반품 전체 페이지 조회 완료. 교환은 원본 전용 조회 계약이 없습니다.',count:orders.size}};
  }
  return {login,verifyIdentity,testConnection:verifyIdentity,collectOrders,getSessionCookies:()=>session.getSessionCookies(),getSessionState:()=>({cookies:session.getSessionCookies(),sessionData:{token:accessToken}}),cancel:()=>{accessToken='';session.cancel?.();}};
}
