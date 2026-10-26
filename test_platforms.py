"""接口隔离回归：虚拟平台仅在测试里注册，不访问招聘网站或生产数据。"""
import json
import re
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

import application_batch as batch
import application_run as runner
import platforms
from application_guard import preflight
from platforms.base import PlatformAdapter, PreparedSubmission, SubmissionOutcome
from test_application_batch import JOB, S
import test_application_run as run_fixtures


class InlineTestPlatform(PlatformAdapter):
    """测试专用：使用内嵌页面和回执号，没有弹窗、附件或确认勾选。"""
    key = 'inline_test'
    name = '测试平台（不启用）'
    skill_path = fast_path = steps_path = 'test-only'

    def validate_id(self, identity):
        if not isinstance(identity, str) or not re.fullmatch(r'inn_[a-z0-9]+', identity):
            raise ValueError('岗位ID无效')

    def job_id(self, url):
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != 'jobs.example.test':
            raise ValueError('测试平台URL无效')
        identity = parsed.path.removeprefix('/positions/')
        self.validate_id(identity)
        return identity

    def parse_listing(self, snapshot):
        return json.loads(snapshot)

    def execution_key(self, root):
        return 'inline-test-v1'

    def gate_fields(self, root):
        return {'resumePolicy': '在线简历'}

    def validate_prepared(self, observed, gate):
        if observed.get('formReady') is not True or observed.get('submissionSent') is not False:
            raise ValueError('内嵌表单未准备好')
        return PreparedSubmission('测试平台已核实在线简历')

    def outcome(self, observed):
        if observed.get('pageState') == 'receipt' and observed.get('receiptId') and observed.get('evidence'):
            return SubmissionOutcome('success')
        if observed.get('pageState') == 'rejected' and observed.get('evidence'):
            return SubmissionOutcome('failure')
        if observed.get('pageState') == 'sending':
            return SubmissionOutcome('pending')
        return SubmissionOutcome('unknown')

    def resume_fields(self, observed, scoring_resume):
        return {'submittedResume': '测试平台已核实在线简历', 'scoringResume': scoring_resume,
                'resume': '测试平台已核实在线简历'}

    def browser_code(self, root, gate, phase, include_driver):
        return 'test-only'

    def session_code(self, root):
        return 'test-only'


class PlatformTests(unittest.TestCase):
    # 复用原有隔离数据准备；不继承原测试集，避免重复跑同一组测试。
    setUp = run_fixtures.RunTests.setUp
    tearDown = run_fixtures.RunTests.tearDown
    save_state = run_fixtures.RunTests.save_state
    ready_observation = run_fixtures.RunTests.ready_observation

    def fake_run(self):
        adapter = InlineTestPlatform()
        patcher = patch.dict(platforms._ADAPTERS, {adapter.key: adapter})
        patcher.start();self.addCleanup(patcher.stop)
        folder = self.root/'inline-run'
        runner.start_run(folder, platform=adapter.key)
        job = {**JOB, 'url': 'https://jobs.example.test/positions/inn_test123', 'platform': adapter.key}
        return adapter, folder, job

    def fake_arm(self):
        adapter, folder, job = self.fake_run()
        runner.approve(folder, job, 80.5)
        gate = runner.browser_gate(folder, 'inn_test123')
        observed = {'platform': adapter.key, 'jobId': gate['jobId'], 'observedUrl': job['url'],
                    'handoffId': gate['handoffId'], 'formReady': True, 'submissionSent': False,
                    'evidence': '本页在线简历与投递表单已核实'}
        armed = runner.arm(folder, observed)
        return adapter, folder, job, armed

    def test_registered_platforms_are_isolated_and_unknown_is_rejected(self):
        self.assertEqual(set(platforms._ADAPTERS), {'shixiseng', '51job'})
        self.assertIs(platforms.get_platform('实习僧'), platforms.get_platform())
        self.assertIs(platforms.get_platform('前程无忧'), platforms.get_platform('51job'))
        for name in ('unknown',):
            folder = self.root/name
            with self.subTest(platform=name), self.assertRaisesRegex(ValueError, '尚未接入'):
                runner.start_run(folder, platform=name)
            self.assertFalse(folder.exists())

    def test_legacy_run_ready_and_armed_keep_handoff(self):
        observation = self.ready_observation()
        handoff = observation['handoffId']
        run = runner.read(self.run/'run.json');run.pop('platform');runner.write(self.run/'run.json', run)
        ready = runner.read(self.run/'inn_test123.ready.json')
        ready.pop('platform');ready.pop('adapterKey');runner.write(self.run/'inn_test123.ready.json', ready)
        self.assertEqual(runner.browser_gate(self.run, 'inn_test123')['handoffId'], handoff)
        gate = runner.arm(self.run, observation)
        gate.pop('platform');runner.write(self.run/'inn_test123.armed.json', gate)
        self.assertEqual(runner.confirm_gate(self.run, 'inn_test123')['attemptId'], gate['attemptId'])
        self.assertIn('inn_test123', runner.read(self.root/'data/application_attempts.json'))

    def test_non_popup_platform_uses_same_screen_score_and_records(self):
        adapter, folder, job, gate = self.fake_arm()
        self.assertNotIn('supplements', gate)
        self.assertEqual(runner.confirm_gate(folder, 'inn_test123'), gate)
        observed = {'platform': adapter.key, 'jobId': 'inn_test123', 'observedUrl': job['url'],
                    'handoffId': gate['handoffId'], 'attemptId': gate['attemptId'],
                    'pageState': 'receipt', 'receiptId': 'receipt-1', 'evidence': '个人投递记录显示回执 receipt-1'}
        result = runner.consume_browser(folder, observed, send=False)
        record = runner.read(Path(result['file']))['record']
        self.assertEqual(record['id'], 'inline_test:inn_test123')
        self.assertEqual(record['score'], 80.5)
        self.assertEqual(record['scoringResume'], self.state['resume']['name'])
        self.assertNotIn('附件', record['resume'])
        self.assertNotIn('clickedConfirm', record['browserResult'])
        self.assertEqual(record['status'], '投递成功')
        self.assertEqual(runner.read(folder/'run.json')['successIds'], ['inn_test123'])
        self.assertEqual(runner.read(self.run/'run.json')['successIds'], [])

    def test_same_site_fields_follow_identical_common_rules(self):
        adapter, folder, job = self.fake_run()
        cases = [({}, 80), ({'city': '北京'}, 80), ({'days': 6}, 80), ({'months': 12}, 80),
                 ({'salary': '100-200/天'}, 80), ({'delivered': True}, 80), ({'jd': ''}, 80),
                 ({}, 59.99), ({}, 60), ({}, 60.01)]
        for change, score in cases:
            with self.subTest(change=change, score=score):
                sx = runner.approve(self.run, {**JOB, **change}, score)
                other = runner.approve(folder, {**job, **change}, score)
                for key in ('action', 'score', 'threshold', 'reason', 'missing'):
                    self.assertEqual(sx.get(key), other.get(key))
        materials = runner.score_input(folder, job)
        self.assertEqual(materials['resume'], self.state['resume'])
        self.assertEqual(materials['rules'], runner.score_input(self.run, JOB)['rules'])

    def test_same_raw_id_does_not_mix_records_or_attempts(self):
        adapter, folder, job = self.fake_run()
        sx_record = {'id': 'shixiseng:inn_test123', 'url': JOB['url']}
        other_record = {'id': 'inline_test:inn_test123', 'url': job['url'], 'platform': adapter.key}
        self.assertFalse(preflight(job['url'], {'records': [sx_record]}, {'inn_test123': {}}, adapter.key)['blocked'])
        self.assertFalse(preflight(JOB['url'], {'records': [other_record]}, {'inline_test:inn_test123': {}})['blocked'])
        self.assertTrue(preflight(job['url'], {'records': [other_record]}, {}, adapter.key)['blocked'])
        self.assertTrue(preflight(JOB['url'], {'records': [sx_record]}, {})['blocked'])
        self.assertTrue(preflight(job['url'], {}, {'inline_test:inn_test123': {}}, adapter.key)['blocked'])

    def test_foreign_platform_or_url_rejected_before_attempt(self):
        observed = self.ready_observation()
        for change in ({'platform': 'inline_test'}, {'observedUrl': 'https://jobs.example.test/positions/inn_test123'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                runner.arm(self.run, {**observed, **change})
        self.assertFalse((self.root/'data/application_attempts.json').exists())
        self.assertNotIn('activeAttempt', runner.read(self.run/'run.json'))

    def test_foreign_or_stale_result_cannot_create_success(self):
        gate = runner.arm(self.run, self.ready_observation())
        valid = dict(status='success', jobId='inn_test123', handoffId=gate['handoffId'], attemptId=gate['attemptId'],
                     observedUrl=JOB['url'], clickedConfirm=True, evidence='文本 投递成功')
        for change in ({'platform': 'inline_test'}, {'attemptId': 'old'}, {'handoffId': 'old'},
                       {'observedUrl': JOB['url']+'other'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                runner.consume_browser(self.run, {**valid, **change}, False)
        self.assertFalse(list(self.run.glob('*.record.json')))
        self.assertIn('activeAttempt', runner.read(self.run/'run.json'))

    def test_shixiseng_evidence_stays_strict(self):
        observed = self.ready_observation()
        for change in ({'attachment': '在线简历'}, {'supplements': {}}, {'evidence': '附件简历 未勾选'},
                       {'clickedConfirm': True}, {'status': 'ready'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                runner.arm(self.run, {**observed, **change})
        gate = runner.arm(self.run, observed)
        base = dict(status='success', jobId='inn_test123', handoffId=gate['handoffId'], attemptId=gate['attemptId'],
                    observedUrl=JOB['url'], clickedConfirm=True, evidence='文本 投递成功')
        for change in ({'clickedConfirm': False}, {'evidence': '按钮 投递成功'}, {'evidence': ''}):
            with self.subTest(change=change):
                result = runner.consume_browser(self.run, {**base, **change}, False)
                self.assertEqual(result['action'], 'needs_reconciliation')
        self.assertFalse(list(self.run.glob('*.record.json')))

    def test_shixiseng_success_words_are_not_other_platform_evidence(self):
        adapter, folder, job, gate = self.fake_arm()
        observed = dict(platform=adapter.key, jobId='inn_test123', observedUrl=job['url'],
                        handoffId=gate['handoffId'], attemptId=gate['attemptId'],
                        status='success', clickedConfirm=True, evidence='文本 投递成功')
        self.assertEqual(runner.consume_browser(folder, observed, False)['action'], 'needs_reconciliation')
        self.assertFalse(list(folder.glob('*.record.json')))

    def test_adapter_change_blocks_new_submission_but_keeps_actual_success(self):
        runner.approve(self.run, JOB, 80)
        with patch.object(type(platforms.get_platform()), 'adapter_key', return_value='changed'):
            with self.assertRaisesRegex(ValueError, '适配程序已修改'):
                runner.check_ready(self.run, 'inn_test123')
            result = runner.finalize(self.run, 'inn_test123', '已核实真实页面成功', True, False)
        self.assertTrue(result['savedLocally'])

    def test_flush_preserves_same_api_and_platform_ids(self):
        adapter, folder, job = self.fake_run()
        records = [dict(id='shixiseng:inn_test123', url=JOB['url'], status='待审核', score=None, evidence='评分异常，暂无有效评分'),
                   dict(id='inline_test:inn_test123', url=job['url'], platform=adapter.key, status='待审核', score=55, evidence='低分，未提交')]
        class Response:
            def __init__(self, value): self.value = value
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps(self.value).encode()
        replies = [Response({'records': []}), *(Response({'record': row}) for row in records)]
        with patch.object(batch, 'urlopen', side_effect=replies) as network:
            result = batch.flush([{'confirmed': True, 'record': row} for row in records])
        self.assertEqual([x['result'] for x in result], ['saved', 'saved'])
        posts = [call.args[0] for call in network.call_args_list[1:]]
        self.assertTrue(all(request.full_url == runner.BASE+'/api/records' for request in posts))
        self.assertEqual([json.loads(request.data)['record']['id'] for request in posts], [r['id'] for r in records])

    def test_run_rejects_foreign_ready_packet(self):
        runner.approve(self.run, JOB, 80)
        file = self.run/'inn_test123.ready.json'
        packet = runner.read(file);packet['platform'] = 'inline_test';runner.write(file, packet)
        with self.assertRaisesRegex(ValueError, '平台不一致'):
            runner.check_ready(self.run, 'inn_test123')

    def test_ready_filename_cannot_substitute_another_job(self):
        runner.approve(self.run, JOB, 80)
        packet=runner.read(self.run/'inn_test123.ready.json')
        runner.write(self.run/'inn_other.ready.json',packet)
        with self.assertRaisesRegex(ValueError,'岗位不一致'):
            runner.check_ready(self.run,'inn_other')


if __name__ == '__main__':
    unittest.main()
