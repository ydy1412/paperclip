import {DatabaseSync} from 'node:sqlite';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseNext1688File} from '../src/forwarder-files.mjs';

// Export an explicit allowlist. Customer, address and post-shipment weight never leave the history DB.
export function exportTrainingData(dbPath){
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    const images=new Map();
    for(const source of db.prepare('SELECT forwarder_id,source,filename,counts FROM forwarder_imports ORDER BY created_at').all()){
      const parsed=parseNext1688File(source.filename,Buffer.from(source.source),JSON.parse(source.counts).total);
      for(const row of parsed.rows)images.set(source.forwarder_id+':'+row.applicationNo,new Map(row.items.map(i=>[i.position,i.imageUrl])));
    }
    let noFee=0;const records=[];
    for(const saved of db.prepare('SELECT id,forwarder_id,data FROM forwarder_shipments ORDER BY id').all()){
      const row=JSON.parse(saved.data);
      if(!(Number.isFinite(row.shippingFee)&&row.shippingFee>0)){noFee++;continue;}
      const items=row.items.map(i=>({title:i.product||row.product,quantity:i.quantity||1,imageUrl:i.imageUrl||images.get(saved.forwarder_id+':'+row.applicationNo)?.get(i.position)||''}));
      if(!items.length)items.push({title:row.product,quantity:row.quantity||1,imageUrl:''});
      let productKey;try{const url=new URL(row.commerceUrl),id=url.searchParams.get('id');if(url.hostname==='item.taobao.com'&&/^\d{1,64}$/.test(id||''))productKey=createHash('sha256').update(url.hostname+':'+id).digest('hex');}catch{}
      records.push({id:createHash('sha256').update(saved.id).digest('hex').slice(0,24),...(productKey?{productKey}:{}),category:row.hsCode||'unknown',items,shippingFee:row.shippingFee});
    }
    return {schemaVersion:1,categorySystem:'HS',target:'recorded_shipping_fee_as_base',sourceSummary:{records:records.length,excludedNoFee:noFee},records};
  }finally{db.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [dbPath,out]=process.argv.slice(2);if(!dbPath||!out)throw Error('Usage: node shipping-model/export.mjs DATABASE OUTPUT.json');
  const data=exportTrainingData(dbPath);await mkdir(path.dirname(out),{recursive:true,mode:0o700});await writeFile(out,JSON.stringify(data),{mode:0o600});console.log(JSON.stringify(data.sourceSummary));
}
