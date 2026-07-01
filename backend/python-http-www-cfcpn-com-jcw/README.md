# 金采网公告爬虫

这个项目用于抓取金采网公告列表、详情正文，并将公告保存为适合后续 LLM 分析的 Markdown 文件。

## 安装依赖

Python 版本建议 3.10 或以上。

```bash
python3 -m pip install requests beautifulsoup4 urllib3
uv pip install requests beautifulsoup4 urllib3
```

当前没有使用 Selenium、Playwright、数据库、异步或多线程。

## 运行方式

首次全量抓取：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --start-page 1 \
  --output-dir output \
  --delay-min 4 \
  --delay-max 8 \
  --page-delay-min 3 \
  --page-delay-max 6 \
  --batch-size 25 \
  --batch-rest-min 60 \
  --batch-rest-max 120
```

后续增量更新：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --update \
  --output-dir output \
  --delay-min 4 \
  --delay-max 8
```

中断后恢复：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --resume \
  --output-dir output \
  --delay-min 4 \
  --delay-max 8
```

小规模联网验证：

```bash
python cfcpn_scraper.py \
  --keyword "证券" \
  --start-page 1 \
  --end-page 1 \
  --max-items 10 \
  --output-dir output_test \
  --delay-min 4 \
  --delay-max 8
```

只测试 3 条公告：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --start-page 1 \
  --end-page 1 \
  --max-items 3 \
  --output-dir output_test \
  --delay 1.2
```

覆盖测试：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --start-page 1 \
  --end-page 1 \
  --max-items 1 \
  --output-dir output_test \
  --delay 1.2 \
  --overwrite
```

抓取指定页：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --start-page 2 \
  --end-page 2 \
  --output-dir output_page2 \
  --delay 1.2
```

继续上次抓取：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --start-page 1 \
  --end-page 1 \
  --max-items 3 \
  --output-dir output_test \
  --delay 1.2
```

默认不覆盖已存在公告。程序会扫描 `output-dir/notices/` 中 Markdown front matter 的完整 `notice_id`，已有公告会跳过。

覆盖已有公告：

```bash
python3 cfcpn_scraper.py \
  --keyword "证券" \
  --start-page 1 \
  --end-page 1 \
  --max-items 1 \
  --output-dir output_test \
  --delay 1.2 \
  --overwrite
```

## 参数说明

- `--keyword`：搜索关键词，默认 `证券`。
- `--since-date`：只处理此日期及之后的公告，默认 `2026-01-01`。遇到更早公告会停止继续扫描后续历史页。
- `--start-page`：起始页，默认 `1`，必须大于等于 1。
- `--end-page`：结束页。不传时根据接口 `total` 和 `page-size` 自动计算。
- `--page-size`：每页数量，默认 `10`，必须大于等于 1。
- `--max-items`：本轮最多检查的列表公告数量。失败、成功、跳过都计入该数量，不会因为失败继续向后补抓。
- `--output-dir`：输出目录，默认 `output`。
- `--delay`：每次请求之间的等待秒数，默认 `1.0`，不得为负数。
- `--delay-min` / `--delay-max`：详情请求随机间隔，默认 `4` 到 `8` 秒。显式传入时优先于 `--delay`。
- `--page-delay-min` / `--page-delay-max`：列表翻页随机间隔，默认 `3` 到 `6` 秒。
- `--batch-size`：每检查多少条公告后批次休息，默认 `25`。
- `--batch-rest-min` / `--batch-rest-max`：批次休息随机秒数，默认 `60` 到 `120` 秒。
- `--forbidden-cooldown-min` / `--forbidden-cooldown-max`：遇到 403 时的冷却秒数，默认 `90` 到 `180` 秒。
- `--max-consecutive-403`：连续 403 熔断阈值，默认 `2`。
- `--checkpoint-file`：checkpoint 路径，默认 `<output-dir>/checkpoint.json`。
- `--resume`：从 checkpoint 恢复，并回退一页重新检查。
- `--overwrite`：重新请求并覆盖已存在公告。
- `--update`：增量更新模式。必须从第一页开始，不能与 `--overwrite` 同时使用。
- `--known-pages-stop`：增量模式下连续多少页没有新 ID 后停止，默认 `2`。

## 运行模式

普通扫描模式适合首次抓取或指定页检查。程序会按页扫描，已存在公告跳过，`--overwrite` 可以强制覆盖。

默认日期范围是 `2026-01-01` 至今。列表按发布时间倒序返回，因此当程序遇到早于日期下限的公告时，会跳过该公告并停止继续翻更早页面。不要用发布时间做去重，公告去重仍然只依赖完整 `notice_id`。

增量更新模式适合后续维护：

- 从第一页开始扫描，列表仍按 `publish_time desc` 获取。
- 每页先用完整 `notice_id` 判断新旧公告。
- 已存在公告不请求详情。
- 本地不存在的公告才请求详情并写入 Markdown。
- 默认连续 2 页没有发现新 ID 后停止，避免每次维护都扫完全部历史页。
- 可以通过 `--known-pages-stop` 调整停止阈值。
- 如果网站出现历史公告补录，过早停止可能无法发现较早页面中的补录公告；建议定期执行一次完整扫描，例如每月一次。

## 请求节流和 403 处理

正式抓取前建议先检查网站公开规则。程序默认使用随机请求间隔、分页间隔和批次休息，适合分批运行。遇到 403 时会检查 `Retry-After`，否则按 403 冷却区间等待后最多重试一次；连续 403 达到阈值会熔断并安全停止。

不要通过提高并发、轮换代理、伪造 Cookie 或规避验证码/访问控制来强行抓取。出现重复 403 时应降低频率或停止任务。

每完成一页会写入 checkpoint。`--resume` 只用于恢复页码提示，最终去重仍以 Markdown front matter 中的完整 `notice_id` 为准。

## 输出文件说明

输出目录完全由 `--output-dir` 控制：

```text
output_test/
├── notices/
├── index.md
└── failures.jsonl
```

每条公告保存为一个 Markdown 文件，文件名包含发布日期、公告 ID 前 8 位和清理后的标题。去重不依赖文件名，而是读取 Markdown front matter 中的完整 `notice_id`。

`index.md` 会根据当前 `notices/` 目录下实际存在的 Markdown 文件重建，同一完整公告 ID 只保留一行。

## 失败日志说明

失败日志路径为：

```text
output_test/failures.jsonl
```

没有失败时可以不生成。每行都是合法 JSON，包含公告 ID、标题、阶段、错误摘要和时间。正常跳过不会写入失败日志。

## 常见错误

- `403 Forbidden`：详情和列表接口需要站内 `Referer`。当前请求模块已经按已验证方式设置。
- 重复 `403 Forbidden`：可能触发站点访问保护。程序会冷却、有限重试并熔断，不会绕过限制。
- 参数错误：页码必须大于等于 1，`page-size` 必须大于等于 1，`delay` 不能为负数。
- 网络波动：对 429、500、502、503、504 有有限重试，但不会无限重试。
- 输出重复：索引按完整 `notice_id` 重建；如果手工编辑 Markdown 删除 front matter，可能无法被识别为已有公告。

## 已知限制

- 不下载附件。
- 不绕过验证码、登录或访问控制。
- 当前测试样本均无附件，附件真实字段结构和下载链接仍待有附件样本验证。
- `--end-page` 不传时可能覆盖较大页数，正式运行前建议先用 `--max-items` 小规模验证。
