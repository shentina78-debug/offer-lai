# 2026-10-23 平台分离与实习僧兼容说明

## 2026-10-24 前程无忧接入补充（当前）

新增 `platforms/job51.py`及 `skills/51job-apply/`，文件分工和调用见[前程无忧步骤](skills/51job-apply/前程无忧投递步骤.md)。共用主干只补平台候选检查钩子、独立回执URL核对，以及读取当前搜索配置/保存详情/读取持久尝试的命令；原硬筛比较、65＋35评分、最低分门槛、同一HTML/服务/入库接口不另建一套。

原 `platforms/shixiseng.py`、整个 `skills/shixiseng-apply/`、`实习僧投递步骤.md`、硬筛模块、去重模块、前后端与同步脚本按备份清单做哈希对照。默认/旧运行仍是实习僧，新平台ID为 `51job:岗位ID`。

备份：`backups/20261024-before-51job/source.tar.gz`及源码、保护文件SHA-256清单。不包含简历、密钥或正式投递记录。只恢复源码时也不能覆盖用户数据。

新增测试 `test_job51.py`、`test_job51_flow.cjs`、`test_job51_integration.cjs`；旧平台注册测试只更新已接入的平台集合，其余兼容断言保留。所有模拟使用临时目录，complete强制offline，不能把虚构岗位写入正式工作台。运行命令：

```sh
python3 -m unittest -q
node --test test_record_sync.cjs test_submission_flow.cjs test_submission_bridge.cjs test_submission_integration.cjs test_job51_flow.cjs test_job51_integration.cjs
```

本次结果：104项Python检查、40项Node检查通过，包含原实习僧JS→共用Python完整连接及新前程无忧连接、会话重置后只读恢复。备份中的15份保护文件哈希全部一致，评分文档从“调用时机”起的全部计分正文逐字一致，只修改适用范围说明。Skill命名、必填描述、无占位符和所有链接已本地核对；skill-creator的quick_validate脚本因运行时缺PyYAML未能执行完，不声称该脚本通过，也未为此安装依赖。

真实网站正常路径由用户在本轮此前带操作验证；新固定程序仍须做真实端到端验证。代码编写时浏览器DOM绑定出现超时/Debugger unattached，未为验证新代码新增真实投递。图形标签或选中状态不能读取时交Agent核对，不能以模拟通过代替真实页面证据。

以下为2026-10-23原分离工作的历史记录，当时“只启用实习僧”不覆盖上面的当前接入状态。

已完成文件职责整理。只启用实习僧，没有接入前程无忧，没有操作招聘网站或提交真实简历。现有实习僧网页动作、条件、评分和结果规则保持原意，使用原固定网页程序。

## 文件怎样归属

按职责分组，不是一个步骤拆成一个文件，也不是顺序启动若干独立软件。`application_run.py` 是本机总入口，在同一进程中调用共用检查和所选平台适配器；原实习僧JS桥继续把CUA网页结果交给这个入口。

| 归属 | 文件 | 本次处理 |
| --- | --- | --- |
| 共用执行入口 | `application_run.py` | 保留评分交接、门槛、输入版本、数量、尝试登记、收尾、计时；改为调用所选平台的页面规则 |
| 共用业务比较/入库 | `application_batch.py` | 硬条件比较、65＋35旧评分兼容、输入指纹、同一入库接口及冲突处理不变；岗位标识交给平台 |
| 共用防重投 | `application_guard.py` | 保留记录及尝试日志核对；原URL/ID识别移到实习僧适配器，旧函数/命令仍可用 |
| 平台选择 | `platforms/__init__.py` | 只注册实习僧；未接入的平台明确拒绝，不回退到其他平台 |
| 共用接口 | `platforms/base.py` | 定义准备/结果接口；核对平台、真实岗位、交接、尝试；不规定弹窗、附件或按钮 |
| 实习僧适配 | `platforms/shixiseng.py` | 收纳原URL/ID及AX列表解析、中文附件/补充信息/勾选证据、成功失败字样、简历标签、CUA代码加载；连接原网页文件 |
| 实习僧网页执行 | `skills/shixiseng-apply/scripts/submission_flow.js` | 原文件逐字保留；弹窗、附件勾选、逐动作观察、延迟续接、确认一次、结果辨认及关闭仍在这里 |
| 实习僧会话交接 | `skills/shixiseng-apply/scripts/submission_bridge.mjs` | 原文件逐字保留；prepare→arm→confirm→complete、加载续接、只读结果核查及记录重试仍在这里；不是通用网页桥 |
| 实习僧配置/步骤 | `skills/shixiseng-apply/submission_profile.json`、`实习僧投递步骤.md`、`skills/shixiseng-apply/fast-path.md` | 原文件逐字保留，补充信息、顺序和提速改进不变 |
| 共用流程说明 | `APPLICATION_GUIDE.md` | 从原实习僧Skill归并共用搜索方向、硬筛、评分、授权、结果和入库规则；不另建平台版条件或简历 |
| 实习僧入口说明 | `skills/shixiseng-apply/SKILL.md` | 精简为实习僧专用入口，引用共用规则和原网页文件；明确哪些经验只适用实习僧 |
| 项目入口 | `AGENTS.md`、`README.md` | 更新新旧入口及适用范围，保留原长期约定 |
| 界面及业务服务 | `index.html`、`app.js`、`style.css`、`status.css`、`record_sync.js`、`server.py`、`start_workbench.py` | 未改；仍同一个HTML、同一个服务和同一入库接口 |
| 评分/分类/AI资源 | `岗位匹配评分标准.md`、`company_catalog.py`、`keychain_store.py`、`prompts/core_capability.json`、`prompts/keyword_analysis.json` | 未改；不另配Key、简历或评分口径 |
| 历史说明/图片 | `APPLICATION_WORKFLOW.md`、原有 `*-preview.png` | 未改，不作为当前执行入口 |
| 原有回归测试 | `test_application_run.py`、`test_application_batch.py`、`test_application_guard.py`、`test_server.py`、`test_submission_bridge.cjs`、`test_record_sync.cjs` | 原测试文件未改 |
| 网页测试夹具 | `test_submission_flow.cjs`、`test_helpers/shixiseng_app.cjs` | 仅将原模拟CUA对象抽出供联调复用，原测试断言保留；不属于生产网页程序 |
| 新增验证 | `test_platforms.py`、`test_submission_integration.cjs` | 平台隔离、历史兼容、无弹窗平台及原JS→新Python完整连接测试 |
| 说明/备份 | 本文件、`backups/20261023-before-platform-refactor.tar.gz` | 文件地图、验证结果、改前源码备份 |

`data/`、`uploads/`、`runs/` 等原有设置、简历、名单、投递记录和运行历史不迁移、不清理。现有服务自身的日志仍可能正常增长。

## 共用原则与网站判断的边界

共用程序规定：先硬筛，后评分；达到原最低分才进入网页投递；先持久登记尝试，再允许提交；结果不明保留尝试，禁止自动重投；成功必须有本次真实证据；入库409或超时先核对，不通过重新投递补记录。

实习僧适配器规定：如何识别本网站岗位URL，怎样读AX列表，什么是中文附件已选中，补充信息是否一致，哪些AX字样证明本次成功/明确失败，怎样加载原会话。`clickedConfirm`、`radio-choosed.png`及“投递成功/失败”文本只用于实习僧。

其他平台以后可以用内嵌表单、在线简历、投递记录或回执，必须按该网站实际证据实现接口；不必伪造实习僧的弹窗或附件字段。测试中的 `inline_test` 只是临时注册的模拟平台，生产注册表不存在这个平台。

搜索和读取完整详情仍由Agent经CUA执行，实习僧没有新增搜索驱动，也没有增加逐按钮大模型判断。平台技能给出本网站的操作方法，适配器解析观察结果；真正的岗位方向判断仍由Agent做。统一字段送回同一套硬筛和评分程序。

## 接口怎样连接

1. Agent识别指令中的平台；`application_run.py platform 实习僧`返回本地平台技能路径。
2. `start ... --platform shixiseng`将平台写入本轮 `run.json`。后续命令均读取该平台，不在每一步重新选择。
3. 平台把CUA观察转换为真实岗位字段：`url/company/role/city/salary/jobType/workMode/days/months/delivered/expired/jd`。限制未设置时可缺相应字段；完整详情仍按原硬筛处理缺项和冲突。
4. 共用程序检查硬条件、提供同一份评分材料，接收GPT最终数值并比较原门槛。平台不另算匹配分。
5. 平台核实自己的投递准备条件；共用程序核对 `platform/jobId/observedUrl/handoffId`，先写尝试日志，产生 `attemptId`，提交前复查仍沿用原逻辑。
6. 平台按实际网页证据返回结果；共用程序核对同一平台/岗位/交接/尝试，消费平台核实后的 `success/failure/pending/unknown`。准备中、跳过等提交前状态由平台会话处理，不登记成成功。
7. 成功按原接口入库；明确失败保留禁止重投日志并继续下一岗；加载中续接；结果未知不重投；低分/评分异常仍按原办法保存待审核。

`PreparedSubmission`只表示平台已核实可进入提交，附实际简历说明；`SubmissionOutcome`只表示平台核实后的结果种类。原始页面证据仍完整归档，不用抽象状态替代真实证据。

## 实习僧兼容范围

- 旧命令不加平台参数仍是实习僧；旧 `run.json` 没有平台字段也按实习僧处理。原 `session-code`及 `submissionSession.submit/inspect` 调用方式不变。
- 原记录ID仍是 `shixiseng:inn_…`，原尝试日志键仍是 `inn_…`，没有重编号或改写历史记录。
- 原网页执行指纹保持原四份文件、原拼接顺序；历史交接可继续核对。新交接另附平台/适配器版本信息，防止混用；版本变化阻止新增提交，已经核实发生的成功仍须保留。
- 新平台默认使用含平台前缀的记录及日志标识。相同数字/字符串岗位ID不会与实习僧混成同一条。
- 评分材料、65＋35标准、最低匹配分、硬筛比较、低分待审核、评分异常null、本地企业分类、入库冲突处理、软时间目标保持原规则。
- 对新平台不提供临时占位投递程序。指定前程无忧/51job会明确“尚未接入”，不会打开网站或借用实习僧的操作。

## 验证结果和手动测试

改前基线：80项Python测试、25项Node测试全部通过。

改后：93项Python测试、27项Node测试全部通过。新增验证包括无弹窗/无附件的平台走完整共用流程、相同条件评分得到相同去向、历史运行/交接兼容、跨平台/跨岗位/过期尝试证据拒绝，以及原实习僧JS会话和网页函数通过新Python入口的完整模拟。记录同步脚本还包含5组原有检查。

另以改前源码运行764组对照检查，覆盖列表/详情硬筛组合、历史去重、原结构化评分兼容、评分输入指纹、AX列表解析和原网页执行指纹；改前改后结果一致。原网页程序、会话桥、profile、fast-path、网页步骤、前后端及评分文档已做文件哈希核对。

以上均为本地模拟，不访问招聘网站，不在真实工作台新增测试记录。没有宣称真实网页端到端耗时已经达标。下一步由用户按原指令测试实习僧，确认后再接入前程无忧。

复现测试，在项目目录使用README所列运行时：

```sh
python3 -m unittest -q
node --test test_record_sync.cjs test_submission_flow.cjs test_submission_bridge.cjs test_submission_integration.cjs
```

只读查询平台：`python3 application_run.py platform 实习僧`。实际投递继续使用原fast-path及原CUA会话；原会话有未核实尝试时先只读核查，不为测试而重投。

Skill快速校验器需要当前Python环境未安装的PyYAML，因此该脚本未完成；Skill前置信息与改前保持逐字相同，并另行检查了命名、格式与本地引用路径。它不影响投递程序运行，未为此增加项目依赖。

## 改前备份

`backups/20261023-before-platform-refactor.tar.gz` 保存31份改前源码/文档和SHA-256清单，不包含简历、Key、设置或投递记录。其SHA-256为 `1c9cfefca4eb12bff063f29239d26b9056ecc54db4da2ef1a4ad680fc87a267f`。

需要回退时先解压到独立目录核对，仅恢复本次改动的代码和执行文档，并移除本次新增接口文件；不要覆盖现有数据或用户之后的修改。此备份用于核对及回退，不作为执行入口。
