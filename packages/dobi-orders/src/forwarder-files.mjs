import XLSX from 'xlsx';
import {AppError} from './store.mjs';

const clean=value=>String(value??'').trim();
const key=value=>clean(value).replace(/\s/g,'');
const number=value=>{
  const s=clean(value).replace(/[,￥¥₩\s]/g,'');
  return s&&/^-?\d+(?:\.\d+)?$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;
};

/** Next1688's main order number is a forwarding application, not a sale order. */
export function parseNext1688File(name,bytes,expectedCount){
  if(!/\.(xls|xlsx)$/i.test(name)||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>10*1024*1024)throw new AppError('넥스트배송 XLS/XLSX 원본은 10MB 이하이어야 합니다.');
  if(!Number.isSafeInteger(expectedCount)||expectedCount<1||expectedCount>10000)throw new AppError('사이트에서 확인한 전체 접수 건수를 입력해주세요.');
  let book;
  try{
    if(bytes[0]===0x50&&bytes[1]===0x4b||bytes[0]===0xd0&&bytes[1]===0xcf)book=XLSX.read(bytes,{type:'buffer',raw:true});
    else{
      let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{html=new TextDecoder('euc-kr').decode(bytes);}
      book=XLSX.read(html,{type:'string',raw:true});
    }
  }catch{throw new AppError('넥스트배송 엑셀 원본을 읽지 못했습니다.');}
  if(book.SheetNames.length!==1)throw new AppError('한 시트로 된 넥스트배송 전체 엑셀을 사용해주세요.');
  const sheet=book.Sheets[book.SheetNames[0]],range=sheet['!ref']&&XLSX.utils.decode_range(sheet['!ref']);
  if(!range||range.e.r>10020||range.e.c>=512)throw new AppError('엑셀은 10,000건·512열 이하이어야 합니다.');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''});
  const headerIndex=matrix.slice(0,20).findIndex(row=>['주문번호','운송장번호','받는사람','품목명'].every(label=>row.some(cell=>key(cell)===label)));
  if(headerIndex<0)throw new AppError('넥스트배송 입출고 엑셀의 열을 확인해주세요.');
  const headers=matrix[headerIndex].map(clean),keys=headers.map(key);
  if(new Set(keys.filter(Boolean)).size!==keys.filter(Boolean).length)throw new AppError('엑셀에 같은 이름의 열이 있습니다.');
  const slots=keys.flatMap(k=>/^품목\d+$/.test(k)?[Number(k.slice(2))]:[]).sort((a,b)=>a-b);
  const rows=[],seen=new Set();
  for(const [index,cells]of matrix.slice(headerIndex+1).entries()){
    if(!cells.some(v=>clean(v)))continue;
    const get=label=>{
      const value=cells[keys.indexOf(label)]??'';
      if(typeof value==='number'&&(!Number.isFinite(value)||/번호|전화|우편|부호|코드/.test(label)&&(!Number.isSafeInteger(value)||Math.abs(value)>=1e15)))throw new AppError(`${index+headerIndex+2}행 식별자가 숫자로 손상됐습니다. 원본을 텍스트로 내려받아주세요.`);
      return clean(value);
    };
    const applicationNo=get('주문번호');
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(applicationNo)||seen.has(applicationNo))throw new AppError(`${index+headerIndex+2}행 접수번호가 없거나 중복되었습니다.`);
    seen.add(applicationNo);
    const items=[];
    for(const slot of slots){
      const product=get('품목'+slot),tracking=get('트레킹번호'+slot),orderNo=get('오더번호'+slot),marketOrderNo=get('오픈마켓주문번호'+slot),managementCode=get('자체관리코드'+slot),quantity=number(get('수량'+slot));
      if(![product,tracking,orderNo,marketOrderNo,managementCode].some(Boolean)&&!(quantity>0))continue;
      items.push({position:slot,product,tracking,orderNo,marketOrderNo,managementCode,quantity,unit:get('단위'+slot),price:number(get('가격'+slot)),imageUrl:get('상품이미지'+slot)});
    }
    const status=get('배송상태')||get('처리상태')||get('상태')||null;
    const raw=Object.fromEntries(headers.flatMap((label,i)=>label&&clean(cells[i])?[[label,clean(cells[i])]]:[]));
    rows.push({applicationNo,status,tracking:get('운송장번호'),jdTracking:get('JD송장번호'),kdTracking:get('경동송장번호'),recipient:get('받는사람'),address:get('받는분주소'),englishName:get('영문이름'),englishAddress:get('영문주소'),product:get('품목명'),quantity:number(get('수량')),hsCode:get('HSCODE'),weight:number(get('Weight')),volume:number(get('Volume')),value:number(get('Value')),phone:get('받는분전화'),customsCode:get('개인통관부호'),postcode:get('받는분우편번호'),commerceUrl:get('전자상거래주소'),shippingFee:number(get('배송비')),collectFreight:number(get('착불운임')),items,raw,sourceRow:index+headerIndex+2});
  }
  if(rows.length!==expectedCount)throw new AppError(`전체 ${expectedCount}건을 요청했지만 엑셀에는 ${rows.length}건이 있습니다. 기간·상태·내보내기 범위를 확인해주세요.`,409);
  return {rows,headers,itemCount:rows.reduce((sum,row)=>sum+row.items.length,0),statusAvailable:rows.every(row=>row.status!==null)};
}
