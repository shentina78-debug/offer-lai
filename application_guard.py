"""Local checks and result recording. Never submits a resume to a job website."""
import argparse
import json
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from platforms import DEFAULT_PLATFORM, get_platform, platform_for_url

ROOT = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:8765'


def job_id(url, platform=DEFAULT_PLATFORM):
    """保留原调用方式；不指定平台仍执行实习僧原校验。"""
    return get_platform(platform).job_id(url)


def preflight(url, state, journal, platform=DEFAULT_PLATFORM):
    adapter = get_platform(platform)
    target = adapter.job_id(url)
    for record in state.get('records', []):
        if record.get('platform', adapter.key) != adapter.key:
            continue
        same = record.get('id') in adapter.record_aliases(target)
        if record.get('url'):
            try:
                same = same or adapter.job_id(record['url']) == target
            except ValueError:
                pass
        if same:
            return {'jobId': target, 'blocked': True, 'reason': '本地已有记录，先核查站内结果'}
    if adapter.journal_key(target) in journal:
        return {'jobId': target, 'blocked': True, 'reason': '已有提交尝试或结果不明，禁止自动重投'}
    return {'jobId': target, 'blocked': False, 'reason': '本地未命中；仍须检查站内历史及当前按钮状态'}


def result_payload(record, observed):
    if not observed:
        raise ValueError('必须先在页面确认成功结果')
    for key in ('company', 'role', 'resume', 'evidence', 'time', 'url'):
        if not isinstance(record.get(key), str) or not record[key].strip():
            raise ValueError('缺少结果字段：' + key)
    adapter = platform_for_url(record['url'], record.get('platform'))
    target = adapter.job_id(record['url'])
    # Do not accept caller-supplied company classifications or arbitrary IDs.
    clean = {key: record[key] for key in ('company', 'role', 'resume', 'evidence', 'time', 'url', 'city', 'salary', 'jd', 'reason', 'score', 'assessment', 'ruleVersion', 'threshold') if key in record}
    clean.update(id=adapter.record_id(target), status='投递成功')
    if adapter.key != DEFAULT_PLATFORM:
        clean['platform'] = adapter.key
    return {'confirmed': True, 'record': clean}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    check = commands.add_parser('check')
    check.add_argument('url')
    check.add_argument('--platform', default=DEFAULT_PLATFORM)
    attempt = commands.add_parser('attempt', help='取得提交授权后、点击前写入；结果不明时保留')
    attempt.add_argument('url')
    attempt.add_argument('--resume', required=True)
    attempt.add_argument('--platform', default=DEFAULT_PLATFORM)
    record = commands.add_parser('record')
    record.add_argument('file', type=Path)
    record.add_argument('--observed-success', action='store_true')
    args = parser.parse_args()
    journal_path = ROOT / 'data/application_attempts.json'
    journal = json.loads(journal_path.read_text()) if journal_path.exists() else {}
    if args.command in ('check', 'attempt'):
        state = json.loads((ROOT / 'data/state.json').read_text())
        adapter = get_platform(args.platform)
        result = preflight(args.url, state, journal, adapter.key)
        if args.command == 'attempt':
            if result['blocked']:
                raise ValueError(result['reason'])
            journal[adapter.journal_key(result['jobId'])] = {'status': '提交尝试，结果待核查', 'resume': args.resume, 'time': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()}
            journal_path.write_text(json.dumps(journal, ensure_ascii=False, indent=2))
        print(json.dumps(result, ensure_ascii=False))
    else:
        payload = result_payload(json.loads(args.file.read_text()), args.observed_success)
        request = Request(BASE + '/api/records', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        # No retry on timeout or 409: inspect existing records before any retry.
        with urlopen(request, timeout=10) as response:
            print(response.read().decode())


if __name__ == '__main__':
    main()
