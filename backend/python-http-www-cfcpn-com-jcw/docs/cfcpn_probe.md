# 金采网公告接口最小调查

目标页面：
`http://www.cfcpn.com/jcw/sys/index/goUrl?url=modules/sys/login/list&column=cggg`

调查时间：2026-06-30

## noticeDetail 实现

页面本身未内联 `noticeDetail`，实现位于：
`http://www.cfcpn.com/static/assets/js/cfcpn2021/index/public.js`

相关实现：

```javascript
function goUrlSearch(url, column, searchVal) {
    window.open($("#ctx").val() + "/sys/index/goUrl?url=" + url + "&column=" + column + "&searchVal=" + searchVal);
}

function noticeDetail(id, type) {
    goUrlSearch("modules/sys/login/detail", type, id);
}
```

列表渲染位于：
`http://www.cfcpn.com/static/assets/js/cfcpn2021/list/list.js`

标题点击生成方式：

```javascript
onclick="noticeDetail('" + row.id + "','" + row.noticeType + "');"
```

详情页脚本位于：
`http://www.cfcpn.com/static/assets/js/cfcpn2021/list/detail.js`

详情页 HTML 只是页面外壳，真实正文由详情页脚本继续 POST 到列表接口加载：

```javascript
var param = {
    id: $("#searchVal").val(),
    isDetail: 1
};
$.ajax({
    url: $("#ctx").val() + "/noticeinfo/noticeInfo/dataNoticeList",
    data: param,
    type: "post",
    success: function (data) { ... }
});
```

## 已确认接口信息

列表接口：
`POST http://www.cfcpn.com/jcw/noticeinfo/noticeInfo/dataNoticeList`

列表请求参数：

```python
{
    "noticeType": "1",
    "pageSize": "10",
    "pageNo": "1",
    "noticeState": "1",
    "isValid": "1",
    "orderBy": "publish_time desc",
    "noticeContent": "",
    "briefContent": "证券",
    "noticeTitle": "",
    "purchaseName": "",
    "purchaseId": "",
    "categoryLabName": "",
    "beginPublishTime": "",
    "endPublishTime": "",
    "areaProvince": "",
    "labelAllId": ""
}
```

详情页地址或详情接口：

- 点击公告打开详情页外壳：
  `GET http://www.cfcpn.com/jcw/sys/index/goUrl?url=modules/sys/login/detail&column=1&searchVal=a7e1d0b7b0ab46d390c0bcaecd24fecc`
- 正文/详情数据接口：
  `POST http://www.cfcpn.com/jcw/noticeinfo/noticeInfo/dataNoticeList`

详情请求方法：
`POST`

详情请求参数：

```python
{
    "id": "a7e1d0b7b0ab46d390c0bcaecd24fecc",
    "isDetail": "1"
}
```

公告 ID 放置位置：
详情页 URL 中放在 `searchVal`；详情 XHR/POST 中放在表单参数 `id`。

其他必要参数：
详情 XHR 需要 `isDetail=1`。详情页外壳 URL 还包含 `url=modules/sys/login/detail`、`column=<noticeType>`、`searchVal=<公告ID>`。

正文数据位置：
详情 POST 返回 JSON 的 `rows[0].noticeContent`。脚本使用 `jp.unescapeHTML(noticeContent)` 填充到 `#detail-new`。未登录或不可完整查看时，脚本可能退回显示 `rows[0].briefContent`。

附件数据位置：
详情 POST 返回 JSON 的 `rows[0].file`。脚本将其作为 JSON 字符串解析，并读取每个附件的 `fileName` 和 `fileUrl`。本次示例公告返回 `file` 为 `]`，未得到有效附件。

附件下载链接：
脚本中的下载流程为先检查再下载：

- 检查：`GET /jcw/systemnotice/systemNotice/fileCheck.do?downloadUrl=<fileUrl>&realFileName=<urlencoded fileName>`
- 下载：`GET /jcw/systemnotice/systemNotice/download.do?downloadUrl=<fileUrl>&realFileName=<fileName>`

本次示例公告无有效附件，因此未对具体附件下载 URL 做实际下载验证。

必要请求头：

- `User-Agent`: 建议设置浏览器 UA。
- `Referer`: 必要。列表和详情 POST 只带 UA 会返回 `403 Forbidden`；带站内 Referer 可正常返回 JSON。
- `Content-Type`: 表单提交使用 `application/x-www-form-urlencoded; charset=UTF-8`。
- `X-Requested-With`: 页面 Ajax 没有显式设置。实测不是必要条件，但验证脚本中保留 `XMLHttpRequest` 以贴近浏览器 Ajax 请求。

是否需要 Cookie：
不需要登录 Cookie。实测全新 `requests.Session()` 只要带站内 `Referer` 即可获取详情 JSON。列表接口会设置 `pageNo=1`、`pageSize=10` Cookie，但详情接口不依赖这些 Cookie。

requests 是否可以直接抓取：
可以。无需 Selenium 或 Playwright。详情正文不需要执行 JavaScript，只需复刻详情页脚本中的 POST 请求。

## 字段位置

- 公告标题：`rows[0].noticeTitle`
- 发布时间：`rows[0].publishTime`
- 采购人：`rows[0].userName`；页面展示逻辑会根据 `isOrg` 显示为“金融机构发布”或“代理机构发布”
- 采购方式：`rows[0].purchaseTypeName`
- 地区：`rows[0].area`
- 标签：页面 `#yxCategoryNames` 使用 `rows[0].yxCategoryNames`
- 品类：页面 `#labelAllId` 使用 `rows[0].labelAllId`
- 公告正文：`rows[0].noticeContent`，HTML 实体转义后存储
- 附件名称：`rows[0].file` 解析后的每项 `fileName`
- 附件下载链接：`rows[0].file` 解析后的每项 `fileUrl` 拼到下载接口

## 示例公告验证结果

测试公告 ID：
`a7e1d0b7b0ab46d390c0bcaecd24fecc`

详情标题：
`中国邮政集团有限公司阳江市分公司2026年代理金融网点消防工程项目采购失败公告`

详情 POST 状态码：
`200`

详情 JSON 中 `rows`：
`1`

附件数量：
`0`，示例公告未返回有效附件列表。
