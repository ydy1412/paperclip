import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import JSZip from 'jszip';
import { createStore } from '../src/store.mjs';
import { createApp } from '../server.mjs';

test('domain references, businesses and private drafts survive restart and backup/restore',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dobi-domain-'));let store=createStore(path.join(dir,'orders.sqlite'),path.join(dir,'backups'));
  try{
    const business=store.saveBusiness({name:'Synthetic business'});store.assignBusiness('쿠팡','Synthetic account',business.id);
    store.saveReference('carriers',['Synthetic carrier']);store.saveDraft('owner-a','order-new',{values:{product:'Pending order'}});
    const backup=store.snapshot();store.close();store=createStore(path.join(dir,'orders.sqlite'),path.join(dir,'backups'));
    assert.deepEqual(store.reference('carriers',[]),['Synthetic carrier']);assert.equal(store.draft('owner-b','order-new'),null);
    assert.equal(store.draft('owner-a','order-new').values.product,'Pending order');store.removeDraft('owner-a','order-new');
    store.restore(backup);assert.equal(store.draft('owner-a','order-new').values.product,'Pending order');assert.equal(store.businesses()[0].id,business.id);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('hosted helper download uses its Dovix origin and scope, and drafts reject credentials',async()=>{
  const base='http://127.0.0.1:3100/api/companies/synthetic/sourcing/projects/synthetic/order-management';
  const app=await createApp({dbPath:':memory:',hosted:true,bridgeBase:base});
  const server=http.createServer((req,res)=>{req.dobiOwnerId='synthetic-owner';return app.handler(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  try{
    const response=await fetch(url+'/api/browser-helper/download');assert.equal(response.status,200);
    const zip=await JSZip.loadAsync(await response.arrayBuffer());
    const manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.deepEqual(manifest.host_permissions,['http://127.0.0.1:3100/*']);
    const code=await zip.file('popup.js').async('string');assert.ok(code.includes(base));assert.ok(!code.includes("const BASE = 'http://127.0.0.1:4317'"));
    assert.equal((await fetch(url+'/api/drafts/order-new',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:{password:'never-store-in-drafts'}})})).status,400);
  }finally{await new Promise(resolve=>server.close(resolve));await app.close();}
});

test('provider references reject executable links before changing the persisted catalog',()=>{
 const store=createStore(':memory:','/tmp');
 try{store.saveReference('catalog',{providers:[{id:'synthetic',name:'Synthetic',kind:'market',browserUrl:'https://example.com'}]});
 assert.throws(()=>store.saveReference('catalog',{providers:[{id:'synthetic',name:'Synthetic',kind:'market',browserUrl:'javascript:alert(1)'}]}));
 assert.equal(store.reference('catalog',{}).providers[0].browserUrl,'https://example.com');
 }finally{store.close();}
});
