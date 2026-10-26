/* 仅前程无忧。子进程只访问本机主干；网页只由传入的CUA Tab操作。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require = createRequire(import.meta.url);
const flowFile = require.resolve('./submission_flow.js');
delete require.cache[flowFile];
delete require.cache[require.resolve('../submission_profile.json')];
const {create51jobFlow, detailId} = require(flowFile);
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_PYTHON = (process.env.PYTHON || 'python3');

function createLocalClient(root, python = DEFAULT_PYTHON) {
  return (command, args = [], input) => new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, 'application_run.py'), command, ...args],
      {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('本机校验超时，保留尝试，不重复提交')); }, 15000);
    child.stdout.on('data', chunk => {out += chunk; if (out.length > 2e6) child.kill();});
    child.stderr.on('data', chunk => {err += chunk;});
    child.on('error', error => {clearTimeout(timer); reject(error);});
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Error(err.trim() || '本机工具失败'));
      try {resolve(JSON.parse(out).result);} catch {reject(Error('本机工具返回格式无效'));}
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}

function createSubmissionSession(initialTab, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const local = options.local || createLocalClient(root, options.python);
  const factory = options.flowFactory || (tab => create51jobFlow(tab, options));
  const searchFlow = factory(initialTab);
  let activeFlow = searchFlow;
  const memory = new Map(), jobs = new Map();
  const key = (run, id) => run + '|' + id;
  const checkId = id => {if (!/^[1-9]\d{0,11}$/.test(id)) throw Error('前程无忧岗位ID无效');};
  const archive = options.archive || (async (run, id, stage, value) => {
    const folder = path.resolve(root, run), relative = path.relative(path.join(root, 'runs'), folder);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !/^(?:[1-9]\d{0,11}|listing)$/.test(id)
        || !/^[a-z-]+$/.test(stage)) throw Error('运行文件路径无效');
    await fs.mkdir(folder, {recursive:true});
    const target = path.join(folder, `${id}.${stage}.json`), temp = target + '.tmp';
    await fs.writeFile(temp, JSON.stringify(value, null, 2)); await fs.rename(temp, target);
    await fs.appendFile(path.join(folder, 'events.jsonl'), JSON.stringify({time:new Date().toISOString(),
      event:'browser.' + stage, platform:'51job', jobId:id, status:value.status, wallSeconds:value.wallSeconds}) + '\n');
  });
  const attention = error => ({action:'needs_attention', reason:error.message});
  async function search(run, keyword, city) {
    const config = await local('website-input', [run]);
    if (config.action === 'done') return config;
    const result = await searchFlow.search(config, keyword, city);
    await archive(run, 'listing', 'listing', result);
    return result;
  }
  async function list(run) {
    const config = await local('website-input', [run]);
    if (config.action === 'done') return config;
    const result = await searchFlow.list(); await archive(run, 'listing', 'listing', result); return result;
  }
  async function reviewLabels(run, snapshotKey, rows) {
    const result = await searchFlow.reviewLabels(snapshotKey, rows);
    await archive(run, 'listing', 'listing', result); return result;
  }
  async function open(run, candidateKey) {
    const config = await local('website-input', [run]);
    if (config.action === 'done') return config;
    if (!options.listTabs || !options.bindTab) throw Error('需要CUA标签发现与绑定回调，不能猜测新标签');
    const before = new Set((await options.listTabs()).map(t => t.id));
    const candidate = await searchFlow.open(candidateKey);
    let found = [];
    for (let n = 0; n < 3 && found.length === 0; n++) {
      found = (await options.listTabs()).filter(t => !before.has(t.id) && (() => {
        try { detailId(t.url); return true; } catch {return false;}
      })());
    }
    if (found.length !== 1) throw Error('未发现唯一的新岗位详情标签，交Agent核对，不点击列表投递按钮');
    const tab = await options.bindTab(found[0].id);
    activeFlow = factory(tab);
    const observed = await activeFlow.detail(candidate);
    const id = detailId(observed.observedUrl);
    jobs.set(id, activeFlow);
    await archive(run, id, 'detail', observed);
    return local('detail', [run, '-'], observed);
  }
  async function consume(run, id, observed) {
    await archive(run, id, 'bridge-result', observed);
    if (observed.status === 'success') memory.set(key(run,id), observed);
    let saved;
    try {saved = await local('complete', [run, '-'], observed);}
    catch (error) {return {status:observed.status, action:'retry_record', evidenceSavedLocally:true, reason:error.message};}
    if (observed.status === 'success') memory.delete(key(run,id));
    return {status:observed.status, jobId:id, action:saved.pendingSync ? 'sync_pending' : saved.action
      || (observed.status === 'success' ? 'done' : 'needs_reconciliation'), record:saved, reason:observed.reason};
  }
  async function inspect(run, id) {
    checkId(id);
    const gate = await local('gate', [run,id,'--phase','observe']);
    if (gate.platform !== '51job') throw Error('禁止混用其他平台的会话');
    const flow = jobs.get(id) || activeFlow;
    return consume(run,id,await flow.observe(gate,true));
  }
  async function submit(run, id) {
    checkId(id);
    if (memory.has(key(run,id))) return consume(run,id,memory.get(key(run,id)));
    // 每次调用先检查磁盘；CUA会话重置后仍不能重新发送已登记的尝试。
    const previous = await local('session-state', [run,id]);
    if (previous.platform !== '51job') throw Error('前程无忧程序不能执行实习僧运行');
    if (previous.finished) return {status:'success',action:'done',jobId:id,alreadyRecorded:true};
    if (previous.armed) return inspect(run,id);
    const gate = await local('gate', [run,id,'--phase','prepare']);
    if (gate.platform !== '51job') throw Error('平台交接不一致');
    if (gate.action !== 'execute_submission') return {action:'next_candidate',status:'skip',reason:gate.reason};
    const flow = jobs.get(id) || activeFlow;
    let prepared = await flow.prepare(gate);
    await archive(run,id,'bridge-prepared',prepared);
    if (['waiting_dialog','waiting_attachment'].includes(prepared.status)) {
      prepared = await flow.prepare(gate); await archive(run,id,'bridge-prepared',prepared);
    }
    if (['waiting_dialog','waiting_attachment'].includes(prepared.status))
      return {status:prepared.status,action:'continue_prepare',reason:prepared.reason};
    if (prepared.status !== 'ready_to_confirm') return {status:prepared.status,
      action:prepared.status === 'skip' ? 'next_candidate' : 'needs_attention',reason:prepared.reason};
    await local('arm', [run,'-'], prepared);
    const confirmed = await local('gate', [run,id,'--phase','confirm']);
    let observed = await flow.confirm(confirmed);
    if (observed.status === 'pending_result') {
      await archive(run,id,'bridge-waiting',observed); observed = await flow.observe(confirmed,true);
    }
    return consume(run,id,observed);
  }
  const bounded = (method, jobAction = false) => async (...args) => {
    const start = Date.now();
    try {
      const result = await method(...args);
      result.sessionSeconds = (Date.now() - start) / 1000;
      if (jobAction) {
        try {await archive(args[0],args[1],'bridge-call',{status:result.status,wallSeconds:result.sessionSeconds});}
        catch (error) {result.logError = error.message;}
      }
      return result;
    } catch (error) {return attention(error);}
  };
  return {search:bounded(search), list:bounded(list), reviewLabels:bounded(reviewLabels), open:bounded(open),
    submit:bounded(submit,true), inspect:bounded(inspect,true)};
}
export {createSubmissionSession,createLocalClient};
