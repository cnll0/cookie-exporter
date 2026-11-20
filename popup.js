// popup.js — v2 面板：不限网站抓 Cookie（当前标签页 / 按域名 / 自动抓取 / 本地库 / 导出）
// 无内置平台表：所有站点一视同仁，抓到按可注册域归类。
const $status = document.getElementById('status');
const $auto = document.getElementById('auto');
const $current = document.getElementById('current');
const $domain = document.getElementById('domain');
const $grabDomain = document.getElementById('grabDomain');
const $manual = document.getElementById('manual');
const $vault = document.getElementById('vault');
const $exportAll = document.getElementById('exportAll');
const $clearVault = document.getElementById('clearVault');

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function status(s) { $status.textContent = s; }
async function send(msg) {
  try { return await chrome.runtime.sendMessage(msg); }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
function keyMark(keysHit) {
  return keysHit && keysHit.length ? '（登录位: ' + keysHit.join('/') + '）' : '（未检出登录位）';
}
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta); return ok;
    } catch { return false; }
  }
}

// 把一次抓取结果渲染成「一行 + 复制/存本地」按钮
function renderSite(el, r, emptyText) {
  if (!r || !r.ok || !r.host) { el.className = 'empty'; el.textContent = emptyText; return; }
  el.className = 'row';
  el.innerHTML =
    '<span class="nm">' + esc(r.label) + '</span>' +
    '<span class="ct ' + (r.count === 0 ? 'zero' : 'good') + '">' + r.count + ' 项</span>' +
    '<button data-act="copyhost" data-host="' + esc(r.host) + '"' + (r.count === 0 ? ' disabled' : '') + '>复制</button>' +
    '<button data-act="savehost" data-host="' + esc(r.host) + '" class="ghost"' + (r.count === 0 ? ' disabled' : '') + '>存本地</button>';
}

// ---- 当前标签页 ----
async function loadCurrent() {
  $current.className = 'empty';
  $current.textContent = '读取中…';
  renderSite($current, await send({ type: 'scanCurrent' }), '当前页不是普通网站（或无权限读取）');
}

// ---- 按域名抓取 ----
async function grabDomain() {
  const host = ($domain.value || '').trim();
  if (!host) { $manual.className = 'empty'; $manual.textContent = '请输入域名'; return; }
  $manual.className = 'empty'; $manual.textContent = '抓取中…';
  renderSite($manual, await send({ type: 'scanDomain', host }), '抓取失败：请检查域名');
}

// ---- 本地库 ----
async function loadVault() {
  const r = await send({ type: 'getVault' });
  const vault = (r && r.vault) || {};
  const domains = Object.keys(vault);
  if (!domains.length) { $vault.className = 'empty'; $vault.textContent = '暂无保存的站点。'; return; }
  $vault.innerHTML = '';
  for (const d of domains) {
    const s = vault[d];
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML =
      '<span class="nm">' + esc(s.label || d) + '</span>' +
      '<span class="ct ' + (s.count === 0 ? 'zero' : 'good') + '">' + (s.count || 0) + ' 项</span>' +
      '<button data-act="copyvault" data-domain="' + esc(d) + '">复制</button>';
    $vault.appendChild(row);
  }
}

// 统一按钮代理（当前站点 / 手动域名 / 本地库）
for (const container of [$current, $manual, $vault]) {
  container.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'copyhost') {
      const r = await send({ type: 'copyHost', host: btn.dataset.host });
      if (!r || !r.ok || !r.header) { status('该站没有可用 Cookie'); return; }
      const ok = await copyToClipboard(r.header);
      status(ok ? '已复制 ' + r.label + ' 的 ' + r.count + ' 项 ' + keyMark(r.keysHit) + ' → 已到剪贴板' : '剪贴板写入被拒');
    } else if (act === 'savehost') {
      const r = await send({ type: 'saveSite', host: btn.dataset.host });
      if (!r || !r.ok || !r.site) { status('保存失败: ' + (r && r.error)); return; }
      status('已存本地: ' + r.site.label + ' ' + r.site.count + ' 项');
      await loadVault();
    } else if (act === 'copyvault') {
      const r = await send({ type: 'getVault' });
      const s = r && r.vault && r.vault[btn.dataset.domain];
      if (!s || !s.header) { status('该站无 Cookie'); return; }
      const ok = await copyToClipboard(s.header);
      status(ok ? '已复制 ' + (s.label || btn.dataset.domain) + ' → 已到剪贴板' : '剪贴板写入被拒');
    }
  });
}

$grabDomain.addEventListener('click', grabDomain);
$domain.addEventListener('keydown', (e) => { if (e.key === 'Enter') grabDomain(); });

$auto.addEventListener('change', async () => {
  const r = await send({ type: 'setAuto', value: $auto.checked });
  if (r && r.ok) status('自动抓取已' + (r.enabled ? '开启（浏览过的站点自动入库）' : '关闭'));
  else { status('设置失败'); $auto.checked = !$auto.checked; }
});

$exportAll.addEventListener('click', async () => {
  const r = await send({ type: 'exportNetscape' });
  if (!r || !r.ok) { status('导出失败: ' + (r && r.error)); return; }
  const blob = new Blob([r.text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cookies.txt';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  status('已导出 cookies.txt');
});

$clearVault.addEventListener('click', async () => {
  if (!confirm('清空本地已保存的全部站点 Cookie？')) return;
  const r = await send({ type: 'clearVault' });
  if (r && r.ok) { status('已清空'); await loadVault(); } else status('清空失败');
});

(async function init() {
  const a = await send({ type: 'getAuto' });
  $auto.checked = !!(a && a.enabled);
  await Promise.all([loadCurrent(), loadVault()]);
})();
