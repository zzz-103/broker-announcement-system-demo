针对你发现的两个目录都存在爬虫数据的原因，以及从爬虫抓取到最终看板展示的完整输入输出链路和产出文件位置，梳理说明如下：

一、为什么 runtime/scraper-output/notices 和 backend/.../output/notices 中都有爬虫数据？
这是因为项目支持两种不同的运行形态（Docker 容器环境 vs. 本地 Windows 直接运行 Python 环境）：

runtime/scraper-output/notices/（Docker 宿主机挂载目录）
在 
docker-compose.yml:L14
 中配置了数据卷映射： - ./runtime/scraper-output:/app/backend/python-http-www-cfcpn-com-jcw/output
当在 Docker 容器内运行爬虫或通过 Docker 启动后端时，爬虫产出的 Markdown 文件会自动写入到宿主机的 runtime/scraper-output/notices/。
backend/python-http-www-cfcpn-com-jcw/output/notices/（代码中默认本地路径）
如果在 Windows 本地不通过 Docker，而是直接以 Python 子进程或命令行在本机运行爬虫及 LLM 结构化解析，代码默认的输出和输入目录位于项目的 backend/python-http-www-cfcpn-com-jcw/output/notices/。
二、从爬虫到最终看板展示：全链路 5 个核心阶段的输入与产出文件全景图
整个系统的数据链路分为 5 个阶段，每个阶段的直接负责模块、输入文件、产出文件如下表所示：

Mermaid diagram
详细文件路径与各阶段说明：
Stage 1：爬虫抓取阶段（Scraper Stage）
底层脚本：
backend/python-http-www-cfcpn-com-jcw/cfcpn_scraper.py
输入：网页公开公告（金采网等）
产出文件：
采购公告 Markdown： backend/python-http-www-cfcpn-com-jcw/output/notices/*.md（或 runtime/scraper-output/notices/*.md）
结果公告 Markdown： backend/python-http-www-cfcpn-com-jcw/output/result/notices/*.md
Stage 2：LLM 结构化提取阶段（LLM Structured Extraction）
底层脚本：
backend/llm_table/llm_markdown_table_builder.py
输入文件：上阶段产出的 Markdown 文件（.md）
产出文件：
采购端候选 CSV：backend/data/staging/announcement_table.csv
结果端候选 CSV：backend/data/staging/result/result_table.csv
Stage 3：流水线双重复核匹配与汇总阶段（Pipeline Matching & Merger）
底层脚本：
backend/matching/project_merger.py
输入文件：
backend/data/staging/announcement_table.csv
backend/data/staging/result/result_table.csv
backend/data/staging/llm_matching/llm_verified_links.csv
产出文件：
匹配合并产物：backend/data/staging/final/announcement_table_merged_test.csv
【关键断点分析】：该表汇集了原采购项目、关联结果公示及中标金额信息，但当前后端【推送】接口不读取此路径！
Stage 4：管理员点击“推送”发布阶段（Publish Stage）
底层接口：
POST /api/data/announcements/publish
 -> 
merge_for_publication()
读取的输入文件：
只读取了单轨的候选表：backend/data/staging/announcement_table.csv
产出文件：
正式看板读取的唯一正本数据源：backend/data/announcement_table.csv
（同时自动在其目录生成带时间戳的 .bak 备份文件）
Stage 5：前端看板展示阶段（Frontend Dashboard Stage）
后端 API：GET /api/data/announcements（直接读取正本 backend/data/announcement_table.csv 并以 JSON 数组返回给前端）
前端处理文件：
数据解析层：
frontend/src/lib/announcement-data.ts
界面表格渲染：
frontend/src/components/project-table.tsx