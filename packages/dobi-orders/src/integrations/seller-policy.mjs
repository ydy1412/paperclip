import {isIP} from 'node:net';
// Hosts are explicit protocol boundaries from the selected shipped login/read paths.
const DEFINITIONS={
 esm:['ESM','https://www.esmplus.com','www.esmplus.com signin.esmplus.com seller.esmplus.com post-tx.esmplus.com','esmplus.com'],
 smartstore:['스마트스토어','https://sell.smartstore.naver.com','sell.smartstore.naver.com accounts.commerce.naver.com nid.naver.com admin.pay.naver.com','naver.com'],
 cafe24:['카페24','https://eclogin.cafe24.com/Shop/','eclogin.cafe24.com user.cafe24.com','cafe24.com cafe24shop.com'],
 '11st':['11번가','https://soffice.11st.co.kr','soffice.11st.co.kr login.11st.co.kr apis.11st.co.kr www.11st.co.kr','11st.co.kr'],
 interpark:['인터파크','https://seller.buyzle.co.kr','seller.buyzle.co.kr shopping.buyzle.co.kr','buyzle.co.kr'],
 wemakeprice1:['위메프 구형','https://biz.wemakeprice.com','biz.wemakeprice.com','wemakeprice.com'],
 wemakeprice2:['위메프','https://wpartner.wemakeprice.com','wpartner.wemakeprice.com front.wemakeprice.com','wemakeprice.com'],
 tmon:['티몬','https://spc.tmon.co.kr','spc.tmon.co.kr','tmon.co.kr'],
 godo5:['고도몰','https://accounts.godo.co.kr','accounts.godo.co.kr','godo.co.kr godomall.com'],
 kakaoapi:['카카오 API','https://shopping-sell.kakao.com','kapi.kakao.com shopping-sell.kakao.com store.kakao.com','kakao.com'],
 kakao:['카카오','https://shopping-sell.kakao.com','shopping-sell.kakao.com accounts.kakao.com shopping-seller.kakao.com store-buy-sell.kakao.com','kakao.com'],
 nhmarket:['NH마켓','https://seller.72time.kr','seller.72time.kr old.72time.kr','72time.kr'],
 naverpay:['네이버페이','https://admin.pay.naver.com','admin.pay.naver.com nid.naver.com','naver.com'],
 domeggook:['도매꾹','https://www.domeggook.com','www.domeggook.com domeggook.com nid.naver.com admin.pay.naver.com','domeggook.com naver.com'],
 smelchi:['멸치쇼핑','https://scm.smelchi.com','scm.smelchi.com','smelchi.com'],
 sellerhub:['셀러허브','https://admin.sellerhub.co.kr','admin.sellerhub.co.kr','sellerhub.co.kr'],
 ownerclan:['오너클랜','https://ownerclan.com','ownerclan.com www.ownerclan.com','ownerclan.com'],
 lotteon:['롯데온','https://store.lotteon.com','store.lotteon.com soapi.lotteon.com www.lotteon.com','lotteon.com'],
 ssg:['SSG','https://po.ssgadm.com','po.ssgadm.com www.ssg.com','ssgadm.com ssg.com'],
 ohouse:['오늘의집','https://orora.ohou.se','orora.ohou.se ohou.se api.ohou.se partners.ohou.se','ohou.se'],
 imweb:['아임웹',null,'api.oms.imweb.me','imweb.me'],
 ably:['에이블리','https://my.a-bly.com','my.a-bly.com api.a-bly.com a-bly.com seller-admin.a-bly.com','a-bly.com'],
 zigzag:['지그재그','https://partners.kakaostyle.com','partners.kakaostyle.com zigzag.kr','kakaostyle.com zigzag.kr'],
 alwayz:['올웨이즈','https://alwayzseller.ilevit.com','alwayzseller.ilevit.com alwayz-seller-back.ilevit.com alwayzshop.ilevit.com','ilevit.com'],
 tossmall:['토스쇼핑','https://shopping-seller.toss.im','shopping-seller.toss.im shopping-merchant-api.toss.im api-public.toss.im','toss.im']
};
export const SELLER_POLICY_IDS=Object.freeze(Object.keys(DEFINITIONS));
// Embedded into the native helper at build time; stdin cannot expand these hosts.
export const NATIVE_SELLER_POLICIES=Object.fromEntries(Object.entries(DEFINITIONS).map(([id,[name,loginUrl,hosts,roots]])=>[id,{name,loginUrl,hosts:hosts.split(' '),roots:roots.split(' ')}]));
export function sellerHost(value){if(typeof value!=='string'||value!==value.trim()||/[\x00-\x1f\x7f]/.test(value))throw Error('쇼핑몰 HTTPS 주소를 확인해주세요.');let u;try{u=new URL(value.includes('://')?value:'https://'+value);}catch{throw Error('쇼핑몰 HTTPS 주소를 확인해주세요.');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search||!['','/'].includes(u.pathname)||isIP(u.hostname)||!u.hostname.includes('.')||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(u.hostname))throw Error('공개 쇼핑몰 HTTPS 호스트를 입력해주세요.');return u.hostname;}
export function sellerPolicy(providerId,credentials={}){
 const row=DEFINITIONS[providerId];if(!row)throw Error('지원하는 판매처 로그인 계정을 선택해주세요.');const [name,initial,known,roots]=row,hosts=new Set(known.split(' ')),cookieDomains=new Set(roots.split(' '));let loginUrl=initial;
 if(['cafe24','godo5','imweb'].includes(providerId)){
  let host=credentials.host;if(!host&&providerId==='cafe24'&&/^[a-z0-9][a-z0-9-]{0,61}$/i.test(credentials.sellerId||''))host=credentials.sellerId+'.cafe24.com';
  if(host){host=sellerHost(host);if(providerId==='cafe24'&&!/(?:^|\.)(?:cafe24\.com|cafe24shop\.com)$/.test(host))throw Error('카페24 관리자 도메인을 입력해주세요.');hosts.add(host);cookieDomains.add(host);if(providerId!=='cafe24')loginUrl='https://'+host+(providerId==='imweb'?'/admin':'/base/login.php');}
  if(providerId==='imweb'&&!host)throw Error('아임웹 쇼핑몰 주소를 먼저 입력해주세요.');
 }
 if(providerId==='smartstore'&&credentials.loginType==='naver')loginUrl='https://nid.naver.com/nidlogin.login';
 if(providerId==='smartstore'&&credentials.loginType==='center')loginUrl='https://accounts.commerce.naver.com/';
 const allowsHost=host=>hosts.has(host)||providerId==='cafe24'&&/^[a-z0-9-]+\.(?:cafe24\.com|cafe24shop\.com)$/.test(host);
 const allowsCookie=(domain,hostOnly)=>{const d=domain.toLowerCase().replace(/^\./,'');return hostOnly?allowsHost(d):[...cookieDomains].some(root=>d===root||allowsHost(d)&&d.endsWith('.'+root));};
 return {providerId,name,loginUrl,hosts:[...hosts],cookieDomains:[...cookieDomains],allowsHost,allowsCookie};
}
