import copy,json,unittest
from unittest.mock import patch
from application_batch import screen,validate_score,score_key,flush
URL='https://www.shixiseng.com/intern/inn_test123'
JOB=dict(url=URL,role='产品实习',company='测试',city='上海',jobType='实习',salary='200-250/天',days=4,months=3,delivered=False,expired=False,jd='需求分析 AI工具 交付成果')
S=dict(cities='上海',minSalary='150',days='5',months='6',jobType='实习')
def assessment():
 return dict(dimensions=[dict(name=n,max=c,items=[dict(jdQuote=q,resumeQuote='做过项目',weight=c,ratio=1)]) for n,c,q in [('核心工作内容匹配',30,'需求分析'),('技能与工具匹配',25,'AI工具'),('实际应用与成果匹配',10,'交付成果')]],bonus=[dict(name=n,max=c,score=c) for n,c in [('专业',10),('学历',10),('毕业年份',5),('到岗时间',5),('行业/公司偏好',5)]],score=999)
class BatchTests(unittest.TestCase):
 def test_capability_limits(self):
  self.assertEqual(screen([JOB],S,detail=True)[0]['action'],'score')
  for change in [dict(days=6),dict(months=12),dict(city='北京')]:self.assertEqual(screen([{**JOB,**change}],S,detail=True)[0]['action'],'skip')
 def test_salary(self):
  for text in ['100-200/天','4000/月','薪资面议']:self.assertEqual(screen([{**JOB,'salary':text}],S,detail=True)[0]['action'],'skip')
  self.assertEqual(screen([{**JOB,'salary':'薪资面议'}],{**S,'allowUnknownSalary':True},detail=True)[0]['action'],'score')
 def test_incomplete_list_deferred(self):
  j=dict(JOB);j.pop('days')
  self.assertEqual(screen([j],S)[0]['action'],'open_detail')
  self.assertEqual(screen([j],S,detail=True)[0]['action'],'skip')
 def test_duplicate_and_attempt(self):
  self.assertEqual(screen([JOB,{**JOB,'url':URL+'?ref=list'}],S)[1]['action'],'skip')
  self.assertEqual(screen([JOB],S,journal={'inn_test123':{}})[0]['action'],'skip')
 def test_preferences_not_hard_filters(self):
  self.assertEqual(screen([JOB],{**S,'major':'影视','preferences':'金融','companyOwnership':['foreign']},detail=True)[0]['action'],'score')
 def test_recompute(self):self.assertEqual(validate_score(assessment(),JOB['jd'],'做过项目'),100)
 def test_invalid_assessments(self):
  for field,value in [('resumeQuote','不存在'),('weight',31),('ratio',float('nan'))]:
   a=assessment();a['dimensions'][0]['items'][0][field]=value
   with self.assertRaises(ValueError):validate_score(a,JOB['jd'],'做过项目')
  a=assessment();a['bonus'][0]['score']=9
  with self.assertRaises(ValueError):validate_score(a,JOB['jd'],'做过项目')
 def test_cache_inputs(self):
  state={'resume':{'text':'简历'},'settings':{**S,'threshold':60}}
  key=score_key(JOB,state,'规则')
  self.assertEqual(key,score_key(JOB,{**state,'settings':{**state['settings'],'threshold':70}},'规则'))
  self.assertNotEqual(key,score_key(JOB,state,'新规则'))
  other=copy.deepcopy(state);other['resume']['text']='新简历'
  self.assertNotEqual(key,score_key(JOB,other,'规则'))
  self.assertNotEqual(key,score_key({**JOB,'jd':'新JD'},state,'规则'))
 def test_record_reconciliation(self):
  old=dict(id='shixiseng:inn_test123',url=URL,status='待审核',score=55,evidence='未提交')
  class Response:
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self):return json.dumps({'records':[old]}).encode()
  for new,expected in [(old,'already_saved'),({**old,'status':'投递成功'},'needs_reconciliation')]:
   with patch('application_batch.urlopen',return_value=Response()) as network:result=flush([{'confirmed':True,'record':new}])
   self.assertEqual(result[0]['result'],expected);self.assertEqual(network.call_count,1)
if __name__=='__main__':unittest.main()
