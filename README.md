# CostBridge

将 iOS 快捷指令的账单识别移到独立服务：输入截图或文本，以及 iCost 当前的分类和账户名单，返回待人工核对的 JSON。服务不写入账本，也不保存原始账单。请勿在确认前打开 iCost 链接。

## 工作方式和隐私

快捷指令采集截图、iCost 分类和账户及当前时间，通过 HTTPS 发给本服务；服务把截图、名单和提示词发送给配置的千问 AI 平台接口。识别结果仅用于本次响应。部署商及模型服务商的处理、保留政策依其各自条款；本项目无法控制其平台日志。不要向公共仓库提交真实截图、账单、密钥或账户配置。

模型可出错，特别是商品不明时分类只是推测。每次必须核对结果。ApplePay/0822 特殊账户规则由模型根据图片判断，返回提示供用户核对，不能当作确定性识别。账户未知时使用指定默认账户并提示。模型未给出有效金额、日期或分类时停止，不生成成功结果。

## 启动

需要 Node.js 20 或更高版本。参考 `.env.example` 设置环境变量：`COSTBRIDGE_TOKEN` 是自定义的高强度随机访问凭据，`QWEN_API_KEY` 是配置在服务端的千问 AI 平台密钥。可选设置 `QWEN_MODEL` 和 `QWEN_BASE_URL`；默认 qwen3.8-flash 和千问 AI 平台兼容接口。设置后运行 `npm start`，服务监听 3000 端口。不要将密钥放入命令历史或公开文件；使用本机安全的环境变量管理方式。执行 `npm test` 运行离线测试。`.env.example` 只是变量说明，Node 不会自动读取 `.env`。

## 接口

`POST /api/analyze`，头部 `Authorization: Bearer <服务访问凭据>`、`Content-Type: application/json`。模型密钥由服务端提供，无需在请求中传入。一次传 `image`（JPEG 文件的纯 Base64，不含前缀和换行）或 `text`，二选一。示例均为虚构数据：

```json
{"text":"午餐 12.50 元","expenseCategories":["餐饮","其他"],"incomeCategories":["工资"],"accounts":["信用卡","储蓄卡"],"defaultAccount":"信用卡","ruleAccount":"信用卡","now":"2026/11/07 16:06"}
```

成功示例：

```json
{"ok":true,"transaction":{"type":"支出","amount":-12.5,"currency":"CNY","date":"2026/11/07 16:06","category":"餐饮","account":"信用卡","remark":"午餐","warnings":["账户未识别，使用默认账户，请核对。","分类由模型判断，请核对后再入账。"]},"icostUrl":"iCost://expense?amount=12.5&currency=CNY&..."}
```

请求可设置 `showTokens` 为 `true` 或 `false`，控制小票是否显示模型返回的总 token 数；未设置时默认显示。若模型未返回用量，小票显示“未提供”。

失败返回非 2xx 状态和 `{"ok":false,"error":{"code":"...","message":"..."}}`；无论请求或模型失败，都不代表已入账。Vercel 请求体上限 4.5 MB；Base64 会增加约三分之一体积，建议截图转 JPEG 并缩小后控制在约 3 MB 以下。如平台在到达函数前拒绝超大请求，可能返回平台自己的错误而不是上述 JSON。

## 部署到 Vercel

导入本仓库创建独立项目，Framework 选择 Other，Node 运行时使用项目声明的版本。在项目环境变量中设置 `COSTBRIDGE_TOKEN` 和 `QWEN_API_KEY`，部署后以 HTTPS 调用 `/api/analyze`。测试和生产环境分别使用独立凭据；不要分享包含服务访问凭据的快捷指令。Vercel 和千问平台可能产生费用，以各自当前套餐为准。

## 制作快捷指令

保留原有可用版本，先创建新指令测试：

1. 在付款详情页触发指令，用“截屏”获取当前屏幕，转为 JPEG，按需缩小图片后使用 Base64 编码，并设置为不换行。
2. 按现有指令查找支出二级分类、收入分类和账户，整理为文本列表。设置默认账户和 ApplePay/0822 对应账户，确保均存在于账户列表中；当前时间格式化为 `yyyy/MM/dd HH:mm`。
3. 建立 JSON 字典，使用接口字段 `image`、`expenseCategories`、`incomeCategories`、`accounts`、`defaultAccount`、`ruleAccount`、`now`，用“获取 URL 内容”向服务发 POST 请求。请求头添加 `Content-Type: application/json` 和 `Authorization: Bearer <你的服务访问凭据>`。此凭据只用于访问 CostBridge，不是模型密钥。
4. 如网络动作报错或 `ok` 不为真，显示错误并停止。成功时从 `transaction` 展示收支、金额、时间、账户、分类、备注和所有 `warnings`，提供确认和取消选项。
5. 选择确认后，打开响应中的 `icostUrl`；该链接根据 iCost 官方文档生成。先用虚构数据检查生成的链接，不要打开入账链接；确认无误后由你决定是否启用。打开链接或返回快捷指令均不能单独证明记账成功。

截图识别前无需传入真实账本记录；可用虚构交易文本验证接口。当前系统命令行没有直接编辑现有快捷指令的接口，本项目不覆盖已有指令。
