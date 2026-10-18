import JSZip from 'jszip';
import he from 'he';
import * as XLSX from 'xlsx';
import {array,attr,bad,fail,html,loginForm,nodeText,nodes,text} from './common.mjs';
const MAX=32*1024*1024;
const unescape=s=>he.decode(s,{isAttributeValue:false});
const xmlAttr=(s,key)=>{const m=new RegExp(`(?:^|\\s)${key}=(?:"([^"]*)"|'([^']*)')`).exec(s);return m?unescape(m[1]??m[2]):'';};
const xmlTexts=s=>[...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t\s*>/g)].map(m=>unescape(m[1])).join('');
function rowsToRecords(rows,required){
  array(rows);if(!rows.length)bad();let headerAt=-1;
  for(let i=0;i<Math.min(20,rows.length);i++)if(required.every(key=>rows[i].map(text).includes(key))){if(headerAt>=0)bad();headerAt=i;}
  if(headerAt<0)bad();const header=rows[headerAt].map(text),seen=new Set();for(const h of header){if(!h)continue;if(seen.has(h))bad();seen.add(h);}
  const result=[];for(const row of rows.slice(headerAt+1)){if(!row.some(v=>text(v)))continue;if(row.length>header.length)bad();const data=Object.create(null);for(let i=0;i<header.length;i++)if(header[i])data[header[i]]=text(row[i]);
    if(required.every(key=>!data[key]))continue;if(required.some(key=>!data[key]))bad();result.push(data);if(result.length>10000)fail('엑셀 주문이 10,000품목을 초과했습니다. 기간을 줄여주세요.','LIMIT_EXCEEDED',400);
  }return result;
}
function htmlRows(raw,required){
  const doc=html(raw);if(loginForm(doc))fail('판매처 로그인 화면이 반환되었습니다.','SESSION_REQUIRED',401);const candidates=[];
  for(const table of nodes(doc)){if(table.tagName!=='table')continue;const rows=[];
    function descend(node){for(const child of node.childNodes??[]){if(child.tagName==='table')continue;if(child.tagName==='tr'){
      const row=[];for(const cell of child.childNodes??[])if(['td','th'].includes(cell.tagName)){const span=Number(attr(cell,'colspan')??'1');if(!Number.isInteger(span)||span<1||span>200||Number(attr(cell,'rowspan')??'1')!==1)bad();let value=nodeText(cell).trim();if(/^="[^"]*"$/.test(value))value=value.slice(2,-1);row.push(value,...Array(span-1).fill(''));}rows.push(row);
    }else descend(child);}}
    descend(table);if(rows.some(row=>required.every(key=>row.map(text).includes(key))))candidates.push(rows);
  }
  if(candidates.length!==1)bad();return rowsToRecords(candidates[0],required);
}
async function xlsxRows(bytes,required){
 let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false});}catch{bad();}const entries=Object.values(zip.files);if(entries.length>1000)bad();let total=0;
 for(const entry of entries){const n=entry._data?.uncompressedSize??0;if(!Number.isSafeInteger(n)||n>20*1024*1024||(total+=n)>40*1024*1024||/(?:vbaProject|externalLinks)/i.test(entry.name))bad();}
 async function xml(path,optional=false){const f=zip.file(path);if(!f){if(optional)return '';bad();}const s=await f.async('string');if(s.length>20*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(s))bad();return s;}
 const wb=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels'),sheets=[...wb.matchAll(/<sheet\s([^>]*?)(?:\/?>)/g)];if(sheets.length!==1)bad();const rid=xmlAttr(sheets[0][1],'r:id');let target;
 for(const m of rels.matchAll(/<Relationship\s([^>]*?)\/?\s*>/g))if(xmlAttr(m[1],'Id')===rid){if(xmlAttr(m[1],'TargetMode')==='External')bad();target=xmlAttr(m[1],'Target');}
 if(!target||/[\\]/.test(target)||target.includes('..'))bad();const path=target.startsWith('/')?target.slice(1):'xl/'+target;if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path))bad();
 const shared=await xml('xl/sharedStrings.xml',true),strings=[];for(const m of shared.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si\s*>/g)){strings.push(xmlTexts(m[1]));if(strings.length>500000)bad();}
 const sheet=await xml(path),rows=[];if(/<mergeCells\b/.test(sheet))bad();
 for(const m of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row\s*>/g)){
  const row=[];for(const cell of m[1].matchAll(/<c\s([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c\s*>)/g)){
   const ref=xmlAttr(cell[1],'r'),type=xmlAttr(cell[1],'t'),body=cell[2]??'';if(!/^[A-Z]{1,3}\d+$/.test(ref)||/<f(?:\s|>)/.test(body))bad();let col=0;for(const letter of ref.match(/^[A-Z]+/)[0])col=col*26+letter.charCodeAt(0)-64;if(col>200||row[col-1]!==undefined)bad();
   const v=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v\s*>/.exec(body)?.[1]??'';let value;
   if(type==='s'){if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)>=strings.length)bad();value=strings[Number(v)];}
   else if(type==='inlineStr')value=xmlTexts(body);
   else if(['','n','str','d'].includes(type))value=unescape(v);else bad();
   if(value.length>10000)bad();row[col-1]=value;
  }rows.push(row);if(rows.length>10030)bad();
 }return rowsToRecords(rows,required);
}
function biffRows(bytes,required){
 let workbook;try{workbook=XLSX.read(bytes,{type:'buffer',cellFormula:true,cellText:true,cellNF:true,cellDates:false,bookVBA:true,sheetRows:10031,dense:false});}catch{bad();}
 if(workbook.vbaraw||workbook.SheetNames.length!==1)bad();const sheet=workbook.Sheets[workbook.SheetNames[0]];if(!sheet?.['!ref']||sheet['!merges']?.length)bad();
 let extent;try{extent=XLSX.utils.decode_range(sheet['!fullref']??sheet['!ref']);}catch{bad();}if(extent.e.r>10030||extent.e.c>199)bad();
 const rows=[];for(let r=0;r<=extent.e.r;r++){const row=[];for(let c=0;c<=extent.e.c;c++){
  const cell=sheet[XLSX.utils.encode_cell({r,c})];if(!cell){row[c]='';continue;}if(cell.f||cell.F||cell.l?.Target||cell.t==='e')bad();let value;
  if(cell.t==='n'){
   if(!Number.isFinite(cell.v))bad();if(cell.z&&XLSX.SSF.is_date(cell.z)){const d=XLSX.SSF.parse_date_code(cell.v,{date1904:Boolean(workbook.Workbook?.WBProps?.date1904)});if(!d)bad();row[c]=`${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')} ${String(d.H).padStart(2,'0')}:${String(d.M).padStart(2,'0')}:${String(d.S).padStart(2,'0')}`;continue;}
   // BIFF stores Number; a long identifier has already lost precision at source.
   if(!Number.isSafeInteger(cell.v)||Math.abs(cell.v)>999999999999999)fail('엑셀 숫자 셀의 정밀도가 보장되지 않습니다. 식별자를 텍스트로 제공해주세요.','UNSAFE_EXCEL_NUMBER');
   value=typeof cell.w==='string'?cell.w:String(cell.v);
  }else if(['s','str','b','z'].includes(cell.t))value=cell.v===undefined?'':String(cell.v);else bad();
  if(value.length>10000)bad();row[c]=value;
 }rows.push(row);}return rowsToRecords(rows,required);
}
export async function tableRecords(bytes,{contentType='',required=[]}={}){
 bytes=Buffer.from(bytes);if(!bytes.length||bytes.length>MAX||!required.length)bad();
 if(bytes[0]===0x50&&bytes[1]===0x4b)return xlsxRows(bytes,required);
 if(bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))return biffRows(bytes,required);
 const prefix=bytes.subarray(0,4096).toString('ascii'),charset=/(?:charset\s*=\s*["']?)([\w-]+)/i.exec(contentType+' '+prefix)?.[1]??'utf-8';let raw;try{raw=new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{bad();}
 if(!/<(?:!doctype|html|table)\b/i.test(raw))bad();return htmlRows(raw,required);
}
export async function downloadRecords(session,url,options={}){
 let response;try{response=await session.request(url,{method:options.method??'GET',body:options.body,headers:options.headers??{}});}catch(e){if(e?.code==='SESSION_REQUIRED'||e?.status===401)fail('판매처 로그인이 만료되었습니다.','SESSION_REQUIRED',401);if(e?.code==='CANCELLED')fail('판매처 다운로드를 취소했습니다.','CANCELLED',400);if(e?.code==='IDENTITY_MISMATCH')fail('판매처 계정이 저장된 연결과 다릅니다.','IDENTITY_MISMATCH',409);fail('판매처 엑셀 다운로드에 실패했습니다.','NETWORK_ERROR');}
 if(response.status===401||response.status===403||response.status>=300&&response.status<400)fail('판매처 로그인이 만료되었습니다.','SESSION_REQUIRED',401);if(!response.ok)fail('판매처 엑셀 다운로드가 거절되었습니다.','REMOTE_ERROR');
 let bytes;try{bytes=await response.arrayBuffer();}catch{fail('판매처 엑셀 응답을 읽지 못했습니다.','NETWORK_ERROR');}return tableRecords(bytes,{contentType:response.headers.get('Content-Type')||'',required:options.required});
}
