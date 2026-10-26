const test=require('node:test');const assert=require('node:assert/strict');
const modulePromise=import('./skills/shixiseng-apply/scripts/submission_bridge.mjs');
async function setup(options={}){
 const {createSubmissionSession}=await modulePromise;const calls=[],archived=[],phases=[];
 const gate={action:'execute_submission',jobId:'inn_test123',handoffId:'ticket'};
 let completed=0;
 const local=async(command,args,input)=>{
  calls.push({command,args,input});
  if(command==='gate')return {...gate,...(args.includes('observe')||args.includes('confirm')?{attemptId:'attempt'}:{})};
  if(command==='arm'){assert.equal(input.status,'ready_to_confirm');return {...gate,attemptId:'attempt'}}
  if(command==='complete'){
   if(options.recordFailure&&completed++===0)throw Error('本机入库暂不可用');
   return input.status==='failed'?{action:'next_candidate',savedLocally:true}:input.status==='success'?{savedLocally:true,sync:[{result:'saved'}]}:{action:'observe_result',savedLocally:true};
  }
  assert.fail(command);
 };
 let prepares=0,observes=0;
 const flow=async(g,phase)=>{
  phases.push(phase);
  if(phase==='prepare')return {status:options.delayPrepare&&prepares++===0?'waiting_dialog':'ready_to_confirm',jobId:g.jobId,evidence:'原始附件证据'};
  if(phase==='confirm'){
   assert.ok(calls.some(x=>x.command==='arm'),'先持久登记再确认');
   return {status:options.pending?'pending_result':options.fail?'failed':'success',jobId:g.jobId,evidence:'原始结果证据'};
  }
  observes++;return {status:options.inspectPending&&observes<2?'pending_result':'success',jobId:g.jobId,evidence:'结果证据'};
 };
 const session=createSubmissionSession({}, {local,flow,archive:async(...args)=>archived.push(args)});
 return {session,calls,archived,phases};
}
test('一次短调用自动交接准备、登记、确认及记录，不需要模型搬JSON',async()=>{
 const {session,calls,archived,phases}=await setup();const result=await session.submit('runs/test','inn_test123');
 assert.equal(result.status,'success');assert.deepEqual(phases,['prepare','confirm']);
 assert.deepEqual(calls.map(x=>x.command),['gate','arm','gate','complete']);
 assert.equal(calls.at(-1).input.evidence,'原始结果证据');assert.ok(archived.some(x=>x[2]==='bridge-result'));
});
test('明确失败消费后返回下一岗，不伪造成功',async()=>{
 const {session,calls}=await setup({fail:true});const result=await session.submit('runs/test','inn_test123');
 assert.equal(result.action,'next_candidate');assert.equal(calls.at(-1).input.status,'failed');
});
test('加载延迟在内部续接，等待提交结果只观察',async()=>{
 const {session,phases}=await setup({delayPrepare:true,pending:true});
 assert.equal((await session.submit('runs/test','inn_test123')).status,'success');assert.deepEqual(phases,['prepare','prepare','confirm','observe']);
});
test('仍在加载时下一次短调用只核查，不再确认',async()=>{
 const {session,phases}=await setup({pending:true,inspectPending:true});assert.equal((await session.submit('runs/test','inn_test123')).action,'observe_result');
 assert.equal((await session.submit('runs/test','inn_test123')).status,'success');assert.equal(phases.filter(x=>x==='confirm').length,1);
});
test('记录暂失败保留终态，下次只重试记录',async()=>{
 const {session,calls,phases}=await setup({recordFailure:true});assert.equal((await session.submit('runs/test','inn_test123')).action,'retry_record');
 assert.equal((await session.submit('runs/test','inn_test123')).status,'success');assert.deepEqual(phases,['prepare','confirm']);assert.equal(calls.filter(x=>x.command==='complete').length,2);
});
