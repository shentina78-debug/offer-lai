"""仅前程无忧：页面字段、专用标签、附件选择及成功回执。"""
import hashlib
import json
import re
from urllib.parse import parse_qs, urlsplit
from .base import PlatformAdapter, PreparedSubmission, SubmissionOutcome

PACKAGE = 'skills/51job-apply/'
CN = {'一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6,
      '七': 7, '八': 8, '九': 9, '十': 10, '十二': 12}
NUM = r'(\d+(?:\.\d+)?|十二|[一二两三四五六七八九十])'


def amount(value):
    return float(value) if re.fullmatch(r'\d+(?:\.\d+)?', value) else CN[value]


def requirements(jd):
    """只提取有明确单位的最低要求；含糊表达留给Agent，不推算天/月。"""
    facts, conflicts = {}, []
    patterns = {
        'days': [r'(?:每周|一周|周出勤|周实习)\s*(?:至少|不少于|最少|保证|实习|出勤|到岗|工作|能到岗)*\s*' + NUM + r'\s*(?:[-—–~至到]\s*' + NUM + r')?\s*(?:个)?\s*(?:工作日|天)'],
        'months': [r'(?:实习(?:期(?:限)?|时间|时长)?|至少|不少于|最少)\s*(?:至少|不少于|最少|为|需|需要|保证|达到|满)?\s*' + NUM + r'\s*(?:[-—–~至到]\s*' + NUM + r')?\s*(?:个)?月'],
    }
    for key, expressions in patterns.items():
        matches = [m for expression in expressions for m in re.finditer(expression, jd)]
        if key == 'months' and re.search(r'(?:实习|至少|不少于).{0,8}半年', jd):
            facts['months'] = 6
        values = {amount(m[1]) for m in matches}
        if len(values) == 1:
            value = values.pop()
            if key in facts and facts[key] != value:
                conflicts.append(key)
            facts[key] = value
            facts[key + 'Evidence'] = matches[0][0]
        elif len(values) > 1:
            conflicts.append(key)
    if conflicts:
        facts['conflicts'] = conflicts
    return facts


class Job51Adapter(PlatformAdapter):
    key, name = '51job', '前程无忧'
    skill_path = PACKAGE + 'SKILL.md'
    fast_path = steps_path = PACKAGE + '前程无忧投递步骤.md'

    def validate_id(self, identity):
        if not isinstance(identity, str) or not re.fullmatch(r'[1-9]\d{0,11}', identity):
            raise ValueError('前程无忧岗位ID无效')

    def _url(self, url, host='jobs.51job.com'):
        p = urlsplit(url)
        if p.scheme != 'https' or p.hostname != host or p.username or p.password or p.port or p.fragment:
            raise ValueError('前程无忧页面URL无效')
        return p

    def job_id(self, url):
        p = self._url(url)
        match = re.fullmatch(r'/[a-z0-9-]+/([1-9]\d{0,11})\.html', p.path)
        if not match:
            raise ValueError('必须提供前程无忧岗位详情URL')
        return match[1]

    def observation_job_id(self, observed):
        p = self._url(observed.get('observedUrl', ''))
        if p.path == '/applysuccess.php':
            ids = parse_qs(p.query).get('jobid', [])
            if len(ids) != 1:
                raise ValueError('成功回执缺少唯一岗位ID')
            self.validate_id(ids[0])
            return ids[0]
        return self.job_id(observed.get('observedUrl', ''))

    def candidate_rejection(self, job, detail=False):
        # “校招”排除和“实习”标签解释仅属于前程无忧。
        if job.get('campus') is True:
            return '前程无忧：黄色校招标签，跳过'
        if job.get('campus') is not False or job.get('labelsVerified') is not True:
            return '前程无忧：岗位标签未核实，交Agent核对后再继续'
        if detail and job.get('jdComplete') is not True:
            return '前程无忧：完整JD尚未读取'
        return None

    def parse_listing(self, snapshot):
        data = json.loads(snapshot) if isinstance(snapshot, str) else snapshot
        self.validate_platform(data)
        self._url(data['observedUrl'], 'we.51job.com')
        if data.get('kind') != 'listing':
            raise ValueError('不是前程无忧列表观察')
        # 无真实详情链接的卡片由网页程序先打开名称，不能编造URL或岗位ID。
        output = []
        for job in data.get('candidates', []):
            if not job.get('url'):
                continue
            self.job_id(job['url'])
            if self.candidate_rejection(job) is None:
                output.append({**job, 'platform': self.key})
        return output

    def parse_detail(self, observed):
        self.validate_platform(observed)
        identity = self.job_id(observed['observedUrl'])
        if observed.get('kind') != 'detail' or observed.get('jobId') != identity:
            raise ValueError('前程无忧详情来源与岗位不一致')
        job = {key: observed[key] for key in ('role', 'company', 'city', 'salary', 'jobType', 'workMode',
               'jd', 'delivered', 'expired', 'campus', 'labelsVerified', 'jdComplete') if key in observed}
        if not job.get('role') or not job.get('company'):
            raise ValueError('岗位名称或招聘公司尚未读取')
        job.update(platform=self.key, url=observed['observedUrl'], **requirements(job.get('jd', '')))
        return job

    def website_options(self, settings):
        split = lambda text: [w.strip() for w in re.split(r'[,，、;；\n]+', text or '') if w.strip()]
        keywords, cities = split(settings.get('keywords')), split(settings.get('cities'))
        if not keywords:
            raise ValueError('工作台未保存岗位关键词')
        if not cities or '不限' in cities or settings.get('jobType') != '实习':
            raise ValueError('当前只验证了指定城市的实习搜索；请Agent核对工作台设置，不自行覆盖条件')
        return {'platform': self.key, 'keywords': keywords, 'cities': cities, 'jobType': '实习', 'sort': '最新优先'}

    def execution_key(self, root):
        names = ['SKILL.md', '前程无忧投递步骤.md', 'submission_profile.json',
                 'scripts/submission_flow.js', 'scripts/submission_bridge.mjs']
        return hashlib.sha256(b''.join((root/(PACKAGE + n)).read_bytes() for n in names)).hexdigest()

    def gate_fields(self, root):
        p = json.loads((root/(PACKAGE + 'submission_profile.json')).read_text())
        return {'attachment': p['attachment'], 'dialogTitle': p['dialogTitle']}

    def submission_context(self, job):
        return {'expectedJDHash': hashlib.sha256(job['jd'].encode()).hexdigest(),
                'expectedRole': job['role'], 'expectedCompany': job['company']}

    def validate_prepared(self, observed, gate):
        page = observed.get('page', {})
        if observed.get('status') != 'ready_to_confirm' or observed.get('submissionSent') is not False:
            raise ValueError('前程无忧未准备好或已经发送')
        if (observed.get('attachment') != gate['attachment'] or page.get('dialogTitle') != gate['dialogTitle']
                or page.get('selectedAttachments') != [gate['attachment']] or page.get('sendCount') != 1
                or page.get('extraInputs') or observed.get('jdHash') != gate['expectedJDHash']
                or not observed.get('evidence')):
            raise ValueError('前程无忧附件选择或弹窗证据未核实')
        return PreparedSubmission('前程无忧附件：' + gate['attachment'])

    def outcome(self, observed):
        if observed.get('status') == 'pending_result':
            return SubmissionOutcome('pending')
        if observed.get('status') != 'success' or observed.get('submissionSent') is not True:
            return SubmissionOutcome('unknown')
        p = self._url(observed.get('observedUrl', ''))
        page = observed.get('page', {})
        if (p.path == '/applysuccess.php' and self.observation_job_id(observed) == observed.get('jobId')
                and page.get('receiptText', '').startswith('投递成功')
                and '投递成功' in observed.get('evidence', '')):
            return SubmissionOutcome('success')
        return SubmissionOutcome('unknown')

    def resume_fields(self, observed, scoring_resume):
        submitted = '前程无忧附件：' + observed['attachment']
        return {'submittedResume': submitted, 'scoringResume': scoring_resume,
                'resume': submitted + '（按站内附件名称选择，未核验与评分简历内容一致）'}

    def session_code(self, root):
        url = (root/(PACKAGE + 'scripts/submission_bridge.mjs')).as_uri() + '?revision=' + self.execution_key(root)[:16]
        return ('var job51Bridge = await import(' + json.dumps(url) + ');\n'
                'var job51Session = job51Bridge.createSubmissionSession(job51Tab, {\n'
                '  listTabs: () => cua.listTabs({browser: job51Browser.browserId, emit: false}),\n'
                '  bindTab: id => cua.getTab(id, {browser: job51Browser.browserId})\n});')

    def browser_code(self, root, gate, phase, include_driver):
        if gate is None:
            return self.session_code(root)
        # 旧单步prepare不能暗中变成完整发送；新平台显式使用持久会话入口。
        raise ValueError('前程无忧使用session-code及job51Session.submit/inspect；单步browser-code不会执行发送')
