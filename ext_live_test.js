// ext_live_test.js v5 — 真浏览器装载扩展端到端实测（去内置平台版：全站通用 keys）
// 历史根因（ext_probe.js 实锤）：Chrome/Edge 157 stable 忽略 --load-extension，
//   旧抓到的 id admccjkmockfdflocgggjfgdacdodkdf 是内置组件 "Gemini in Chrome" ⇒ 扩展从未装载。
// 正解：browser 级 CDP `Extensions.loadUnpacked{path}`（返回 {id}）。
// v5 相对 v4：内置平台表已删 → 无 #list、无 {type:'scan'}、无 button[data-tag]；
//   抓取统一走 scanDomain/copyHost，任何域名 known=false、label=可注册域、keys=通用 keys。
// 链路：起浏览器 → loadUnpacked → 注入 3 条测试 cookie（含 httpOnly __puus）→
//       开 popup → 按域名抓 → 注入值/去重/不串域 → 点复制 → 断言 #status → Get-Clipboard 复核 → 全站能力断言
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
  await sleep(2000);

  const ev = (expression) => cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, q);
  const msg = (objLiteral) => ev(`chrome.runtime.sendMessage(${objLiteral}).then(r => JSON.stringify(r)).catch(x => JSON.stringify({err:String(x)}))`)
    .then(res => { try { return JSON.parse(res.result.value); } catch { return {}; } });

  const e = JSON.parse((await ev(`JSON.stringify({
      href: location.href,
      rtId: (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime.id : 'NO',
      manifestName: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().name : 'NO',
      hasList: !!document.getElementById('list'),
      allRows: document.querySelectorAll('.row').length,
      hasAuto: !!document.getElementById('auto'),
      hasDomain: !!document.getElementById('domain'),
      hasVault: !!document.getElementById('vault'),
      hasYunx: !!document.getElementById('yunx')
    })`)).result.value);
  console.log('  popup env: ' + JSON.stringify(e));
  t('popup 是真扩展页面（runtime.id 对上）', e.rtId === extId, e.rtId);
  t('manifest 身份正确（Cookie Exporter）', /Cookie Exporter/.test(e.manifestName || ''), e.manifestName);
  t('去内置平台：popup 已无 #list 平台区', e.hasList === false, e.hasList);
  t('v2 DOM：自动抓取/按域名/本地库控件齐备', e.hasAuto && e.hasDomain && e.hasVault);
  t('去云析化：popup 无云析桥残留 DOM', e.hasYunx === false, e.hasYunx);

  // 4) messaging 驱动真 SW：scanDomain（全站通用，无平台表 → known 恒 false）
  const quark = await msg("{type:'scanDomain',host:'pan.quark.cn'}");
  t('scanDomain pan.quark.cn → ok/known=false/domain=quark.cn',
    quark.ok === true && quark.known === false && quark.domain === 'quark.cn', JSON.stringify(quark).slice(0, 160));
  const pairs = quark ? Object.fromEntries(String(quark.header || '').split('; ').filter(Boolean).map(kv => {
    const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)];
  })) : {};
  t('scanDomain 抓到注入的两条（count>=2）', quark && quark.count >= 2, JSON.stringify(quark && { c: quark.count }));
  t('注入值原样读出（httpOnly __puus + 普通 __pus）',
    pairs.__pus === 'PUS_LIVETEST' && pairs.__puus === 'PUUS_LIVETEST', JSON.stringify({ pus: pairs.__pus, puus: pairs.__puus }));
  t('串按 path 具体度去重（同名只留一条）', quark && (String(quark.header).match(/__pus=/g) || []).length === 1);
  t('跨站不串（百度诱饵不在 quark 串）', quark && !/BAIDU_DECOY/.test(quark.header));
  t('keysHit 是数组（无平台专属 keys，全站通用）', Array.isArray(quark.keysHit));

  const baidu = await msg("{type:'scanDomain',host:'pan.baidu.com'}");
  t('百度站单独可见诱饵（任意域名入口走通）',
    baidu.ok === true && baidu.domain === 'baidu.com' && baidu.count >= 1 && /BAIDU_DECOY/.test(baidu.header || ''),
    JSON.stringify(baidu && { d: baidu.domain, c: baidu.count }));

  // 5) UI 按域名抓 + 点复制 → #status（writeText 成功才出现）
  const statusTxt = (await ev(`(async () => {
      const inp = document.getElementById('domain');
      inp.value = 'pan.quark.cn';
      document.getElementById('grabDomain').click();
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (document.querySelector('#manual button[data-act=copyhost]')) break;
      }
      const btn = document.querySelector('#manual button[data-act=copyhost][data-host]');
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
  t('点复制 → 已复制 quark.cn 的 N 项 → 已到剪贴板',
    /已复制 quark\.cn 的 \d+ 项/.test(statusTxt) && /已到剪贴板/.test(statusTxt), statusTxt);
  // 去内置平台后：登录位只标通用 keys（如 token/session），不再出现 __pus/__puus 平台专属键
  t('去内置平台：登录位只用通用 keys（无 __pus/__puus 平台专属键）',
    !/登录位[^\n]*__(pus|puus)/.test(statusTxt), statusTxt);

  // 6) 独立复核系统剪贴板（headless 可能不与 Windows 剪贴板同步 ⇒ 轮询，仍不过则改 visible 模式跑）
  let clip = '';
  for (let i = 0; i < 10 && !clip.includes('PUUS_LIVETEST'); i++) {
    clip = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf8' }).stdout || '';
    if (!clip.includes('PUUS_LIVETEST')) await sleep(400);
  }
  t('系统剪贴板 = quark 串（含 httpOnly 值、不含诱饵）',
    clip.includes('__puus=PUUS_LIVETEST') && clip.includes('__pus=PUS_LIVETEST') && !clip.includes('BAIDU_DECOY'),
    JSON.stringify(clip.slice(0, 80)) + (MODE === 'headless' ? ' ← headless 若不共享剪贴板请用 visible 模式复跑' : ''));

  // ===== 全站能力：任何域名（无内置平台概念）=====
  // 7) scanDomain 常见站（复用注入的 quark cookie，验证任意域名入口走通）
  t('scanDomain pan.quark.cn 抓到 httpOnly 值',
    quark.ok === true && /PUUS_LIVETEST/.test(quark.header || ''), quark && quark.count);

  // 8) scanDomain 未访问过的站（无 cookie → 优雅返回，证明"不限网站"且不报错）
  const sdUnknown = await msg("{type:'scanDomain',host:'random-site-xyz.com'}");
  t('scanDomain 未访问站 → ok/known=false/domain 原样',
    sdUnknown.ok === true && sdUnknown.known === false && sdUnknown.domain === 'random-site-xyz.com', JSON.stringify(sdUnknown).slice(0, 160));
  t('scanDomain 未访问站无 cookie → count=0/header 空（优雅返回非报错）',
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

  // 9b) 单点删除：删一个站，其它站保留（区别于 clearVault 群体清空）
  const savedB = await msg("{type:'saveSite',host:'pan.baidu.com'}");
  t('saveSite 第二站 pan.baidu.com → ok/domain=baidu.com',
    savedB.ok === true && savedB.site && savedB.site.domain === 'baidu.com', JSON.stringify(savedB).slice(0, 160));
  const del = await msg("{type:'deleteSite',domain:'quark.cn'}");
  t('deleteSite quark.cn → ok/deleted=true/domain=quark.cn',
    del.ok === true && del.deleted === true && del.domain === 'quark.cn', JSON.stringify(del));
  const vaultAfterDel = await msg("{type:'getVault'}");
  t('单点删除：被删除站 quark.cn 已不在 vault',
    vaultAfterDel.ok === true && !vaultAfterDel.vault['quark.cn'], JSON.stringify(vaultAfterDel).slice(0, 160));
  t('单点删除：其它站 baidu.com 仍在（区别于群体清空）',
    vaultAfterDel.ok === true && !!vaultAfterDel.vault['baidu.com'], JSON.stringify(vaultAfterDel).slice(0, 160));
  const delAgain = await msg("{type:'deleteSite',domain:'quark.cn'}");
  t('deleteSite 重复删不存在站 → deleted=false（幂等）',
    delAgain.ok === true && delAgain.deleted === false, JSON.stringify(delAgain));

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
    ? 'LIVE TEST PASS — ' + pass + '/' + pass + '（loadUnpacked → 读 httpOnly → 过滤拼接 → 剪贴板 → 全站 scanDomain/saveSite/单点删除/vault/export/auto，全链路通）'
    : 'LIVE TEST FAIL — ' + pass + ' passed / ' + fail + ' failed');
  bail(fail === 0 ? 0 : 1);
})().catch(err => { console.log('FATAL: ' + (err && err.stack || err)); killTestBrowsers(); process.exit(9); });
