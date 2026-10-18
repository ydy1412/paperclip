import test from 'node:test';import assert from 'node:assert/strict';
import JSZip from 'jszip';import * as XLSX from 'xlsx';
import {tableRecords,downloadRecords} from '../src/integrations/market-sessions/tables.mjs';
const html=(headers,rows)=>'<html><table><tr>'+headers.map(v=>'<th>'+v+'</th>').join('')+'</tr>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table></html>';
test('market table HTML preserves text IDs, entities, leading zeros and ignores scripts',async()=>{
 const rows=await tableRecords(Buffer.from(html(['주문번호','우편번호','상품명','주소'],[['900719925474099312','="00123"','합성 &amp; 상품<script>secret</script>','합성 주소<br>상세주소']])),{required:['주문번호','상품명']});assert.equal(rows[0]['주문번호'],'900719925474099312');assert.equal(rows[0]['우편번호'],'00123');assert.equal(rows[0]['상품명'],'합성 & 상품');assert.equal(rows[0]['주소'],'합성 주소\n상세주소');
});
test('market table headers are explicit and ambiguous tables or duplicate headers reject',async()=>{
 for(const source of [html(['주문번호','주문번호'],[['1','2']]),html(['다른열'],[['1']]),html(['주문번호'],[['1']])+html(['주문번호'],[['2']])])await assert.rejects(tableRecords(Buffer.from(source),{required:['주문번호']}),e=>e.code==='INVALID_RESPONSE');
});
test('market table HTML login form is an authentication failure',async()=>{
 await assert.rejects(tableRecords(Buffer.from('<html><form><input type="password"></form></html>'),{required:['주문번호']}),e=>e.code==='SESSION_REQUIRED');
});
test('market downloads preserve session expiry and cancellation without leaking response secrets',async()=>{
 for(const [code,status] of [['SESSION_REQUIRED',401],['CANCELLED',400],['IDENTITY_MISMATCH',409]])await assert.rejects(downloadRecords({request(){const e=Error('private cookie');e.code=code;e.status=status;throw e;}},'https://example.invalid',{required:['주문번호']}),e=>e.code===code&&e.status===status&&!e.message.includes('private'));
});
async function rawXlsx(formula=false){
 const zip=new JSZip();zip.file('xl/workbook.xml','<workbook><sheets><sheet name="orders" sheetId="1" r:id="rId1"/></sheets></workbook>');zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
 zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>주문번호</t></is></c><c r="B1" t="inlineStr"><is><t>상품명</t></is></c></row><row r="2"><c r="A2" t="n">'+(formula?'<f>HYPERLINK("https://example.invalid")</f>':'')+'<v>900719925474099312</v></c><c r="B2" t="inlineStr"><is><t>합성 상품</t></is></c></row></sheetData></worksheet>');return zip.generateAsync({type:'nodebuffer'});
}
test('market table OOXML raw values never round numeric long IDs',async()=>{const rows=await tableRecords(await rawXlsx(),{required:['주문번호','상품명']});assert.equal(rows[0]['주문번호'],'900719925474099312');});
test('market table OOXML refuses formulas without evaluating them',async()=>{await assert.rejects(tableRecords(await rawXlsx(true),{required:['주문번호','상품명']}),e=>e.code==='INVALID_RESPONSE');});
function biff(values,modify){const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(values);modify?.(sheet);XLSX.utils.book_append_sheet(book,sheet,'orders');return XLSX.write(book,{type:'buffer',bookType:'biff8'});}
test('market table BIFF supports string IDs and numeric date cells',async()=>{
 const bytes=biff([['주문번호','상품명','주문일자'],['900719925474099312','합성 상품',new Date('2026-10-01T12:30:00Z')]]);const rows=await tableRecords(bytes,{required:['주문번호','상품명']});assert.equal(rows[0]['주문번호'],'900719925474099312');assert.match(rows[0]['주문일자'],/^2026-10-01/);
});
test('market table BIFF unsafe numeric IDs stop instead of guessing lost digits',async()=>{const bytes=biff([['주문번호','상품명'],[900719925474099312,'합성 상품']]);await assert.rejects(tableRecords(bytes,{required:['주문번호','상품명']}),e=>e.code==='UNSAFE_EXCEL_NUMBER');});
test('market table BIFF does not silently truncate excess rows',async()=>{
 const many=[['주문번호','상품명'],...Array.from({length:10001},(_,i)=>[String(i+1),'합성 상품'])];await assert.rejects(tableRecords(biff(many),{required:['주문번호','상품명']}));
});
