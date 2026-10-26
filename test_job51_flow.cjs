const test = require('node:test');
const assert = require('node:assert/strict');
const {create51jobFlow} = require('./skills/51job-apply/scripts/submission_flow.js');
const URL = 'https://jobs.51job.com/shanghai-pdxq/174008722.html';
const JD = '每周3天，实习3个月，数据分析项目';
const gate = {platform:'51job',action:'execute_submission',url:URL,jobId:'174008722',handoffId:'h1',score:80.5,threshold:60,
  expectedJDHash:require('node:crypto').createHash('sha256').update(JD).digest('hex'),expectedRole:'测试实习',expectedCompany:'测试公司'};
const control = selector => ({selector});
function site(options = {}) {
  let stage = options.stage || 'detail', selected = !!options.selected, afterOpenReads = 0;
  const actions = [];
  const io = {
    read: async () => {
      if (stage === 'opening' && ++afterOpenReads > (options.openDelay || 0)) stage = 'modal';
      if (stage === 'receipt') return {platform:'51job',kind:'receipt',observedUrl:
        'https://jobs.51job.com/applysuccess.php?jobid=' + (options.wrongReceipt || '174008722'),receiptText:'投递成功，前往应届生求职App随时查看更多职位'};
      const s = {platform:'51job',kind:'detail',observedUrl:options.wrongJob ? URL.replace('174008722','174008723') : URL,
        role:'测试实习',company:'测试公司',jd:options.changedJD?'已经变化的JD':JD,jdComplete:true,
        delivered:!!options.delivered,expired:!!options.expired,apply:control('apply'),dialogCount:0};
      if (stage === 'modal') Object.assign(s,{dialogCount:1,dialogTitle:'选择需要同步发送的附件简历',
        sendCount:1,extraInputs:options.extraInputs || 0,send:control('send'),attachments:[
          {name:'实习应聘 简历',selected:false,selector:'first'}, {name:'简历',selected:false,selector:'second'},
          {name:'综合能力简历',selected:options.unknownSelection ? null : selected,selector:'third'}]});
      return s;
    },
    click: async selector => {
      actions.push(selector);
      if (selector === 'apply') stage = 'opening';
      else if (selector === 'third') selected = !selected;
      else if (selector === 'send') {
        stage = options.pending ? 'pending' : 'receipt';
        if (options.sendError) throw Error('发送后的工具响应超时');
      } else throw Error('未知控件');
    }
  };
  return {io,actions,unselect:()=>{selected=false;},receipt:()=>{stage='receipt';},flow:create51jobFlow({}, {io})};
}
async function prepared(options = {}) {
  const s = site(options);const value = await s.flow.prepare(gate);
  assert.equal(value.status,'ready_to_confirm');return s;
}
test('前程无忧正常准备、只发送一次、核对独立成功回执',async()=>{
  const s = await prepared();
  const value = await s.flow.confirm({...gate,attemptId:'a1'});
  assert.equal(value.status,'success');assert.equal(value.submissionSent,true);
  assert.equal(value.attachment,'综合能力简历');assert.deepEqual(s.actions,['apply','third','send']);
  await assert.rejects(s.flow.confirm({...gate,attemptId:'a1'}));assert.equal(s.actions.filter(x=>x==='send').length,1);
});
test('附件已经选中不切换；已投递和错误岗位不点击',async()=>{
  const s = await prepared({selected:true});assert.deepEqual(s.actions,['apply']);
  for (const settings of [{delivered:true},{expired:true}]) {
    const s = site(settings);assert.equal((await s.flow.prepare(gate)).status,'skip');assert.deepEqual(s.actions,[]);
  }
  const wrong = site({wrongJob:true});await assert.rejects(wrong.flow.prepare(gate));assert.deepEqual(wrong.actions,[]);
});
test('弹窗加载延迟续接，不重复打开',async()=>{
  const s = site({openDelay:5});
  assert.equal((await s.flow.prepare(gate)).status,'waiting_dialog');
  assert.equal((await s.flow.prepare(gate)).status,'ready_to_confirm');
  assert.equal(s.actions.filter(x=>x==='apply').length,1);
});
test('不能核实选中或出现额外输入时不选择、不发送',async()=>{
  for (const options of [{unknownSelection:true},{extraInputs:1}]) {
    const s = site(options);assert.equal((await s.flow.prepare(gate)).status,'waiting_dialog');
    assert.deepEqual(s.actions,['apply']);
  }
});
test('发送前附件改变、低分、跨平台均阻止发送',async()=>{
  const s = await prepared();s.unselect();await assert.rejects(s.flow.confirm({...gate,attemptId:'a1'}));
  assert.equal(s.actions.includes('send'),false);
  for (const changes of [{platform:'shixiseng'},{score:59},{action:'pending_review'}]) {
    const s = site();await assert.rejects(s.flow.prepare({...gate,...changes}));assert.deepEqual(s.actions,[]);
  }
});
test('网页JD在评分后改变时停止，不点击投递入口',async()=>{
  const s=site({changedJD:true});await assert.rejects(s.flow.prepare(gate));assert.deepEqual(s.actions,[]);
});
test('发送工具报错后只读恢复，不再点击发送',async()=>{
  const s = await prepared({sendError:true});const g = {...gate,attemptId:'a1'};
  assert.equal((await s.flow.confirm(g)).status,'uncertain');
  assert.equal((await s.flow.observe(g,true)).status,'success');
  await assert.rejects(s.flow.confirm(g));assert.equal(s.actions.filter(x=>x==='send').length,1);
});
test('未知结果与其他岗位回执不会冒充成功',async()=>{
  const pending = await prepared({pending:true});const g = {...gate,attemptId:'a1'};
  assert.equal((await pending.flow.confirm(g)).status,'pending_result');
  assert.equal((await pending.flow.observe(g,true)).status,'pending_result');
  assert.equal(pending.actions.filter(x=>x==='send').length,1);
  const wrong = await prepared({wrongReceipt:'174008723'});await assert.rejects(wrong.flow.confirm(g));
  const old = site({stage:'receipt'});await assert.rejects(old.flow.prepare(gate));
  assert.equal((await old.flow.observe(gate,false)).status,'pending_result');
});
function searchSite(options = {}) {
  const actions = [];
  let keyword='商务助理', title='商务助理 上海', city=false, intern=false, menu=false, latest=false;
  let rows=[{role:'业务研究（实习）',company:'测试公司甲',campus:true,labelsVerified:true,roleSelector:'campus',text:'校招'},
    {role:'Wholesale Intern',company:'测试公司乙',campus:null,labelsVerified:false,roleSelector:'candidate',text:'待核对图形标签'}];
  const io={read:async()=>({platform:'51job',kind:'listing',observedUrl:'https://we.51job.com/pc/search',title,loading:false,
    searchInput:{...control('input'),value:keyword},searchButton:control('search'),
    cityOptions:{上海:{...control('city'),selected:city}},
    workType:{...control('workType'),text:intern?'工作类型 ·1':'工作类型'},
    internOption:menu?{...control('intern'),selected:intern}:null,latest:{...control('latest'),selected:latest},candidates:rows}),
    fill:async(selector,value)=>{actions.push('fill');keyword=value;},
    click:async selector=>{
      actions.push(selector);
      if(selector==='search')title=keyword+' 上海';
      if(selector==='city')city=true;
      if(selector==='workType')menu=true;
      if(selector==='intern'){intern=true;if(options.resetKeyword)keyword='商务助理';}
      if(selector==='latest'){latest=true;menu=false;}
    }};
  return {actions,flow:create51jobFlow({}, {io}),change:()=>{rows=[...rows,{role:'新岗位',company:'丙',text:'新'}];}};
}
test('搜索严格按关键词搜索、城市、实习、最新优先的顺序',async()=>{
  const s=searchSite();const result=await s.flow.search({platform:'51job',keywords:['市场分析'],cities:['上海'],jobType:'实习'},'市场分析','上海');
  assert.deepEqual(s.actions,['fill','search','city','workType','intern','latest']);
  assert.equal(result.candidates[0].action,'skip_campus');assert.equal(result.candidates[1].action,'needs_label_review');
  await assert.rejects(s.flow.open(result.candidates[0].candidateKey));assert.equal(s.actions.includes('campus'),false);
});
test('不可读标签需当前列表的Agent核验；旧页面核验失效',async()=>{
  const s=searchSite();const snapshot=await s.flow.list();const c=snapshot.candidates[1];
  await assert.rejects(s.flow.open(c.candidateKey));
  const reviewed=await s.flow.reviewLabels(snapshot.snapshotKey,[{candidateKey:c.candidateKey,campus:false,evidence:'当前列表截图无黄色校招标志'}]);
  assert.equal(reviewed.candidates[1].action,'candidate');
  await s.flow.open(c.candidateKey);assert.equal(s.actions.includes('candidate'),true);
  s.change();await assert.rejects(s.flow.reviewLabels(snapshot.snapshotKey,[{candidateKey:c.candidateKey,campus:false,evidence:'旧证据'}]));
});
test('网站重置关键词或配置不来自工作台时停止',async()=>{
  const config={platform:'51job',keywords:['市场分析'],cities:['上海'],jobType:'实习'};
  const bad=searchSite();await assert.rejects(bad.flow.search(config,'自创关键词','上海'));assert.deepEqual(bad.actions,[]);
  const reset=searchSite({resetKeyword:true});await assert.rejects(reset.flow.search(config,'市场分析','上海'));
  assert.equal(reset.actions.includes('send'),false);
});
module.exports={site,gate,URL};
