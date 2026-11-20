# Cookie Exporter

一个 Chrome MV3 扩展：把浏览器里**已登录网站**的 Cookie，按平台一键复制到剪贴板。

- **数据不出本机**：全程只调用 `chrome.cookies` API 读取、在扩展内部拼接、写入系统剪贴板，没有任何网络上报、没有远程服务器。
- **能读到 httpOnly / v20 加密 Cookie**：由 Chrome 自己解密后经扩展 API 交出，绕开"直接读 Cookie 数据库拿不到明文"的限制（Chrome 127+ 的 App-Bound Encryption 对外部程序加密，但扩展 API 不受影响）。
- **按平台归类**：内置常见网盘与视频站平台表，同名 Cookie 按 path/domain 具体度去重，并标出识别到的登录位。

## 内置平台（15 个）

| 分类 | 平台 |
|---|---|
| 网盘（8） | 夸克网盘、UC 网盘、百度网盘、中国移动云盘、123 网盘、115 网盘、阿里云盘、蓝奏云 |
| 视频/社区（7） | 哔哩哔哩、小红书、PIXIV、抖音、快手、微博、AcFun |

平台定义在 `cookie_core.js` 的 `PLATFORMS`，可自行增删（字段 `{tag, label, domains, keys}`，`domains` 为要匹配的域名后缀，`keys` 为关注的关键 Cookie 名）。

## 安装

1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选中本仓库根目录（含 `manifest.json` 的这一层）
4. 工具栏出现扩展图标；建议 `chrome://extensions` 里把它固定，或按快捷键 `Alt+Shift+C` 打开面板

> Chrome 稳定版从 127 起会忽略命令行 `--load-extension` 参数，所以**必须用上面的"加载已解压"手动方式**，命令行参数加载不生效。

## 使用

1. 先用 Chrome 正常登录目标网站（例如 `pan.quark.cn`）
2. 点扩展图标打开面板，对应平台会显示 Cookie 条数；带 `✓` 表示识别到了登录位
3. 点该平台行的「复制」，整条 `name=value; name=value; ...` 格式的 Cookie 串进入剪贴板
4. 粘贴到任何你需要的地方（导入工具、脚本、调试环境等）

显示「未登录」的平台：说明当前 Chrome 里没有该站的 Cookie，先登录一次即可。

## 隐私与权限说明

申请的权限只有四项，均服务于"读 Cookie → 复制到剪贴板"这一件事：

| 权限 | 用途 |
|---|---|
| `cookies` | 读取已登录网站的 Cookie（含 httpOnly） |
| `activeTab` | 兼容校验，无实际取数 |
| `clipboardWrite` | 把拼接好的 Cookie 串写入剪贴板 |
| `storage` | 预留，当前版本未使用 |

`host_permissions` 列出内置平台域名，用于让 `chrome.cookies.getAll` 能按域取到值。

**注意**：Cookie 等同于登录凭证，复制出来后请妥善保管，不要发给不可信的第三方。本扩展本身不上传、不外发。

## 自测

Node 环境跑核心逻辑单测（无需浏览器）：

```bash
node test_core.js
```

预期输出：`SELFTEST PASS — 44/44`

真浏览器端到端测试（会临时启动一个独立 profile 的 Chrome，注入测试 Cookie，验证"装载 → 读 httpOnly → 拼接 → messaging → 剪贴板"，结束自动清理）：

```bash
node ext_live_test.js          # headless
node ext_live_test.js visible  # 有头模式；剪贴板断言在 headless 下可能不共享，优先用 visible
```

预期输出：`LIVE TEST PASS — 13/13`

## 文件结构

```
.
├── manifest.json       MV3 清单
├── background.js       service worker：扫描平台 / 拼接 Cookie / 响应消息
├── cookie_core.js      平台表 + 域名匹配 + 去重拼接（纯逻辑，可被 Node 单测）
├── popup.html          面板 UI
├── popup.js            面板逻辑：扫描 → 列表 → 一键复制
├── test_core.js        核心逻辑单测
├── ext_live_test.js    真浏览器端到端测试
└── LICENSE             MIT
```

## License

MIT — 详见 [LICENSE](LICENSE)。
