// 原实习僧JS会话 + 原网页函数 + 新Python入口，全部在临时目录模拟，不访问网站。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {mockApp}=require('./test_helpers/shixiseng_app.cjs');
const source=__dirname;
const bridge=import('./skills/shixiseng-apply/scripts/submission_bridge.mjs');
const job={url:'https://www.shixiseng.com/intern/inn_test123',role:'产品实习',company:'虚构测试公司',
 city:'上海',jobType:'实习',salary:'200-250/天',days:4,months:3,delivered:false,expired:false,jd:'需求分析 AI工具 交付成果'};
async function fixture(t,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'shixiseng-adapter-test-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const name of ['application_run.py','application_batch.py','application_guard.py','platforms',
   '实习僧投递步骤.md','岗位匹配评分标准.md','skills/shixiseng-apply']){
  const dest=path.join(root,name);await fs.mkdir(path.dirname(dest),{recursive:true});
  await fs.cp(path.join(source,name),dest,{recursive:true});
 }
 await fs.mkdir(path.join(root,'data'));
 await fs.writeFile(path.join(root,'data/state.json'),JSON.stringify({settings:{cities:'上海',jobType:'实习',minSalary:150,days:5,months:6,threshold:60},
   resume:{name:'虚构测试简历',text:'做过项目'},records:[]}));
 await fs.writeFile(path.join(root,'job.json'),JSON.stringify(job));
 const {createLocalClient,createSubmissionSession}=await bridge;
 const raw=createLocalClient(root);
 // complete 强制offline，不连接正在运行的工作台，不写任何真实投递记录。
 const calls=[];const local=async(command,args,input)=>{
  calls.push(command);return raw(command,command==='complete'?[...args,'--offline']:args,input);
 };
 await local('start',['runs/test','--limit','2']);
 await local('rate',['runs/test','job.json','80.5']);
 const app=mockApp(options);
 const session=createSubmissionSession(app,{root,local});
 const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
 return {root,session,app,read,calls};
}
test('原会话及网页函数经过新接口完成一次投递模拟，记录字段保持原样',async t=>{
 const {session,app,read,calls}=await fixture(t,{closeControl:true});
 const result=await session.submit('runs/test','inn_test123');
 assert.equal(result.status,'success');assert.equal(result.action,'done');
 assert.equal(app.confirms,1);assert.deepEqual(app.clicks,['open','attachment','confirm','close']);
 const record=(await read('runs/test/inn_test123.record.json')).record;
 assert.equal(record.id,'shixiseng:inn_test123');assert.equal(record.score,80.5);
 assert.equal(record.status,'投递成功');assert.equal(record.scoringResume,'虚构测试简历');
 assert.equal(record.submittedResume,'实习僧现有中文附件简历');assert.match(record.resume,/附件文件名未预览核验/);
 assert.equal((await read('data/application_attempts.json')).inn_test123.status,'已核实投递成功');
 assert.deepEqual(calls,['start','rate','gate','arm','gate','complete']);
});
test('原加载续接、结果只读观察与明确失败经过新接口仍有效',async t=>{
 const delayed=await fixture(t,{openCheckpoints:4,selectCheckpoints:3,resultCheckpoints:4,closeControl:true});
 let result=await delayed.session.submit('runs/test','inn_test123');
 for(let n=0;n<5&&result.action!=='done';n++){
  result=result.action==='observe_result'?await delayed.session.inspect('runs/test','inn_test123'):await delayed.session.submit('runs/test','inn_test123');
 }
 assert.equal(result.status,'success');assert.equal(result.action,'done');assert.equal(delayed.app.confirms,1);
 assert.equal(delayed.app.clicks.filter(x=>x==='open').length,1);
 assert.equal(delayed.app.clicks.filter(x=>x==='attachment').length,1);
 const failed=await fixture(t,{failure:true});
 const rejection=await failed.session.submit('runs/test','inn_test123');
 assert.equal(rejection.status,'failed');assert.equal(rejection.action,'next_candidate');assert.equal(failed.app.confirms,1);
 const run=await failed.read('runs/test/run.json');assert.equal(run.activeAttempt,undefined);assert.deepEqual(run.successIds,[]);
 assert.equal(run.failures.length,1);
 assert.equal((await failed.read('data/application_attempts.json')).inn_test123.status,'已核实明确失败，禁止重投');
 await assert.rejects(fs.access(path.join(failed.root,'runs/test/inn_test123.record.json')));
});
