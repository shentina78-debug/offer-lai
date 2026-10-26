import unittest
from application_guard import job_id, preflight, result_payload

URL = 'https://www.shixiseng.com/intern/inn_aow28ipbdhvk'


class GuardTests(unittest.TestCase):
    def test_canonical_id(self):
        self.assertEqual(job_id(URL + '?source=home'), job_id(URL.replace('www.', '') + '/'))

    def test_foreign_host_rejected(self):
        for url in ('https://shixiseng.com.evil.test/intern/inn_a', 'https://evil.test/intern/inn_a', 'file:///intern/inn_a'):
            with self.assertRaises(ValueError):
                job_id(url)

    def test_existing_record_or_attempt_blocks(self):
        for record in ({'id': 'shixiseng:inn_aow28ipbdhvk'}, {'id': 'legacy', 'url': URL}):
            self.assertTrue(preflight(URL, {'records': [record]}, {})['blocked'])
        self.assertTrue(preflight(URL, {}, {'inn_aow28ipbdhvk': {'status': 'unknown'}})['blocked'])
        self.assertFalse(preflight(URL, {}, {})['blocked'])

    def test_success_requires_observation_and_evidence(self):
        record = dict(company='得物App', role='AI产品经理实习(A155912)', resume='站内中文附件', evidence='页面成功提示', time='2026-10-17 12:00', url=URL)
        with self.assertRaises(ValueError):
            result_payload(record, False)
        with self.assertRaises(ValueError):
            result_payload({**record, 'evidence': ''}, True)
        result = result_payload({**record, 'companyNature': '不可继承', 'score': 83.75, 'assessment': {'ruleVersion': 'jd-fit-v2'}}, True)
        self.assertEqual(result['record']['id'], 'shixiseng:inn_aow28ipbdhvk')
        self.assertNotIn('companyNature', result['record'])
        self.assertEqual(result['record']['score'], 83.75)
        self.assertEqual(result['record']['assessment']['ruleVersion'], 'jd-fit-v2')


if __name__ == '__main__':
    unittest.main()
