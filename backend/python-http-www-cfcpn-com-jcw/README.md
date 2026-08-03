# 金采网公告爬虫

抓取金采网采购公告和结果公告，保存为带 front matter 的 Markdown，供来源选择器和 LLM 结构化任务使用。爬虫只保存原文，不做摘要、分类或业务计算。

## 安装

Python 3.10+，在仓库根目录执行：

```bash
python3 -m pip install requests beautifulsoup4 urllib3
```

## 常用命令

以下命令在本目录执行，或将脚本路径写成完整相对路径：

```bash
# 首次抓取采购公告
python cfcpn_scraper.py --keyword "证券" --start-page 1 --output-dir output

# 增量更新（必须从第 1 页开始）
python cfcpn_scraper.py --keyword "证券" --update --output-dir output

# 中断后恢复
python cfcpn_scraper.py --keyword "证券" --resume --output-dir output

# 小规模联网验证
python cfcpn_scraper.py --keyword "证券" --start-page 1 --end-page 1 \
  --max-items 3 --output-dir output_test --delay 1.2

# 抓取结果公告
python cfcpn_scraper.py --notice-type result --keyword "证券" \
  --start-page 1 --end-page 1 --max-items 3 --output-dir output
```

完整参数以 `python cfcpn_scraper.py --help` 为准。常用参数：

- `--notice-type`：`procurement`（默认）或 `result`。
- `--output-dir`：输出根目录，默认 `output`。
- `--since-date`：日期下限；列表按发布时间倒序，遇到更早公告会停止翻页。
- `--max-items`：本轮最多检查的公告数量，适合先做小规模验证。
- `--overwrite`：重新请求并覆盖已有公告；不能与 `--update` 同时使用。
- `--known-pages-stop`：增量模式连续无新 ID 的停止页数，默认 2。

## 输出目录

采购公告保持旧目录兼容；结果公告使用独立目录：

```text
output/
├── notices/                    # 采购公告 Markdown
├── result/notices/             # 结果公告 Markdown
├── selected/{procurement,result}/notices/  # 来源选择后的 LLM 输入
├── index.md
└── checkpoints/{procurement,result}.json
```

每条 Markdown 的完整 `notice_id` 位于 front matter，是唯一去重依据；文件名和发布时间不能代替 ID。`index.md` 会按实际文件重建，失败记录写入同目录 `failures.jsonl`。

临时外来公告放在 `output/external/notices/`，不要手工混入采购或结果目录；管理员导入后由后端统一处理。

## 流水线位置

```text
爬虫 Markdown
  → backend/broker_sources/ 来源选择
  → backend/llm_table/ LLM 结构化
  → backend/data/staging/ 候选数据
  → 管理员审核并发布
  → backend/data/announcement_table.csv
  → dashboard-data 导出
```

## 访问保护与限制

- 请求带站内 Referer，并使用随机延迟、分页间隔和 403 冷却；不要提高并发或绕过验证码、登录和访问控制。
- 遇到重复 403 会有限重试并熔断；应降低频率后再运行。
- 不下载附件；附件字段仅在源站返回有效样本时再单独验收。
- 运行数据和日志不提交 Git。
