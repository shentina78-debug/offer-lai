/* 仅前程无忧。所有页面读取/动作经调用者传入的CUA Tab；不抓取网站API。 */
'use strict';
const crypto = require('node:crypto');
const profileDefault = require('../submission_profile.json');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function detailId(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'jobs.51job.com' || u.username || u.password || u.port || u.hash)
    throw Error('不是前程无忧岗位页面');
  const m = /^\/[a-z0-9-]+\/([1-9]\d{0,11})\.html$/.exec(u.pathname);
  if (!m) throw Error('不是岗位详情URL');
  return m[1];
}
function receiptId(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'jobs.51job.com' || u.pathname !== '/applysuccess.php'
      || u.username || u.password || u.port || u.hash || u.searchParams.getAll('jobid').length !== 1) return null;
  const id = u.searchParams.get('jobid');
  return /^[1-9]\d{0,11}$/.test(id || '') ? id : null;
}

/* 此函数只在CUA的read-only evaluate内读取当前渲染DOM。
   路径来自本次观察的元素，未写死未经核实的站点CSS类或坐标；不读取Vue/React内部对象。 */
function inspectDocument(p) {
  const text = el => (el?.innerText || el?.textContent || '').trim();
  const visible = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const nodes = Array.from(document.querySelectorAll('*')).filter(visible);
  const leaves = nodes.filter(el => text(el) && !Array.from(el.children).some(c => text(c) === text(el)));
  const exact = (value, scope = document) => leaves.filter(el => scope.contains(el) && text(el) === value);
  const orange = color => {
    const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
    return !!rgb && +rgb[1] > 200 && +rgb[2] >= 40 && +rgb[2] < 190 && +rgb[3] < 110;
  };
  const path = el => {
    if (!el) return null;
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const index = n.parentElement ? Array.from(n.parentElement.children).indexOf(n) + 1 : 1;
      parts.unshift(n.tagName.toLowerCase() + ':nth-child(' + index + ')');
    }
    return parts.join(' > ');
  };
  const selected = el => {
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true') return true;
    if (el.matches('input') && el.checked) return true;
    if (orange(getComputedStyle(el).color)) return true;
    const scopes = [el];
    for (let n = el.parentElement; n && scopes.length < 4 && text(n) === text(el); n = n.parentElement) scopes.push(n);
    return scopes.some(scope => [scope,...scope.children].some(c => {
      const r = c.getBoundingClientRect(), style = getComputedStyle(c);
      if (parseFloat(style.borderBottomWidth) >= 2 && orange(style.borderBottomColor)) return true;
      if (r.height >= 2 && r.height <= 8 && r.width >= 8 && orange(style.backgroundColor)) return true;
      return ['::before','::after'].some(pseudo => {
        const s = getComputedStyle(c,pseudo);
        return s.content !== 'none' && parseFloat(s.height) >= 2 && parseFloat(s.height) <= 8
          && parseFloat(s.width) >= 8 && orange(s.backgroundColor);
      });
    }));
  };
  const control = el => el && ({selector: path(el), text: text(el), selected: selected(el)});
  const unique = xs => xs.length === 1 ? control(xs[0]) : null;
  const bodyText = document.body.innerText, url = document.URL;
  const out = {platform: '51job', observedUrl: url, title: document.title, kind: 'unknown',
    loading: /(?:^|\n)\s*Loading\.\.\.\s*(?:\n|$)/i.test(bodyText)};
  const u = new URL(url);
  if (u.hostname === 'jobs.51job.com' && u.pathname === '/applysuccess.php') {
    out.kind = 'receipt';
    out.receiptText = bodyText.split('\n').map(s => s.trim()).find(s => s.startsWith(p.successText)) || '';
    return out;
  }
  const isSearch = u.hostname === 'we.51job.com' && u.pathname === '/pc/search';
  if (isSearch) {
    out.kind = 'listing'; out.candidates = [];
    const anchors = Array.from(document.querySelectorAll('a[href]')).filter(visible);
    const companyLinks = anchors.filter(a => /^https:\/\/jobs\.51job\.com\/all\/co[^/]+\.html/.test(a.href));
    const cards = [];
    for (const company of companyLinks) {
      let card = company.parentElement, role = null;
      for (let depth = 0; card && depth < 7; depth++, card = card.parentElement) {
        const companyCount = companyLinks.filter(a => card.contains(a)).length;
        if (companyCount > 1) break;
        const cr = company.getBoundingClientRect();
        const titles = leaves.filter(n => card.contains(n) && !company.contains(n) && text(n).length < 160
          && ![p.campusLabel, p.internshipLabel, '投递', '去聊聊'].includes(text(n))
          && !/^[\d\s.,元天/千万元·-]+$/.test(text(n))
          && n.getBoundingClientRect().left < cr.left - 30
          && Math.abs(n.getBoundingClientRect().top - cr.top) < 45);
        titles.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || text(a).length - text(b).length);
        if (titles.length && card.getBoundingClientRect().width > 400) { role = titles[0]; break; }
      }
      if (!role || cards.includes(card)) continue;
      cards.push(card);
      const rr = role.getBoundingClientRect(), cr = company.getBoundingClientRect();
      const near = nodes.filter(n => card.contains(n) && n !== role && !n.contains(role)
        && n.getBoundingClientRect().left >= rr.left && n.getBoundingClientRect().left < Math.min(cr.left - 20, rr.right + 160)
        && Math.abs(n.getBoundingClientRect().top - rr.top) < 35);
      const labels = near.flatMap(n => [text(n), n.getAttribute('alt'), n.getAttribute('title'), n.getAttribute('aria-label')])
        .filter(t => t === p.campusLabel || t === p.internshipLabel);
      const opaque = near.some(n => {
        const r = n.getBoundingClientRect(), s = getComputedStyle(n);
        return r.width < 100 && r.height < 50 && (n.matches('img,svg') || s.backgroundImage !== 'none'
          || /[\uE000-\uF8FF]/.test(text(n)))
          && ![p.campusLabel, p.internshipLabel].includes(n.getAttribute('alt'))
          && ![p.campusLabel, p.internshipLabel].includes(n.getAttribute('title'));
      });
      const allLinks = anchors.filter(a => card.contains(a));
      const jobLinks = allLinks.filter(a => /^https:\/\/jobs\.51job\.com\/[a-z0-9-]+\/[1-9]\d*\.html(?:[?#]|$)/.test(a.href));
      const content = text(card);
      const salary = /\d+(?:\.\d+)?(?:[-–~至]\d+(?:\.\d+)?)?元\/天/.exec(content)?.[0];
      out.candidates.push({role: text(role), company: text(company), url: jobLinks.length === 1 ? jobLinks[0].href : null,
        salary, labels: [...new Set(labels)], campus: labels.includes(p.campusLabel) ? true : opaque ? null : false,
        labelsVerified: !opaque || labels.includes(p.campusLabel), roleSelector: path(role), cardSelector: path(card),
        labelEvidence: {labels: [...new Set(labels)], opaqueMarker: opaque}, text: content});
    }
    const outsideCards = el => !cards.some(card => card.contains(el));
    const available = value => exact(value).filter(outsideCards);
    const inputs = Array.from(document.querySelectorAll('input')).filter(n => visible(n) && n.placeholder === p.searchPlaceholder);
    if (inputs.length === 1) {
      out.searchInput = {...control(inputs[0]), value: inputs[0].value};
      let parent = inputs[0].parentElement;
      for (let n = 0; parent && n < 5; n++, parent = parent.parentElement) {
        const buttons = exact('搜索', parent).filter(outsideCards);
        if (buttons.length === 1) { out.searchButton = control(buttons[0]); break; }
      }
    }
    out.cityOptions = {};
    for (const city of ['北京', '上海', '广州', '深圳', '武汉', '西安', '杭州', '南京', '成都', '重庆', '东莞']) {
      const xs = available(city); if (xs.length === 1) out.cityOptions[city] = control(xs[0]);
    }
    out.cityPicker = unique(leaves.filter(n => outsideCards(n) && /^(?:全国|上海|北京|广州|深圳)$/.test(text(n))));
    out.workType = unique(leaves.filter(n => outsideCards(n) && /^工作类型(?:\s*·\s*1)?$/.test(text(n))));
    if (out.workType) {
      const n = document.querySelector(out.workType.selector);
      for (let parent = n.parentElement, count = 0; parent && count < 3; parent = parent.parentElement,count++) {
        const value = text(parent).replace(/\s+/g,'');
        if (/^工作类型·1$/.test(value)) {out.workType.text = '工作类型 ·1'; break;}
        if (value.length > 15) break;
      }
    }
    out.internOption = unique(available(p.internshipLabel));
    out.latest = unique(available(p.sortText));
    out.empty = /暂无(?:相关)?职位|未找到相关职位/.test(bodyText);
    return out;
  }
  if (u.hostname === 'www.51job.com' || u.hostname === '51job.com') {
    out.kind = 'home';
    out.searchNav = unique(exact('搜索').filter(n => n.closest('a')?.getAttribute('href')?.includes('/pc/search')));
    return out;
  }
  if (u.hostname !== 'jobs.51job.com' || !/^\/[a-z0-9-]+\/[1-9]\d*\.html$/.test(u.pathname)) return out;
  out.kind = 'detail'; out.jobId = u.pathname.match(/\/(\d+)\.html$/)[1];
  out.role = text(document.querySelector('h1'));
  const roleStart = bodyText.indexOf(out.role), jdStart = bodyText.indexOf('职位描述', roleStart);
  const jdEnd = bodyText.indexOf('工作地址', jdStart + 4);
  const intro = bodyText.slice(roleStart + out.role.length, jdStart);
  const rawSalary = intro.split('\n').map(s => s.trim()).find(s => /^\d/.test(s) || /无薪|不提供薪资/.test(s));
  out.salary = /\d+(?:\.\d+)?(?:\s*[-–~至]\s*\d+(?:\.\d+)?)?\s*元\/天/.exec(intro)?.[0]
    || /\d+(?:\.\d+)?(?:\s*[-–~至]\s*\d+(?:\.\d+)?)?\s*(?:千|万|元\/月|元\/年)[^\n]*/.exec(intro)?.[0]
    || (/面议/.test(intro) ? '面议' : rawSalary || '未公开');
  out.city = /(?:^|\s)(上海|北京|广州|深圳|武汉|西安|杭州|南京|成都|重庆|东莞)(?:[-·\s]|$)/.exec(intro)?.[1];
  out.jd = jdStart >= 0 && jdEnd > jdStart ? bodyText.slice(jdStart + 4, jdEnd).trim() : '';
  out.jdComplete = !!out.jd && jdEnd > jdStart && !exact('展开职位描述').length && !exact('展开全部').length;
  const companies = Array.from(document.querySelectorAll('a[href]')).filter(a => visible(a)
    && /^https:\/\/jobs\.51job\.com\/all\/co[^/]+\.html/.test(a.href) && !/查看所有职位/.test(text(a)));
  out.company = companies.length === 1 ? text(companies[0]) : '';
  out.apply = unique(exact(p.applyText));
  const delivered = exact(p.deliveredText).length > 0;
  const expired = /(?:职位已下线|该职位已停止招聘|职位已过期)/.test(bodyText);
  out.delivered = delivered ? true : out.apply ? false : null;
  out.expired = expired ? true : out.apply || delivered ? false : null;
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog')).filter(visible);
  out.dialogCount = dialogs.length;
  if (dialogs.length === 1) {
    const dialog = dialogs[0];
    out.dialogTitle = exact(p.dialogTitle, dialog).length === 1 ? p.dialogTitle : '';
    const sends = exact(p.sendText, dialog);
    out.send = unique(sends); out.sendCount = sends.length;
    out.extraInputs = Array.from(dialog.querySelectorAll('input,textarea,select')).filter(n => visible(n)
      && !n.matches('input[type="radio"],input[type="checkbox"],input[type="hidden"]')).length;
    const nativeChoices = dialog.querySelectorAll('input[type="radio"],input[type="checkbox"]');
    if (nativeChoices.length && nativeChoices.length !== 3) out.extraInputs++;
    out.attachments = [];
    for (const name of ['实习应聘 简历', '简历', p.attachment]) {
      const choices = exact(name, dialog); if (choices.length !== 1) continue;
      let row = choices[0];
      while (row.parentElement && row.parentElement !== dialog && text(row.parentElement) === name) row = row.parentElement;
      const radio = row.querySelector('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]');
      let isSelected = radio ? radio.checked === true || radio.getAttribute('aria-checked') === 'true' : null;
      let marker = radio;
      if (!radio) {
        const circles = [row, ...row.querySelectorAll('*')].filter(n => {
          const r = n.getBoundingClientRect(), s = getComputedStyle(n);
          return visible(n) && r.width >= 6 && r.width <= 35 && Math.abs(r.width - r.height) < 3
            && (s.borderRadius.includes('%') || parseFloat(s.borderRadius) >= r.width / 2 - 1);
        });
        if (circles.length) {
          marker = circles[0];
          isSelected = circles.some(n => ['','::before','::after'].some(pseudo =>
            orange(getComputedStyle(n, pseudo || null).backgroundColor)));
        }
      }
      out.attachments.push({name, selected: isSelected, selector: path(marker || choices[0])});
    }
  }
  return out;
}

function createDomIO(tab, profile = profileDefault) {
  return {
    read: () => tab.playwright.evaluate(inspectDocument, profile, {timeoutMs: 6000}),
    click: selector => tab.playwright.locator(selector).click({timeoutMs: 6000}),
    fill: (selector, value) => tab.playwright.locator(selector).fill(value, {timeoutMs: 6000}),
    navigate: url => tab.goto(url),
  };
}

function create51jobFlow(tab, options = {}) {
  const p = options.profile || profileDefault, io = options.io || createDomIO(tab, p);
  const prepared = new Map(), clicked = new Set(), transitions = new Map(), reviews = new Map();
  let lastListing;
  const read = async () => {
    const s = await io.read();
    if (s.platform !== '51job') throw Error('网页观察平台不一致');
    const u = new URL(s.observedUrl);
    if (!['jobs.51job.com','we.51job.com','www.51job.com','51job.com'].includes(u.hostname) || u.protocol !== 'https:')
      throw Error('已离开前程无忧，交Agent处理');
    return s;
  };
  const poll = async predicate => {
    let s;
    for (let n = 0; n < 3; n++) { s = await read(); if (predicate(s)) return s; }
    throw Error('页面未准备好，保留当前状态交Agent处理');
  };
  const click = async c => { if (!c?.selector) throw Error('控件不唯一或无法识别'); await io.click(c.selector); return read(); };
  function listingKey(s) {
    return hash({url:s.observedUrl, keyword:s.searchInput?.value, candidates:s.candidates?.map(c =>
      [c.role,c.company,c.url,c.text,c.labelEvidence])});
  }
  function listingResult(s) {
    if (s.kind !== 'listing' || s.loading || (!s.candidates?.length && !s.empty)) throw Error('列表尚未完整读取');
    const snapshotKey = listingKey(s);
    const candidates = s.candidates.map(c => {
      const candidateKey = hash([c.role,c.company,c.url,c.text,c.labelEvidence]);
      const reviewed = reviews.get(snapshotKey + ':' + candidateKey);
      const value = reviewed ? {...c, campus:reviewed.campus, labelsVerified:true, labelReview:reviewed.evidence} : c;
      return {...value, platform:'51job', candidateKey,
        action:value.campus === true ? 'skip_campus' : value.labelsVerified && value.campus === false ? 'candidate' : 'needs_label_review'};
    });
    lastListing = {platform:'51job', kind:'listing', observedUrl:s.observedUrl, snapshotKey, candidates};
    return lastListing;
  }
  async function list() { return listingResult(await read()); }
  async function search(config, keyword, city) {
    if (config.platform !== '51job' || !config.keywords?.includes(keyword) || !config.cities?.includes(city)
        || config.jobType !== '实习') throw Error('搜索条件必须来自本轮共用工作台');
    let s = await read();
    if (s.kind === 'home') s = await click(s.searchNav);
    if (s.kind !== 'listing') throw Error('先绑定前程无忧搜索标签，不复用岗位详情执行搜索');
    if (!s.searchInput?.selector) throw Error('搜索框未读取');
    await io.fill(s.searchInput.selector, keyword); s = await read();
    if (s.searchInput?.value !== keyword) throw Error('搜索词输入未生效');
    await click(s.searchButton);
    s = await poll(v => v.kind === 'listing' && v.title.includes(keyword) && !v.loading && (v.candidates?.length || v.empty));
    if (!s.cityOptions?.[city]?.selected) {
      if (!s.cityOptions?.[city]) s = await click(s.cityPicker);
      s = await click(s.cityOptions?.[city]);
      s = await poll(v => v.cityOptions?.[city]?.selected);
    }
    // 必须先搜索，再选实习；不使用月薪筛选替代最低日薪。
    s = await click(s.workType);
    s = await poll(v => !!v.internOption);
    if (!s.internOption.selected) s = await click(s.internOption);
    s = await poll(v => !!v.workType && /·\s*1/.test(v.workType.text) && v.internOption?.selected === true
      && !v.loading && (v.candidates?.length || v.empty));
    if (!s.latest?.selected) s = await click(s.latest);
    s = await poll(v => v.latest?.selected && !v.loading && (v.candidates?.length || v.empty));
    if (s.searchInput?.value !== keyword || !s.cityOptions?.[city]?.selected) throw Error('搜索词或城市被网站重置，停止并交Agent核对');
    return listingResult(s);
  }
  async function reviewLabels(snapshotKey, rows) {
    const s = listingResult(await read());
    if (s.snapshotKey !== snapshotKey) throw Error('列表已变化，不能沿用旧标签核验');
    for (const r of rows) {
      const candidate = s.candidates.find(c => c.candidateKey === r.candidateKey);
      if (!candidate || typeof r.campus !== 'boolean' || !r.evidence?.trim()) throw Error('缺少本页Agent标签核验依据');
      if (candidate.campus === true && r.campus === false) throw Error('不能覆盖明确的校招标签');
      reviews.set(snapshotKey + ':' + r.candidateKey, {campus:r.campus,evidence:r.evidence});
    }
    return listingResult(await read());
  }
  async function open(candidateKey) {
    const fresh = await list(), c = fresh.candidates.find(x => x.candidateKey === candidateKey);
    if (!c || c.action !== 'candidate') throw Error('岗位标签未核实、已变化或属于校招，禁止打开');
    await click({selector:c.roleSelector});
    return c;
  }
  async function detail(candidate) {
    const s = await read();
    if (s.kind !== 'detail') throw Error('当前不是岗位详情');
    detailId(s.observedUrl);
    if (candidate && (candidate.role !== s.role || candidate.company !== s.company)) throw Error('打开的岗位与候选不一致');
    if (candidate?.url && detailId(candidate.url) !== detailId(s.observedUrl)) throw Error('打开的岗位链接与候选不一致');
    return {...s, campus:candidate?.campus ?? null, labelsVerified:candidate?.labelsVerified === true,
      jobType:candidate?.labels?.includes(p.internshipLabel) || /实习|\bintern\b/i.test(s.role) ? '实习' : undefined};
  }
  function observation(s, gate, status, extra = {}) {
    return {platform:'51job', jobId:gate.jobId, handoffId:gate.handoffId, attemptId:gate.attemptId,
      observedUrl:s.observedUrl, attachment:p.attachment, jdHash:s.jd ? crypto.createHash('sha256').update(s.jd).digest('hex') : undefined,
      status, submissionSent:clicked.has(gate.attemptId),
      page:{dialogTitle:s.dialogTitle, selectedAttachments:s.attachments?.filter(a => a.selected === true).map(a => a.name),
        sendCount:s.sendCount, extraInputs:s.extraInputs, receiptText:s.receiptText},
      evidence:JSON.stringify(s), ...extra};
  }
  const gateCheck = gate => {
    if (gate.platform !== '51job' || gate.action !== 'execute_submission' || detailId(gate.url) !== gate.jobId
        || !gate.handoffId || !gate.expectedJDHash || !gate.expectedRole || !gate.expectedCompany
        || !Number.isFinite(gate.score) || !Number.isFinite(gate.threshold) || gate.score < gate.threshold)
      throw Error('没有本次达标的前程无忧交接');
  };
  const verifyDetail = (s, gate) => {
    if (!s.jdComplete || typeof s.jd !== 'string' || crypto.createHash('sha256').update(s.jd).digest('hex') !== gate.expectedJDHash
        || s.role !== gate.expectedRole || s.company !== gate.expectedCompany)
      throw Error('当前网页JD、岗位或公司与评分材料不一致，回到详情核对');
  };
  function formReady(s) {
    return s.dialogCount === 1 && s.dialogTitle === p.dialogTitle && s.sendCount === 1 && !s.extraInputs
      && s.attachments?.length === 3 && s.attachments.every(a => typeof a.selected === 'boolean');
  }
  function selectedResume(s) {
    return s.attachments?.filter(a => a.selected).map(a => a.name).join('|') === p.attachment;
  }
  async function prepare(gate) {
    gateCheck(gate); let s = await read();
    if (s.kind !== 'detail' || detailId(s.observedUrl) !== gate.jobId) throw Error('不是目标岗位详情');
    if (s.delivered || s.expired) return observation(s, gate, 'skip', {reason:'前程无忧：已投递或失效，不计本轮成功'});
    verifyDetail(s,gate);
    if (s.dialogCount === 0 && transitions.get(gate.handoffId) !== 'opening') {
      transitions.set(gate.handoffId, 'opening'); s = await click(s.apply);
    }
    if (!formReady(s)) {
      for (let n = 0; n < 2 && !formReady(s); n++) s = await read();
      if (!formReady(s)) return observation(s, gate, 'waiting_dialog', {reason:'弹窗或选中证据尚未可读，续接同一页面，不重复打开'});
    }
    if (!selectedResume(s)) {
      if (transitions.get(gate.handoffId) !== 'selecting') {
        transitions.set(gate.handoffId, 'selecting');
        s = await click(s.attachments.find(a => a.name === p.attachment));
      }
      for (let n = 0; n < 2 && !selectedResume(s); n++) s = await read();
      if (!formReady(s) || !selectedResume(s)) return observation(s, gate, 'waiting_attachment', {reason:'综合能力简历选中状态未更新；不重复切换'});
    }
    prepared.set(gate.handoffId, gate.jobId); transitions.delete(gate.handoffId);
    return observation(s, gate, 'ready_to_confirm', {submissionSent:false});
  }
  async function observe(gate, sent = clicked.has(gate.attemptId)) {
    if (gate.platform !== '51job' || detailId(gate.url) !== gate.jobId || !gate.handoffId)
      throw Error('不是本岗位的前程无忧结果交接');
    const s = await read();
    // 新会话只读恢复必须由已持久登记的attemptId交接；不执行发送。
    if (sent && gate.attemptId && receiptId(s.observedUrl) === gate.jobId && s.receiptText?.startsWith(p.successText))
      return observation(s, gate, 'success', {submissionSent:true});
    if (s.kind === 'detail' && detailId(s.observedUrl) !== gate.jobId) throw Error('结果页岗位不一致');
    if (s.kind === 'receipt' && receiptId(s.observedUrl) !== gate.jobId) throw Error('成功回执属于其他岗位');
    return observation(s, gate, 'pending_result', {submissionSent:sent,
      reason:'未看到本岗位成功回执；只读核查，不再次发送，也不把已投递按钮当作本轮成功'});
  }
  async function confirm(gate) {
    gateCheck(gate);
    if (!gate.attemptId || prepared.get(gate.handoffId) !== gate.jobId || clicked.has(gate.attemptId))
      throw Error('没有本会话准备状态或已经发送；只允许核查结果');
    const s = await read();
    if (s.kind !== 'detail' || detailId(s.observedUrl) !== gate.jobId || !formReady(s) || !selectedResume(s))
      throw Error('发送前岗位或附件选择变化');
    verifyDetail(s,gate);
    clicked.add(gate.attemptId); prepared.delete(gate.handoffId);
    // 先标记尝试，再调用工具；即使click超时也绝不重发。
    try { await io.click(s.send.selector); }
    catch (error) { return observation(s, gate, 'uncertain', {submissionSent:true,reason:error.message}); }
    await read();
    return observe(gate, true);
  }
  return {search,list,reviewLabels,open,detail,prepare,confirm,observe};
}
module.exports = {create51jobFlow, createDomIO, inspectDocument, detailId, receiptId};
