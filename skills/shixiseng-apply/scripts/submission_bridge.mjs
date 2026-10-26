/* CUA会话中的本地数据桥：子进程只做本机校验/记录，网页交互只调用传入的App。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
import {spawn} from 'node:child_process';
function loadFlow(app){const file=require.resolve('./submission_flow.js');delete require.cache[file];return require(file).createShixisengFlow(app)}
const DEFAULT_ROOT=path.resolve(__dirname,'../../..');
const DEFAULT_PYTHON=(process.env.PYTHON || 'python3');
function createLocalClient(root,python=DEFAULT_PYTHON) {
  return (command,args=[],input)=>new Promise((resolve,reject)=>{
    const child=spawn(python,[path.join(root,'application_run.py'),command,...args],{cwd:root,stdio:['pipe','pipe','pipe']});
    let out='',err='';
    const timeout=setTimeout(()=>{child.kill();reject(Error('本机校验/记录超时；保留日志，先核查'))},15000);
    child.stdout.on('data',chunk=>{out+=chunk;if(out.length>2e6){child.kill();reject(Error('本机返回过长'))}});
    child.stderr.on('data',chunk=>{err+=chunk});
    child.on('error',error=>{clearTimeout(timeout);reject(error)});
    child.on('close',code=>{
      clearTimeout(timeout);
      if(code!==0)return reject(Error(err.trim()||'本机工具执行失败'));
      try{resolve(JSON.parse(out).result)}catch{reject(Error('本机工具返回格式无效'))}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(input===undefined?'':JSON.stringify(input));
  });
}
function createSubmissionSession(app,options={}) {
  const root=options.root||DEFAULT_ROOT;
  const local=options.local||createLocalClient(root,options.python);
  const flow=options.flow||loadFlow(app);
  const memory=new Map();
  const archive=options.archive||async function(run,id,stage,value){
    const folder=path.resolve(root,run);
    const relative=path.relative(path.join(root,'runs'),folder);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('运行目录必须位于项目runs内');
    const target=path.join(folder,`${id}.${stage}.json`),temp=target+'.tmp';
    await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,target);
    await fs.appendFile(path.join(folder,'events.jsonl'),JSON.stringify({time:new Date().toISOString(),event:'browser.'+stage,jobId:id,browserSeconds:value.browserSeconds,wallSeconds:value.wallSeconds,status:value.status})+'\n');
  };
  const key=(run,id)=>run+'|'+id;
  const checkId=id=>{if(!/^inn_[a-z0-9]+$/.test(id))throw Error('岗位ID无效')};
  async function consume(run,id,observed){
    await archive(run,id,'bridge-result',observed);
    if(['success','failed'].includes(observed.status))memory.set(key(run,id),{armed:true,terminal:observed});
    let saved;
    try{saved=await local('complete',[run,'-'],observed)}catch(error){return {status:observed.status,jobId:id,action:'retry_record',evidenceSavedLocally:true,reason:error.message}}
    if(observed.status==='success'||observed.status==='failed')memory.delete(key(run,id));
    return {status:observed.status,jobId:id,reason:observed.reason,closeRequired:observed.closeRequired,
            action:saved.pendingSync?'sync_pending':saved.action||(observed.status==='success'?'done':'needs_reconciliation'),record:saved,
            browserSeconds:observed.browserSeconds};
  }
  async function inspect(run,id){
    checkId(id);
    const gate=await local('gate',[run,id,'--phase','observe']);
    const observed=await flow(gate,'observe');
    return consume(run,id,observed);
  }
  async function submit(run,id){
    checkId(id);
    const previous=memory.get(key(run,id));
    if(previous?.terminal)return consume(run,id,previous.terminal);
    if(previous?.armed)return inspect(run,id);
    // 每次继续都刷新本机条件；相同材料保留handoffId和函数内部的加载状态。
    const gate=await local('gate',[run,id,'--phase','prepare']);
    if(gate.action!=='execute_submission')return {status:'skip',jobId:id,action:'next_candidate',reason:gate.reason};
    let observed=await flow(gate,'prepare');
    await archive(run,id,'bridge-prepared',observed);
    if(['waiting_dialog','waiting_attachment'].includes(observed.status)){
      observed=await flow(gate,'prepare');await archive(run,id,'bridge-prepared',observed);
    }
    if(['waiting_dialog','waiting_attachment'].includes(observed.status))return {status:observed.status,jobId:id,action:'continue_prepare',reason:observed.reason};
    if(observed.status!=='ready_to_confirm')return {status:observed.status,jobId:id,action:observed.status==='skip'?'next_candidate':'needs_attention',reason:observed.reason,closeRequired:observed.closeRequired};
    await local('arm',[run,'-'],observed);
    memory.set(key(run,id),{armed:true});
    // arm持久写入后才获取确认交接，再以最新网页核对，只点击一次。
    const confirmed=await local('gate',[run,id,'--phase','confirm']);
    let outcome=await flow(confirmed,'confirm');
    if(outcome.status==='pending_result'){await archive(run,id,'bridge-waiting',outcome);outcome=await flow(confirmed,'observe')}
    return consume(run,id,outcome);
  }
  const timed=method=>async(run,id)=>{const started=Date.now();const value=await method(run,id);value.sessionSeconds=(Date.now()-started)/1000;await archive(run,id,'bridge-call',{status:value.status,wallSeconds:value.sessionSeconds});return value};
  return {submit:timed(submit),inspect:timed(inspect)};
}
export {createSubmissionSession,createLocalClient};
