// background.js — Cookie Exporter service worker（ES module 形态）
// 不限网站、无内置平台表：任何域名都用同一套通用 keys 抓取、归类到可注册域。
// Chrome 157 起本 SW 按 module 跑，importScripts() 会抛，必须用 import。
import './cookie_core.js';

const CORE = self.CookieExporterCore;
export { CORE };

const VAULT_KEY = 'vault';          // { [registrableDomain]: {label,updated,header,count,keysHit,cookies:[...]} }
const AUTO_KEY = 'autoCapture';     // boolean，默认 false
const CAPTURE_GAP_MS = 15_000;      // 自动抓取同域最短间隔，避免频繁写盘
const lastCapture = Object.create(null);

// ---- 基础：按 spec 抓 cookie ----
async function collectForSpec(spec) {
  let all = [];
  for (const d of spec.domains) {
    try {
      const list = await chrome.cookies.getAll({ domain: d });
      all = all.concat(list);
    } catch (_) { /* 无权限/无效域，跳过 */ }
  }
  const built = CORE.buildHeader(all.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.expirationDate ? c.expirationDate : 0
  })), spec);
  return {
    label: spec.label, header: built.header, count: built.count, keysHit: built.keysHit,
    cookies: all.filter(c => CORE.isLive({ expires: c.expirationDate ? c.expirationDate : 0 })
                              && CORE.matchSpec({ domain: c.domain }, spec))
                 .map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path,
                              expires: c.expirationDate ? c.expirationDate : 0, httpOnly: !!c.httpOnly, secure: !!c.secure }))
  };
}

// ---- vault（本地保管的已抓取站点）----
async function getVault() { return (await chrome.storage.local.get(VAULT_KEY))[VAULT_KEY] || {}; }
async function saveSite(host) {
  const spec = CORE.specForHost(host);
  const dom = CORE.registrableDomain(host);
  if (!dom) return null;
  const r = await collectForSpec(spec);
  const vault = await getVault();
  vault[dom] = {
    label: r.label, updated: Date.now(), header: r.header, count: r.count,
    keysHit: r.keysHit, cookies: r.cookies
  };
  await chrome.storage.local.set({ [VAULT_KEY]: vault });
  return { domain: dom, label: r.label, count: r.count, keysHit: r.keysHit, header: r.header };
}

async function getAuto() { return !!(await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY]; }
async function setAuto(v) { await chrome.storage.local.set({ [AUTO_KEY]: !!v }); return !!v; }

// 自动抓取：导航提交时把该站点 cookie 归入 vault（默认关；用户开才生效）
chrome.webNavigation?.onCommitted?.addListener(async (details) => {
  if (details.frameId !== 0) return;                 // 只主框架
  if (!/^https?:/.test(details.url || '')) return;   // 跳过扩展/内部页
  if (!(await getAuto())) return;
  let host = '';
  try { host = new URL(details.url).hostname; } catch (_) { return; }
  const dom = CORE.registrableDomain(host);
  const now = Date.now();
  if (lastCapture[dom] && now - lastCapture[dom] < CAPTURE_GAP_MS) return;
  lastCapture[dom] = now;
  try { await saveSite(host); } catch (_) { /* 抓取失败不影响浏览 */ }
});

// Netscape cookies.txt 导出（vault 全部站点）
async function exportNetscape() {
  const vault = await getVault();
  const lines = ['# Netscape HTTP Cookie File', '# Cookie Exporter v2 — 本地导出', ''];
  for (const dom of Object.keys(vault)) {
    for (const c of (vault[dom].cookies || [])) {
      const hostOnly = c.domain && c.domain[0] !== '.' ? 'FALSE' : 'TRUE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const exp = c.expires > 0 ? Math.floor(c.expires) : 0;
      lines.push([c.domain, hostOnly, c.path || '/', secure, exp, c.name, c.value].join('\t'));
    }
  }
  return lines.join('\r\n');
}

// ---- 消息入口 ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const reply = p => { p.then(r => sendResponse({ ok: true, ...r })).catch(e => sendResponse({ ok: false, error: String(e && e.message || e) })); return true; };
  if (!msg || !msg.type) return false;

  // 任意站点：抓当前活动标签页（或指定 host）
  if (msg.type === 'scanCurrent' || msg.type === 'scanDomain') {
    return reply((async () => {
      let host = msg.host;
      if (!host && msg.type === 'scanCurrent') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) { try { host = new URL(tab.url).hostname; } catch (_) {} }
      }
      if (!host) return { error: 'no host (打开一个网站或输入域名)' };
      const spec = CORE.specForHost(host);
      const r = await collectForSpec(spec);
      return { host, domain: CORE.registrableDomain(host), known: spec.known,
               label: r.label, count: r.count, header: r.header, keysHit: r.keysHit };
    })());
  }

  // 存入 vault（手动抓当前站后「保存到本地」用）
  if (msg.type === 'saveSite') return reply(saveSite(msg.host).then(r => ({ site: r })));

  // 任意 host 一键复制（弹窗里当前页/域名行/vault 行的复制都走这里）
  if (msg.type === 'copyHost' && msg.host) {
    const spec = CORE.specForHost(msg.host);
    return reply(collectForSpec(spec).then(r => ({ count: r.count, header: r.header, keysHit: r.keysHit, label: spec.label, host: msg.host })));
  }

  if (msg.type === 'getAuto') return reply(getAuto().then(enabled => ({ enabled })));
  if (msg.type === 'setAuto') return reply(setAuto(msg.value).then(enabled => ({ enabled })));
  if (msg.type === 'getVault') return reply(getVault().then(vault => ({ vault })));
  if (msg.type === 'exportNetscape') return reply(exportNetscape().then(text => ({ text })));
  if (msg.type === 'clearVault') return reply(chrome.storage.local.remove(VAULT_KEY).then(() => ({})));
  return false;
});

// module 作用域 ≠ globalThis：CDP 调试与自动化实测要能从全局拿到入口，显式挂一份
self.CE_MOD = { CORE, collectForSpec, saveSite, getVault, getAuto, setAuto, exportNetscape };
