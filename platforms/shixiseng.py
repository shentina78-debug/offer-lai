"""仅实习僧：原有岗位识别、AX解析、附件/弹窗证据及CUA执行入口。"""
import hashlib
import json
import re
from urllib.parse import urlsplit
from .base import PlatformAdapter, PreparedSubmission, SubmissionOutcome


class ShixisengAdapter(PlatformAdapter):
    key = 'shixiseng'
    name = '实习僧'
    skill_path = 'skills/shixiseng-apply/SKILL.md'
    fast_path = 'skills/shixiseng-apply/fast-path.md'
    steps_path = '实习僧投递步骤.md'
    pending_reason = '继续只读核查本次结果，不再点击确认'

    def validate_id(self, identity):
        if not isinstance(identity, str) or not re.fullmatch(r'inn_[a-z0-9]+', identity):
            raise ValueError('岗位ID无效')

    def record_aliases(self, identity):
        return (identity, self.record_id(identity))

    def journal_key(self, identity):
        self.validate_id(identity)
        return identity  # 保持已有实习僧提交日志的键，不迁移历史数据。

    def validate_platform(self, value):
        if value.get('platform', self.key) != self.key:
            raise ValueError('岗位或网页结果的平台与本轮不一致')

    def job_id(self, url):
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or parsed.hostname not in ('shixiseng.com', 'www.shixiseng.com') or parsed.username or parsed.password or parsed.port:
            raise ValueError('必须提供实习僧岗位详情 URL')
        match = re.fullmatch(r'/intern/(inn_[a-z0-9]+)/*', parsed.path)
        if not match:
            raise ValueError('无法识别岗位 ID')
        return match[1]

    def parse_listing(self, snapshot):
        """只解析通过cua观察得到的AX文本，不访问浏览器内部或招聘网站接口。"""
        lines = snapshot.splitlines()
        found = []
        for index, line in enumerate(lines):
            link = re.search(r'\blink (.*?),.*?Value: (https?://)?((?:www\.)?shixiseng\.com/intern/inn_[a-z0-9]+)', line)
            if not link:
                # AX还可能用“link 名字, Value: ...”，上面的匹配同样涵盖。
                continue
            block = []
            for later in lines[index + 1:]:
                if re.search(r'\blink .*?Value: (?:https?://)?(?:www\.)?shixiseng\.com/intern/', later):
                    break
                if len(block) == 24:
                    break
                block.append(later)
            context = '\n'.join(block)
            row = {'url': 'https://' + link[3], 'role': link[1]}
            # URL路径不足以证明岗位类型；未明确观察到时留到详情确认。
            area = re.search(r'(?:text|文本)\s+([^|\n]+?)\s*\|\s*([^|\n]+?)天[/／]周\s*\|\s*([^|\n]+?)个月', context)
            if area:
                row['city'] = area[1].strip()
                for key, value in [('days', area[2]), ('months', area[3])]:
                    if re.fullmatch(r'\d+(?:\.\d+)?', value.strip()):
                        row[key] = float(value)
            salary = re.search(r'(?:文本|text)\s+((?:\d+(?:\.\d+)?\s*[-–~]?\s*)+[/／]天|薪资面议|面议)', context)
            if salary:
                row['salary'] = salary[1].strip()
            company = re.search(r'\blink ([^,\n]+), Value: javascript:;', context)
            if company and company[1] != 'javascript:;':
                row['company'] = company[1].strip()
            # 页面反爬字体乱码不解码、不猜数值；缺项由详情确认。
            found.append(row)
        return found

    def execution_key(self, root):
        paths = ['实习僧投递步骤.md','skills/shixiseng-apply/submission_profile.json',
                 'skills/shixiseng-apply/scripts/submission_flow.js','skills/shixiseng-apply/scripts/submission_bridge.mjs']
        return hashlib.sha256(''.join((root/name).read_text() for name in paths).encode()).hexdigest()

    def gate_fields(self, root):
        profile = json.loads((root/'skills/shixiseng-apply/submission_profile.json').read_text())
        return {'supplements': profile['supplements']}

    def validate_prepared(self, observed, gate):
        if observed.get('status') != 'ready_to_confirm' or observed.get('clickedConfirm') is not False:
            raise ValueError('不是本次有效准备结果')
        if observed.get('attachment') != '中文附件简历' or observed.get('supplements') != gate['supplements']:
            raise ValueError('现场岗位、附件或补充信息不一致')
        if 'radio-choosed.png' not in observed.get('evidence', '') or '附件简历' not in observed['evidence']:
            raise ValueError('缺少现场勾选证据')
        return PreparedSubmission('实习僧现有中文附件简历')

    def outcome(self, observed):
        # 这些AX字样和 clickedConfirm 只对实习僧有效，绝不用于其他平台。
        clicked = observed.get('clickedConfirm') is True
        evidence = observed.get('evidence', '')
        if observed.get('status') == 'failed' and clicked and re.search(r'(?:文本|text) 投递失败(?:\n|$)', evidence):
            return SubmissionOutcome('failure')
        if observed.get('status') == 'pending_result':
            return SubmissionOutcome('pending')
        if observed.get('status') == 'success' and clicked and re.search(r'(?:文本|text) 投递成功(?:\n|$)', evidence):
            return SubmissionOutcome('success')
        return SubmissionOutcome('unknown')

    def resume_fields(self, observed, scoring_resume):
        submitted = observed.get('attachment', '实习僧现有中文附件简历')
        return {'submittedResume': submitted, 'scoringResume': scoring_resume,
                'resume': submitted + '（附件文件名未预览核验）'}

    def browser_code(self, root, gate, phase, include_driver):
        source = (root/'skills/shixiseng-apply/scripts/submission_flow.js').read_text() if include_driver else ''
        if include_driver:
            source += '\nvar shixisengFlow = createShixisengFlow(chrome);\n'
        if gate is None:
            return source
        return source + ('\nvar submissionResult = await shixisengFlow(' + json.dumps(gate, ensure_ascii=False)
                         + ',' + json.dumps(phase) + ');\nnodeRepl.write(submissionResult);')

    def session_code(self, root):
        url = (root/'skills/shixiseng-apply/scripts/submission_bridge.mjs').as_uri() + '?revision=' + self.execution_key(root)[:16]
        return ('var submissionBridge = await import(' + json.dumps(url) + ');\n'
                'var submissionSession = submissionBridge.createSubmissionSession(chrome);')
