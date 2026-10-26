const test=require('node:test');
const assert=require('node:assert/strict');
const {createShixisengFlow}=require('./skills/shixiseng-apply/scripts/submission_flow.js');
const url='https://www.shixiseng.com/intern/inn_test123';
const gate=()=>({action:'execute_submission',jobId:'inn_test123',url,score:75,threshold:60,handoffId:'handoff-test',expiresAtMs:Date.now()+180000,supplements:{'到岗时间':'1个月内','实习时长':'6个月以上','每周出勤':'5天'}});
const {mockApp}=require('./test_helpers/shixiseng_app.cjs');
async function prepared(options={}){const app=mockApp(options),flow=createShixisengFlow(app),g=gate();const result=await flow(g);return {app,flow,g,result}}
test('正常路径在两次工具调用内核对附件、只提交一次并关闭',async()=>{
 const {app,flow,g,result}=await prepared({closeControl:true});assert.equal(result.status,'ready_to_confirm');assert.equal(result.observedUrl,url);assert.equal(app.confirms,0);
 const done=await flow({...g,attemptId:'attempt-1'},'confirm');assert.equal(done.status,'success');assert.equal(done.closeRequired,false);assert.equal(done.deliveredAfterClose,true);
 assert.equal(app.confirms,1);assert.deepEqual(app.clicks,['open','attachment','confirm','close']);assert.match(done.evidence,/文本 投递成功/);
});
test('附件已选中时不重复切换',async()=>{const {app,result}=await prepared({selected:true});assert.equal(result.status,'ready_to_confirm');assert.deepEqual(app.clicks,['open'])});
test('Chrome翻译后的对话容器仍核对附件并仅确认一次',async()=>{const {app,flow,g,result}=await prepared({localizedDialog:true,closeControl:true});assert.equal(result.status,'ready_to_confirm');assert.equal(app.selected,true);const done=await flow({...g,attemptId:'localized'},'confirm');assert.equal(done.status,'success');assert.equal(app.confirms,1);assert.equal(done.closeRequired,false)});
test('中英文简历完善提示关闭并跳过',async()=>{const {app,result}=await prepared({openStage:'blocked'});assert.equal(result.status,'skip');assert.deepEqual(app.clicks,['open','cancel']);assert.equal(app.confirms,0)});
test('未知弹窗、验证码、新必填、字段改变均停止',async()=>{
 for(const options of [{openStage:'unknown'},{openStage:'captcha'},{extraField:true},{changedField:true}]){
  const {app,result}=await prepared(options);assert.equal(result.status,'stopped');assert.equal(app.confirms,0);assert.ok(!app.clicks.includes('attachment'));
 }
});
test('错误岗位、已投递、失效都不点击',async()=>{
 for(const options of [{wrongPage:true},{stage:'delivered'},{stage:'expired'}]){const {app,result}=await prepared(options);assert.ok(['stopped','skip'].includes(result.status));assert.deepEqual(app.clicks,[])}
});
test('成功弹窗无可访问关闭按钮时返回关闭需求而不猜坐标',async()=>{const {app,flow,g}=await prepared();const done=await flow({...g,attemptId:'a'},'confirm');assert.equal(done.status,'success');assert.equal(done.closeRequired,true);assert.equal(app.confirms,1)});
test('结果未加载时返回进度，禁止重复提交',async()=>{
 const {app,flow,g}=await prepared({neverSuccess:true});const before=app.reads;
 const done=await flow({...g,attemptId:'a'},'confirm');assert.equal(done.status,'pending_result');assert.equal(app.reads-before,3);assert.equal(app.confirms,1);
 const again=await flow({...g,attemptId:'a'},'confirm');assert.equal(again.status,'uncertain');assert.equal(app.confirms,1);
});
test('点击发生后工具报错仍标记结果不明并禁止重试',async()=>{
 const {app,flow,g}=await prepared({clickError:true});assert.equal((await flow({...g,attemptId:'a'},'confirm')).status,'uncertain');
 assert.equal((await flow({...g,attemptId:'a'},'confirm')).status,'uncertain');assert.equal(app.confirms,1);
});
test('低分和无效交接在页面操作前停止',async()=>{
 for(const g of [{...gate(),handoffId:''},{...gate(),score:30}]){const app=mockApp();const result=await createShixisengFlow(app)(g);assert.equal(result.status,'stopped');assert.equal(app.reads,0)}
});
test('旧成功弹窗不冒充本次提交成功',async()=>{const {app,result}=await prepared({stage:'success'});assert.equal(result.status,'existing_success');assert.equal(result.clickedConfirm,false);assert.equal(app.confirms,0)});
test('未准备或会话重置不能直接确认',async()=>{const app=mockApp({stage:'dialog',selected:true});const result=await createShixisengFlow(app)({...gate(),attemptId:'a'},'confirm');assert.equal(result.status,'stopped');assert.equal(app.confirms,0)});
test('准备后附件状态改变时停止',async()=>{const {app,flow,g}=await prepared();app.selected=false;assert.equal((await flow({...g,attemptId:'a'},'confirm')).status,'stopped');assert.equal(app.confirms,0)});

test('弹窗加载两次检查点后继续，不重复点击入口',async()=>{
 const {app,flow,g,result}=await prepared({openCheckpoints:2});assert.equal(result.status,'waiting_dialog');
 const next=await flow(g,'prepare');assert.equal(next.status,'ready_to_confirm');assert.equal(app.clicks.filter(x=>x==='open').length,1);
});
test('附件选中延迟时不重复切换',async()=>{
 const {app,flow,g,result}=await prepared({selectCheckpoints:2});assert.equal(result.status,'waiting_attachment');
 assert.equal((await flow(g,'prepare')).status,'ready_to_confirm');assert.equal(app.clicks.filter(x=>x==='attachment').length,1);
});
test('延迟成功通过observe恢复，确认仍只点一次',async()=>{
 const {app,flow,g}=await prepared({resultCheckpoints:2});const armed={...g,attemptId:'a'};
 assert.equal((await flow(armed,'confirm')).status,'pending_result');assert.equal((await flow(armed,'observe')).status,'success');assert.equal(app.confirms,1);
});
test('明确失败保存原因并返回关闭，不纠结英文简历',async()=>{
 const {app,flow,g}=await prepared({failure:true});const outcome=await flow({...g,attemptId:'a'},'confirm');
 assert.equal(outcome.status,'failed');assert.match(outcome.reason,/英文简历/);assert.match(outcome.evidence,/文本 投递失败/);assert.equal(app.confirms,1);assert.equal(outcome.closeRequired,false);
});
test('旧短期票据倒计时不再造成中断，最新材料由本机提交前检查',async()=>{
 const app=mockApp();const flow=createShixisengFlow(app);assert.equal((await flow({...gate(),expiresAtMs:0})).status,'ready_to_confirm');
});

test('标题先加载表单后加载时继续等待而非误报结构改变',async()=>{const {result,app}=await prepared({partialForm:true});assert.equal(result.status,'ready_to_confirm');assert.equal(app.clicks.filter(x=>x==='open').length,1)});
