// ext_live_test.js v4 — 真浏览器装载扩展端到端实测（v2 全站版）
// 历史根因（ext_probe.js 实锤）：Chrome/Edge 157 stable 忽略 --load-extension，
//   旧抓到的 id admccjkmockfdflocgggjfgdacdodkdf 是内置组件 "Gemini in Chrome" ⇒ 扩展从未装载。
// 正解：browser 级 CDP `Extensions.loadUnpacked{path}`（返回 {id}）。
// v4 相对 v3：popup DOM 变（#list/.row 不再等于全部行）→ 只数 `#list .row`；
//   新增 v2 能力实测：scanDomain 任意域（已知/未知）、saveSite→getVault→exportNetscape、getAuto/setAuto。
// 链路：起浏览器 → loadUnpacked → 注入 3 条测试 cookie（含 httpOnly __puus）→
//       开 popup → scan 注入验证 → 点复制 → 断言 #status → Get-Clipboard 复核 → v2 全站能力断言
// 用法：node ext_live_test.js            headless（默认，快、不弹窗）
//       node ext_live_test.js visible    可见窗口（剪贴板断言必须 visible）
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 9334;
const EXT_DIR = __dirname;
const WORK = 'C:\\yxext';
const MODE = process.argv[2] === 'visible' ? 'visible' : 'headless';
const CHROME_CANDS = [
  process.env.CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
].filter(Boolean);
const findBrowser = () => { const c = CHROME_CANDS.find(x => fs.existsSync(x)); if (!c) throw new Error('CHROME_NOT_FOUND'); return c; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function httpJson(port, p) { return (await fetch(`http://127.0.0.1:${port}${p}`)).json(); }

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  close() { try { this.ws.close(); } catch {} }
}

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra !== undefined ? ' — ' + extra : '')); }
};

function killTestBrowsers() {
  for (const img of ['chrome.exe', 'msedge.exe']) {
    try {
      const { stdout } = spawnSync('wmic', ['process', 'where',
        `name='${img}' and CommandLine like '%yxext%'`, 'get', 'ProcessId', '/value'], { encoding: 'utf8' });
      for (const m of String(stdout || '').matchAll(/ProcessId=(\d+)/g)) {
        if (m[1] !== '0') spawnSync('taskkill', ['/PID', m[1], '/T', '/F'], { stdio: 'ignore' });
      }
    } catch {}
  }
}

(async () => {
  killTestBrowsers();
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(path.join(WORK, 'Default'), { recursive: true });

  const exe = findBrowser();
  console.log('browser: ' + exe + '  mode=' + MODE);
  const args = [
    `--user-data-dir=${WORK}`, '--profile-directory=Default',
    `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update',
    '--window-size=900,700', 'about:blank',
  ];
  if (MODE === 'headless') args.splice(3, 0, '--headless');
  const child = spawn(exe, args, { stdio: 'ignore' });
  child.on('exit', c => console.log('[note] browser exited early code=' + c));

  let ver = null;
  for (let i = 0; i < 40 && !ver; i++) { await sleep(500); try { ver = await httpJson(PORT, '/json/version'); } catch {} }
  if (!ver) { console.log('FAIL: CDP 端口没起来'); killTestBrowsers(); process.exit(2); }
  console.log('CDP up: ' + ver['Browser']);
  const cdp = await Cdp.connect(ver.webSocketDebuggerUrl);
  const bail = code => { cdp.close(); try { child.kill(); } catch {} killTestBrowsers(); process.exit(code); };

  // 1) 正解装载：Extensions.loadUnpacked（--load-extension 在 stable 已被忽略）
  let extId = null;
  try {
    const r = await cdp.send('Extensions.loadUnpacked', { path: EXT_DIR });
    extId = (r && (r.extensionId || r.id)) || null;
    console.log('loadUnpacked => ' + JSON.stringify(r));
  } catch (e) {
    console.log('Extensions.loadUnpacked 不可用: ' + (e && e.message || e));
    bail(3);
  }
  if (!extId) { console.log('FAIL: 没拿到 extensionId'); bail(3); }

  // 2) 注入测试 cookie：页面级 Network.setCookie（httpOnly 那条正是 document.cookie 拿不到的）
  const page = (await cdp.send('Target.createTarget', { url: 'https://pan.quark.cn/' })).targetId;
  const pSess = (await cdp.send('Target.attachToTarget', { targetId: page, flatten: true })).sessionId;
  await cdp.send('Network.enable', {}, pSess);
  const put = (name, value, domain, httpOnly) => cdp.send('Network.setCookie', {
    name, value, domain, path: '/', url: 'https://' + domain.replace(/^\./, 'www.') + '/',
    httpOnly: !!httpOnly, expires: Math.floor(Date.now() / 1000) + 7200,
  }, pSess);
  await put('__pus', 'PUS_LIVETEST', '.quark.cn', false);
  await put('__puus', 'PUUS_LIVETEST', '.quark.cn', true);
  await put('BDUSS', 'BAIDU_DECOY', '.baidu.com', false);
  console.log('  injected 3 cookies (1 httpOnly)');

  // 3) 开扩展 popup = 用户真实入口，一切断言从这里发出
  const pop = (await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` })).targetId;
  const q = (await cdp.send('Target.attachToTarget', { targetId: pop, flatten: true })).sessionId;
  await cdp.send('Runtime.enable', {}, q);
  await sleep(2000);                                       // popup.js init() 自动 scan

  const ev = (expression) => cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, q);
  const msg = (objLiteral) => ev(`chrome.runtime.sendMessage(${objLiteral}).then(r => JSON.stringify(r)).catch(x => JSON.stringify({err:String(x)}))`)
    .then(res => { try { return JSON.parse(res.result.value); } catch { return {}; } });

  const e = JSON.parse((await ev(`JSON.stringify({
      href: location.href,
      rtId: (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.id : 'NO',
      manifestName: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().name : 'NO',
      listRows: document.querySelectorAll('#list .row').length,
      allRows: document.querySelectorAll('.row').length,
      hasAuto: !!document.getElementById('auto'),
      hasDomain: !!document.getElementById('domain'),
      hasVault: !!document.getElementById('vault'),
      hasYunx: !!document.getElementById('yunx')
    })`)).result.value);
  console.log('  popup env: ' + JSON.stringify(e));
  t('popup 是真扩展页面（runtime.id 对上）', e.rtId === extId, e.rtId);
  t('manifest 身份正确（Cookie Exporter）', /Cookie Exporter/.test(e.manifestName || ''), e.manifestName);
  t('v2 DOM：#list 渲染 15 个内置平台行', e.listRows === 15, 'got ' + e.listRows);
  t('v2 DOM：总 .row 数 > 15（当前页/域名行也在，修正 v1 死断言）', e.allRows > e.listRows, 'all=' + e.allRows + ' list=' + e.listRows);
  t('v2 DOM：自动抓取/按域名/本地库控件齐备', e.hasAuto && e.hasDomain && e.hasVault);
  t('去云析化：popup 无云析桥残留 DOM', e.hasYunx === false, e.hasYunx);

  // 4) messaging 驱动真 SW：scan（已知平台打标签，逻辑未变）
  const scan = await msg("{type:'scan'}");
  t('sendMessage{scan} 返回 ok', scan.ok === true, JSON.stringify(scan).slice(0, 140));
  const list = (scan.platforms || []);
  const quark = list.find(s => s.tag === 'quark');
  const baidu = list.find(s => s.tag === 'baidu');
  const pairs = quark ? Object.fromEntries(String(quark.header).split('; ').map(kv => {
    const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)];
  })) : {};
  t('SW scanAll → quark 至少含注入的两条', quark && quark.count >= 2, JSON.stringify(quark && { c: quark.count, k: quark.keysHit }));
  t('keysHit 含 __pus/__puus', quark && quark.keysHit.includes('__pus') && quark.keysHit.includes('__puus'), quark && JSON.stringify(quark.keysHit));
  t('注入值原样读出（httpOnly __puus + 普通 __pus）',
    pairs.__pus === 'PUS_LIVETEST' && pairs.__puus === 'PUUS_LIVETEST', JSON.stringify({ pus: pairs.__pus, puus: pairs.__puus }));
  t('quark 串按 path 具体度去重（同名只留一条）', quark && (String(quark.header).match(/__pus=/g) || []).length === 1);
  t('跨平台不串（百度诱饵不在 quark 串）', quark && !/BAIDU_DECOY/.test(quark.header));
  t('baidu 平台单独可见诱饵', baidu && baidu.count >= 1 && /BAIDU_DECOY/.test(baidu.header), JSON.stringify(baidu && { c: baidu.count }));

  // 5) 点复制按钮 → #status 文案（writeText 成功才出现）
  const statusTxt = (await ev(`(async () => {
      const btn = [...document.querySelectorAll('button[data-tag]')].find(b => b.dataset.tag === 'quark');
      if (!btn) return 'NO BUTTON';
      btn.click();
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 100));
        const s = document.getElementById('status').textContent;
        if (/已复制|没有可用|失败|被拒/.test(s)) return s;
      }
      return 'TIMEOUT: ' + document.getElementById('status').textContent;
    })()`)).result.value;
  console.log('  popup 状态: ' + statusTxt);
  t('点复制 → 已复制 夸克网盘 N 项 + 登录位 → 已到剪贴板',
    /已复制 .*夸克.* \d+ 项/.test(statusTxt) && /__pus\/__puus|__puus\/__pus/.test(statusTxt) && /已到剪贴板/.test(statusTxt), statusTxt);

  // 6) 独立复核系统剪贴板（headless 可能不与 Windows 剪贴板同步 ⇒ 轮询，仍不过则改 visible 模式跑）
  let clip = '';
  for (let i = 0; i < 10 && !clip.includes('PUUS_LIVETEST'); i++) {
    clip = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' }).stdout || '';
    if (!clip.includes('PUUS_LIVETEST')) await sleep(400);
  }
  t('系统剪贴板 = quark 串（含 httpOnly 值、不含诱饵）',
    clip.includes('__puus=PUUS_LIVETEST') && clip.includes('__pus=PUS_LIVETEST') && !clip.includes('BAIDU_DECOY'),
    JSON.stringify(clip.slice(0, 80)) + (MODE === 'headless' ? ' ← headless 若不共享剪贴板请用 visible 模式复跑' : ''));

  // ===== v2 新能力：不限网站 =====
  // 7) scanDomain 已知站（复用注入的 quark cookie，验证任意域名入口走通）
  const sdKnown = await msg("{type:'scanDomain',host:'pan.quark.cn'}");
  t('scanDomain 已知站 pan.quark.cn → ok/known=true/domain=quark.cn',
    sdKnown.ok === true && sdKnown.known === true && sdKnown.domain === 'quark.cn', JSON.stringify(sdKnown).slice(0, 160));
  t('scanDomain 已知站抓到注入的 httpOnly 值',
    sdKnown.ok === true && /PUUS_LIVETEST/.test(sdKnown.header || ''), sdKnown && sdKnown.count);

  // 8) scanDomain 未知站（不在 15 平台表 → 仍用通用 keys 抓，证明"不限网站"）
  const sdUnknown = await msg("{type:'scanDomain',host:'random-site-xyz.com'}");
  t('scanDomain 未知站 random-site-xyz.com → ok/known=false/domain 原样',
    sdUnknown.ok === true && sdUnknown.known === false && sdUnknown.domain === 'random-site-xyz.com', JSON.stringify(sdUnknown).slice(0, 160));
  t('scanDomain 未知站无 cookie → count=0/header 空（优雅返回非报错）',
    sdUnknown.ok === true && sdUnknown.count === 0 && sdUnknown.header === '', JSON.stringify(sdUnknown).slice(0, 160));

  // 9) saveSite → getVault → exportNetscape（本地库 + Netscape 导出全链路）
  const saved = await msg("{type:'saveSite',host:'pan.quark.cn'}");
  t('saveSite pan.quark.cn → ok/domain=quark.cn/count>=2',
    saved.ok === true && saved.site && saved.site.domain === 'quark.cn' && saved.site.count >= 2, JSON.stringify(saved).slice(0, 160));
  const vault = await msg("{type:'getVault'}");
  t('getVault 含 quark.cn（本地库落库成功）',
    vault.ok === true && vault.vault && vault.vault['quark.cn'] && vault.vault['quark.cn'].count >= 2, JSON.stringify(vault).slice(0, 160));
  const exported = await msg("{type:'exportNetscape'}");
  const txt = (exported && exported.text) || '';
  t('exportNetscape 输出 Netscape 头 + 制表符分隔 + httpOnly 值',
    exported.ok === true && /^# Netscape HTTP Cookie File/.test(txt) && /__puus\t/.test(txt) && /PUUS_LIVETEST/.test(txt), JSON.stringify(txt.slice(0, 100)));

  // 10) getAuto/setAuto 往返（默认关、可开可关）
  const a0 = await msg("{type:'getAuto'}");
  t('getAuto 默认关（新 profile）', a0.ok === true && a0.enabled === false, JSON.stringify(a0));
  const aOn = await msg("{type:'setAuto',value:true}");
  const a1 = await msg("{type:'getAuto'}");
  t('setAuto(true) → getAuto 开', aOn.ok === true && aOn.enabled === true && a1.enabled === true, JSON.stringify({ aOn, a1 }));
  const aOff = await msg("{type:'setAuto',value:false}");
  const a2 = await msg("{type:'getAuto'}");
  t('setAuto(false) → getAuto 关', aOff.ok === true && aOff.enabled === false && a2.enabled === false, JSON.stringify({ aOff, a2 }));

  // 11) clearVault 清理
  const cleared = await msg("{type:'clearVault'}");
  const vault2 = await msg("{type:'getVault'}");
  t('clearVault 后 getVault 为空', cleared.ok === true && vault2.ok === true && Object.keys(vault2.vault || {}).length === 0,
    JSON.stringify(vault2).slice(0, 120));

  console.log('');
  console.log(fail === 0
    ? 'LIVE TEST PASS — ' + pass + '/' + pass + '（loadUnpacked → 读 httpOnly → 过滤拼接 → 剪贴板 → 全站 scanDomain/saveSite/vault/export/auto，全链路通）'
    : 'LIVE TEST FAIL — ' + pass + ' passed / ' + fail + ' failed');
  bail(fail === 0 ? 0 : 1);
})().catch(err => { console.log('FATAL: ' + (err && err.stack || err)); killTestBrowsers(); process.exit(9); });
