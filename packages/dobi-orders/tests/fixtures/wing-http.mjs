import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

export const fixtureLogin={sellerId:'synthetic-wing',password:'synthetic-password',code:'123456'};
export const fixtureOrder={orderNo:'86000001',lineId:'86000002:86000003'};
export const fixtureDate=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);

/** Synthetic HTTP only: exercises the real login, cookie jar, and order collector. */
export function wingHttpFixture({mfa=true}={}){
  const state={vendorId:'SYNTHETIC_A1',cookie:'synthetic-session-1',logins:0,reads:0,missingCookies:0,failSearch:false,accessDenied:false};
  const wing='https://wing.coupang.com',auth='https://xauth.coupang.com';
  const action=kind=>auth+'/auth/realms/seller/login-actions/'+(kind==='password'?'authenticate':'required-action')+'?execution='+kind;
  const form=kind=>kind==='password'?`<form id="kc-form-login" action="${action(kind)}"></form>`:kind==='method'?`<form id="mfa-method-form" action="${action(kind)}"><input id="btnSms" value="fixture-mobile"><input id="btnEmail" value="fixture-email"></form>`:`<form id="mfa-form" action="${action(kind)}"><input name="code"></form>`;
  const reply=(value,options={})=>new Response(typeof value==='string'?value:JSON.stringify(value),{status:200,...options});
  const signedIn=()=>reply('signed in',{headers:{'Set-Cookie':`XSRF-TOKEN=${state.cookie}; Domain=.coupang.com; Path=/; Secure; HttpOnly`}});
  const book=new ExcelJS.Workbook();book.addWorksheet('Synthetic').addRow(['주문번호','묶음배송번호','옵션ID','구매수(수량)','결제액','주문일','배송완료일','구매확정일자','노출상품명(옵션명)','업체상품코드','구매자','수취인이름','수취인전화번호','우편번호','수취인 주소','배송메세지','택배사','운송장번호','바코드']);
  const emptyWorkbook=book.xlsx.writeBuffer();
  const fetchImpl=async(raw,init={})=>{
    const u=new URL(raw);
    assert.ok([wing,auth].includes(u.origin),'No external or official-key endpoint is allowed');
    assert.equal(init.headers.Authorization,undefined);
    if(u.origin===wing&&state.accessDenied)return reply('<h1>Access Denied</h1>',{status:403});
    if(u.origin===wing&&u.pathname==='/')return reply('',{status:302,headers:{Location:'http://wing.coupang.com/login','Strict-Transport-Security':'max-age=31536000'}});
    if(u.origin===wing&&u.pathname==='/login')return reply('',{status:302,headers:{Location:auth+'/auth/realms/seller/protocol/openid-connect/auth?client_id=wing'}});
    if(u.origin===auth&&u.pathname.endsWith('/openid-connect/auth'))return reply(form('password'));
    if(u.origin===auth&&init.method==='POST'){
      const body=Object.fromEntries(new URLSearchParams(init.body));
      if(u.pathname.endsWith('/authenticate')){
        state.logins++;
        if(body.username!==fixtureLogin.sellerId||body.password!==fixtureLogin.password)return reply(form('password'));
        return mfa?reply(form('method')):signedIn();
      }
      if(u.searchParams.get('execution')==='method'){assert.ok(['fixture-mobile','fixture-email'].includes(body.mfaType));return reply(form('code'));}
      if(body.code!==fixtureLogin.code)return reply(form('code'));
      return signedIn();
    }
    if(!init.headers.Cookie?.includes('XSRF-TOKEN='+state.cookie)){state.missingCookies++;return reply('session expired',{status:401});}
    state.reads++;
    if(u.pathname==='/winglayout/bell/notification/find')return reply({status:'OK'});
    if(u.pathname==='/tenants/sfl-portal/delivery/management')return reply(`<script>var account={vendorId:'${state.vendorId}'};</script>`);
    if(/\/(stop-shipment|return-delivery|exchange)\/search$/.test(u.pathname))return reply({content:[]});
    if(u.pathname.endsWith('/dashboard/search')){
      if(state.failSearch)return reply('failed',{status:500});
      const c=JSON.parse(u.searchParams.get('condition'));
      return reply(c.nextShipmentBoxId==null?[{orderId:fixtureOrder.orderNo,shipmentBoxId:'86000002',memberName:'합성 주문자',safeNumberDto:{safeNumber:'05000000000'}}]:[]);
    }
    if(u.pathname.endsWith('/order/detail/86000001/order'))return reply({orderId:fixtureOrder.orderNo,createdAt:fixtureDate()+' 09:00:00',receiverName:'합성 수령인',safeNumber:'05000000000',postCode:'01234',addr1:'합성 주소',addr2:'테스트',message:'합성 배송 메모',shipmentBoxes:[{shipmentBoxId:'86000002',deliveryStatusName:'결제완료',deliverName:'',invoiceNumber:'',items:[{vendorItemId:'86000003',vendorItemName:'합성 세션 상품, 화이트',quantity:1,cancelCount:0,price:12000,productId:'1234'}]}]});
    if(u.pathname.endsWith('/request-auto-download'))return reply({requestedDownloadId:'synthetic-download'});
    if(u.pathname.endsWith('/check-downloadable'))return reply({status:'SUCCESS',downloadIds:['empty']});
    if(u.pathname.includes('/download-manager/download/'))return new Response(await emptyWorkbook,{status:200});
    throw Error('Unexpected synthetic Wing path: '+u.pathname);
  };
  return {fetchImpl,state};
}
