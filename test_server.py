import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / 'data').mkdir()
        (root / 'uploads').mkdir()
        self.root_patch = patch.object(server, 'ROOT', root)
        self.root_patch.start()
        self.key_patch = patch.object(server, 'KEY', '')
        self.key_patch.start()

    def tearDown(self):
        self.key_patch.stop()
        self.root_patch.stop()
        self.temp.cleanup()

    def request(self, path, data=None, raw=None, headers=None):
        handler = server.Handler.__new__(server.Handler)
        body = raw if raw is not None else json.dumps(data or {}).encode()
        handler.path = path
        handler.headers = {'Host': '127.0.0.1:8765', 'Origin': 'http://127.0.0.1:8765', 'Content-Length': str(len(body)), **(headers or {})}
        handler.rfile = io.BytesIO(body)
        results = []
        handler.reply = lambda value, status=200: results.append((status, value))
        handler.send_error = lambda status: results.append((status, {}))
        handler.do_POST()
        return results[-1]

    def test_resume_upload_persists_without_saving_filters(self):
        server.write_state({'settings': {'major': '原专业'}, 'records': []})
        status, resume = self.request('/api/resume', raw='项目经历：使用 Python 与 SQL 分析数据，并撰写报告。邮箱 demo@example.com'.encode(), headers={'X-File-Extension': 'txt', 'X-File-Name': '%E6%88%91%E7%9A%84%E7%AE%80%E5%8E%86.txt'})
        self.assertEqual(status, 200)
        recovered = server.read_state()
        self.assertEqual(recovered['resume']['name'], '我的简历.txt')
        self.assertEqual(recovered['resume']['text'], resume['text'])
        self.assertNotIn('demo@example.com', resume['text'])
        self.assertEqual(recovered['settings']['major'], '原专业')

    def test_key_uses_keychain_and_never_state_or_response(self):
        with patch.object(server, 'save_key') as save:
            status, response = self.request('/api/ai-config', {'key': 'fake-test-secret', 'model': 'deepseek-flash'})
            save.assert_called_once_with('fake-test-secret')
        self.assertEqual(status, 200)
        self.assertTrue(response['configured'])
        self.assertNotIn('fake-test-secret', json.dumps(response))
        self.assertNotIn('fake-test-secret', json.dumps(server.read_state()))

    def test_failed_keychain_save_does_not_claim_configured(self):
        with patch.object(server, 'save_key', side_effect=ValueError('钥匙串不可用')):
            status, response = self.request('/api/ai-config', {'key': 'fake-key', 'model': 'deepseek-flash'})
        self.assertEqual(status, 400)
        self.assertFalse(server.KEY)

    def test_test_result_persists_success_and_failure(self):
        server.KEY = 'fake-key'
        with patch.object(server, 'deepseek', return_value='OK'):
            status, response = self.request('/api/ai-test')
        self.assertEqual(status, 200)
        self.assertEqual(response['status'], 'connected')
        with patch.object(server, 'deepseek', side_effect=ValueError('余额不足')):
            status, response = self.request('/api/ai-test')
        self.assertEqual(status, 400)
        self.assertEqual(server.config_status()['error'], '余额不足')

    def test_analysis_job_survives_request_and_blocks_duplicates(self):
        server.KEY = 'fake-key'
        payload = {'text': '这是一份用于验证后台任务的测试简历，包含 SQL 和 Python 项目经历。', 'settings': {}, 'consent': True}
        with patch.object(server.threading, 'Thread') as thread:
            status, response = self.request('/api/analyze', payload)
            self.assertEqual(status, 202)
            job_id = response['job']['id']
            self.assertEqual(server.read_state()['analysisJob']['status'], 'running')
            status, response = self.request('/api/analyze', payload)
            self.assertEqual(response['job']['id'], job_id)
            self.assertEqual(thread.call_count, 1)
        with patch.object(server, 'deepseek', side_effect=ValueError('API Key 无效')):
            server.run_analysis(job_id, payload['text'], {}, 'fake-key', 'deepseek-flash', '测试简历.txt')
        self.assertEqual(server.read_state()['analysisJob']['error'], 'API Key 无效')

    def test_successful_analysis_keeps_resume_and_records(self):
        server.write_state({'settings': {}, 'records': [{'id': 'existing'}], 'resume': {'name': '我的简历.txt'}})
        output = {'summary': '测试分析', 'profile': {'education': '本科', 'graduation': '2028', 'major': '金融学', 'school': '示例大学'}, 'skills': ['SQL'], 'constraints': [], 'questions': [], 'filterSuggestions': {}, 'recommendations': [{'role': '数据分析', 'fit': '较高', 'reason': 'SQL 经历', 'evidence': ['SQL 项目'], 'gaps': [], 'keywords': ['数据分析']}]}
        with patch.object(server, 'deepseek', return_value=json.dumps(output)):
            server.run_analysis('test-job', '虚构测试文字', {}, 'fake-key', 'deepseek-flash', '我的简历.txt')
        recovered = server.read_state()
        self.assertEqual(recovered['analysisJob']['status'], 'completed')
        self.assertEqual(recovered['analysis']['resumeName'], '我的简历.txt')
        self.assertEqual(recovered['analysis']['profile']['major'], '金融学')
        self.assertEqual(recovered['resume']['name'], '我的简历.txt')
        self.assertEqual(recovered['records'], [{'id': 'existing'}])

class CompanyTests(WorkflowTests):
    def test_catalog_and_unknown_without_model(self):
        from company_catalog import classify
        catalog = server.ROOT / 'data/company_catalog.json'
        catalog.write_text(json.dumps({'version': 'test-v1', 'companies': [
            {'name': '示例星河有限公司', 'aliases': ['星河示例'], 'categories': ['测试分类']},
            {'name': '示例青禾(上海)有限公司', 'aliases': [], 'categories': ['测试拟推荐']}
        ]}))
        with patch.object(server, 'deepseek', side_effect=AssertionError('不能调用模型')):
            self.assertEqual(classify('示例星河有限公司', catalog)['companyNature'], '测试分类')
            self.assertEqual(classify('星河示例', catalog)['companyMatch'], 'explicit_alias')
            self.assertEqual(classify('示例星河有限公司子公司', catalog)['companyNature'], '无法判断')
            self.assertEqual(classify('不存在的企业', catalog)['companyNature'], '无法判断')
            self.assertEqual(classify('示例青禾（上海）有限公司', catalog)['companyMatch'], 'exact')

    def test_record_ingestion_classifies_and_persists(self):
        record = {'id':'test-record', 'company':'拼多多', 'role':'测试岗位', 'time':'2026-10-17 12:00', 'status':'投递成功', 'companyNature':'伪造性质'}
        with patch.object(server, 'deepseek', side_effect=AssertionError('不能调用模型')):
            self.assertEqual(self.request('/api/records', {'record':record})[0], 400)
            status, response = self.request('/api/records', {'confirmed':True, 'record':record})
            self.assertEqual(status, 201)
            self.assertNotEqual(response['record']['companyNature'], '伪造性质')
            self.assertEqual(server.read_state()['records'][0], response['record'])
            self.assertEqual(self.request('/api/records', {'confirmed':True, 'record':record})[0], 409)
            record.update(id='unknown-record', company='未知公司')
            status, response = self.request('/api/records', {'confirmed':True, 'record':record})
            self.assertEqual(response['record']['companyNature'], '无法判断')


def staged_core_response(output):
    def respond(messages, *args):
        if '招聘岗位与简历证据分析员' in messages[0]['content']:
            source = json.loads(messages[1]['content'])
            return json.dumps({'matches':[{'requirement':'业务数据分析', 'jdEvidence':source['jd'],
                'priority':'核心','status':'直接匹配','resumeEvidence':output.get('evidence',[]),
                'explanation':'简历中的数据处理经历可支持岗位数据分析任务。'}]})
        return json.dumps({'points':[{'title':'数据分析','content':output.get('text','')} ]})
    return respond


class CoreCapabilityTests(WorkflowTests):
    def test_core_capability_requires_consent_and_keeps_old_on_failure(self):
        server.KEY = 'fake-key'
        server.write_state({'settings': {}, 'records': [], 'coreCapability': {'text':'原有介绍'}})
        text = '曾使用Python和SQL整理业务数据，完成数据清洗与可视化报告。'
        with patch.object(server, 'deepseek') as model:
            self.assertEqual(self.request('/api/core-capability', {'text':text})[0], 400)
            model.assert_not_called()
        with patch.object(server, 'deepseek', return_value='{"text":"","evidence":["不存在的证据"]}'):
            self.assertEqual(self.request('/api/core-capability', {'text':text, 'jd':'数据分析实习生：负责业务数据清洗、SQL查询和分析报告撰写。', 'consent':True})[0], 400)
        self.assertEqual(server.read_state()['coreCapability']['text'], '原有介绍')

    def test_core_capability_generates_and_saves(self):
        server.KEY = 'fake-key'
        text = '曾使用Python和SQL整理业务数据，完成数据清洗与可视化报告。'
        output = {'text':'我能使用Python和SQL完成业务数据整理、清洗与可视化报告。', 'evidence':['使用Python和SQL整理业务数据']}
        with patch.object(server, 'deepseek', side_effect=staged_core_response(output)) as model:
            status, result = self.request('/api/core-capability', {'text':text, 'jd':'数据分析实习生：负责业务数据清洗、SQL查询和分析报告撰写。', 'consent':True})
        self.assertEqual(status, 200)
        self.assertEqual(result['text'], '1. 数据分析：'+output['text'])
        self.assertEqual(server.read_state()['coreCapability'], result)
        self.assertIn('resumeHash', result)
        self.assertEqual(model.call_count, 2)
        self.assertEqual(result['promptVersion'], 'jd-keyword-points-v4')
        writing_input = json.loads(model.call_args_list[1].args[0][1]['content'])
        self.assertIn('matches', writing_input)
        self.assertNotIn('resume', writing_input)
        self.assertEqual(json.loads(model.call_args_list[0].args[0][1]['content']), {'resume':text, 'jd':'数据分析实习生：负责业务数据清洗、SQL查询和分析报告撰写。'})


class SharedAIResourcesTests(WorkflowTests):
    def test_saved_resume_is_used_without_upload_or_text(self):
        server.KEY = 'same-saved-key'
        text = '使用 Python 和 SQL 整理业务数据，完成清洗与分析报告。'
        server.write_state({'settings':{}, 'records':[], 'resume':{'text':text, 'name':'已保存简历.pdf'}})
        output = {'text':'我能使用Python和SQL整理业务数据并完成分析报告。', 'evidence':['使用Python和SQL整理业务数据']}
        with patch.object(server, 'deepseek', side_effect=staged_core_response(output)) as model:
            status, result = self.request('/api/core-capability', {'jd':'数据分析实习生：负责业务数据清洗、SQL查询和分析报告撰写。', 'consent':True})
        self.assertEqual(status, 200)
        self.assertEqual(model.call_args_list[0].args[1], 'same-saved-key')
        self.assertEqual(json.loads(model.call_args_list[0].args[0][1]['content'])['resume'],text)
        self.assertEqual(result['evidence'], output['evidence'])
        self.assertEqual(server.read_state()['resume']['name'], '已保存简历.pdf')
        self.assertEqual(server.ai_resume_text({}),text)
        self.assertEqual(server.ai_resume_text({'text':''}),text)

    def test_unmatched_quotes_do_not_discard_summary(self):
        text = '使用Python和SQL整理业务数据，完成清洗与分析报告。'
        with patch.object(server, 'deepseek', side_effect=staged_core_response({'text':'我能整理业务数据。', 'evidence':['不存在的引用']})):
            result = server.generate_core_capability(text, 'saved-key', 'saved-model', '数据分析岗位，负责数据清洗与分析报告。')
        self.assertIn('暂不足以生成', result['text'])
        self.assertEqual(result['matches'][0]['status'], '未体现')
        self.assertEqual(result['evidence'], [])
        self.assertTrue(result['evidenceWarning'])


class JDTests(WorkflowTests):
    def test_jd_upload_keeps_shared_resume(self):
        server.write_state({'settings':{},'records':[], 'resume':{'text':'原有简历内容，不得替换','name':'简历.pdf'}})
        status, result = self.request('/api/target-jd-upload', raw='数据分析实习生：负责SQL查询、数据清洗和报告撰写，要求了解业务指标。'.encode(), headers={'X-File-Extension':'txt','X-File-Name':'JD.txt'})
        self.assertEqual(status,200)
        self.assertEqual(result['name'],'JD.txt')
        self.assertEqual(server.read_state()['resume']['name'],'简历.pdf')
        self.assertEqual(server.read_state()['targetJD'],result)

    def test_missing_jd_does_not_call_model(self):
        server.KEY='existing-key'
        server.write_state({'settings':{},'records':[], 'resume':{'text':'已有简历：使用SQL和Python进行数据清洗与分析报告撰写。'}})
        with patch.object(server,'deepseek') as model:
            status, result=self.request('/api/core-capability', {'consent':True})
        self.assertEqual(status,400)
        self.assertIn('岗位JD',result['error'])
        model.assert_not_called()


class KeywordPointsTests(unittest.TestCase):
    def test_points_keep_keywords_and_user_confirmed_traits(self):
        jd='开发岗位：使用AI工具进行开发，要求能够完成自动推送。'
        resume='熟练使用AI工具，具备Vibe Coding经验，开发过报价系统和飞书自动推送。'
        analysis={'matches':[{'requirement':'AI工具开发','jdEvidence':'使用AI工具进行开发','priority':'核心','status':'直接匹配','resumeEvidence':[resume],'keywords':['AI工具','开发'],'explanation':'开发经历支持岗位要求'}]}
        output={'points':[{'title':'AI工具与Vibe Coding','content':'能开发报价系统。'},{'title':'自动推送开发','content':'能搭建飞书自动推送。'}]}
        with patch.object(server,'deepseek',side_effect=[json.dumps(analysis),json.dumps(output)]) as model:
            result=server.generate_core_capability(resume,'same-key','same-model',jd,'开朗健谈')
        self.assertEqual(result['text'],'1. AI工具与Vibe Coding：能开发报价系统。\n\n2. 自动推送开发：能搭建飞书自动推送。')
        self.assertEqual(result['matches'][0]['keywords'],['AI工具','开发'])
        self.assertEqual(json.loads(model.call_args_list[1].args[0][1]['content'])['selfTraits'],'开朗健谈')
        self.assertEqual(result['points'],output['points'])


class KeywordExtractionTests(WorkflowTests):
    def test_keyword_sources_isolated_and_irrelevant_fields_filtered(self):
        jd='岗位要求：使用Python整理数据，每周实习4天，公司提供餐补福利。'
        resume='具备Python基础，曾整理业务数据。英语六级，能进行基础英文沟通。'
        outputs=[{'keywords':[{'keyword':'Python','category':'工具与技术','evidence':'使用Python整理数据'},
            {'keyword':'每周实习4天','category':'工作任务','evidence':'每周实习4天'},
            {'keyword':'餐补福利','category':'专业技能','evidence':'餐补福利'},
            {'keyword':'AIGC','category':'工具与技术','evidence':'没有这句话'}]},
            {'keywords':[{'keyword':'Python基础','category':'工具与技术','evidence':'具备Python基础'},
                         {'keyword':'英语六级','category':'语言能力','evidence':'英语六级'}]}]
        with patch.object(server,'deepseek',side_effect=[json.dumps(v) for v in outputs]) as model:
            result=server.analyze_keywords(resume,jd,'same-key','same-model')
        self.assertEqual([v['keyword'] for v in result['jdKeywords']],['Python'])
        self.assertEqual([v['keyword'] for v in result['resumeKeywords']],['Python基础','英语六级'])
        requests=[json.loads(call.args[0][1]['content']) for call in model.call_args_list]
        self.assertEqual(requests,[{'sourceType':'jd','document':jd},{'sourceType':'resume','document':resume}])
        self.assertEqual(result['promptVersion'],'ability-keywords-v1')

    def test_keyword_endpoint_uses_saved_resume_and_preserves_old_on_failure(self):
        server.KEY='saved-key'
        resume='已有简历：能使用Python进行数据整理与分析，能做基础英文沟通。'
        jd='数据分析实习，要求使用Python整理数据并撰写分析报告。'
        server.write_state({'settings':{},'records':[],'resume':{'text':resume}})
        with patch.object(server,'deepseek',return_value='{"keywords":[]}') as model:
            self.assertEqual(self.request('/api/keywords',{'jd':jd})[0],400)
            model.assert_not_called()
            status,result=self.request('/api/keywords',{'jd':jd,'consent':True})
        self.assertEqual(status,200)
        self.assertEqual(server.read_state()['keywordAnalysis'],result)
        self.assertEqual(server.read_state()['resume']['text'],resume)
        with patch.object(server,'deepseek',side_effect=ValueError('API超时')):
            self.assertEqual(self.request('/api/keywords',{'jd':jd,'consent':True})[0],400)
        self.assertEqual(server.read_state()['keywordAnalysis'],result)


if __name__ == '__main__':
    unittest.main()
