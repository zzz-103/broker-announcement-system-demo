# 券商公告多来源采集

该目录在现有 LLM 结构化之前增加一层轻量来源选择：

1. `collectors/`：每家券商一个官网采集器。
2. `source_reader.py`：把官网、金采网、外部 Markdown 读成统一 `SourceDocument`。
3. `selector.py`：按券商执行 `official > cfcpn > external`，再去重并生成 LLM 输入。
4. `sources.json`：启用券商、分页数和完整性阈值。

官网采集失败不会让流水线失败；采集器会写失败/部分成功 manifest，来源选择器据此回退。
只有列表页全部成功、至少一条正文有效且详情成功率达到配置阈值时，官网才覆盖该券商的低优先级来源。

```bash
python -m backend.broker_sources.cli collect --broker citic_securities
python -m backend.broker_sources.cli collect --broker huaxi_securities
python -m backend.broker_sources.cli prepare
```

原始响应和逐次运行 manifest 默认保存在 `backend/data/official-sources/runs/`；
`prepare` 输出默认位于金采网输出目录下的 `output/selected/`。

## 两个站点的实现

- 中信证券：静态列表页。第 1 页为 `index.html`，后续页依次为
  `index_1.html`、`index_2.html`；列表相对链接使用 `urljoin` 解析，
  详情正文读取 `.docHtmlB`。
- 华西证券：列表直接调用
  `POST https://www.hx168.com.cn/servlet/json`，使用
  `application/x-www-form-urlencoded`。必要参数为
  `funcNo=741000`、`catalogId=15`、`curtPageNo`、`numPerPage`；
  同时发送空的 `branchNo/key_word/start_date/end_date`。详情 URL 来自
  JSON 的 `url` 字段，正文读取 `.article_cont`。无需浏览器自动化。

## 可选环境变量

- `OFFICIAL_SOURCE_DATA_DIR`：官网原始响应、Markdown 和 manifest 根目录。
- `CFCPN_PROCUREMENT_INPUT_DIR` / `CFCPN_RESULT_INPUT_DIR`：金采网两类输入。
- `LLM_EXTERNAL_INPUT_DIR`：外部 Markdown 输入目录。
- `SELECTED_SOURCE_OUTPUT_DIR`：来源选择后的 LLM 输入根目录。
