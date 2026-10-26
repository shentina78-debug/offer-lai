/* 仅在 cua_repl 中使用已绑定的 App。无网络、文件访问或独立浏览器驱动。 */
function createShixisengFlow(app, clock = () => Date.now()) {
  const prepared = new Map(), attempted = new Set(), transitions = new Map();
  const identity = value => {
    const match = String(value || '').match(/^(?:https?:\/\/)?(?:www\.)?shixiseng\.com\/intern\/(inn_[a-z0-9]+)(?:[?/#]|$)/);
    return match ? match[1] : null;
  };
  function nodes(text) {
    return String(text).split('\n').flatMap(line => {
      const m = line.match(/^(\s*)(\d+) (.*)$/);
      return m ? [{index:Number(m[2]), indent:m[1].length, text:m[3], raw:line}] : [];
    });
  }
  function subtree(rows, index) {
    const first=rows[index]; let end=index+1;
    while(end<rows.length && rows[end].indent>first.indent)end++;
    return rows.slice(index,end);
  }
  function observe(text, gate) {
    const rows=nodes(text), pageIndex=rows.findIndex(n=>/^HTML 内容 .*URL:/.test(n.text));
    if(pageIndex<0)throw Error('无法定位当前网页');
    const page=subtree(rows,pageIndex), observed=page[0].text.match(/URL: (\S+)/)?.[1];
    const url=/^https?:\/\//.test(observed||'') ? observed : 'https://'+observed;
    if(identity(url)!==gate.jobId)throw Error('当前网页与交接岗位不一致');
    const dialogs=page.filter(n=>/^(?:container (?:dialog|对话)|对话框)(?:\s|$)/.test(n.text));
    if(dialogs.length>1)throw Error('多个弹窗，需现场核对');
    const dialog=dialogs.length ? subtree(page,page.indexOf(dialogs[0])) : [];
    const labels=ns=>ns.map(n=>n.text.replace(/^(?:文本|text|按钮) /,'').trim());
    const dlabels=labels(dialog), all=labels(page);
    if(!dlabels.includes('投递失败')&&dlabels.some(t=>/验证码|滑块|安全验证|请登录|登录后|用户协议|隐私政策/.test(t)))throw Error('登录、验证码或协议弹窗，停止');
    const success=dlabels.includes('投递成功'), failed=dlabels.includes('投递失败');
    return {page,dialog,url,success,failed,delivered:all.includes('已投递'),expired:all.some(t=>/^(?:该)?(?:岗位|职位)已(?:失效|下架|关闭)$/.test(t)),
      requiresResume:dlabels.some(t=>/^请完善中\s*[&＆和]\s*英文简历后投递$/.test(t)),
      normal:dlabels.includes('选择投递简历')};
  }
  function evidence(state) {
    return state.dialog.filter(n=>/^(?:文本|text|文本栏|未加标签的图片) /.test(n.text)).map(n=>n.text).join('\n').slice(0,6000);
  }
  function form(state,gate) {
    if(!state.normal)throw Error('不是已验证的简历选择弹窗');
    const rows=state.dialog, online=rows.findIndex(n=>n.text==='文本 在线简历'), attachment=rows.findIndex(n=>n.text==='文本 附件简历');
    if(online<0||attachment<=online)throw Error('简历选择结构发生变化');
    const first=rows.slice(online,attachment), second=rows.slice(attachment);
    const radio=ns=>ns.filter(n=>/\/radio-(?:choose|choosed)\.png(?:\?|$)/.test(n.text));
    const a=radio(first), b=radio(second);
    if(a.length!==1||b.length!==1||!second.some(n=>n.text==='文本 中文：100%'))throw Error('无法确认中文附件简历');
    const selected=n=>/\/radio-choosed\.png(?:\?|$)/.test(n.text);
    if(selected(a[0])===selected(b[0]))throw Error('简历勾选状态异常');
    const expected=gate.supplements;
    if(!expected||Object.keys(expected).sort().join(',')!==['到岗时间','实习时长','每周出勤'].sort().join(','))throw Error('补充信息配置无效');
    const fields=rows.filter(n=>/^文本栏 /.test(n.text));
    if(fields.length!==3 || rows.some(n=>/^(?:复选框|弹出式按钮|文本区域) /.test(n.text)) || rows.some(n=>/必填|补充问题|请填写/.test(n.text)))throw Error('出现新必填项或表单结构变化');
    for(const [label,value] of Object.entries(expected)) {
      const at=rows.findIndex(n=>n.text===`文本 ${label}：`);
      const field=at<0?null:rows.slice(at+1).find(n=>/^文本栏 /.test(n.text));
      const actual=field?.text.match(/Value: (.*?)(?:, Placeholder:|$)/)?.[1];
      if(actual!==value)throw Error(`${label}与已确认值不同`);
    }
    const confirm=rows.filter(n=>/^(?:文本|按钮) 确认投递$/.test(n.text));
    if(confirm.length!==1)throw Error('无法唯一定位确认投递');
    return {attachmentIndex:b[0].index,selected:selected(b[0]),confirmIndex:confirm[0].index};
  }
  return async function run(gate, phase='prepare') {
    const started=clock(), trace=[]; let clicked=attempted.has(gate.attemptId), state;
    const result=(status,extra={})=>({status,jobId:gate.jobId,handoffId:gate.handoffId,attemptId:gate.attemptId||null,
      observedUrl:state?.url||null,clickedConfirm:clicked,evidence:state?evidence(state):'',trace,
      browserSeconds:(clock()-started)/1000,...extra});
    const read=async()=>{
      const before=clock(); const text=await app.getAXState({emit:false,disableDiffing:true});
      trace.push({event:'observe',ms:clock()-before}); state=observe(text,gate);return state;
    };
    const click=async(index,event)=>{const before=clock();await app.click(index);trace.push({event,ms:clock()-before})};
    const checkpoint=async()=>{
      // 新观察提供缺失的加载/动画信息，不连续空读AX，也不固定sleep。
      const before=clock();await app.getScreenshot({emit:false});trace.push({event:'loading_checkpoint',ms:clock()-before});
      await read();
    };
    const current=()=>{
      if(gate.action!=='execute_submission'||!Number.isFinite(gate.score)||!Number.isFinite(gate.threshold)||gate.score<gate.threshold)throw Error('评分未获准进入投递');
      if(!gate.handoffId||identity(gate.url)!==gate.jobId)throw Error('交接结论无效');
      // 新路径由本机arm和confirm即时复查材料/门槛，不以固定票据倒计时中断。
    };
    const terminal=async()=>{
      if(!state.success&&!state.failed)return null;
      const proof=evidence(state), failure=state.failed;
      const reasons=state.dialog.filter(n=>/^(?:文本|text) /.test(n.text)).map(n=>n.text.replace(/^(?:文本|text) /,''));
      const close=state.dialog.find(n=>/\/deliver-layer-close\.png/.test(n.text)||/^(?:按钮|文本) (?:关闭|Close|返回)$/.test(n.text));
      let closeError;
      if(close){try{await click(close.index,failure?'close_failure':'close_success');await read()}catch(error){closeError=error.message}}
      transitions.delete(gate.handoffId);
      return result(failure?'failed':'success',{evidence:proof,closeRequired:!!closeError||state.dialog.length>0,
        ...(failure?{reason:reasons.filter(t=>!['投递失败','返回','关闭'].includes(t)).join('；')||'网站明确投递失败'}:{deliveredAfterClose:state.delivered}),
        ...(closeError?{closeError}:{})});
    };
    try {
      current();
      if(!['prepare','confirm','observe'].includes(phase))throw Error('未知执行阶段');
      if(phase==='confirm' && (!gate.attemptId||attempted.has(gate.attemptId)||!prepared.has(gate.handoffId)))throw Error('未准备、已有提交尝试或会话已重置，先核查结果');
      if(phase==='observe'&&!gate.attemptId)throw Error('缺少本次提交登记');
      await read();
      if(phase==='observe'){
        clicked=true; // 本机已持久登记，observe只核查结果，绝不点击确认。
        let done=await terminal();if(done)return done;
        await checkpoint();done=await terminal();
        return done||result('pending_result',{reason:'等待本次结果；继续观察，不重投'});
      }
      if(state.success)return result('existing_success',{needsReconciliation:true});
      if(state.failed)return result('skip',{reason:'当前岗位已有明确失败提示，跳过',closeRequired:true});
      if(state.delivered||state.expired)return result('skip',{reason:'已投递或已失效'});
      if(phase==='prepare') {
        if(!state.dialog.length) {
          if(!transitions.has(gate.handoffId)){
            const buttons=state.page.filter(n=>/^(?:文本|按钮) 投个简历$/.test(n.text));
            if(!buttons.length||buttons.length>2)throw Error('无法定位已验证的投递按钮');
            transitions.set(gate.handoffId,'opening');
            await click(buttons[0].index,'open_dialog');await read();
          }
          if(!state.dialog.length)await checkpoint();
          if(!state.dialog.length)return result('waiting_dialog',{reason:'弹窗仍在加载；继续prepare，不重复点击入口'});
        }
        if(state.requiresResume) {
          const close=state.dialog.find(n=>/\/deliver-layer-close\.png/.test(n.text)||/^(?:按钮|文本) 取消$/.test(n.text));
          if(!close)throw Error('需完善中英文简历，未找到关闭控件');
          const proof=evidence(state);await click(close.index,'close_resume_requirement');await read();transitions.delete(gate.handoffId);
          return result('skip',{evidence:proof,reason:'请完善中&英文简历后投递；按用户规则跳过',closeRequired:state.dialog.length>0});
        }
        // 弹窗标题可能先于表单内容进入AX，未加载全时继续观察，不误报结构变化。
        const incomplete=()=>state.normal&&(!state.dialog.some(n=>n.text==='文本 在线简历')||!state.dialog.some(n=>n.text==='文本 附件简历')||state.dialog.filter(n=>/^文本栏 /.test(n.text)).length<3);
        if(incomplete())await checkpoint();
        if(incomplete())return result('waiting_dialog',{reason:'弹窗表单尚未加载完整，继续prepare'});
        const f=form(state,gate);
        if(!f.selected){
          if(transitions.get(gate.handoffId)!=='selecting'){
            transitions.set(gate.handoffId,'selecting');await click(f.attachmentIndex,'select_attachment');await read();
          }
          if(!form(state,gate).selected)await checkpoint();
          if(!form(state,gate).selected)return result('waiting_attachment',{reason:'附件勾选尚未更新；继续prepare，不重复切换'});
        }
        prepared.set(gate.handoffId,{jobId:gate.jobId});transitions.delete(gate.handoffId);
        return result('ready_to_confirm',{attachment:'中文附件简历',supplements:gate.supplements});
      }
      if(prepared.get(gate.handoffId).jobId!==gate.jobId)throw Error('准备状态不一致');
      const f=form(state,gate);if(!f.selected)throw Error('确认前附件已取消选中');
      attempted.add(gate.attemptId);prepared.delete(gate.handoffId);clicked=true;
      await click(f.confirmIndex,'confirm_once');await read();
      let done=await terminal();if(done)return done;
      await checkpoint();done=await terminal();
      return done||result('pending_result',{reason:'已点击一次，结果尚在加载；继续observe，禁止重投'});
    } catch(error) {return result(clicked?'uncertain':'stopped',{reason:error.message})}
  };
}
if(typeof module!=='undefined')module.exports={createShixisengFlow};
