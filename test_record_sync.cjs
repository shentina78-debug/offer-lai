const assert=require('node:assert/strict');
const {createRecordSync}=require('./record_sync.js');
(async()=>{
 let enabled=false,calls=0,rows=[],updates=0;
 const sync=createRecordSync({active:()=>enabled,load:async()=>{calls++;return [{id:1}]},current:()=>rows,update:r=>{rows=r;updates++}});
 assert.equal(await sync(),'inactive');assert.equal(calls,0);
 enabled=true;assert.equal(await sync(),'updated');assert.equal(updates,1);
 assert.equal(await sync(),'unchanged');assert.equal(updates,1);
 const fail=createRecordSync({active:()=>true,load:async()=>{throw Error()},current:()=>[],update:()=>assert.fail()});
 assert.equal(await fail(),'retry_later');assert.equal(await fail(),'retry_later');
 let release;const loading=createRecordSync({active:()=>true,load:()=>new Promise(r=>release=r),current:()=>[],update:()=>{}});
 const first=loading();assert.equal(await loading(),'inactive');release([]);await first;
 console.log('record sync: 5 checks passed');
})();
