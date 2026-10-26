"""招聘平台接口。网站如何呈现由平台判断，共用程序只消费核实后的状态。"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
import hashlib
import inspect
from pathlib import Path


@dataclass(frozen=True)
class PreparedSubmission:
    submitted_resume: str


@dataclass(frozen=True)
class SubmissionOutcome:
    # success / failure / pending / unknown；不要求弹窗、勾选框或“确认”按钮。
    state: str


class PlatformAdapter(ABC):
    key: str
    name: str
    skill_path: str
    fast_path: str
    steps_path: str
    pending_reason = '继续只读核查本次结果，不再提交'

    @abstractmethod
    def job_id(self, url): ...

    @abstractmethod
    def validate_id(self, identity): ...

    def record_id(self, identity):
        self.validate_id(identity)
        return self.key + ':' + identity

    def record_aliases(self, identity):
        return (self.record_id(identity),)

    def journal_key(self, identity):
        return self.record_id(identity)

    def observation_job_id(self, observed):
        """默认仍核对详情URL；有独立回执页的平台自行核对回执URL。"""
        return self.job_id(observed.get('observedUrl', ''))

    def candidate_rejection(self, job, detail=False):
        """平台专用的候选规则不进入共用硬筛。"""
        return None

    def submission_context(self, job):
        return {}

    def parse_detail(self, observed):
        raise ValueError('本平台详情仍由Agent按原流程结构化')

    def website_options(self, settings):
        raise ValueError('本平台搜索仍按原流程执行')

    def validate_platform(self, value):
        # 只有实习僧兼容历史中没有 platform 字段的结果；新平台必须明确来源。
        if value.get('platform') != self.key:
            raise ValueError('岗位或网页结果的平台与本轮不一致')

    def adapter_key(self):
        paths = [Path(__file__), Path(inspect.getfile(type(self)))]
        return hashlib.sha256(b''.join(p.read_bytes() for p in paths)).hexdigest()

    @abstractmethod
    def parse_listing(self, snapshot): ...

    @abstractmethod
    def execution_key(self, root): ...

    @abstractmethod
    def gate_fields(self, root): ...

    @abstractmethod
    def validate_prepared(self, observed, gate): ...

    @abstractmethod
    def outcome(self, observed): ...

    @abstractmethod
    def resume_fields(self, observed, scoring_resume): ...

    @abstractmethod
    def browser_code(self, root, gate, phase, include_driver): ...

    @abstractmethod
    def session_code(self, root): ...


def validate_observation(adapter, observed, identity, gate, attempt=False):
    """共用来源核对：平台、真实岗位 URL、本轮交接与本次尝试必须一致。"""
    adapter.validate_platform(observed)
    adapter.validate_id(identity)
    if gate.get('jobId') != identity or observed.get('jobId') != identity or adapter.observation_job_id(observed) != identity:
        raise ValueError('网页结果与本次岗位不一致')
    if observed.get('handoffId') != gate['handoffId']:
        raise ValueError('网页结果与本次交接不一致')
    if attempt and observed.get('attemptId') != gate['attemptId']:
        raise ValueError('网页结果与本次提交登记不一致')
