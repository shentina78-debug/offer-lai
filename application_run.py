"""固定运行入口：列表初筛、评分交接、结果落盘及入库。不控制浏览器/调用外部模型。"""
import argparse
import json
import re
import time
import hashlib
import secrets
import sys
from urllib.request import urlopen
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from application_batch import read, screen, validate_score, score_key, flush, number
from application_guard import ROOT, BASE
from platforms import DEFAULT_PLATFORM, get_platform
from platforms.base import validate_observation


def now():
    return datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()


def write(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temp.replace(path)


def parse_listing(snapshot, platform=DEFAULT_PLATFORM):
    return get_platform(platform).parse_listing(snapshot)


def screen_jobs(jobs, settings, state=None, journal=None, detail=False, platform=DEFAULT_PLATFORM):
    """共用硬筛不变；仅由所选适配器补充本平台候选排除规则。"""
    adapter = get_platform(platform)
    output = screen(jobs, settings, state, journal, detail=detail, platform=platform)
    for job, result in zip(jobs, output):
        rejection = adapter.candidate_rejection(job, detail)
        if rejection:
            result['action'] = 'skip'
            result.setdefault('reason', []).append(rejection)
    return output


def website_input(folder):
    adapter = run_platform(folder)
    run = read(folder/'run.json')
    if run.get('activeAttempt'):
        raise ValueError('先只读核查未结束的提交尝试，再开始搜索')
    if len(run['successIds']) >= run['successLimit']:
        return {'action': 'done', 'platform': adapter.key}
    return adapter.website_options(read(ROOT/'data/state.json')['settings'])


def ingest_detail(folder, observed):
    adapter = run_platform(folder)
    job = adapter.parse_detail(observed)
    identity = adapter.job_id(job['url'])
    write(folder/(identity+'.job.json'), job)
    state = read(ROOT/'data/state.json')
    journal = ROOT/'data/application_attempts.json'
    result = screen_jobs([job], state['settings'], state, read(journal) if journal.exists() else {},
                         detail=True, platform=adapter.key)[0]
    return {'job': job, 'jobFile': str(folder/(identity+'.job.json')), 'check': result}


def session_state(folder, identity):
    adapter = run_platform(folder)
    adapter.validate_id(identity)
    run = read(folder/'run.json')
    if identity in run['successIds']:
        return {'finished': True, 'platform': adapter.key}
    active = run.get('activeAttempt')
    if active:
        if active['jobId'] != identity:
            raise ValueError('另一岗位有未结束提交，先核查原岗位')
        return {'armed': True, 'platform': adapter.key, 'gate': observe_gate(folder, identity)}
    return {'armed': False, 'platform': adapter.key}


def execution_key(platform=DEFAULT_PLATFORM):
    return get_platform(platform).execution_key(ROOT)


def run_platform(folder):
    # 历史运行没有平台字段时仍按原实习僧执行；未知平台不回退。
    return get_platform(read(folder/'run.json').get('platform', DEFAULT_PLATFORM))


def validate_packet(adapter, packet, check_version=True, identity=None):
    if packet.get('platform', DEFAULT_PLATFORM) != adapter.key:
        raise ValueError('运行与交接文件的平台不一致')
    packet_id=adapter.job_id(packet['job']['url'])
    if identity is not None and packet_id != identity:
        raise ValueError('交接文件与本次岗位不一致')
    if check_version and packet.get('adapterKey') and packet['adapterKey'] != adapter.adapter_key():
        raise ValueError('平台适配程序已修改，重新检查交接')


def observe_gate(folder, identity):
    adapter = run_platform(folder)
    adapter.validate_id(identity)
    gate = read(folder/(identity+'.armed.json'))
    if gate.get('platform', DEFAULT_PLATFORM) != adapter.key or gate.get('jobId') != identity or adapter.job_id(gate['url']) != identity:
        raise ValueError('运行与提交登记的平台或岗位不一致')
    return gate


def expand_assessment(value):
    """紧凑评分JSON展开为原有校验格式，不改变分制或引用要求。"""
    if 'items' not in value:
        return value
    caps = {'核心工作内容匹配':30,'技能与工具匹配':25,'实际应用与成果匹配':10}
    if any(item.get('dimension') not in caps for item in value['items']):
        raise ValueError('评分维度无效')
    bonus_caps = {'专业':10,'学历':10,'毕业年份':5,'到岗时间':5,'行业/公司偏好':5}
    return {**{k:v for k,v in value.items() if k!='items'},
            'dimensions':[{'name':name,'max':cap,'items':[{k:v for k,v in i.items() if k!='dimension'}
                           for i in value['items'] if i['dimension']==name]} for name,cap in caps.items()],
            'bonus':[{**b,'max':bonus_caps.get(b.get('name'))} for b in value.get('bonus',[])]}


def service_check():
    with urlopen(BASE+'/api/state',timeout=3) as response:
        state=json.load(response)
    if not isinstance(state.get('records'),list) or not isinstance(state.get('settings'),dict):
        raise ValueError('本机记录服务响应异常')
    return {'reachable':True,'recordCount':len(state['records'])}


def score_input(folder, job):
    """硬筛通过才读取评分规则和共享简历；一次给齐必要材料。"""
    adapter=run_platform(folder)
    run=read(folder/'run.json');state=read(ROOT/'data/state.json')
    journal=ROOT/'data/application_attempts.json'
    check=screen_jobs([job],state['settings'],state,read(journal) if journal.exists() else {},detail=True,platform=adapter.key)[0]
    if check['action']!='score':return check
    if len(run['successIds'])>=run['successLimit']:raise ValueError('本轮已完成')
    input_key=score_key(job,state,(ROOT/'岗位匹配评分标准.md').read_text())
    write(folder/(adapter.job_id(job['url'])+'.input.json'),{'inputKey':input_key,'readAt':now()})
    return {'action':'need_gpt_assessment','job':job,'rules':(ROOT/'岗位匹配评分标准.md').read_text(),
            'resume':state['resume'],'personal':{k:state['settings'].get(k) for k in
              ('education','graduation','major','startDate','preferences','threshold')},
            'output':'由当前对话GPT按本文标准评分，只交回0至100的最终数值。不要生成条目、引用、加分明细或长篇JSON。程序仅校验数值和输入版本、比较门槛、记录最终分数，不声称核验引用或重算明细。'}


def browser_gate(folder, identity):
    check=check_ready(folder,identity)
    if check['action']!='execute_submission':return check
    packet=read(folder/(identity+'.ready.json'))
    adapter=run_platform(folder)
    return {**check,'handoffId':packet['handoffId'],**adapter.gate_fields(ROOT),**adapter.submission_context(packet['job'])}


def arm(folder, observed):
    adapter=run_platform(folder)
    identity=observed.get('jobId','')
    adapter.validate_id(identity)
    adapter.validate_platform(observed)
    run=read(folder/'run.json')
    if run.get('activeAttempt'):
        raise ValueError('本轮仍有提交尝试待核查，停止新增提交')
    gate=browser_gate(folder,identity)
    if gate.get('action')!='execute_submission':return gate
    validate_observation(adapter,observed,identity,gate)
    prepared=adapter.validate_prepared(observed,gate)
    gate['attemptId']=secrets.token_hex(16)
    journal_file=ROOT/'data/application_attempts.json';journal=read(journal_file) if journal_file.exists() else {}
    # 先持久登记再允许网页操作；网站具体准备条件由其适配器核实。
    journal[adapter.journal_key(identity)]={'status':'提交尝试，结果待核查','time':now(),'resume':prepared.submitted_resume,
                       'handoffId':gate['handoffId'],'attemptId':gate['attemptId']}
    write(journal_file,journal);write(folder/(identity+'.prepared.json'),observed)
    write(folder/(identity+'.armed.json'),gate)
    run['activeAttempt']={'jobId':identity,'attemptId':gate['attemptId']}
    write(folder/'run.json',run)
    return gate


def consume_browser(folder, observed, send=True):
    adapter=run_platform(folder)
    identity=observed.get('jobId','')
    adapter.validate_id(identity)
    armed=observe_gate(folder,identity)
    validate_observation(adapter,observed,identity,armed,attempt=True)
    journal_key=adapter.journal_key(identity)
    journal_file=ROOT/'data/application_attempts.json';journal=read(journal_file)
    if journal.get(journal_key,{}).get('attemptId')!=armed['attemptId']:
        raise ValueError('本地尝试日志与结果不一致')
    write(folder/(identity+'.browser.json'),observed)
    outcome=adapter.outcome(observed)
    if outcome.state in ('success','failure') and (not isinstance(observed.get('evidence'),str) or not observed['evidence'].strip()):
        return {'savedLocally':True,'action':'needs_reconciliation','reason':'缺少本次结果证据；保留尝试日志，禁止重投'}
    if outcome.state=='failure':
        journal[journal_key].update(status='已核实明确失败，禁止重投',evidence=observed['evidence'],verifiedAt=now())
        write(journal_file,journal);run=read(folder/'run.json')
        if run.get('activeAttempt',{}).get('attemptId')==armed['attemptId']:run.pop('activeAttempt',None)
        failures=run.setdefault('failures',[])
        if not any(x.get('jobId')==identity for x in failures):
            failures.append({'jobId':identity,'reason':observed.get('reason','网站明确投递失败'),'time':now()})
        write(folder/'run.json',run);event(folder,'submission.failed',jobId=identity,reason=observed.get('reason'))
        return {'savedLocally':True,'action':'next_candidate','reason':observed.get('reason','网站明确投递失败'),'successCount':len(run['successIds'])}
    if outcome.state=='pending':
        return {'savedLocally':True,'action':'observe_result','reason':adapter.pending_reason}
    if outcome.state!='success':
        return {'savedLocally':True,'action':'needs_reconciliation','reason':'没有本次已核实成功；保留尝试日志，禁止重投'}
    result=finalize(folder,identity,observed['evidence'],True,send,browser_result=observed)
    journal_file=ROOT/'data/application_attempts.json';journal=read(journal_file)
    journal[journal_key]['status']='已核实投递成功';write(journal_file,journal)
    run=read(folder/'run.json');run.pop('activeAttempt',None);write(folder/'run.json',run)
    return result


def confirm_gate(folder,identity):
    adapter=run_platform(folder)
    gate=observe_gate(folder,identity);packet=read(folder/(identity+'.ready.json'))
    validate_packet(adapter,packet,identity=identity)
    journal_key=adapter.journal_key(identity)
    state=read(ROOT/'data/state.json');journal=read(ROOT/'data/application_attempts.json')
    attempt=journal.get(journal_key,{})
    if attempt.get('attemptId')!=gate['attemptId'] or attempt.get('status')!='提交尝试，结果待核查':
        raise ValueError('尝试登记不一致或已有结果，先核查')
    if packet['inputKey']!=score_key(packet['job'],state,(ROOT/'岗位匹配评分标准.md').read_text()) or packet['executionKey']!=execution_key(adapter.key) or gate['handoffId']!=packet['handoffId']:
        raise ValueError('准备后材料或执行步骤已变化，停止提交')
    if number(state['settings'].get('threshold'))!=gate['threshold']:
        raise ValueError('提交前门槛已变化，停止提交')
    check=screen_jobs([packet['job']],state['settings'],state,{k:v for k,v in journal.items() if k!=journal_key},detail=True,platform=adapter.key)[0]
    run=read(folder/'run.json')
    if check['action']!='score' or len(run['successIds'])>=run['successLimit']:
        raise ValueError('硬性条件、去重或数量限制不通过，停止提交')
    return gate


def browser_code(folder, identity=None, phase='prepare', include_driver=False):
    adapter=run_platform(folder)
    gate=None
    if identity is not None:
        gate=browser_gate(folder,identity) if phase=='prepare' else confirm_gate(folder,identity) if phase=='confirm' else observe_gate(folder,identity)
        if gate.get('action')!='execute_submission':raise ValueError('岗位未达标')
    # 只生成平台自己的CUA代码；本地CLI不控制浏览器。
    return adapter.browser_code(ROOT,gate,phase,include_driver)


def run_report(folder):
    run=read(folder/'run.json');end=run.get('completedAt',now())
    elapsed=(datetime.fromisoformat(end)-datetime.fromisoformat(run['startedAt'])).total_seconds()
    events=read_events(folder)
    event_counts={}
    for item in events:event_counts[item['event']]=event_counts.get(item['event'],0)+1
    target=run.get('targetSeconds',300) # 旧budgetSeconds不再阻断提交；目标以新规则默认300秒。
    return {'successCount':len(run['successIds']),'failureCount':len(run.get('failures',[])),
            'wallSecondsFromStartCommand':round(elapsed,3),'targetSeconds':target,'withinTarget':elapsed<=target,
            'continueAfterTarget':True,'overTargetSeconds':round(max(0,elapsed-target),3),
            'eventCounts':event_counts,'browserSessionSeconds':round(sum(e.get('wallSeconds',0) or 0 for e in events if e['event']=='browser.bridge-call'),3),'eventsFile':str(folder/'events.jsonl'),
            'note':'从start命令计时；超目标仅提醒，继续至本轮授权结果。命令前准备、暂停/用户等待须另列，不冒充模型处理耗时。'}


def read_events(folder):
    path=folder/'events.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def event(folder,name,**data):
    if not (folder/'run.json').exists():return
    with (folder/'events.jsonl').open('a') as handle:
        handle.write(json.dumps({'time':now(),'event':name,**data},ensure_ascii=False)+'\n')


def start_run(folder, limit=1, budget=300, platform=DEFAULT_PLATFORM):
    adapter=get_platform(platform)
    if not isinstance(budget,int) or isinstance(budget,bool) or budget <= 0:
        raise ValueError('目标时间必须是正整数秒数')
    if limit < 1:
        raise ValueError('成功数量上限必须大于0')
    folder.mkdir(parents=True, exist_ok=True)
    if (folder/'run.json').exists():
        raise ValueError('运行目录已存在，请复用原运行或指定新目录')
    state = read(ROOT/'data/state.json')
    value = {'platform': adapter.key, 'startedAt': now(), 'successLimit': limit, 'successIds': [], 'settings': state['settings'], 'targetSeconds': budget}
    # 不在运行准备输出中附带简历，简历仅评分阶段读取。
    value['settings'] = {k: v for k, v in value['settings'].items() if k != 'resume'}
    write(folder/'run.json', value)
    return {'run': str(folder), 'successLimit': limit, 'targetSeconds': budget, 'continueAfterTarget':True, 'keywords': value['settings'].get('keywords'),
            'websiteFilters': {'cities': value['settings'].get('cities'), 'jobType': value['settings'].get('jobType')},
            'note': '仅设置网站能等价表达的硬条件，未支持或区间不等价的留给本地筛选；学历/专业等不设为网站淘汰条件'}


def approve(folder, job, assessment):
    adapter = run_platform(folder)
    run = read(folder/'run.json')
    if len(run['successIds']) >= run['successLimit']:
        raise ValueError('本轮成功上限已达到')
    state = read(ROOT/'data/state.json')
    journal_file = ROOT/'data/application_attempts.json'
    checks = screen_jobs([job], state['settings'], state, read(journal_file) if journal_file.exists() else {}, detail=True,platform=adapter.key)[0]
    if checks['action'] != 'score':
        return checks
    input_file=folder/(adapter.job_id(job['url'])+'.input.json')
    if input_file.exists() and read(input_file)['inputKey']!=score_key(job,state,(ROOT/'岗位匹配评分标准.md').read_text()):
        raise ValueError('评分输入已变化，需重新读取材料并评分')
    # 新默认入口只接收最终分数；旧结构化输入仅兼容校验，不再传递或入库其明细。
    if isinstance(assessment,dict) and ('dimensions' in assessment or 'items' in assessment):
        score=validate_score(expand_assessment(assessment),job['jd'],state['resume']['text'])
    else:
        value=assessment.get('score') if isinstance(assessment,dict) else assessment
        if isinstance(value,bool) or not isinstance(value,(int,float)) or number(value) is None or not 0 <= value <= 100:
            raise ValueError('最终分数必须是0至100的有限数值')
        score=value
    supplied=assessment if isinstance(assessment,dict) else {}
    threshold = number(state['settings'].get('threshold'))
    if threshold is None or not 0 <= threshold <= 100:
        raise ValueError('最低匹配分无效')
    rules = (ROOT/'岗位匹配评分标准.md').read_text()
    version = re.search(r'版本[：:]\s*([^；;\n]+)',rules)
    rule_version = version[1].strip() if version else supplied.get('ruleVersion','unknown')
    if supplied.get('ruleVersion',rule_version) != rule_version:
        raise ValueError('评分规则版本不符')
    assessment = {'ruleVersion':rule_version,'model':supplied.get('model','当前对话 GPT'),'scoreMode':'final_only',
                  'analyzedAt':supplied.get('analyzedAt',now()),'jobId':adapter.job_id(job['url']), 'url':job['url'],
                  'jdHash':hashlib.sha256(job['jd'].encode()).hexdigest(),
                  'resumeHash':hashlib.sha256(state['resume']['text'].encode()).hexdigest(),
                  'preferences':state['settings'].get('preferences',''),'score':score,'threshold':threshold}
    packet = {'platform': adapter.key, 'adapterKey': adapter.adapter_key(), 'job': job, 'assessment': assessment, 'inputKey': score_key(job, state, rules),
              'resumeName': state['resume'].get('name', ''), 'checkedAt': now()}
    path = folder/(adapter.job_id(job['url'])+'.ready.json')
    packet['executionKey'] = execution_key(adapter.key)
    old = read(path) if path.exists() else {}
    same = all(old.get(k)==packet.get(k) for k in ('inputKey','executionKey')) and old.get('assessment',{}).get('score')==score and old.get('assessment',{}).get('threshold')==threshold
    packet['handoffId'] = old.get('handoffId') if same and old.get('handoffId') else secrets.token_hex(16)
    write(path, packet)
    return {'platform': adapter.key, 'jobId': adapter.job_id(job['url']), 'url': job['url'], 'score': score, 'threshold': threshold,
            'action': 'execute_submission' if score >= threshold else 'pending_review'}


def check_ready(folder, identity):
    adapter = run_platform(folder)
    adapter.validate_id(identity)
    packet = read(folder/(identity+'.ready.json'))
    validate_packet(adapter,packet,identity=identity)
    state = read(ROOT/'data/state.json')
    if packet['inputKey'] != score_key(packet['job'], state, (ROOT/'岗位匹配评分标准.md').read_text()):
        raise ValueError('评分材料已变化，需重新评分')
    if packet.get('executionKey') != execution_key(adapter.key):
        raise ValueError('网页步骤或执行程序已修改，重新检查交接')
    # 重新检查硬条件、已有记录、尝试日志、数量上限及最新门槛。
    return approve(folder, packet['job'], packet['assessment'])


def finalize(folder, identity, evidence, success=False, send=True, browser_result=None):
    """成功证据由cua现场确认后传入；低分未提交记录由程序生成。先落盘再网络。"""
    adapter = run_platform(folder)
    adapter.validate_id(identity)
    if not evidence.strip():
        raise ValueError('岗位ID或结果证据无效')
    packet = read(folder/(identity+'.ready.json'))
    # 实际成功仍须留存；程序版本变化只阻止新的提交，不抹去已发生的结果。
    validate_packet(adapter,packet,check_version=False,identity=identity)
    run = read(folder/'run.json')
    if success and len(run['successIds']) >= run['successLimit'] and identity not in run['successIds']:
        raise ValueError('本轮成功上限已达到，不接受新增成功记录')
    state = read(ROOT/'data/state.json')
    input_changed = packet['inputKey'] != score_key(packet['job'], state, (ROOT/'岗位匹配评分标准.md').read_text())
    # 实际成功必须留存，即便提交后设置发生变化；不能因此丢失结果或重投。
    a, job = packet['assessment'], packet['job']
    if success and a['score'] < a['threshold']:
        raise ValueError('低分岗位尚未获人工放行')
    if not success and a['score'] >= a['threshold']:
        raise ValueError('达标岗位不能误记为低分待审核')
    timestamp = now()
    record = {k: job[k] for k in ('company','role','city','salary','url','jd') if k in job}
    record.update(id=adapter.record_id(identity), status='投递成功' if success else '待审核',
                  time=datetime.fromisoformat(timestamp).strftime('%Y-%m-%d %H:%M:%S'),
                  score=a['score'], assessment=a, resume=packet['resumeName'], evidence=evidence,
                  inputChangedAfterAssessment=input_changed, threshold=a['threshold'], ruleVersion=a.get('ruleVersion', 'jd-fit-v2'),
                  reason='')
    if adapter.key != DEFAULT_PLATFORM:
        record['platform'] = adapter.key
    if browser_result:
        adapter.validate_platform(browser_result)
        record['browserResult'] = browser_result
        record.update(adapter.resume_fields(browser_result,packet['resumeName']))
    path = folder/(identity+'.record.json')
    payload = {'confirmed': True, 'record': record}
    # 重复收尾保留最初记录时间；核对内容有变化时交给原接口冲突处理。
    if path.exists():
        old = read(path)
        if all(old['record'].get(k) == record.get(k) for k in ('id','status','score','url')):
            payload = old
    write(path, payload)
    if success and identity not in run['successIds']:
        run['successIds'].append(identity)
        write(folder/'run.json', run)
    result = {'savedLocally': True, 'file': str(path), 'successCount': len(run['successIds'])}
    if send:
        try:
            result['sync'] = flush([payload])
            write(folder/(identity+'.sync.json'), result['sync'])
            result['pendingSync'] = any(row['result']=='needs_reconciliation' for row in result['sync'])
        except Exception as error:
            result['pendingSync'] = True
            result['error'] = str(error)
    if success and len(run['successIds']) >= run['successLimit'] and not run.get('completedAt'):
        run['completedAt'] = now();write(folder/'run.json',run)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    init=sub.add_parser('start');init.add_argument('run',type=Path);init.add_argument('--limit',type=int,default=1)
    init.add_argument('--platform',default=DEFAULT_PLATFORM,help='默认实习僧；未接入的平台直接拒绝')
    init.add_argument('--target-seconds','--budget-seconds',dest='target_seconds',type=int,default=300);init.add_argument('--check-service',action='store_true')
    listing=sub.add_parser('list');listing.add_argument('run',type=Path);listing.add_argument('snapshot',type=Path)
    website=sub.add_parser('website-input');website.add_argument('run',type=Path)
    detail=sub.add_parser('detail');detail.add_argument('run',type=Path);detail.add_argument('snapshot',nargs='?',default='-')
    session_status=sub.add_parser('session-state');session_status.add_argument('run',type=Path);session_status.add_argument('job_id')
    inp=sub.add_parser('score-input');inp.add_argument('run',type=Path);inp.add_argument('job',type=Path)
    assess=sub.add_parser('assess');assess.add_argument('run',type=Path);assess.add_argument('job',type=Path);assess.add_argument('assessment',nargs='?',default='-')
    rate=sub.add_parser('rate');rate.add_argument('run',type=Path);rate.add_argument('job',type=Path);rate.add_argument('score',type=float)
    check=sub.add_parser('check');check.add_argument('run',type=Path);check.add_argument('job_id')
    finish=sub.add_parser('finish');finish.add_argument('run',type=Path);finish.add_argument('job_id');finish.add_argument('--evidence',required=True);finish.add_argument('--observed-success',action='store_true');finish.add_argument('--offline',action='store_true')
    for name in ('arm','complete'):
        command=sub.add_parser(name);command.add_argument('run',type=Path);command.add_argument('result',nargs='?',default='-')
        if name=='complete':command.add_argument('--offline',action='store_true')
    code=sub.add_parser('browser-code');code.add_argument('run',type=Path);code.add_argument('job_id',nargs='?')
    code.add_argument('--phase',choices=['prepare','confirm','observe'],default='prepare');code.add_argument('--include-driver',action='store_true')
    for name in ('sync','report'):
        command=sub.add_parser(name);command.add_argument('run',type=Path)
    gate=sub.add_parser('gate');gate.add_argument('run',type=Path);gate.add_argument('job_id');gate.add_argument('--phase',choices=['prepare','confirm','observe'],default='prepare')
    sub.add_parser('service-check')
    session=sub.add_parser('session-code');session.add_argument('--platform',default=DEFAULT_PLATFORM)
    route=sub.add_parser('platform');route.add_argument('name',nargs='?',default=DEFAULT_PLATFORM)
    args=parser.parse_args();started=time.perf_counter()
    load_json=lambda path: json.load(sys.stdin) if str(path)=='-' else read(path)
    if args.command=='start':
        get_platform(args.platform)
        if args.check_service:service_check()
        result=start_run(args.run,args.limit,args.target_seconds,args.platform)
    elif args.command=='service-check':result=service_check()
    elif args.command=='session-code':
        print(get_platform(args.platform).session_code(ROOT));return
    elif args.command=='platform':
        adapter=get_platform(args.name)
        result={'platform':adapter.key,'name':adapter.name,'skill':adapter.skill_path,
                'fastPath':adapter.fast_path,'steps':adapter.steps_path}
    elif args.command=='list':
        adapter=run_platform(args.run);candidates=parse_listing(args.snapshot.read_text(),adapter.key);state=read(ROOT/'data/state.json')
        journal=ROOT/'data/application_attempts.json'
        result=screen_jobs(candidates,state['settings'],state,read(journal) if journal.exists() else {},platform=adapter.key)
        write(args.run/'candidates.json',candidates);write(args.run/'list-results.json',result)
    elif args.command=='website-input':result=website_input(args.run)
    elif args.command=='detail':result=ingest_detail(args.run,load_json(args.snapshot))
    elif args.command=='session-state':result=session_state(args.run,args.job_id)
    elif args.command=='score-input':result=score_input(args.run,read(args.job))
    elif args.command=='assess':result=approve(args.run,read(args.job),load_json(args.assessment))
    elif args.command=='rate':result=approve(args.run,read(args.job),args.score)
    elif args.command=='check':result=check_ready(args.run,args.job_id)
    elif args.command=='gate':result=browser_gate(args.run,args.job_id) if args.phase=='prepare' else confirm_gate(args.run,args.job_id) if args.phase=='confirm' else observe_gate(args.run,args.job_id)
    elif args.command=='arm':result=arm(args.run,load_json(args.result))
    elif args.command=='complete':result=consume_browser(args.run,load_json(args.result),not args.offline)
    elif args.command=='finish':result=finalize(args.run,args.job_id,args.evidence,args.observed_success,not args.offline)
    elif args.command=='report':result=run_report(args.run)
    elif args.command=='browser-code':
        print(browser_code(args.run,args.job_id,args.phase,args.include_driver));return
    else:
        adapter=run_platform(args.run)
        payloads=[read(p) for p in sorted(args.run.glob('*.record.json'))]
        for payload in payloads:
            record=payload['record']
            if record.get('platform',DEFAULT_PLATFORM)!=adapter.key:
                raise ValueError('待同步记录的平台与本轮不一致')
            adapter.job_id(record['url'])
        result=flush(payloads)
    duration=round(time.perf_counter()-started,6)
    if hasattr(args,'run') and args.command!='report':event(args.run,'command.'+args.command,localSeconds=duration)
    print(json.dumps({'result':result,'localSeconds':duration},ensure_ascii=False))


if __name__=='__main__':main()
