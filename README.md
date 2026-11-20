# Cookie Exporter

一个 Chrome MV3 扩展：把浏览器里**任意已登录网站**的 Cookie 抓取下来，可复制到剪贴板、存入本地库、导出为 Netscape `cookies.txt`。

**v2 · 不限网站** —— 不再局限于内置平台表，任何域名都能抓。

- **数据不出本机**：全程只调用 `chrome.cookies` API 读取、在扩展内部拼接、写入剪贴板 / `chrome.storage.local`，没有任何网络上报、没有远程服务器。
- **能读到 httpOnly / v20 加密 Cookie**：由 Chrome 自己解密后经扩展 API 交出，绕开"直接读 Cookie 数据库拿不到明文"的限制（Chrome 127+ 的 App-Bound Encryption 对外部程序加密，但扩展 API 不受影响）。
- **不限网站**：`host_permissions: ["*://*/*"]` + `chrome.cookies.getAll({domain})` 对任意域名抓取。内置 15 平台表只用于"打标签 + 标登录位"，**不是**抓取范围限制。
- **已知站用专属 keys，未知站用通用 keys**：已知站（如夸克 `__pus/__puus`、B站 `SESSDATA`）用平台专属关键 Cookie 标登录位；未知站用通用规则（`session`/`token`/`sid`/`PHPSESSID`…）抓取并归类到可注册域。

## 三种抓取方式

| 方式 | 入口 | 说明 |
|---|---|---|
| 当前标签页 | 面板「当前标签页」区 | 一键抓取当前活动页所在站点 |
| 按域名抓取 | 面板输入域名 +「抓取」 | 任意域名，如 `example.com`，不用先打开页面 |
| 自动抓取 | 面板「自动抓取」开关 | 开启后每访问一个站，最快 15s 入库一次（默认关） |

抓取结果可「复制」成 `name=value; name=value; ...` 串，或「存本地」进 vault；vault 可一键导出为 Netscape HTTP Cookie File 格式（`cookies.txt`，供 curl/wget/下载器导入），也可清空。

## 内置平台（15 个，仅用于打标签）

| 分类 | 平台 |
|---|---|
| 网盘（8） | 夸克网盘、UC 网盘、百度网盘、中国移动云盘、123 网盘、115 网盘、阿里云盘、蓝奏云 |
| 视频/社区（7） | 哔哩哔哩、小红书、PIXIV、抖音、快手、微博、AcFun |

平台定义在 `cookie_core.js` 的 `PLATFORMS`，可自行增删（字段 `{tag, label, domains, keys}`，`domains` 为匹配的域名后缀，`keys` 为关注的关键 Cookie 名）。**不在此表的网站依然能抓**，只是没有专属登录位标签，走通用 keys。

## 安装

1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选中本仓库根目录（含 `manifest.json` 的这一层）
4. 工具栏出现扩展图标；建议固定，或按快捷键 `Alt+Shift+C` 打开面板

> Chrome 稳定版从 127 起忽略命令行 `--load-extension` 参数，**必须用上面的"加载已解压"手动方式**，命令行参数加载不生效。

## 使用

1. 先用 Chrome 正常登录目标网站（任意站，例如 `pan.quark.cn`）
2. 点扩展图标打开面板，用上面三种方式之一抓取
3. 「复制」得到 Cookie 串进入剪贴板；「存本地」进下方「已保存」库
4. 「导出全部」得到 `cookies.txt`（Netscape 格式）；「清空本地库」删除所有已存条目
5. 打开「自动抓取」后，之后每浏览一个站会自动入库（同域最快 15s 一次）

显示「未登录 / 0 项」：说明当前 Chrome 里没有该站的 Cookie，先登录一次即可。

## 隐私与权限说明

申请六项权限，均服务于"读 Cookie → 复制/入库/导出"这一件事：

| 权限 | 用途 |
|---|---|
| `cookies` | 读取已登录网站的 Cookie（含 httpOnly），任意域名 |
| `activeTab` | 读取当前标签页 URL 以定位当前站点 |
| `tabs` | 查询活动标签页（当前页抓取用） |
| `webNavigation` | 监听页面跳转以触发自动抓取 |
| `clipboardWrite` | 把拼接好的 Cookie 串写入剪贴板 |
| `storage` | 保存自动抓取开关与本地 vault |

`host_permissions: ["*://*/*"]` 是"不限网站"的前提——让 `chrome.cookies.getAll` 能对任意域名取值。

> **通配权限说明**：`*://*/*` 意味着扩展被授予访问所有网站的 Cookie 读取能力。本扩展**不会**主动上传或外发任何数据（无网络请求、无远程服务器），读取到的 Cookie 只留在本机剪贴板 / 本地存储。但请理解：能读全部站点 Cookie 是一个高权限能力，只从可信来源安装，不要在此扩展里做任何外发改动。

**注意**：Cookie 等同于登录凭证，复制/导出后请妥善保管 `cookies.txt`，不要发给不可信的第三方。

## 自测

Node 环境跑核心逻辑单测（无需浏览器）：

```bash
node test_core.js
```

预期输出：`SELFTEST PASS — 60/60`

真浏览器端到端测试（临时启动独立 profile 的 Chrome，注入测试 Cookie，验证"装载 → 读 httpOnly → 拼接 → messaging → 剪贴板 → 全站 scanDomain/saveSite/vault/export/auto"，结束自动清理）：

```bash
node ext_live_test.js          # headless
node ext_live_test.js visible  # 有头模式；剪贴板断言在 headless 下可能不共享，优先用 visible
```

预期输出：`LIVE TEST PASS — 26/26`

## 文件结构

```
.
├── manifest.json       MV3 清单（v2：6 权限 + *://*/*）
├── background.js       service worker：扫描平台/任意域抓取/自动抓取入库/vault/Netscape 导出/响应消息
├── cookie_core.js      平台表 + 域名匹配 + 可注册域归类 + 通用 keys + 去重拼接（纯逻辑，可 Node 单测）
├── popup.html          面板 UI v2（当前页/按域名/自动抓取/本地库/内置平台）
├── popup.js            面板逻辑：抓取 → 列表 → 复制/入库/导出/清空
├── test_core.js        核心逻辑单测（60 断言）
├── ext_live_test.js    真浏览器端到端测试（26 断言）
└── LICENSE             MIT
```

## License

MIT — 详见 [LICENSE](LICENSE)。
