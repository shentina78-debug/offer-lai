const assert=require('node:assert/strict');
const url='https://www.shixiseng.com/intern/inn_test123';
const supplements={'到岗时间':'1个月内','实习时长':'6个月以上','每周出勤':'5天'};
function mockApp(options={}) {
 const app={stage:options.stage||'detail',selected:!!options.selected,clicks:[],reads:0,confirms:0,controls:{},options};
 app.getScreenshot=async function(){this.screenshots=(this.screenshots||0)+1;if(this.pendingOpen&&!--this.pendingOpen)this.stage=options.openStage||'dialog';if(this.pendingResult&&!--this.pendingResult)this.stage='success';if(this.pendingSelect&&!--this.pendingSelect)this.selected=true;return new Uint8Array()};
 app.getAXState=async function(opts){
  assert.equal(opts.emit,false);assert.equal(opts.disableDiffing,true);
  this.reads++;let i=this.reads*100;const rows=[];this.controls={};
  const add=(depth,text,action)=>{if(options.localizedDialog&&text==='container dialog')text='container 对话';const id=++i;rows.push(`${'\t'.repeat(depth)}${id} ${text}`);if(action)this.controls[id]=action};
  add(0,'标准窗口 实习岗位 - Google Chrome');add(1,'container');add(2,`HTML 内容 商业拓展实习生, URL: ${options.wrongPage?'https://www.shixiseng.com/intern/inn_other':url.replace('https://','')}`);
  const detail=()=>{add(3,'文本 商业拓展实习生');add(3,'文本 投个简历','open')};
  if(this.stage==='detail')detail();
  else if(this.stage==='delivered'){add(3,'文本 已投递')}
  else if(this.stage==='failed'){add(3,'container dialog');add(4,'未加标签的图片 /i-error.png');add(4,'文本 投递失败');add(4,'文本 该职位需要你完善英文简历');add(4,'文本 返回','cancel')}
  else if(this.stage==='expired'){add(3,'文本 岗位已失效')}
  else if(this.stage==='success'){
   add(3,'container dialog');add(4,'文本 投递成功');
   if(options.closeControl)add(4,'未加标签的图片 /deliver-layer-close.png','close');
   add(4,'按钮 一键投递6个职位','batch');
  } else if(['blocked','unknown','captcha'].includes(this.stage)){
   add(3,'container dialog');add(4,'文本 友情提示');
   add(4,'文本 '+(this.stage==='blocked'?'请完善中&英文简历后投递':this.stage==='captcha'?'请完成验证码':'新问题：填写承诺'));
   add(4,'按钮 取消','cancel');
  } else {
   add(3,'container dialog');add(4,'文本 选择投递简历');if(options.partialForm&&!this.partialSeen){this.partialSeen=true;return rows.join('\n')}add(4,'文本 在线简历');add(4,'文本 中文：91%');add(4,'文本 英文：90%');
   add(4,`未加标签的图片 /radio-${this.selected?'choose':'choosed'}.png`);
   add(4,'文本 附件简历');add(4,'文本 中文：100%');
   add(4,`未加标签的图片 /radio-${this.selected?'choosed':'choose'}.png`,'attachment');
   add(4,'文本 投递附件简历将一并投递您的在线简历，请及时更新在线简历');add(4,'文本 补充信息');
   for(const [label,value] of Object.entries(supplements)){
    add(4,'container');add(5,`文本 ${label}：`);add(5,'container');
    add(6,`文本栏 Value: ${options.changedField&&label==='到岗时间'?'立即到岗':value}, Placeholder: 请选择`);
   }
   if(options.extraField)add(4,'文本栏 Value: 新必填问题');
   add(4,'文本 确认投递','confirm');
  }
  // Chrome标签文字和推荐链接不能作为当前岗位成功证据。
  add(1,'标签 其他岗位投递成功');add(1,'link 投递成功, Value: https://example.com');
  return rows.join('\n');
 };
 app.click=async function(index){
  assert.ok(this.controls[index],`不能复用旧观察的元素编号 ${index}`);
  const action=this.controls[index];this.clicks.push(action);
  if(action==='open'){if(options.openCheckpoints){this.pendingOpen=options.openCheckpoints;this.stage='detail'}else this.stage=options.openStage||'dialog'}
  else if(action==='attachment'){if(options.selectCheckpoints)this.pendingSelect=options.selectCheckpoints;else this.selected=true}
  else if(action==='confirm'){
   this.confirms++;this.stage=options.failure?'failed':options.neverSuccess||options.resultCheckpoints?'waiting':'success';if(options.resultCheckpoints)this.pendingResult=options.resultCheckpoints;
   if(options.clickError)throw Error('工具断开，动作结果未知');
  }else if(action==='cancel')this.stage='detail';
  else if(action==='close')this.stage='delivered';
  else if(action==='batch')assert.fail('不得点击推荐批量投递');
 };
 return app;
}
module.exports={mockApp};
