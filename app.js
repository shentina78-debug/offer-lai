const companyMultiFields=['companyOwnership','companyScale','companyCertification'];
function readSettings(){const form=document.getElementById('settings'),data=new FormData(form),settings=Object.fromEntries(data);for(const key of companyMultiFields)settings[key]=data.getAll(key);return settings}
const $=id=>document.getElementById(id);let state={settings:{},records:[]};let resumeInfo=null;let visible=[];
const statusStyles=document.createElement('link');statusStyles.rel='stylesheet';statusStyles.href='/status.css';document.head.append(statusStyles);
const aiPage=document.createElement('section');aiPage.id='ai';aiPage.hidden=true;aiPage.innerHTML='<div class="title"><div><p class="eyebrow">RESUME INTELLIGENCE</p><h1>AI 分析</h1><p>连接 DeepSeek，分析简历，再按需将建议导入岗位筛选。</p></div></div>';$('records').before(aiPage);
const aiNav=document.createElement('a');aiNav.href='#ai';aiNav.id='nav-ai';aiNav.textContent='✦　AI 分析';$('nav-filters').before(aiNav);
function toast(message){$('toast').textContent=message;$('toast').style.display='block';setTimeout(()=>$('toast').style.display='none',3200)}
const libraryPage=document.createElement('section');libraryPage.id='companies';libraryPage.hidden=true;
libraryPage.innerHTML=`<div class="title"><div><p class="eyebrow">COMPANY DIRECTORY</p><h1>企业库</h1><p>浏览本地企业名单，查看分类与品牌简称。</p></div><span class="badge">本地名单 · 程序匹配</span></div><div class="notice">分类沿用导入文档；“拟推荐”与“公示”保留原状态，不代表正式认定。名单外企业显示“无法判断”。</div><div id="catalog-stats" class="catalog-stats"></div><article><div class="catalog-controls"><label>搜索企业 / 品牌<input id="catalog-search" placeholder="输入企业名称或品牌简称"></label><label>企业分类<select id="catalog-category"><option value="">全部分类</option></select></label></div><p id="catalog-status" role="status">正在读取企业库…</p><div class="catalog-table-wrap"><table class="catalog-table"><thead><tr><th>企业名称</th><th>企业分类</th><th>品牌 / 简称</th></tr></thead><tbody id="catalog-rows"></tbody></table></div><div class="catalog-pagination"><button id="catalog-prev" class="secondary">上一页</button><span id="catalog-page"></span><button id="catalog-next" class="secondary">下一页</button></div><small id="catalog-source"></small></article>`;
$('records').after(libraryPage);
const libraryNav=document.createElement('a');libraryNav.href='#companies';libraryNav.id='nav-companies';libraryNav.textContent='▦　企业库';$('nav-records').after(libraryNav);
function route(){const requested=location.hash.slice(1),page=['ai','filters','records','companies'].includes(requested)?requested:'filters';for(const id of ['ai','filters','records','companies']){$(id).hidden=id!==page;$('nav-'+id).classList.toggle('active',id===page)}$('crumb').textContent={records:'投递记录',ai:'AI 分析',filters:'岗位筛选',companies:'企业库'}[page]}window.addEventListener('hashchange',route);route();
let catalogData=null,catalogPage=1;const catalogPageSize=50;
function renderCatalog(){
 if(!catalogData)return;
 const query=$('catalog-search').value.trim().normalize('NFKC').toLowerCase(),category=$('catalog-category').value;
 const rows=catalogData.companies.filter(c=>(!category||c.categories.includes(category))&&(!query||[c.name,...c.aliases].some(n=>n.normalize('NFKC').toLowerCase().includes(query))));
 const pages=Math.max(1,Math.ceil(rows.length/catalogPageSize));catalogPage=Math.min(catalogPage,pages);
 $('catalog-status').textContent=`共 ${catalogData.companies.length.toLocaleString()} 家企业 · 当前找到 ${rows.length.toLocaleString()} 家`;
 $('catalog-rows').innerHTML=rows.slice((catalogPage-1)*catalogPageSize,catalogPage*catalogPageSize).map(c=>`<tr><td>${safe(c.name)}</td><td><div class="catalog-tags">${c.categories.map(v=>`<span>${safe(v)}</span>`).join('')}</div></td><td>${safe(c.aliases.join('、')||'—')}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">没有找到符合条件的企业</td></tr>';
 $('catalog-page').textContent=`第 ${catalogPage} / ${pages} 页`;$('catalog-prev').disabled=catalogPage<=1;$('catalog-next').disabled=catalogPage>=pages;
}
async function loadCatalog(){try{const response=await fetch('/api/company-catalog',{cache:'no-store'});if(!response.ok)throw Error();catalogData=await response.json();$('catalog-category').innerHTML='<option value="">全部分类</option>'+Object.keys(catalogData.counts).map(c=>`<option value="${safe(c)}">${safe(c)}</option>`).join('');$('catalog-stats').innerHTML=Object.entries(catalogData.counts).map(([c,count])=>`<div><span>${safe(c)}</span><strong>${count.toLocaleString()}</strong><small>名单条目</small></div>`).join('');$('catalog-source').textContent=`来源：${catalogData.source} · 同一企业可属于多个分类，分类条目数包含重复企业。`;renderCatalog()}catch{$('catalog-status').innerHTML='企业库读取失败，请检查本机服务。 <button id="catalog-retry" class="secondary">重新加载</button>';$('catalog-retry').onclick=loadCatalog;$('catalog-prev').disabled=true;$('catalog-next').disabled=true}}
for(const id of ['catalog-search','catalog-category'])$(id).addEventListener('input',()=>{catalogPage=1;renderCatalog()});
$('catalog-prev').onclick=()=>{catalogPage--;renderCatalog()};$('catalog-next').onclick=()=>{catalogPage++;renderCatalog()};

const demo=[{id:'demo-1',company:'示例 · 星河科技',role:'产品实习生',city:'上海',salary:'180–220 元/天',time:'2026-10-14 09:12',score:88,status:'投递成功',jd:'【虚构示例 JD】\n协助产品需求分析，整理用户反馈，参与原型设计与数据复盘。\n要求：本科及以上，每周出勤 4 天，实习 3 个月。',reason:'示例匹配依据：产品项目经历、需求分析能力与岗位相关。\n待核实：每周出勤与到岗时间。',resume:'示例简历 v1',evidence:'示例：网站显示投递成功提示',url:''},{id:'demo-2',company:'示例 · 青禾研究',role:'数据分析实习生',city:'杭州',salary:'200 元/天',time:'2026-10-14 09:18',score:81,status:'待审核',jd:'【虚构示例 JD】\n维护业务报表，使用 SQL 分析数据，协助专题研究。\n要求：熟悉 SQL 与 Excel，每周至少 3 天。',reason:'示例匹配依据：数据分析方向相关。\n待核实：SQL 熟练度，暂无真实简历分析。',resume:'示例简历 v1',evidence:'尚未提交，等待人工审核',url:''},{id:'demo-3',company:'示例 · 山岚品牌',role:'运营实习生',city:'上海',salary:'150 元/天',time:'2026-10-13 09:25',score:76,status:'失败',jd:'【虚构示例 JD】\n参与内容运营、活动策划和效果分析。',reason:'示例匹配依据：内容与项目经验相关。',resume:'示例简历 v1',evidence:'示例失败原因：登录会话过期',url:''}];
function safe(text){const el=document.createElement('span');el.textContent=text??'';return el.innerHTML}
function recordTimestamp(record){
 const value=String(record.time||'').trim();
 // Existing local timestamps use Beijing time; explicit ISO offsets are preserved.
 const local=/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;
 const timestamp=Date.parse(local.test(value)?value.replace(' ','T')+(value.length===10?'T00:00:00':'')+'+08:00':value);
 return Number.isFinite(timestamp)?timestamp:-Infinity;
}
function recordDate(record){const timestamp=recordTimestamp(record);return Number.isFinite(timestamp)?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date(timestamp)):'日期不明'}
function renderRecordGroups(records,renderRecord){
 const groups=new Map();
 for(const record of records){const date=recordDate(record);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(record)}
 return [...groups].map(([date,items])=>`<section class="record-day"><div class="record-day-heading"><h2>${safe(date)}</h2><span>${items.length} 条记录</span></div>${items.map(renderRecord).join('')}</section>`).join('');
}
function render(){const rows=$('demo').checked?demo:state.records;visible=rows.filter(r=>(!$('date-filter').value||recordDate(r)===$('date-filter').value)&&(!$('status-filter').value||r.status===$('status-filter').value)&&(`${r.company} ${r.role}`.toLowerCase().includes($('search').value.toLowerCase()))).sort((a,b)=>recordTimestamp(b)-recordTimestamp(a));$('demo-notice').textContent=$('demo').checked?'示例预览：下列岗位与数据均为虚构，不代表真实投递。':'正式记录：显示本机保存的真实投递与待审核结果。';const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());const success=rows.filter(r=>r.status==='投递成功');$('today').textContent=success.filter(r=>recordDate(r)===today).length;$('total').textContent=success.length;$('pending').textContent=rows.filter(r=>['待确认','待审核'].includes(r.status)).length;const scored=rows.filter(r=>Number.isFinite(r.score));$('average').textContent=scored.length?Math.round(scored.reduce((a,r)=>a+r.score,0)/scored.length):'—';$('record-list').innerHTML=visible.length?renderRecordGroups(visible,r=>`<div class="record"><div class="row"><div><div class="company">${safe(r.company)} · ${safe(r.companyNature||'无法判断')}</div><div class="job">${safe(r.role)}</div><div class="meta">${safe(r.city)} · ${safe(r.salary)}<br>${safe(r.time)} · 北京时间</div></div><div><div class="score">${safe(r.score)} <small>匹配分 / 100</small></div><span class="status ${r.status==='失败'?'fail':r.status==='投递成功'?'':'warn'}">${safe(r.status)}</span></div></div><details><summary>查看 JD 与投递详情</summary><h3>完整岗位 JD</h3><p>${safe(r.jd)}</p><p>简历版本：${safe(r.resume)}<br>结果凭据 / 失败原因：${safe(r.evidence)}</p>${r.url&&/^https?:\/\//.test(r.url)?`<a href="${safe(r.url)}" target="_blank" rel="noopener noreferrer">打开原始岗位 ↗</a>`:'<p>岗位链接：示例未关联真实网址</p>'}</details></div>`):'<div class="empty">暂无投递记录<br><small>接入搜索与投递脚本后，每次执行结果会显示在这里。</small></div>'}
for(const id of ['demo','date-filter','status-filter','search'])$(id).addEventListener('input',render);
$('save').onclick=async()=>{const form=$('settings');if(!form.reportValidity())return;const settings=readSettings();settings.allowUnknownSalary=form.elements.allowUnknownSalary.checked;settings.deduplicate=true;settings.resume=resumeInfo||state.settings.resume||null;try{const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});if(!response.ok)throw Error();state.settings=settings;toast('已保存到本机 · 尚未启动自动投递')}catch{toast('保存失败，请检查本机服务')}};
let connectionInfo=null,jobTimer=null,uploading=false,analysisRunning=false;
function localTime(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—'}
function resumeCard(resume){
  if(!resume){$('resume-status').innerHTML='<strong>尚未上传简历</strong><small>上传成功后，这里将显示文件名、大小、上传时间和解析状态。</small>';return}
  resumeInfo={id:resume.id,name:resume.name,uploadedAt:resume.uploadedAt};
  $('resume-status').innerHTML=`<strong>✓ 当前简历：${safe(resume.name)}</strong><small>已上传 · 已解析 · 已自动保存到本机</small><small>${resume.size?`${Math.ceil(resume.size/1024)} KB · `:''}${safe(localTime(resume.uploadedAt))} 北京时间</small><small>已读取 ${(resume.text||'').length} 字；刷新后自动恢复。</small>`;
  $('resume-text').value=resume.text||'';
  $('ai-consent').checked=false;
}
$('resume').onchange=async()=>{const file=$('resume').files[0];if(!file)return;const ext=file.name.split('.').pop().toLowerCase();if(!['pdf','docx','txt'].includes(ext)||file.size>15*1024*1024){toast('请上传 15 MB 以内的 PDF、DOCX 或 TXT');return}uploading=true;$('analyze').disabled=true;$('resume-status').innerHTML=`<strong>正在上传并解析：${safe(file.name)}</strong><small>请稍候，完成后会自动保存。</small>`;try{const response=await fetch('/api/resume',{method:'POST',headers:{'X-File-Extension':ext,'X-File-Name':encodeURIComponent(file.name)},body:file});const result=await response.json();if(!response.ok)throw Error(result.error);state.resume=result;resumeCard(result);$('preview-panel').open=true;setAnalysisStatus('简历上传并解析成功，请检查文字，勾选发送确认后点击 AI 分析。');toast('简历已保存，刷新后仍可使用')}catch(e){resumeCard(state.resume);const warning=document.createElement('small');warning.textContent='新文件上传失败：'+(e.message||'本机服务不可用')+'。原简历未替换。';$('resume-status').append(warning);setAnalysisStatus(warning.textContent)}finally{uploading=false;$('analyze').disabled=analysisRunning;$('resume').value=''}};
async function api(path,body){let response;try{response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}catch{throw Error('无法连接本机服务，请确认工作台服务正在运行')}let result;try{result=await response.json()}catch{throw Error('本机服务返回异常，请刷新后重试')}if(!response.ok)throw Error(result.error||'请求失败');return result}
function displayConnection(info){connectionInfo=info;$('ai-model').value=info.model;const label=!info.configured?'尚未配置密钥':info.status==='connected'?'✓ 已保存 · 最近一次连接测试成功':info.status==='failed'?'已保存 · 最近一次连接测试失败':'已保存 · 尚未测试连接';$('api-status').innerHTML=`<strong>${safe(label)}</strong><small>${info.configured?'密钥保存在本机钥匙串，刷新或重启后自动读取。':'填写密钥并点击“保存并测试连接”。'}</small>${info.testedAt?`<small>最近测试：${safe(localTime(info.testedAt))} 北京时间 · ${safe(info.model)}</small>`:''}${info.error?`<small class="connection-error">${safe(info.error)}</small>`:''}`;$('api-key').placeholder=info.configured?'已保存密钥；仅更换时填写新 Key':'填写 DeepSeek API Key'}
async function config(){const response=await fetch('/api/ai-config',{cache:'no-store'});if(!response.ok)throw Error('读取连接状态失败');const info=await response.json();displayConnection(info);return info}
async function saveConnection(){const result=await api('/api/ai-config',{key:$('api-key').value,model:$('ai-model').value});$('api-key').value='';displayConnection(result);if(!result.configured)throw Error('请填写 DeepSeek API Key');return result}
async function testConnection(save=false){const buttons=[$('connect'),$('test-api')];buttons.forEach(b=>b.disabled=true);try{if(save||$('api-key').value.trim())await saveConnection();$('api-status').textContent='正在连接 DeepSeek，请稍候…';const info=await api('/api/ai-test',{});displayConnection(info);toast('DeepSeek 连接成功，密钥已记住');return info}catch(e){await config().catch(()=>{});const error=document.createElement('small');error.className='connection-error';error.textContent='连接未完成：'+e.message;$('api-status').append(error);throw e}finally{buttons.forEach(b=>b.disabled=false)}}
$('connect').onclick=()=>testConnection(true).catch(e=>toast(e.message));
$('test-api').onclick=()=>testConnection().catch(e=>toast(e.message));
const fieldNames={education:'学历',graduation:'毕业年份',major:'专业',keywords:'岗位关键词',preferences:'行业 / 公司偏好'};
function prepareAnalysisPanel(){
  const panel=$('analysis');
  panel.hidden=false;
  $('filters').insertBefore(panel,document.querySelector('.columns'));
  panel.innerHTML=`<div class="analysis-heading"><div><p class="eyebrow">AI RESUME REPORT</p><h2>AI 简历分析结果</h2><p>上传并点击分析后，结果填入下方字段；你可以逐项选择是否替换原筛选条件。</p></div><span class="badge">等待分析</span></div><div class="analysis-grid"><section><h3>简历提取字段</h3><dl class="profile-fields">${['学校','学历','毕业年份','专业','核心技能','经历优势'].map(label=>`<div><dt>${label}</dt><dd>等待 AI 分析</dd></div>`).join('')}</dl></section><section><h3>岗位方向分析</h3><dl class="profile-fields">${['推荐岗位','适配程度','推荐理由','能力缺口'].map(label=>`<div><dt>${label}</dt><dd>等待 AI 分析</dd></div>`).join('')}</dl></section></div><section class="suggestions"><h3>筛选条件对比与替换</h3><div class="suggestion-table-wrap"><table class="suggestion-table"><thead><tr><th>字段</th><th>你的填写</th><th>AI 建议</th><th>是否替换</th></tr></thead><tbody>${Object.entries(fieldNames).map(([key,label])=>`<tr><td>${label}</td><td data-current-field="${key}">${safe(currentValue(key))}</td><td>等待分析</td><td><input type="checkbox" disabled aria-label="替换${label}"></td></tr>`).join('')}</tbody></table></div><small>分析成功后可勾选应用，再点击“保存筛选条件”保存。</small></section>`;
  const status=document.createElement('p');status.id='analysis-visible-status';status.className='notice';status.setAttribute('role','status');status.textContent='尚未生成分析结果。请在下方上传简历，检查文字并点击 AI 分析。';panel.before(status);
  const source=$('analysis-status');new MutationObserver(()=>{status.textContent=source.textContent||'等待分析';}).observe(source,{childList:true,subtree:true,characterData:true});
  panel.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.classList.contains('apply-keywords')||(button.id==='apply-suggestions'&&panel.querySelector('.suggestion-check:checked'))){location.hash='#filters';route();$('settings').scrollIntoView({behavior:'smooth',block:'start'})}});
  $('settings').addEventListener('input',()=>{for(const cell of panel.querySelectorAll('[data-current-field]'))cell.textContent=currentValue(cell.dataset.currentField)});
  const jump=document.createElement('button');jump.className='secondary';jump.textContent='查看 AI 分析结果 ↑';jump.style.marginTop='12px';jump.onclick=()=>panel.scrollIntoView({behavior:'smooth',block:'start'});source.after(jump);
}
function currentValue(key){const element=$('settings').elements.namedItem(key);return element?element.value||'未填写':'未填写'}
function arrangeWorkspaceLayout(){
  const page=$('filters'),oldColumns=page.querySelector('.columns');
  const resume=page.querySelector('.resume-card'),filters=$('settings').closest('article');
  const summary=page.querySelector('.summary');
  const heading=document.createElement('div');heading.className='workspace-top-heading';
  for(const element of [...resume.children].slice(0,3))heading.append(element);
  heading.querySelector('h2').textContent='API 连接、上传简历与 AI 分析';
  heading.querySelector('p:not(.eyebrow)').textContent='先连接 DeepSeek、上传简历并分析，再对照下方筛选条件选择采纳建议。';
  const topGrid=document.createElement('div');topGrid.className='workspace-top-grid';
  const apiPanel=resume.querySelector('.api-panel'),uploadFlow=document.createElement('div');uploadFlow.className='upload-flow';
  topGrid.append(apiPanel,uploadFlow);
  for(const element of [...resume.children])uploadFlow.append(element);
  resume.append(heading,topGrid);resume.classList.add('workspace-top');
  $('ai').append(resume,$('analysis-visible-status'),$('analysis'));
  oldColumns.before(filters);oldColumns.remove();
  if(summary){summary.classList.add('workspace-summary');page.append(summary)}
  $('analysis-visible-status').textContent='尚未生成分析结果。请在上方上传简历并点击 AI 分析。';
  const jump=uploadFlow.querySelector('button.secondary:not(#test-api)');if(jump&&jump.textContent.includes('查看 AI'))jump.textContent='查看下方 AI 分析结果 ↓';
  heading.querySelector('p:not(.eyebrow)').textContent='上传并分析简历后，返回“岗位筛选”，通过字段旁的“AI 分析导入”选择采纳建议。';
  const notice=page.querySelector('.notice');notice.innerHTML='保留手动填写，点击各字段旁的“AI 分析导入”查看建议并选择替换。 <a href="#ai">前往 AI 分析 ↗</a>';
  addFieldImports();
}
function addFieldImports(){
  for(const element of $('settings').querySelectorAll('input:not([type=checkbox]):not([data-manual]),select:not([data-manual])')){
    const label=element.closest('label');if(!label)continue;
    const button=document.createElement('button');button.type='button';button.className='field-ai-import';button.textContent='✦ AI 分析导入';button.onclick=event=>{event.preventDefault();openFieldImport(element)};label.append(button);
  }
  const dialog=document.createElement('dialog');dialog.id='field-import-dialog';dialog.className='field-import-dialog';document.body.append(dialog);
}
function openFieldImport(element){
  const result=state.analysis,dialog=$('field-import-dialog');
  const label=element.closest('label').childNodes[0].textContent.trim();
  const suggestion=result?.filterSuggestions?.[element.name];
  let value=suggestion?.value;
  if(!value&&['education','graduation','major'].includes(element.name))value=result?.profile?.[element.name];
  if(value==='未识别')value='';
  const valid=value&&!(element.tagName==='SELECT'&&![...element.options].some(option=>option.value===value));
  dialog.innerHTML=`<h2>${safe(label)} · AI 分析导入</h2><p class="meta">来源：${safe(result?.resumeName||'尚无成功的简历分析')}</p><div class="import-compare"><div><small>当前填写</small><p>${safe(element.value||'未填写')}</p></div><div><small>AI 分析建议</small><p>${safe(valid?value:'暂无可导入建议')}</p></div></div><p>${safe(valid?(suggestion?.reason||'从简历教育信息中提取，请核实后采纳。'):'该字段需要你的个人选择，或当前分析未提供足够依据。你可以继续手动填写，也可以前往 AI 分析重新分析简历。')}</p><div class="api-actions"><button type="button" id="confirm-field-import" ${valid?'':'disabled'}>替换到编辑区</button><button type="button" class="secondary" id="go-ai-page">前往 AI 分析</button><button type="button" class="secondary" id="cancel-field-import">取消</button></div><small>替换后仍需点击“保存筛选条件”才会保存。</small>`;
  $('cancel-field-import').onclick=()=>dialog.close();$('go-ai-page').onclick=()=>{dialog.close();location.hash='#ai';route();window.scrollTo({top:0,behavior:'smooth'})};
  $('confirm-field-import').onclick=()=>{if(!valid)return;element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));dialog.close();toast('已导入到编辑区，请检查并保存筛选条件')};
  dialog.showModal();
}
function applySuggestion(key,value){const element=$('settings').elements.namedItem(key);if(!element)return false;element.value=value;return true}
function showAnalysis(result,focus=false){const profile=result.profile||{education:'未识别',graduation:'未识别',major:'未识别',school:'未识别'};const suggestions=result.filterSuggestions||{};const suggestionRows=Object.entries(suggestions).filter(([key])=>fieldNames[key]).map(([key,s])=>`<label class="suggestion-row"><input type="checkbox" class="suggestion-check" data-key="${safe(key)}"><span><b>${safe(fieldNames[key])}</b><small>当前：${safe(currentValue(key))}</small></span><span class="suggestion-value">${safe(s.value)}<small>${safe(s.confidence)}可信度 · ${safe(s.reason)}</small></span></label>`).join('');$('analysis').hidden=false;$('analysis').innerHTML=`<div class="analysis-heading"><div><p class="eyebrow">AI RESUME REPORT</p><h2>简历分析结果</h2><p>分析不会自动修改你的筛选条件。勾选建议后应用到左侧编辑区，再由你决定是否保存。</p></div><span class="badge">${safe(result.model||'DeepSeek')} · ${safe(new Date(result.analyzedAt||Date.now()).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}</span></div><div class="analysis-grid"><section><h3>简历提取字段</h3><dl class="profile-fields"><div><dt>学校</dt><dd>${safe(profile.school)}</dd></div><div><dt>学历</dt><dd>${safe(profile.education)}</dd></div><div><dt>毕业年份</dt><dd>${safe(profile.graduation)}</dd></div><div><dt>专业</dt><dd>${safe(profile.major)}</dd></div></dl><h3>核心技能</h3><p>${safe((result.skills||[]).join('、')||'未识别')}</p></section><section><h3>分析概览</h3><p>${safe(result.summary||'暂无概览')}</p><h3>条件与待确认项</h3><ul>${[...(result.constraints||[]),...(result.questions||[])].map(x=>`<li>${safe(x)}</li>`).join('')||'<li>暂无</li>'}</ul></section></div><section class="suggestions"><div class="section-heading"><div><h3>筛选条件建议</h3><p>只提供能从简历判断的学历、毕业年份、专业、关键词和行业偏好；城市、日薪、出勤等由你自己决定。</p></div>${suggestionRows?'<button id="apply-suggestions" class="secondary">应用所选建议到编辑区</button>':''}</div>${suggestionRows?`<div class="suggestion-list">${suggestionRows}</div>`:'<p class="empty-inline">简历信息不足以建议替换筛选条件；现有填写保持不变。</p>'}</section><section><h3>推荐岗位方向</h3><div class="recommendations">${(result.recommendations||[]).map((r,i)=>`<div class="recommendation"><h3>${safe(r.role)} <span class="badge">${safe(r.fit)}</span></h3><p>${safe(r.reason)}</p><h4>简历证据</h4><ul>${(r.evidence||[]).map(x=>`<li>${safe(x)}</li>`).join('')}</ul><h4>能力缺口</h4><ul>${(r.gaps||[]).map(x=>`<li>${safe(x)}</li>`).join('')}</ul><small>搜索词：${safe((r.keywords||[]).join('、'))}</small><button class="secondary apply-keywords" data-index="${i}">将这些搜索词加入编辑区</button></div>`).join('')}</div></section>`;const apply=$('apply-suggestions');if(apply)apply.onclick=()=>{const checked=[...document.querySelectorAll('.suggestion-check:checked')];if(!checked.length){toast('请先勾选至少一项建议');return}const changed=checked.filter(item=>applySuggestion(item.dataset.key,suggestions[item.dataset.key].value)).length;toast(`已将 ${changed} 项建议写入编辑区；点击“保存筛选条件”后才会正式保存`);$('settings').scrollIntoView({behavior:'smooth',block:'start'})};for(const button of document.querySelectorAll('.apply-keywords'))button.onclick=()=>{const input=$('settings').elements.keywords;const words=[...input.value.split(/[,，、]/),...(result.recommendations[Number(button.dataset.index)].keywords||[])];input.value=[...new Set(words.map(x=>x.trim()).filter(Boolean))].join('、');toast('已将搜索词加入编辑区；保存后生效');$('settings').scrollIntoView({behavior:'smooth',block:'start'})};if(focus)requestAnimationFrame(()=>$('analysis').scrollIntoView({behavior:'smooth',block:'start'}))}
function setAnalysisStatus(message){$('analysis-status').textContent=message;const visible=$('analysis-visible-status');if(visible)visible.textContent=message}
function analysisBusy(value){analysisRunning=value;$('analyze').disabled=value||uploading;$('analyze').textContent=value?'DeepSeek 正在分析…':'✦ AI 分析适合的岗位';$('resume').disabled=value}
async function pollAnalysis(){
  clearTimeout(jobTimer);
  try{const response=await fetch('/api/analysis-job',{cache:'no-store'});if(!response.ok)throw Error('读取分析进度失败');const result=await response.json();const job=result.job;if(!job){analysisBusy(false);return}
    if(job.status==='running'){analysisBusy(true);setAnalysisStatus(`正在分析：${job.resumeName||'当前简历'} · 开始于 ${localTime(job.startedAt)}。可刷新页面，任务继续运行。`);jobTimer=setTimeout(pollAnalysis,2000);return}
    analysisBusy(false);
    if(job.status==='completed'&&result.analysis){state.analysis=result.analysis;showAnalysis(result.analysis,true);setAnalysisStatus(`✓ 分析完成：${job.resumeName||'当前简历'} · ${localTime(job.finishedAt)}，结果已自动保存。`);await config().catch(()=>{})}
    else if(job.status==='failed'){setAnalysisStatus(`分析失败：${job.error||'请重新分析'}。请检查连接状态后重试。`);$('analysis-visible-status').scrollIntoView({behavior:'smooth',block:'start'})}
  }catch(e){analysisBusy(false);setAnalysisStatus('暂时无法读取分析进度：'+e.message+'。正在重新连接…');jobTimer=setTimeout(pollAnalysis,5000)}
}
$('analyze').onclick=async()=>{
  if(uploading||analysisRunning)return;
  const text=currentAIResumeText();
  if(text.length<20){$('preview-panel').open=true;setAnalysisStatus('尚无可分析的简历文字，请先上传简历或粘贴至少 20 字。');toast('请先上传简历或粘贴文字');return}
  if(!$('ai-consent').checked){setAnalysisStatus('请在 AI 分析按钮上方勾选“允许发送简历文字和筛选条件给 DeepSeek”，然后再次点击分析。');$('ai-consent').focus();toast('请勾选按钮上方的发送确认');return}
  if(!$('settings').reportValidity())return;
  analysisBusy(true);setAnalysisStatus('正在读取已保存的密钥并提交分析任务…');
  try{await ensureAIConnection();
    const settings=readSettings();settings.allowUnknownSalary=$('settings').elements.allowUnknownSalary.checked;
    await api('/api/analyze',{text,settings,consent:true});await pollAnalysis();
  }catch(e){analysisBusy(false);setAnalysisStatus('分析未开始：'+e.message);toast(e.message)}
};
$('resume-text').addEventListener('input',()=>{$('ai-consent').checked=false});
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({isDemo:$('demo').checked,records:visible},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=$('demo').checked?'示例投递记录.json':'投递记录.json';a.click();URL.revokeObjectURL(url)};
// All AI features share the same saved resume and the server's Keychain key.
function currentAIResumeText(){return $('resume-text').value.trim()||(state.resume?.text||'').trim()}
async function ensureAIConnection(){if($('api-key').value.trim())return testConnection(true);const info=await config();if(!info.configured)throw Error('尚未保存 API Key，请在上方连接区配置一次');return info}
let coreGenerating=false;
function prepareCoreCapability(){
 const card=document.createElement('article');card.id='core-capability';
 card.innerHTML=`<div class="section-heading"><div><p class="eyebrow">CORE CAPABILITIES</p><h2>核心能力分析</h2><p>输入或粘贴岗位 JD，结合已保存的简历，提炼适合这个岗位的核心能力。</p></div><span class="badge">可编辑 · 一键复制</span></div><div class="jd-input-panel"><label for="target-jd-text">岗位 JD</label><p id="jd-file-status" role="status">把你看到的岗位职责和任职要求写在下面，AI 将结合已保存的简历生成核心能力总结。</p><textarea id="target-jd-text" rows="7" maxlength="30000" placeholder="粘贴目标岗位的职位名称、岗位职责和任职要求…"></textarea><label for="core-traits">性格与沟通风格（选填，仅写你确认符合自己的特点）</label><input id="core-traits" maxlength="300" placeholder="例如：开朗健谈、喜欢与人沟通；不填则只依据简历描述沟通能力"></div><section class="keyword-panel"><div class="section-heading"><div><h3>关键词分析</h3><p>分别提取岗位需要什么、你能做什么。只看任务、技能、工具、证书和语言能力。</p></div><button id="analyze-keywords" type="button" class="secondary">分析 JD 与简历关键词</button></div><p id="keyword-status" role="status">复用当前 JD 和已保存简历；排除薪资、实习天数、企业性质和福利等信息。</p><div class="keyword-columns"><div><h4>JD 要求的能力关键词</h4><div id="jd-keywords">尚未分析</div></div><div><h4>简历已有的能力关键词</h4><div id="resume-keywords">尚未分析</div></div></div></section><section id="core-matches" hidden><h3>岗位要求与我的能力</h3><p>先分析 JD，再核对简历；“可迁移”不等于已经具备同岗经验。</p><div id="core-match-list"></div></section><label for="core-text">面向该岗位的核心能力介绍</label><textarea id="core-text" rows="9" maxlength="1000" placeholder="生成后显示分点总结：每点突出岗位关键词，并结合你的真实能力。可编辑后复制。"></textarea><div class="core-meta"><span id="core-count">0 字</span><span id="core-origin">尚未生成</span></div><label class="check"><input id="core-consent" type="checkbox">同意将岗位 JD 和当前简历文字发送给 DeepSeek，用于关键词分析和核心能力介绍</label><div class="api-actions"><button id="generate-core" type="button">✦ 生成核心能力</button><button id="copy-core" type="button" class="secondary" disabled>复制核心能力</button></div><p id="core-status" role="status">自动使用本页已保存的 API Key 与同一份简历，无需重新上传。生成会产生 DeepSeek API 使用费用。</p><details id="core-evidence" hidden><summary>查看简历依据</summary><ul id="core-evidence-list"></ul></details>`;
 $('ai').querySelector('.resume-card').after(card);
 card.querySelector('.keyword-panel').before($('core-consent').closest('label'));
 $('core-text').addEventListener('input',()=>{updateCoreControls();$('core-origin').textContent='手动修改 · 本次修改尚未保存';$('core-evidence').hidden=true});
 $('resume-text').addEventListener('input',invalidateCoreSource);$('resume').addEventListener('change',invalidateCoreSource);
 $('core-traits').addEventListener('input',()=>{$('core-consent').checked=false;$('core-status').textContent='个人特点已修改，重新生成后生效。'});
 $('target-jd-text').addEventListener('input',()=>{$('core-consent').checked=false;$('jd-file-status').textContent='JD已修改，点击生成时自动保存；请重新生成该岗位的介绍。';$('keyword-status').textContent='JD已变更，当前显示的是上次关键词结果，请重新分析。';$('core-matches').hidden=true;if($('core-text').value)$('core-status').textContent='JD已变更，下方为之前的结果，尚未针对新JD生成。'});
 $('analyze-keywords').onclick=generateKeywords;
 $('generate-core').onclick=generateCore;
 $('copy-core').onclick=async()=>{const text=$('core-text').value.trim();if(!text)return;try{await navigator.clipboard.writeText(text);$('core-status').textContent='✓ 核心能力已复制，可直接粘贴给 HR。';toast('核心能力已复制')}catch{$('core-text').focus();$('core-text').select();$('core-status').textContent='浏览器未允许复制，已选中文字，请按 ⌘C 或 Ctrl+C 复制。'}};
}
let keywordRunning=false;
function showKeywordAnalysis(result){if(!result)return;for(const [id,key] of [['jd-keywords','jdKeywords'],['resume-keywords','resumeKeywords']])$(id).innerHTML=(result[key]||[]).length?(result[key]||[]).map(v=>`<details class="keyword-item"><summary>${safe(v.keyword)} <small>${safe(v.category)}</small></summary><p>原文依据：${safe(v.evidence)}</p></details>`).join(''):'<p>没有提取到有原文依据的能力关键词。</p>';$('keyword-status').textContent=`${result.model} · ${result.promptVersion} · ${localTime(result.generatedAt)} · 点击关键词查看原文依据`;checkKeywordSource(result)}
async function checkKeywordSource(result){const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');if(await hash(currentAIResumeText())!==result.resumeHash||await hash($('target-jd-text').value.trim())!==result.jdHash)$('keyword-status').textContent='JD或简历与该结果的来源不同，显示的是上次分析，请重新分析。'}
async function generateKeywords(){
 if(keywordRunning||uploading)return;
 const text=currentAIResumeText(),jd=$('target-jd-text').value.trim();
 if(jd.length<20||text.length<20){$('keyword-status').textContent='请填写至少20字的JD，并确认上方有已保存的简历。';return}
 if(!$('core-consent').checked){$('keyword-status').textContent='请勾选本卡片下方的JD和简历发送确认。';$('core-consent').focus();return}
 keywordRunning=true;$('analyze-keywords').disabled=true;$('keyword-status').textContent='正在分别调用DeepSeek提取JD关键词和简历关键词…';
 try{await ensureAIConnection();const result=await api('/api/keywords',{text,jd,consent:true});state.keywordAnalysis=result;showKeywordAnalysis(result)}catch(e){$('keyword-status').textContent='关键词分析失败：'+e.message+'。上次结果保留。'}finally{keywordRunning=false;$('analyze-keywords').disabled=false}
}
function restoreTargetJD(){if(state.targetJD){$('target-jd-text').value=state.targetJD.text||'';$('jd-file-status').textContent=`已恢复岗位JD：${state.targetJD.name||'粘贴的岗位JD'}`}}
function invalidateCoreSource(){if($('keyword-status'))$('keyword-status').textContent='简历已变更，当前显示的是上次关键词结果，请重新分析。'; $('core-consent').checked=false;$('keyword-status').textContent='JD已变更，当前显示的是上次关键词结果，请重新分析。';$('core-matches').hidden=true;if($('core-text').value)$('core-status').textContent='简历内容已变更；下方保留之前的介绍，请核对后重新生成。'}
function updateCoreControls(){$('core-count').textContent=`${$('core-text').value.length} 字`;$('copy-core').disabled=!$('core-text').value.trim()}
function renderCoreMatches(matches){$('core-matches').hidden=!matches?.length;$('core-match-list').innerHTML=(matches||[]).map(row=>`<div class="core-match-row"><div><b>${safe(row.requirement)}</b><span class="badge">${safe(row.priority)} · ${safe(row.status)}</span></div><p><strong>JD要求：</strong>${safe(row.jdEvidence)}</p><p><strong>简历依据：</strong>${safe(row.resumeEvidence.join('；')||'简历未体现')}</p><p>${safe(row.explanation)}</p></div>`).join('')}
function showCoreCapability(result){if(!result?.text)return;$('core-text').value=result.text;$('core-traits').value=result.selfTraits||'';renderCoreMatches(result.matches);$('core-origin').textContent=`${result.model||'DeepSeek'} · ${result.promptVersion||'旧版提示词'} · ${localTime(result.generatedAt)}`;$('core-evidence-list').innerHTML=(result.evidence||[]).map(v=>`<li>${safe(v)}</li>`).join('');$('core-evidence').hidden=!(result.evidence||[]).length;updateCoreControls();$('generate-core').textContent='✦ 重新生成核心能力';$('core-status').textContent=result.evidenceWarning||'已恢复本机保存的生成结果；可编辑后复制，手动修改仅保留在本次页面。'}
async function generateCore(){
 if(coreGenerating||uploading)return;
 const text=currentAIResumeText(),jd=$('target-jd-text').value.trim();
 if(jd.length<20){$('core-status').textContent='请先输入或粘贴至少20字的岗位JD。';$('target-jd-text').focus();return}
 if(text.length<20){$('core-status').textContent='请先在上方上传简历或粘贴至少20字的简历文字。';return}
 if(!$('core-consent').checked){$('core-status').textContent='请先勾选本卡片中的发送确认，再生成核心能力。';$('core-consent').focus();return}
 coreGenerating=true;$('generate-core').disabled=true;$('generate-core').textContent='正在提炼核心能力…';$('core-status').textContent='正在拆解JD要求、核对简历依据，再据此生成介绍（两步分析），请稍候…';
 try{await ensureAIConnection();
 const result=await api('/api/core-capability',{text,jd,selfTraits:$('core-traits').value.trim(),consent:true});state.coreCapability=result;showCoreCapability(result);
 $('core-status').textContent=currentAIResumeText()===text&&$('target-jd-text').value.trim()===jd?(result.evidenceWarning||'✓ 已生成并保存到本机。请核对表述，再一键复制给 HR。'):'已保存生成结果，但简历或JD在生成期间已变化，请核对后重新生成。';
 }catch(e){$('core-status').textContent='生成失败：'+e.message+'。原有内容保留。'}finally{coreGenerating=false;$('generate-core').disabled=false;$('generate-core').textContent=$('core-text').value?'✦ 重新生成核心能力':'✦ 生成核心能力'}
}
async function init(){
  prepareAnalysisPanel();
  $('connect').textContent='保存并测试连接';
  document.querySelector('.api-panel>small').textContent='密钥保存到本机 macOS 钥匙串；刷新与服务重启后自动读取，页面不显示完整密钥。';
  $('api-status').classList.add('connection-card');$('resume-status').classList.add('file-status-card');
  const consent=$('ai-consent').closest('label');$('analyze').before(consent);$('analyze').before($('analysis-status'));
  arrangeWorkspaceLayout();
  prepareCoreCapability();
  try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw Error();state=await response.json();for(const [key,value] of Object.entries(state.settings)){const el=$('settings').elements.namedItem(key);if(el){if(companyMultiFields.includes(key)){for(const checkbox of $('settings').querySelectorAll(`input[name="${key}"]`))checkbox.checked=Array.isArray(value)&&value.includes(checkbox.value)}else if(el.type==='checkbox')el.checked=!!value;else el.value=value}}for(const cell of $('analysis').querySelectorAll('[data-current-field]'))cell.textContent=currentValue(cell.dataset.currentField);resumeCard(state.resume);restoreTargetJD();showKeywordAnalysis(state.keywordAnalysis);showCoreCapability(state.coreCapability);if(state.coreCapability&&!state.coreCapability.jdHash)$('core-status').textContent='下方保留之前的通用介绍；请提供岗位JD，重新生成针对岗位的版本。';if(state.analysis){showAnalysis(state.analysis);setAnalysisStatus(`已恢复最近一次分析：${state.analysis.resumeName||'之前的简历'} · ${localTime(state.analysis.analyzedAt)}`)}if(state.analysisJob&&['running','failed'].includes(state.analysisJob.status))await pollAnalysis();}catch{setAnalysisStatus('读取本机数据失败，请检查服务后刷新');toast('读取本机设置失败')}render();try{await config()}catch(e){$('api-status').textContent=e.message}
}init();loadCatalog();

// 只同步投递记录，不覆盖用户正在编辑的筛选条件或简历。
const recordSync = createRecordSync({
  active:()=>!document.hidden && !$('records').hidden,
  load:async()=>{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw Error('记录同步失败');return (await response.json()).records||[]},
  current:()=>state.records||[],
  update:records=>{state.records=records;render()}
});
setInterval(()=>recordSync(),8000);
window.addEventListener('focus',()=>recordSync());
window.addEventListener('hashchange',()=>recordSync());
document.addEventListener('visibilitychange',()=>recordSync());
