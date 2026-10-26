"""前程无忧接入：只用临时数据和模拟网络，不写正式投递记录。"""
import copy
import hashlib
import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch
import application_run as runner
import application_batch as batch
from application_guard import preflight
from platforms import get_platform
from platforms.job51 import requirements
import test_application_run as fixtures
from test_application_batch import JOB, S

URL = 'https://jobs.51job.com/shanghai-pdxq/174008722.html'
RECEIPT = 'https://jobs.51job.com/applysuccess.php?jobid=174008722'


class Job51Tests(unittest.TestCase):
    setUp = fixtures.RunTests.setUp
    tearDown = fixtures.RunTests.tearDown
    save_state = fixtures.RunTests.save_state

    def setup51(self):
        source = Path(runner.__file__).parent
        shutil.copytree(source/'skills/51job-apply', self.root/'skills/51job-apply')
        folder = self.root/'run51'
        runner.start_run(folder, platform='51job', limit=2)
        job = {**JOB, 'platform':'51job', 'url':URL, 'campus':False, 'labelsVerified':True, 'jdComplete':True}
        return get_platform('51job'), folder, job

    def prepare51(self):
        adapter, folder, job = self.setup51()
        runner.score_input(folder, job)
        runner.approve(folder, job, 80.5)
        gate = runner.browser_gate(folder, '174008722')
        observed = {'platform':'51job','jobId':'174008722','observedUrl':URL,'handoffId':gate['handoffId'],
                    'status':'ready_to_confirm','submissionSent':False,'attachment':'综合能力简历',
                    'jdHash':hashlib.sha256(job['jd'].encode()).hexdigest(),
                    'page':{'dialogTitle':'选择需要同步发送的附件简历','selectedAttachments':['综合能力简历'],
                            'sendCount':1,'extraInputs':0}, 'evidence':'现场DOM附件选中证据'}
        return adapter, folder, job, gate, observed

    def test_identity_accepts_only_real_detail_urls(self):
        adapter = get_platform('51job')
        self.assertEqual(adapter.job_id(URL+'?source=test'), '174008722')
        for url in [RECEIPT,'https://jobs.51job.com.evil.test/shanghai/174008722.html',
                    'https://51job.com/shanghai/174008722.html','http://jobs.51job.com/shanghai/174008722.html',
                    'https://x@jobs.51job.com/shanghai/174008722.html',URL+'#other']:
            with self.subTest(url=url), self.assertRaises(ValueError): adapter.job_id(url)

    def test_same_rules_and_same_scoring_materials(self):
        adapter, folder, job = self.setup51()
        for delta in [{}, {'salary':'100-200元/天'}, {'salary':'3-4千'}, {'days':6}, {'months':7},
                      {'city':'杭州'}, {'delivered':True}, {'expired':True}, {'days':None}]:
            with self.subTest(delta=delta):
                sx = runner.screen_jobs([{**JOB,'jdComplete':True,**delta}],S,detail=True)[0]
                other = runner.screen_jobs([{**job,**delta}],S,detail=True,platform='51job')[0]
                self.assertEqual((sx['action'],sx['reason'],sx['missing']), (other['action'],other['reason'],other['missing']))
        a = runner.score_input(self.run,JOB); b = runner.score_input(folder,job)
        self.assertEqual(a['rules'],b['rules']); self.assertEqual(a['resume'],b['resume'])
        self.assertEqual(runner.approve(folder,job,59.99)['action'],'pending_review')
        self.assertEqual(runner.approve(folder,job,60)['action'],'execute_submission')

    def test_platform_tags_are_not_common_hard_conditions(self):
        adapter, folder, job = self.setup51()
        for changes in [{'campus':True}, {'campus':None}, {'labelsVerified':False}, {'jdComplete':False}]:
            self.assertEqual(runner.score_input(folder,{**job,**changes})['action'],'skip')
        self.assertEqual(runner.score_input(self.run,{**JOB,'campus':True,'labelsVerified':False})['action'],'need_gpt_assessment')

    def test_detail_requirements_and_ambiguous_fields(self):
        self.assertEqual(requirements('每周实习3个工作日以上；至少三个月')['days'],3)
        self.assertEqual(requirements('每周实习3个工作日以上；至少三个月')['months'],3)
        self.assertEqual(requirements('每周3-5天，实习3至6个月')['months'],3)
        self.assertEqual(requirements('至少实习半年')['months'],6)
        self.assertNotIn('months',requirements('可以长期实习'))
        self.assertIn('days',requirements('每周3天；每周5天')['conflicts'])
        adapter, folder, job = self.setup51()
        raw = {**job,'kind':'detail','jobId':'174008722','observedUrl':URL,'salary':'3-4千',
               'jd':'每周3个工作日以上，可以长期实习'}
        value = runner.ingest_detail(folder,raw)
        self.assertEqual(value['job']['days'],3)
        self.assertNotIn('months',value['job'])
        self.assertEqual(value['check']['action'],'skip')
        self.assertIn('无法确认：日薪无法确认', value['check']['reason'])

    def test_prepare_requires_exact_attachment_and_not_yet_sent(self):
        adapter, folder, job, gate, observed = self.prepare51()
        for change in [{'submissionSent':True},{'attachment':'简历'}, {'page':{}}, {'evidence':''}]:
            with self.subTest(change=change), self.assertRaises(ValueError): runner.arm(folder,{**observed,**change})
        wrong = copy.deepcopy(observed);wrong['page']['selectedAttachments']=['简历','综合能力简历']
        with self.assertRaises(ValueError):runner.arm(folder,wrong)
        armed = runner.arm(folder,observed)
        self.assertEqual(runner.session_state(folder,'174008722')['gate']['attemptId'],armed['attemptId'])
        self.assertIn('51job:174008722',runner.read(self.root/'data/application_attempts.json'))

    def test_success_receipt_is_bound_to_attempt_and_original_url(self):
        adapter, folder, job, gate, prepared = self.prepare51()
        gate = runner.arm(folder,prepared)
        observed = {**prepared,'status':'success','submissionSent':True,'attemptId':gate['attemptId'],
                    'observedUrl':RECEIPT,'page':{'receiptText':'投递成功，前往应届生求职App随时查看更多职位'},
                    'evidence':'本次页面明确显示：投递成功'}
        for change in [{'observedUrl':RECEIPT+'9'},{'attemptId':'old'},{'platform':'shixiseng'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):runner.consume_browser(folder,{**observed,**change},False)
        for change in [{'observedUrl':URL},{'submissionSent':False},{'page':{}},{'evidence':'仅按钮已投递'}]:
            self.assertEqual(runner.consume_browser(folder,{**observed,**change},False)['action'],'needs_reconciliation')
        result = runner.consume_browser(folder,observed,False)
        record = runner.read(Path(result['file']))['record']
        self.assertEqual(record['url'],URL);self.assertEqual(record['id'],'51job:174008722')
        self.assertEqual(record['score'],80.5);self.assertEqual(record['scoringResume'],'共享简历')
        self.assertIn('综合能力简历',record['submittedResume'])
        self.assertEqual(runner.session_state(folder,'174008722')['finished'],True)
        self.assertEqual(runner.read(self.run/'run.json')['successIds'],[])

    def test_foreign_receipt_never_works_for_shixiseng(self):
        observed = fixtures.RunTests.ready_observation(self)
        gate = runner.arm(self.run,observed)
        with self.assertRaises(ValueError):
            runner.consume_browser(self.run,{**observed,'status':'success','attemptId':gate['attemptId'],
                'observedUrl':RECEIPT,'clickedConfirm':True,'evidence':'文本 投递成功'},False)

    def test_settings_and_resume_change_block_sending(self):
        adapter, folder, job, gate, prepared = self.prepare51()
        runner.arm(folder,prepared)
        self.state['settings']['days']='2';self.save_state()
        with self.assertRaises(ValueError):runner.confirm_gate(folder,'174008722')
        self.state['settings']['days']='5';self.state['resume']['text']='新简历';self.save_state()
        with self.assertRaises(ValueError):runner.confirm_gate(folder,'174008722')

    def test_current_shared_website_settings_and_limit(self):
        adapter, folder, job = self.setup51()
        self.state['settings']['keywords']='市场分析、产品';self.save_state()
        value = runner.website_input(folder)
        self.assertEqual(value['keywords'],['市场分析','产品']);self.assertNotIn('resume',value)
        self.assertEqual(value['cities'],['上海'])
        run = runner.read(folder/'run.json');run['activeAttempt']={'jobId':'174008722'};runner.write(folder/'run.json',run)
        with self.assertRaises(ValueError):runner.website_input(folder)

    def test_flush_uses_original_api_and_platform_record_identity(self):
        record={'id':'51job:174008722','platform':'51job','url':URL,'status':'投递成功','score':80.5,'evidence':'真实回执投递成功'}
        class Response:
            def __init__(self,value):self.value=value
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return json.dumps(self.value).encode()
        with patch.object(batch,'urlopen',side_effect=[Response({'records':[]}),Response({'record':record})]) as network:
            result=batch.flush([{'confirmed':True,'record':record}])
        self.assertEqual(result[0]['result'],'saved')
        request=network.call_args_list[1].args[0]
        self.assertEqual(request.full_url,runner.BASE+'/api/records')
        self.assertEqual(json.loads(request.data)['record']['id'],'51job:174008722')

    def test_legacy_prepare_command_cannot_silently_send(self):
        adapter, folder, job, gate, prepared=self.prepare51()
        with self.assertRaisesRegex(ValueError,'单步browser-code不会执行发送'):
            adapter.browser_code(self.root,gate,'prepare',True)
        self.assertIn('skills/51job-apply/',adapter.session_code(self.root))
        self.assertNotIn('shixiseng-apply',adapter.session_code(self.root))


if __name__ == '__main__': unittest.main()
