import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import application_run as runner
from test_application_batch import JOB,S,assessment

class RunTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'data').mkdir()
  self.state={'settings':{**S,'threshold':60},'resume':{'text':'做过项目','name':'共享简历'},'records':[]}
  self.save_state();(self.root/'岗位匹配评分标准.md').write_text('规则')
  source=Path(runner.__file__).parent
  for name in ['实习僧投递步骤.md','skills/shixiseng-apply/submission_profile.json','skills/shixiseng-apply/scripts/submission_flow.js','skills/shixiseng-apply/scripts/submission_bridge.mjs']:
   target=self.root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text((source/name).read_text())
  self.mock=patch.object(runner,'ROOT',self.root);self.mock.start();self.run=self.root/'run';runner.start_run(self.run)
 def tearDown(self):self.mock.stop();self.tmp.cleanup()
 def save_state(self):runner.write(self.root/'data/state.json',self.state)
 def test_list_missing_and_mismatch(self):
  snapshot='link 产品实习, Value: https://www.shixiseng.com/intern/inn_test123\ntext 100-200/天\ntext 上海 | 乱码天/周 | 3个月'
  jobs=runner.parse_listing(snapshot);self.assertEqual(len(jobs),1);self.assertNotIn('days',jobs[0]);self.assertNotIn('jobType',jobs[0])
  self.assertEqual(runner.screen(jobs,S)[0]['action'],'skip')
  jobs[0]['salary']='200-250/天';self.assertEqual(runner.screen(jobs,S)[0]['action'],'open_detail')
 def test_success_persist_network_failure_and_idempotency(self):
  self.assertEqual(runner.approve(self.run,JOB,assessment())['action'],'execute_submission')
  with patch.object(runner,'flush',side_effect=OSError('offline')):
   result=runner.finalize(self.run,'inn_test123','页面投递成功',True)
  self.assertTrue(result['pendingSync']);self.assertEqual(result['successCount'],1)
  first=runner.read(Path(result['file']));runner.finalize(self.run,'inn_test123','重复核对',True,False)
  self.assertEqual(first,runner.read(Path(result['file'])))
  with self.assertRaises(ValueError):runner.approve(self.run,{**JOB,'url':JOB['url']+'x'},assessment())
 def test_pending_review_cannot_submit(self):
  a=assessment()
  for d in a['dimensions']:d['items'][0]['ratio']=0
  self.assertEqual(runner.approve(self.run,JOB,a)['action'],'pending_review')
  with self.assertRaises(ValueError):runner.finalize(self.run,'inn_test123','伪成功',True,False)
  result=runner.finalize(self.run,'inn_test123','低于门槛，未提交',False,False)
  self.assertEqual(runner.read(Path(result['file']))['record']['status'],'待审核')
 def test_changed_input_does_not_lose_actual_success(self):
  runner.approve(self.run,JOB,assessment());self.state['resume']['text']='已更新';self.save_state()
  result=runner.finalize(self.run,'inn_test123','页面成功',True,False)
  self.assertTrue(runner.read(Path(result['file']))['record']['inputChangedAfterAssessment'])
 def test_gate_rechecks_inputs_and_threshold(self):
  runner.approve(self.run,JOB,assessment());self.state['settings']['minSalary']=300;self.save_state()
  self.assertEqual(runner.check_ready(self.run,'inn_test123')['action'],'skip')
  self.state['resume']['text']='变化';self.save_state()
  with self.assertRaises(ValueError):runner.check_ready(self.run,'inn_test123')
 def ready_observation(self):
  runner.approve(self.run,JOB,assessment());gate=runner.browser_gate(self.run,'inn_test123')
  return dict(status='ready_to_confirm',jobId=gate['jobId'],handoffId=gate['handoffId'],clickedConfirm=False,observedUrl=JOB['url'],attachment='中文附件简历',supplements=gate['supplements'],evidence='文本 附件简历\n未加标签的图片 /radio-choosed.png')
 def test_fixed_handoff_and_complete(self):
  observation=self.ready_observation();gate=runner.arm(self.run,observation)
  self.assertEqual(gate,runner.confirm_gate(self.run,'inn_test123'))
  self.assertIn('attemptId',runner.read(self.root/'data/application_attempts.json')['inn_test123'])
  with self.assertRaises(ValueError):runner.arm(self.run,observation)
  outcome=dict(status='success',jobId='inn_test123',handoffId=gate['handoffId'],attemptId=gate['attemptId'],clickedConfirm=True,observedUrl=JOB['url'],evidence='文本 投递成功\n文本 一键投递6个职位')
  result=runner.consume_browser(self.run,outcome,False)
  self.assertEqual(runner.read(Path(result['file']))['record']['score'],100)
  self.assertTrue(runner.run_report(self.run)['withinTarget'])
 def test_unknown_browser_result_not_success(self):
  gate=runner.arm(self.run,self.ready_observation())
  result=runner.consume_browser(self.run,dict(status='uncertain',jobId='inn_test123',handoffId=gate['handoffId'],attemptId=gate['attemptId'],observedUrl=JOB['url'],clickedConfirm=True,evidence='旧弹窗'),False)
  self.assertEqual(result['action'],'needs_reconciliation');self.assertFalse(list(self.run.glob('*.record.json')))
 def test_arm_mismatched_page_and_confirm_changed_settings(self):
  observation=self.ready_observation();observation['observedUrl']='https://www.shixiseng.com/intern/inn_other'
  with self.assertRaises(ValueError):runner.arm(self.run,observation)
  gate=runner.arm(self.run,self.ready_observation());self.state['settings']['threshold']=95;self.save_state()
  with self.assertRaises(ValueError):runner.confirm_gate(self.run,gate['jobId'])
 def test_compact_score_and_hard_first(self):
  a=assessment();a['items']=[dict(item,dimension=d['name']) for d in a.pop('dimensions') for item in d['items']]
  self.assertEqual(runner.approve(self.run,JOB,a)['score'],100)
  # 硬筛失败不读取评分规则/简历材料给模型。
  (self.root/'岗位匹配评分标准.md').unlink()
  self.assertEqual(runner.score_input(self.run,{**JOB,'city':'北京'})['action'],'skip')
 def test_uncertain_attempt_reserves_run_and_metadata(self):
  observation=self.ready_observation();gate=runner.arm(self.run,observation)
  self.assertEqual(runner.read(self.run/'run.json')['activeAttempt']['jobId'],JOB['url'].split('/')[-1])
  with self.assertRaises(ValueError):runner.arm(self.run,dict(observation,jobId='inn_other'))
  ready=runner.read(self.run/'inn_test123.ready.json')
  self.assertIn('jdHash',ready['assessment']);self.assertIn('resumeHash',ready['assessment']);self.assertIn('analyzedAt',ready['assessment'])
 def test_score_material_change_rejected_before_handoff(self):
  self.assertEqual(runner.score_input(self.run,JOB)['action'],'need_gpt_assessment')
  self.state['settings']['preferences']='新偏好';self.save_state()
  with self.assertRaises(ValueError):runner.approve(self.run,JOB,assessment())
 def test_over_five_minutes_warns_and_still_allows_submission(self):
  run=runner.read(self.run/'run.json');run['startedAt']='2020-01-01T00:00:00+08:00';run['budgetSeconds']=1;runner.write(self.run/'run.json',run)
  self.assertEqual(runner.approve(self.run,JOB,assessment())['action'],'execute_submission')
  report=runner.run_report(self.run);self.assertFalse(report['withinTarget']);self.assertTrue(report['continueAfterTarget'])
 def test_explicit_failure_releases_slot_without_posting_success(self):
  gate=runner.arm(self.run,self.ready_observation())
  observed=dict(status='failed',jobId='inn_test123',handoffId=gate['handoffId'],attemptId=gate['attemptId'],observedUrl=JOB['url'],clickedConfirm=True,evidence='文本 投递失败\n文本 该职位需要你完善英文简历\n文本 返回',reason='该职位需要你完善英文简历')
  with patch.object(runner,'flush') as network:
   self.assertEqual(runner.consume_browser(self.run,observed)['action'],'next_candidate');runner.consume_browser(self.run,observed)
  network.assert_not_called();run=runner.read(self.run/'run.json');self.assertNotIn('activeAttempt',run);self.assertEqual(len(run['failures']),1)
  self.assertEqual(run['successIds'],[]);self.assertFalse(list(self.run.glob('*.record.json')))
  self.assertEqual(runner.approve(self.run,{**JOB,'url':JOB['url']+'other'},assessment())['action'],'execute_submission')
 def test_pending_result_preserves_attempt_until_observed(self):
  gate=runner.arm(self.run,self.ready_observation())
  observed=dict(status='pending_result',jobId='inn_test123',handoffId=gate['handoffId'],attemptId=gate['attemptId'],observedUrl=JOB['url'],clickedConfirm=True,evidence='文本 确认投递')
  self.assertEqual(runner.consume_browser(self.run,observed,False)['action'],'observe_result');self.assertIn('activeAttempt',runner.read(self.run/'run.json'))

 def test_hard_fail_and_bad_score(self):
  self.assertEqual(runner.approve(self.run,{**JOB,'city':'北京'},assessment())['action'],'skip')
  a=assessment();a['dimensions'][0]['items'][0]['resumeQuote']='不存在'
  with self.assertRaises(ValueError):runner.approve(self.run,JOB,a)

 def test_final_score_preserves_precision_and_live_threshold(self):
  self.state['settings']['threshold']=68.01;self.save_state()
  self.assertEqual(runner.approve(self.run,JOB,68)['action'],'pending_review')
  result=runner.approve(self.run,JOB,{'score':68.01})
  self.assertEqual(result['action'],'execute_submission');self.assertEqual(result['score'],68.01)
  self.state['settings']['threshold']=68.02;self.save_state()
  self.assertEqual(runner.check_ready(self.run,'inn_test123')['action'],'pending_review')

 def test_final_score_range_and_invalid_values(self):
  for value in (0,100):
   with self.subTest(valid=value):self.assertEqual(runner.approve(self.run,JOB,value)['score'],value)
  for value in (True,False,None,'68',{},-0.01,100.01,float('nan'),float('inf'),float('-inf'),{'score':True},{'score':'68'}):
   with self.subTest(invalid=value):
    with self.assertRaisesRegex(ValueError,'最终分数'):runner.approve(self.run,JOB,value)

 def test_final_score_record_has_no_scoring_details(self):
  runner.score_input(self.run,JOB)
  runner.approve(self.run,JOB,{'score':68,'reason':'旧评分依据','bonus':[{'detail':'旧加分明细'}]})
  result=runner.finalize(self.run,'inn_test123','页面投递成功',True,False)
  record=runner.read(Path(result['file']))['record']
  self.assertEqual(record['score'],68);self.assertEqual(record['reason'],'')
  self.assertEqual(record['assessment']['scoreMode'],'final_only')
  self.assertNotIn('bonus',record['assessment']);self.assertNotIn('reason',record['assessment'])
  self.assertNotIn('dimensions',record['assessment']);self.assertNotIn('旧评分',json.dumps(record,ensure_ascii=False))

 def test_legacy_scoring_details_are_not_propagated(self):
  runner.approve(self.run,JOB,assessment())
  saved=runner.read(self.run/'inn_test123.ready.json')['assessment']
  self.assertEqual(saved['score'],100)
  self.assertNotIn('dimensions',saved);self.assertNotIn('bonus',saved)

 def test_final_score_cli(self):
  import contextlib,io
  job=self.root/'job.json';runner.write(job,JOB);output=io.StringIO()
  with patch('sys.argv',['application_run.py','rate',str(self.run),str(job),'68.25']),contextlib.redirect_stdout(output):runner.main()
  self.assertEqual(json.loads(output.getvalue())['result']['score'],68.25)

if __name__=='__main__':unittest.main()
