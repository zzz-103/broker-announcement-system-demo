# 券商公告多来源采集

该目录在现有 LLM 结构化之前增加一层轻量来源选择：

1. `collectors/`：每家券商一个官网采集器。
2. `source_reader.py`：把官网、金采网、外部 Markdown 读成统一 `SourceDocument`。
3. `selector.py`：按券商执行 `official > cfcpn > external`，再去重并生成 LLM 输入。
4. `sources.json`：启用券商、分页数和完整性阈值。

官网采集失败不会让流水线失败；采集器会写失败/部分成功 manifest，来源选择器据此回退。
只有列表页全部成功、至少一条正文有效且详情成功率达到配置阈值时，官网才覆盖该券商的低优先级来源。

## 流水线业务流程

1. 采集金采网采购/结果公告，并采集已启用券商官网。
2. 按 manifest 做整券商选择：官网质量通过时，该券商只使用官网数据；
   否则回退金采网，金采网无有效数据时再使用外部数据。
3. 将选择结果按 `procurement/result` 写入 `output/selected/`，再分别执行
   LLM 结构化。
4. 规则匹配生成候选后，双重 LLM 复核必须从同一
   `output/selected/procurement|result/notices` 目录读取原始正文。
5. 保守汇总写入 staging，仍由现有发布接口人工审核后发布。

整券商覆盖是有意行为：官网质量通过后，不再保留该券商的金采网或外部公告。

```bash
python -m backend.broker_sources.cli collect --broker citic_securities
python -m backend.broker_sources.cli collect --broker huaxi_securities
python -m backend.broker_sources.cli collect --broker century_securities
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
  Windows/OpenSSL 会为华西会话单独启用旧式服务端 TLS 重协商兼容；
  其他采集器仍使用默认 TLS 策略。
- 世纪证券：采购公告页直接调用真实 XHR 接口
  `POST https://www.csco.com.cn/Handler/ContentHandler.aspx`，参数为
  `action=GetColumnInfo`、`Column=844`、`Page`。接口在同一列表返回完整正文，
  采集器按标题和正文将“招标公告”写入 `procurement`，将“中标/中选公示”
  写入 `result`，再进入现有来源选择与匹配流程，无需浏览器自动化。

## 可选环境变量

- `OFFICIAL_SOURCE_DATA_DIR`：官网原始响应、Markdown 和 manifest 根目录。
- `CFCPN_PROCUREMENT_INPUT_DIR` / `CFCPN_RESULT_INPUT_DIR`：金采网两类输入。
- `LLM_EXTERNAL_INPUT_DIR`：外部 Markdown 输入目录。
- `SELECTED_SOURCE_OUTPUT_DIR`：来源选择后的 LLM 输入根目录。

已有环境升级时，必须同步将 `LLM_INPUT_DIR` 和 `LLM_RESULT_INPUT_DIR`
改为该根目录下的 `procurement/notices` 和 `result/notices`；否则旧环境变量会
覆盖代码默认值，使 LLM 继续读取金采网原目录。
