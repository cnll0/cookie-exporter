// background.js — Cookie Exporter service worker（ES module 形态）
// 复用 cookie_core 的匹配/去重逻辑。
// 注意：Chrome 157 起本 SW 按 module 跑，`importScripts()` 会抛
// "Module scripts don't support importScripts()." ⇒ 必须用 import。
import './cookie_core.js';

const CORE = self.CookieExporterCore;
export { CORE };

async function collectForPlatform(p) {
  // 逐域拉，保证拿到 httpOnly 与全部 path；chrome.cookies 能看到 Chrome 已解密的明文
  let all = [];
  for (const d of p.domains) {
    try {
      const list = await chrome.cookies.getAll({ domain: d });
      all = all.concat(list);
    } catch (e) { /* 权限或域名无效，跳过 */ }
  }
  // 去重（同名取更具体）
  const built = CORE.buildHeader(all.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.expirationDate ? c.expirationDate : 0
  })), p);
  return built;
}

async function scanAll() {
  const out = [];
  for (const p of CORE.PLATFORMS) {
    const r = await collectForPlatform(p);
    out.push({ tag: p.tag, label: p.label, count: r.count, header: r.header, keysHit: r.keysHit });
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'scan') {
    scanAll().then(platforms => sendResponse({ ok: true, platforms }));
    return true; // async
  }
  if (msg && msg.type === 'copy' && msg.tag) {
    const p = CORE.PLATFORMS.find(x => x.tag === msg.tag);
    if (!p) { sendResponse({ ok: false, error: 'unknown tag' }); return false; }
    collectForPlatform(p).then(r => {
      sendResponse({ ok: true, count: r.count, header: r.header, keysHit: r.keysHit, label: p.label });
    }).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
});

// module 作用域 ≠ globalThis：CDP 调试与自动化实测要能从全局拿到入口，显式挂一份
self.CE_MOD = { CORE, collectForPlatform, scanAll };
