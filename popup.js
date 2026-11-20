// popup.js — 面板逻辑：扫描 -> 列表 -> 一键复制
const $list = document.getElementById('list');
const $status = document.getElementById('status');

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function render(rows) {
  $list.innerHTML = '';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    const ctCls = r.count === 0 ? 'zero' : (r.keysHit && r.keysHit.length ? 'good' : '');
    const ctTxt = r.count === 0 ? '未登录' : (r.keysHit && r.keysHit.length ? r.count + ' 项 ✓' : r.count + ' 项');
    row.innerHTML =
      '<span class="nm">' + esc(r.label) + '</span>' +
      '<span class="ct ' + ctCls + '">' + ctTxt + '</span>' +
      '<button data-tag="' + esc(r.tag) + '"' + (r.count === 0 ? ' disabled' : '') + '>复制</button>';
    $list.appendChild(row);
  }
}

async function scan() {
  $status.textContent = '';
  const resp = await chrome.runtime.sendMessage({ type: 'scan' });
  if (!resp || !resp.ok) { $status.textContent = '扫描失败: ' + (resp && resp.error); return; }
  render(resp.platforms);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 兜底：临时 textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

$list.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-tag]');
  if (!btn || btn.disabled) return;
  const tag = btn.dataset.tag;
  btn.disabled = true;
  const resp = await chrome.runtime.sendMessage({ type: 'copy', tag });
  btn.disabled = false;
  if (!resp || !resp.ok) { $status.textContent = '失败: ' + (resp && resp.error); return; }
  if (!resp.count || !resp.header) { $status.textContent = '该平台没有可用 Cookie'; return; }
  const ok = await copyToClipboard(resp.header);
  if (ok) {
    const mark = resp.keysHit && resp.keysHit.length ? '（登录位: ' + resp.keysHit.join('/') + '）' : '（未检出登录位，可能未登录）';
    $status.textContent = '已复制 ' + resp.label + ' 的 ' + resp.count + ' 项 ' + mark + ' → 已到剪贴板';
  } else {
    $status.textContent = '剪贴板写入被拒：请点击浏览器地址栏右侧的扩展图标后重试';
  }
});

scan();
