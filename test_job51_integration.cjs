// 前程无忧JS网页状态机/会话 -> 共用Python -> 本地记录，全部在临时目录离线模拟。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {create51jobFlow}=require('./skills/51job-apply/scripts/submission_flow.js');
const bridge=import('./skills/51job-apply/scripts/submission_bridge.mjs');
async function fixture(t,options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'job51-adapter-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const name of ['application_run.py','application_batch.py','application_guard.py','platforms',
    '实习僧投递步骤.md','岗位匹配评分标准.md','skills/shixiseng-apply','skills/51job-apply']) {
    await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});
    await fs.cp(path.join(__dirname,name),path.join(root,name),{recursive:true});
  }
  await fs.mkdir(path.join(root,'data'));
  await fs.writeFile(path.join(root,'data/state.json'),JSON.stringify({settings:{cities:'上海',jobType:'实习',
    keywords:'市场分析、产品',minSalary:150,days:5,months:6,threshold:60},resume:{name:'虚构共享简历',text:'做过项目'},records:[]}));
  const job={platform:'51job',url:'https://jobs.51job.com/shanghai-pdxq/174008722.html',role:'虚构测试实习',company:'虚构测试公司',
    city:'上海',jobType:'实习',salary:'200元/天',days:3,months:3,delivered:false,expired:false,
    campus:false,labelsVerified:true,jdComplete:true,jd:'数据分析项目，实习至少三个月，每周3天'};
  await fs.writeFile(path.join(root,'job.json'),JSON.stringify(job));
  const {createLocalClient,createSubmissionSession}=await bridge;
  const raw=createLocalClient(root), calls=[];
  const local=async(command,args,input)=>{calls.push(command);return raw(command,command==='complete'?[...args,'--offline']:args,input);};
  await local('start',['runs/test','--platform','51job','--limit','2']);
  await local('score-input',['runs/test','job.json']);
  await local('rate',['runs/test','job.json','80.5']);
  let stage='detail', selected=false, sends=0;
  const io={
    read:async()=>stage==='receipt'?{platform:'51job',kind:'receipt',
      observedUrl:'https://jobs.51job.com/applysuccess.php?jobid=174008722',receiptText:'投递成功，前往应届生求职App随时查看更多职位'}:
      {platform:'51job',kind:'detail',observedUrl:job.url,dialogCount:stage==='modal'?1:0,apply:{selector:'apply'},
       role:job.role,company:job.company,jd:job.jd,jdComplete:true,
       ...(stage==='modal'?{dialogTitle:'选择需要同步发送的附件简历',extraInputs:0,sendCount:1,send:{selector:'send'},attachments:[
         {name:'实习应聘 简历',selected:false,selector:'first'},{name:'简历',selected:false,selector:'second'},
         {name:'综合能力简历',selected,selector:'third'}]}:{})},
    click:async selector=>{
      if(selector==='apply')stage='modal';
      else if(selector==='third')selected=true;
      else if(selector==='send'){sends++;stage=options.pending?'pending':'receipt';}
      else throw Error('未知模拟动作');
    }
  };
  const make=()=>createSubmissionSession({}, {root,local,flowFactory:()=>create51jobFlow({}, {io})});
  const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
  return {root,make,read,calls,sends:()=>sends,receipt:()=>{stage='receipt';}};
}
test('前程无忧真实代码完整连接共用评分、登记、成功及原入库格式',async t=>{
  const f=await fixture(t);const session=f.make();const result=await session.submit('runs/test','174008722');
  assert.equal(result.action,'done',JSON.stringify(result));assert.equal(f.sends(),1);
  const record=(await f.read('runs/test/174008722.record.json')).record;
  assert.equal(record.id,'51job:174008722');assert.equal(record.platform,'51job');assert.equal(record.score,80.5);
  assert.equal(record.url,'https://jobs.51job.com/shanghai-pdxq/174008722.html');
  assert.equal(record.scoringResume,'虚构共享简历');assert.match(record.submittedResume,/综合能力简历/);
  assert.equal((await f.read('data/application_attempts.json'))['51job:174008722'].status,'已核实投递成功');
  assert.deepEqual((await f.read('data/state.json')).records,[]); // offline没有触碰实际工作台
  assert.deepEqual(f.calls,['start','score-input','rate','session-state','gate','arm','gate','complete']);
  await session.submit('runs/test','174008722');assert.equal(f.sends(),1);
});
test('浏览器会话重置后从磁盘发现原尝试，只读续接不重发',async t=>{
  const f=await fixture(t,{pending:true});
  let result=await f.make().submit('runs/test','174008722');assert.equal(result.action,'observe_result',JSON.stringify(result));
  assert.equal(f.sends(),1);assert.ok((await f.read('runs/test/run.json')).activeAttempt);
  f.receipt();result=await f.make().submit('runs/test','174008722');
  assert.equal(result.action,'done',JSON.stringify(result));assert.equal(f.sends(),1);
  assert.deepEqual((await f.read('runs/test/run.json')).successIds,['174008722']);
  assert.equal(f.calls.filter(c=>c==='arm').length,1);
});
