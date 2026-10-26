"""平台路由；未知平台不得回退到其他平台。"""
from .shixiseng import ShixisengAdapter
from .job51 import Job51Adapter

DEFAULT_PLATFORM = 'shixiseng'
_ADAPTERS = {DEFAULT_PLATFORM: ShixisengAdapter(), '51job': Job51Adapter()}
_ALIASES = {'实习僧': DEFAULT_PLATFORM, '前程无忧': '51job', '前程无忧平台': '51job'}


def get_platform(name=DEFAULT_PLATFORM):
    key = _ALIASES.get(name, name)
    if key not in _ADAPTERS:
        raise ValueError('招聘平台尚未接入：' + str(name) + '；本次不会执行其他平台的流程')
    return _ADAPTERS[key]


def platform_for_url(url, declared=None):
    if declared is not None:
        adapter = get_platform(declared)
        adapter.job_id(url)
        return adapter
    for adapter in _ADAPTERS.values():
        try:
            adapter.job_id(url)
            return adapter
        except (ValueError, TypeError):
            continue
    raise ValueError('岗位 URL 不属于已接入的招聘平台')
