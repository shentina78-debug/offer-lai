# 固定执行与五分钟目标

运行时每轮读一次；评分及网页规则仍以主流程引用的两个独立文档为准。只经 `cua_repl` 操作 Chrome，不启动独立浏览器驱动、不使用招聘网站隐藏提交接口。当前对话 GPT 只在硬筛通过后评分；未接入新的评分 API。

## 准备与搜索

- 项目目录中使用 README 的 Python 运行时。先 `python3 application_run.py service-check`，确认本机记录服务可用；未运行时用 `start_workbench.py` 启动一次。权限限制应按实际工具权限处理，不能循环重试或绕过限制。
- `python3 application_run.py start runs/本轮 --limit 当次授权数量 --check-service`：新目录、默认300秒目标（--target-seconds，可兼容旧--budget-seconds），只输出搜索词及必要条件，不输出简历。开始搜索前完成服务检查，不把问题拖到成功后处理。
- 复用同一个 `chrome` 绑定。首次绑定读取 CUA 参数文档：原生 App 是 `chrome.click(整数编号)`，不是 `click({elementIndex:...})`。当前页面变化后只用最新编号。
- 按已保存关键词分别搜索，网站有等价硬筛选项才设置。可出勤5天是上限，不能用网站“要求5天”排除要求3天的岗位；接受面议时不能用薪资区间过滤掉面议。学历、专业、到岗时间不设硬筛；企业条件不限。
- 一次观察收集列表中的真实链接和卡片字段，`application_run.py list runs/本轮 list.ax.txt` 解析并筛选；AX文本只来自 CUA 真实观察。结构不兼容时把观察到的候选保存JSON，用 `application_batch.py filter candidates.json`。缺字段或字体乱码留待详情确认，不能推测数字。只打开 `open_detail` 候选。
- 详情一次保存真实 `url/company/role/city/salary/jobType/workMode/days/months/delivered/expired/jd`，未限制的字段可缺省。`delivered/expired` 必须是现场确认的布尔值；日薪区间按下限。完整JD与摘要冲突不能消解则跳过。规则和简历未变时同轮复用，不重复打印整页和历史。

## 只交接最终分数

`python3 application_run.py score-input runs/本轮 job.json` 先硬筛，通过后才提供当前共享简历、评分标准及必要个人事实。同轮复用未变材料，变更后重读。GPT按65＋35分制分析并加总，仅交回0至100的最终数值，不生成逐项JSON、引用、分项理由或加分表。

`python3 application_run.py rate runs/本轮 job.json 68` 接收最终分数。程序校验有限数值范围、材料版本、硬筛、当前门槛和数量，补齐元数据；不再声称检查引用、重算评分。也可用现有assess入口传数字或 `{score:68}`，仅为接口格式兼容，正常不生成长JSON。

达标进入固定会话模块；低分用 `application_run.py finish runs/本轮 inn_ID --evidence '低于门槛，未提交'` 保存最终分数为待审核。异常无有效分数沿用主流程保存null和异常原因，不伪造评分。历史评分细则不再显示到记录页面，旧分数不改写。

## 固定网页执行：优先使用会话模块

浏览器仍只经 CUA；本地模块仅负责加载固定函数、调用本机 Python 校验/入库和保存原始结果。正常路径不再复制长脚本或手工搬运JSON。

1. `python3 application_run.py session-code` 输出两行加载代码，放入已绑定 `chrome` 的 CUA 会话执行一次（模块格式 `.mjs`）。代码版本变化后重载；有未核实提交时只核查结果，不重建会话重投。
2. 达标后在 CUA 执行 `nodeRepl.write(await submissionSession.submit('runs/本轮','inn_ID'))`，`timeout_ms:60000`。内部自动刷新交接、准备附件、arm持久登记、确认一次、识别结果并调用complete入库。每次网页动作后核对新状态。
3. 返回 `continue_prepare` 时继续同一个 submit 调用；模块保留加载阶段，不重复点击入口或切换附件。返回 `observe_result` 时调用 `submissionSession.inspect('runs/本轮','inn_ID')`，只核查已提交结果。加载中不是失败，也不结束整个任务。
4. 明确 `failed/next_candidate`：保存失败原因、关闭可识别的返回/关闭控件、释放当前尝试，继续下一岗；不重投、不完善英文简历、不转人工审核、不伪造成功。用户没有上传英文简历，网站因此拒绝也直接跳过；英语技能仍按原评分标准评价。
5. 返回 `success/done` 后检查 record.sync 为 saved/already_saved 且无 pendingSync。closeRequired 为 true 时截图定位 × 关闭，不点推荐批量投递。记录暂失败优先使用相同会话重试记录，或 `sync`，不能重新提交。
6. 返回 uncertain/needs_reconciliation 时先调用 inspect 只读核查；仍无法确定时保留尝试日志并明确说明，不能把未知当失败再投。登录、验证码或新必填项仍按现场情况处理。

每个阶段的原始结果和事件由模块写入当轮目录；评分仍由当前对话GPT直接给出最终分数，不改用外部API。模块支持真实CUA加载及本机数据传递，端到端速度需实际投递测量。

旧 `browser-code` → prepare → arm → confirm → complete 仍可兼容使用，但不作为正常路径。短期票据倒计时已移除，依靠提交前材料版本、硬条件、门槛和去重即时核对。

## 记录与计时

- `complete` 自动同步，无需每岗切工作台。只有返回 `saved/already_saved` 且无 `pendingSync` 才算入库完成；409或超时保留原文件，`application_run.py sync runs/本轮` 先核对后补录，不改ID。工作台正式记录页可见时每8秒同步；旧页需首次刷新加载新版脚本。
- `application_run.py report runs/本轮` 给出 start 命令至结果处理的墙钟及超目标秒数，事件文件保留阶段时间戳，包含中间的模型和工具等待。它不含 start 前准备及之后的界面核对，汇报端到端耗时必须另加，不用本地毫秒数冒充完整耗时。函数 `trace/browserSeconds` 仅对应浏览器阶段。
- 正常路径目标预算：搜索硬筛60秒、评分90秒、网页90秒、记录15秒、余量45秒。超过300秒只提醒并继续，不中断、不重置开始时间；明确失败继续下一岗，直到完成本次授权成功数量、候选耗尽或遇到需要用户处理的真实阻塞。缺少合格岗位、验证码等异常如实报告，不能为了达标跳过评分或成功核验。
- 阶段计时沿用 `application_batch.py timing ... --stage search/detail/scoring/submission/recording --seconds 实测秒数 --calls 次数`，只记不重叠阶段，不相加冒充完整墙钟。

本地模拟验证不代表已达到真实网页端到端五分钟；下一次用户授权投递时再实测。
