import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { AppError,normalizeOrder } from './store.mjs';

export const FIELDS={orderNo:'주문번호',lineId:'품목번호',channel:'판매처',account:'계정명',product:'상품명',sku:'상품코드',option:'옵션',quantity:'수량',unitPrice:'단가',amount:'결제금액',fee:'수수료',expectedAmount:'예상정산금액',shippingFee:'배송비',buyer:'구매자',recipient:'수령자',phone:'연락처',postcode:'우편번호',address:'주소',deliveryMemo:'배송메모',orderedAt:'주문일',status:'주문상태',carrier:'택배사',tracking:'송장번호',workMemo:'작업메모'};
const aliases={orderNo:['주문번호','주문코드','orderid','orderno','order_no'],lineId:['품목번호','상품주문번호','주문순번','주문고유코드','주문상품번호','lineid','orderitemid'],channel:['판매처','쇼핑몰','마켓','channel'],account:['계정명','쇼핑몰id','스토어명','별칭(쇼핑몰계정)','account'],product:['상품명','등록상품명','노출상품명','product'],sku:['상품코드','상품번호','판매자상품코드','sku'],option:['옵션','선택사항','옵션명','option'],quantity:['수량','주문수량','구매수량','quantity'],unitPrice:['단가','판매가','상품가격','unitprice'],amount:['결제금액','총주문금액','상품주문금액','주문금액','amount'],fee:['수수료','마켓수수료금액','fee'],expectedAmount:['예상정산금액','정산예상금액','공급금액','expectedamount'],shippingFee:['배송비','배송비합계','shippingfee'],buyer:['구매자','구매자명','주문자명','buyer'],recipient:['수령자','수취인명','수취인','수령자명','받는사람','recipient'],phone:['연락처','수령자휴대전화','수취인연락처1','수취인연락처','수취인휴대폰','phone'],postcode:['우편번호','수취인우편번호','zipcode','postcode'],address:['주소','통합배송지','수취인주소','배송지주소','address'],deliveryMemo:['배송메모','배송메시지','배송메세지','배송요청사항','deliverymemo'],orderedAt:['주문일','주문일시','결제일','결제일시','orderedat'],status:['주문상태','상품주문상태','status'],carrier:['택배사','택배사명','배송업체','carrier'],tracking:['송장번호','운송장번호','tracking'],workMemo:['작업메모','cs메모','메모','workmemo']};
const key=v=>String(v).replace(/\s/g,'').toLowerCase();
export function suggestMapping(headers) {return Object.fromEntries(Object.keys(FIELDS).map(f=>[f,headers.find(h=>(aliases[f]||[key(f)]).includes(key(h)))||'']));}
function cellValue(cell){const v=cell.value;if(v===null||v===undefined)return '';if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='object'){if('formula'in v||'sharedFormula'in v)return v.result??'';if(v.richText)return v.richText.map(x=>x.text).join('');if(v.text)return v.text;}return typeof v==='number'?v:String(v);}
export async function parseFile(name,bytes) {
  if(bytes.length>10*1024*1024)throw new AppError('파일은 10MB 이하로 올려주세요.');
  let matrix=[];
  if(/\.xlsx$/i.test(name)){
    const wb=new ExcelJS.Workbook();try{await wb.xlsx.load(bytes);}catch{throw new AppError('엑셀 파일을 읽을 수 없습니다. XLSX 형식으로 저장해주세요.');}
    const ws=wb.worksheets[0];if(!ws)throw new AppError('첫 시트에 데이터가 없습니다.');
    if(ws.rowCount>10020||ws.columnCount>150)throw new AppError('한 파일에 최대 10,000행·150열까지 가져올 수 있습니다.');
    ws.eachRow({includeEmpty:true},row=>matrix.push(row.values.slice(1).map((_,i)=>cellValue(row.getCell(i+1)))));
  }else if(/\.(csv|tsv)$/i.test(name)){
    let content=new TextDecoder('utf-8',{fatal:false}).decode(bytes);if(content.includes('\ufffd'))content=new TextDecoder('euc-kr').decode(bytes);
    try{matrix=parse(content.replace(/^\uFEFF/,''),{delimiter:/\.tsv$/i.test(name)?'\t':',',skip_empty_lines:true,relax_column_count:true,bom:true,max_record_size:500000});}catch{throw new AppError('CSV 형식을 확인해주세요. 쉼표와 따옴표가 맞지 않습니다.');}
  }else throw new AppError('XLSX, CSV, TSV 파일을 사용할 수 있습니다. XLS는 XLSX로 저장해주세요.');
  const headerIndex=matrix.slice(0,20).findIndex(row=>row.some(v=>['주문번호','주문코드','orderid','orderno','order_no'].includes(key(v))));
  const index=headerIndex<0?0:headerIndex;
  const headers=(matrix[index]||[]).map((v,i)=>String(v||`빈 열 ${i+1}`).trim());
  if(!headers.length)throw new AppError('파일이 비어 있습니다.');
  if(new Set(headers).size!==headers.length)throw new AppError('중복된 열 제목이 있습니다. 열 제목을 서로 다르게 수정해주세요.');
  const rows=matrix.slice(index+1).filter(r=>r.some(v=>v!==''&&v!==null&&v!==undefined));
  if(!rows.length||rows.length>10000)throw new AppError('데이터가 없거나 10,000행을 초과했습니다.');
  return {headers,rows,mapping:suggestMapping(headers),rowOffset:index+2};
}
const amount=v=>v===''||v===undefined?undefined:Number(String(v).replace(/[₩원,\s]/g,''));
const statusMap={'결제완료':'신규','신규주문':'신규','신규':'신규','상품준비중':'발송대기','배송준비중':'발송대기','발송대기':'발송대기','배송중':'배송중','배송완료':'배송완료','구매확정':'구매확정','취소완료':'취소','취소주문':'취소','취소':'취소'};
export function mapRows(file,mapping,defaults={},mode='orders') {
  if(!mapping.orderNo || (mode==='orders'&&!mapping.product) || (mode==='tracking'&&!mapping.tracking))throw new AppError(mode==='orders'?'주문번호와 상품명 열을 연결해주세요.':'주문번호와 송장번호 열을 연결해주세요.');
  for(const header of Object.values(mapping))if(header&&!file.headers.includes(header))throw new AppError('선택한 열이 파일에 없습니다.');
  const errors=[],rows=[],warnings=[];
  for(let i=0;i<file.rows.length;i++){
    const get=f=>{const h=mapping[f],idx=file.headers.indexOf(h);return idx<0?'':file.rows[i][idx]??'';};
    try{
      for(const f of ['orderNo','lineId','tracking','phone','postcode'])if(typeof get(f)==='number'&&String(Math.trunc(get(f))).length>15)throw new AppError(`${FIELDS[f]}가 15자 이상의 숫자입니다. 원본에서 텍스트로 저장해주세요.`);
      const record=Object.fromEntries(Object.keys(FIELDS).map(f=>[f,get(f)]));
      record.channel=String(record.channel||defaults.channel|| (mode==='orders'?'기타':''));record.account=String(record.account||defaults.account|| (mode==='orders'?'기본 계정':''));
      if(mode==='tracking'){
        record.carrier=String(record.carrier||defaults.carrier||'');
        if(!record.orderNo||!record.tracking||!record.carrier)throw new AppError('주문번호·송장번호·택배사가 필요합니다.');
        if(!/^[\w -]{3,60}$/.test(String(record.tracking)))throw new AppError('송장번호 형식을 확인해주세요.');
        rows.push(record);
      }else{
        for(const f of ['quantity','unitPrice','amount','shippingFee','fee','expectedAmount'])record[f]=amount(record[f]);
        record.status=statusMap[String(record.status).trim()]||String(record.status).trim()||'신규';
        record.quantity??=1;
        if(!record.lineId&&i===0)warnings.push('품목번호가 없으면 상품명·옵션·상품코드로 동일 품목을 구분합니다. 같은 주문의 동일 품목이 여러 행이면 품목번호를 지정해주세요.');
        rows.push(normalizeOrder(record));
      }
    }catch(e){errors.push({row:i+file.rowOffset,message:e.message});}
  }
  return {rows,errors,warnings,total:file.rows.length};
}
function safeCSV(value){const s=String(value??'');const safe=/^[\s]*[=+@-]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';}
export async function exportOrders(orders,format='xlsx',trackingOnly=false) {
  const fields=trackingOnly?['channel','account','orderNo','lineId','carrier','tracking']:Object.keys(FIELDS);
  if(format==='csv'){const rows=[fields.map(f=>FIELDS[f]),...orders.map(o=>fields.map(f=>o[f]??''))];return {bytes:Buffer.from('\uFEFF'+rows.map(r=>r.map(safeCSV).join(',')).join('\r\n'),'utf8'),mime:'text/csv; charset=utf-8',extension:'csv'};}
  const wb=new ExcelJS.Workbook();wb.creator='도비 오더스';const ws=wb.addWorksheet(trackingOnly?'송장':'주문');ws.columns=fields.map(f=>({header:FIELDS[f],key:f,width:f==='address'?45:f==='product'?35:20}));
  for(const o of orders)ws.addRow(Object.fromEntries(fields.map(f=>[f,o[f]??''])));
  ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:{row:1,column:1},to:{row:1,column:fields.length}};
  ws.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF183A39'}};});
  for(const f of ['orderNo','lineId','tracking','phone','postcode']){const idx=fields.indexOf(f);if(idx>=0)ws.getColumn(idx+1).numFmt='@';}
  return {bytes:Buffer.from(await wb.xlsx.writeBuffer()),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
}
