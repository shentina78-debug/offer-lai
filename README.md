# 求职工作台 · Job Console

本机运行的求职辅助工具：管理岗位筛选条件、简历与投递记录，并通过 DeepSeek 分析简历与岗位 JD。

## 功能

- 岗位筛选条件保存与投递记录管理，按日期查看结果。
- 简历 PDF、DOCX、TXT 解析与预览。
- 简历分析、JD 匹配表、分点核心能力介绍，以及 JD / 简历独立关键词提取。
- 企业名单本地精确匹配，无法匹配时显示“无法判断”。
- 实习僧和前程无忧的独立浏览器流程模块，共用评分与记录主干。

## 安装与启动

目前面向 **macOS、Python 3.10+**；API Key 存储使用 macOS 钥匙串。浏览器流程模块需要 Node.js 18+ 和提供 CUA Tab 接口的 Agent 环境，不是独立无人值守投递工具。

```sh
git clone https://github.com/shentina78-debug/job-console.git
cd job-console
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py
```

浏览器打开 http://127.0.0.1:8765 。前台服务按 Ctrl+C 停止；也可执行 `python start_workbench.py` 启动后台服务，日志位于 `data/server.log`。

第一次使用请上传自己的简历、设置筛选条件。AI 功能需要自行配置可用的 DeepSeek API Key 和账户支持的模型名称；默认模型配置不保证对所有账户可用。调用模型可能产生费用，连接测试和分析由用户点击触发。

## 数据与隐私

本仓库不包含作者的 API Key、简历、投递记录、历史运行文件、日志、备份或截图。

- API Key 保存在本机 macOS 钥匙串，不写入 HTML 或状态 JSON。
- 简历和记录保存在本地 `uploads/` 与 `data/state.json`，这些目录中的运行数据已配置 Git 忽略。
- AI 分析会按页面授权将当前简历预览及相关输入发送给 DeepSeek；自动隐藏常见邮箱和手机号不代表完整匿名化，请自行核对。
- 服务仅监听 `127.0.0.1:8765`，适合个人本机使用；不要直接作为公网服务部署。

公开版仅包含空白企业库示例。没有本地名单时分类显示“无法判断”，不会调用模型或网络补全。可参照 `data/company_catalog.example.json` 创建自有且有权使用的 `data/company_catalog.json`，条目包含 `name`、`aliases`、`categories`，顶层包含 `version`、`source`、`counts`、`companies`。原始名单及导入文档不随仓库发布。

## 浏览器流程

投递前阅读 [共用流程](APPLICATION_GUIDE.md)，再选择对应的平台技能。需要自行登录招聘网站，并明确授权本次投递。结果不明时禁止重复提交；模拟测试通过不代表真实网站始终可用。

两个会话桥使用 `PYTHON` 环境变量指定 Python，未设置时使用 PATH 中的 `python3`。建议在已激活的虚拟环境中运行 Agent；也可传入 `options.python`。

## 本地测试

```sh
python -m unittest discover -p 'test_*.py'
node --test test_*.cjs
```

测试使用模拟输入与临时目录，不进行真实投递或模型调用。历史实现说明见 [开发记录](DEVELOPMENT_NOTES.md)；发生冲突时以当前源码和项目 `AGENTS.md` 的最新规则为准。

## 技术结构

前端使用 HTML / CSS / JavaScript，后端使用 Python 标准库 HTTP 服务，PDF 解析使用 pypdf。平台模块位于 `platforms/`，浏览器流程与操作说明位于 `skills/`，固定提示词位于 `prompts/`。
