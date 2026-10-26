"""本地批处理辅助：不操作浏览器、不调用外部评分服务、不提交简历。"""
import argparse
import hashlib
import json
import math
import re
import time
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from application_guard import BASE, ROOT, preflight
from platforms import DEFAULT_PLATFORM, get_platform, platform_for_url


def read(path):
    return json.loads(Path(path).read_text())


def words(value):
    return [s.strip() for s in re.split(r'[,，、;；\n]+', value or '') if s.strip()]


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def screen(jobs, settings, state=None, journal=None, detail=False, platform=DEFAULT_PLATFORM):
    """输入仅来自页面观察的结构化字段；列表缺项留待详情确认；完整详情未写明非薪资条件默认符合。"""
    adapter = get_platform(platform)
    seen, output = set(), []
    for job in jobs:
        reasons, missing = [], []
        try:
            if job.get('platform', adapter.key) != adapter.key:
                raise ValueError('岗位平台不一致')
            identity = adapter.job_id(job['url'])
        except (KeyError, ValueError):
            output.append({'action': 'skip', 'reason': ['岗位URL无效']})
            continue
        check = preflight(job['url'], state or {}, journal or {}, adapter.key)
        if identity in seen or check['blocked']:
            reasons.append('重复或已有记录/提交尝试，需核对结果')
        seen.add(identity)
        if job.get('delivered') is True or job.get('expired') is True:
            reasons.append('已投递或已失效')
        if detail and (job.get('delivered') is not False or job.get('expired') is not False):
            missing.append('岗位投递/有效状态未确认')
        if job.get('conflicts'):
            reasons.append('页面硬性条件存在冲突')
        text = ' '.join(str(job.get(k, '')) for k in ('role', 'company', 'jd'))
        if any(w.casefold() in text.casefold() for w in words(settings.get('exclude'))):
            reasons.append('命中排除项')
        for field, setting in [('city', 'cities'), ('jobType', 'jobType'), ('workMode', 'workMode')]:
            allowed = words(settings.get(setting))
            if not allowed or '不限' in allowed:
                continue
            if not job.get(field):
                if not (detail and job.get('jdComplete') is True):
                    missing.append(field)
            elif job[field] not in allowed:
                reasons.append(field + '不符合')
        minimum = number(settings.get('minSalary'))
        if minimum is not None:
            salary = number(job.get('salaryMin'))
            if salary is None:
                match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)(?:\s*[-–~至]\s*\d+(?:\.\d+)?)?\s*(?:元)?\s*[/／]\s*天\s*', job.get('salary', ''))
                salary = float(match[1]) if match else None
            if salary is not None:
                if salary < minimum:
                    reasons.append('最低日薪不符合')
            elif job.get('salary', '').strip() in ('薪资面议', '面议', '未公开'):
                if settings.get('allowUnknownSalary') not in (True, 'on', 'true', '1'):
                    reasons.append('不接受未公开薪资')
            else:
                missing.append('日薪无法确认')
        for field, setting in [('days', 'days'), ('months', 'months')]:
            limit = number(settings.get(setting))
            if limit is None:
                continue
            required = number(job.get(field))
            if required is None:
                if not (detail and job.get('jdComplete') is True):
                    missing.append(field)
            elif required > limit:
                reasons.append(field + '超出可提供范围')
        if detail and not job.get('jd', '').strip():
            missing.append('完整JD')
        if detail:
            reasons += ['无法确认：' + s for s in missing]
        output.append({'jobId': identity, 'url': job['url'], 'action': 'skip' if reasons else 'score' if detail else 'open_detail', 'reason': reasons, 'missing': missing})
    return output


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if not c.isspace())


def validate_score(assessment, jd, resume):
    dimensions = assessment.get('dimensions', [])
    expected = {'核心工作内容匹配': 30, '技能与工具匹配': 25, '实际应用与成果匹配': 10}
    if len(dimensions) != 3 or {d.get('name') for d in dimensions} != set(expected):
        raise ValueError('JD维度缺失或重复')
    total = 0
    for dimension in dimensions:
        cap = expected[dimension['name']]
        items = dimension.get('items', [])
        if dimension.get('max') != cap:
            raise ValueError('维度满分不符')
        if items and abs(sum(number(i.get('weight')) or 0 for i in items) - cap) > 1e-8:
            raise ValueError('条目权重不等于维度满分')
        for item in items:
            weight, ratio = number(item.get('weight')), number(item.get('ratio'))
            if weight is None or weight <= 0 or ratio not in (0, .25, .5, .75, 1):
                raise ValueError('权重或比例无效')
            jq, rq = item.get('jdQuote', ''), item.get('resumeQuote', '')
            if not jq or normalized(jq) not in normalized(jd):
                raise ValueError('JD引用无法定位')
            if ratio and (not rq or normalized(rq) not in normalized(resume)):
                raise ValueError('简历引用无法定位')
            total += weight * ratio
    bonus = assessment.get('bonus', [])
    expected_bonus = {'专业': 10, '学历': 10, '毕业年份': 5, '到岗时间': 5, '行业/公司偏好': 5}
    if len(bonus) != 5 or {b.get('name') for b in bonus} != set(expected_bonus):
        raise ValueError('附加项缺失或重复')
    for row in bonus:
        cap = expected_bonus[row['name']]
        if row.get('max') != cap or number(row.get('score')) not in (0, cap):
            raise ValueError('附加分不符')
        total += row['score']
    return total


def score_key(job, state, rules):
    # 门槛变化不必重新分析；比较时始终使用最新门槛。其余输入变化使缓存失效。
    payload = {'job': job, 'resume': state.get('resume', {}).get('text', ''), 'rules': rules, 'date': datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat(),
               'personal': {k: state.get('settings', {}).get(k) for k in ('education', 'graduation', 'major', 'startDate', 'preferences')}}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def flush(payloads, request_url=BASE):
    # 固定调用本机服务；不传输到第三方。超时/409不盲重试。
    if request_url != BASE:
        raise ValueError('仅支持本机工作台')
    with urlopen(BASE + '/api/state', timeout=5) as response:
        existing = {r['id']: r for r in json.load(response).get('records', [])}
    results = []
    for payload in payloads:
        record = payload['record']
        if payload.get('confirmed') is not True or record.get('status') not in ('投递成功', '待审核'):
            raise ValueError('必须核对状态后再入库')
        adapter = platform_for_url(record['url'], record.get('platform'))
        identity = adapter.record_id(adapter.job_id(record['url']))
        if record['id'] != identity or not record.get('evidence'):
            raise ValueError('稳定ID或凭据缺失')
        value = record.get('score')
        if value is None and record['status'] == '投递成功':
            raise ValueError('成功记录缺少评分')
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or number(value) is None or not 0 <= value <= 100):
            raise ValueError('评分必须是0至100的数值或null')
        if identity in existing:
            old = existing[identity]
            same = all(old.get(k) == record.get(k) for k in ('status', 'score', 'url'))
            results.append({'id': identity, 'result': 'already_saved' if same else 'needs_reconciliation'})
            continue
        request = Request(BASE + '/api/records', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urlopen(request, timeout=5) as response:
                saved = json.load(response)['record']
            existing[identity] = saved
            results.append({'id': identity, 'result': 'saved'})
        except HTTPError as error:
            if error.code != 409:
                raise
            results.append({'id': identity, 'result': 'needs_reconciliation'})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare')
    filt = sub.add_parser('filter'); filt.add_argument('file', type=Path); filt.add_argument('--detail', action='store_true')
    filt.add_argument('--platform', default=DEFAULT_PLATFORM)
    val = sub.add_parser('score'); val.add_argument('job', type=Path); val.add_argument('assessment', type=Path, nargs='?')
    val.add_argument('--cache', type=Path, required=True)
    val.add_argument('--platform', default=DEFAULT_PLATFORM)
    save = sub.add_parser('flush'); save.add_argument('files', nargs='+', type=Path)
    timing = sub.add_parser('timing'); timing.add_argument('file', type=Path); timing.add_argument('--stage', required=True)
    timing.add_argument('--seconds', type=float, required=True); timing.add_argument('--calls', type=int, default=1)
    args = parser.parse_args(); started = time.perf_counter()
    if args.command == 'timing':
        if not math.isfinite(args.seconds) or args.seconds < 0 or args.calls < 0:
            raise ValueError('无效计时')
        args.file.parent.mkdir(parents=True, exist_ok=True)
        with args.file.open('a') as handle:
            handle.write(json.dumps({'stage': args.stage, 'seconds': args.seconds, 'calls': args.calls}) + '\n')
        events = [json.loads(line) for line in args.file.read_text().splitlines()]
        result = {'seconds': sum(e['seconds'] for e in events), 'calls': sum(e['calls'] for e in events), 'events': events}
    elif args.command == 'flush':
        result = flush([read(p) for p in args.files])
    else:
        state = read(ROOT / 'data/state.json')
        if args.command == 'prepare':
            result = {'settings': state.get('settings', {}), 'recordCount': len(state.get('records', [])), 'resumeExposed': False}
            # 不输出简历元信息或正文；仅返回搜索和硬性筛选所需字段。
            result['settings'] = {k: v for k, v in result['settings'].items() if k in ('keywords', 'cities', 'minSalary', 'allowUnknownSalary', 'workMode', 'days', 'months', 'jobType', 'exclude', 'dailyLimit')}
        elif args.command == 'filter':
            journal_path = ROOT / 'data/application_attempts.json'
            result = screen(read(args.file), state['settings'], state, read(journal_path) if journal_path.exists() else {}, args.detail, args.platform)
        else:
            job = read(args.job)
            checks = screen([job], state['settings'], detail=True, platform=args.platform)
            if checks[0]['action'] != 'score':
                raise ValueError('硬性条件未通过：' + str(checks[0]))
            rules = (ROOT / '岗位匹配评分标准.md').read_text()
            key = score_key(job, state, rules)
            cached = read(args.cache) if args.cache.exists() else {}
            assessment = read(args.assessment) if args.assessment else cached.get(key)
            if assessment is None:
                result = {'cacheHit': False, 'action': 'need_gpt_assessment', 'key': key}
            else:
                total = validate_score(assessment, job['jd'], state['resume']['text'])
                threshold = number(state['settings'].get('threshold'))
                if threshold is None or not 0 <= threshold <= 100:
                    raise ValueError('最低分无效')
                cached[key] = assessment
                args.cache.parent.mkdir(parents=True, exist_ok=True)
                args.cache.write_text(json.dumps(cached, ensure_ascii=False, indent=2))
                result = {'score': total, 'threshold': threshold, 'cacheHit': args.assessment is None,
                          'action': 'execute_submission' if total >= threshold else 'pending_review', 'key': key}
    print(json.dumps({'result': result, 'localSeconds': round(time.perf_counter() - started, 6)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
