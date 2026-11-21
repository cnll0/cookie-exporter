// test_core.js — cookie_core 逻辑自测（纯 Node，不需要 Chrome）
// 覆盖：通用 keys / matchSpec 域名匹配 / 过期过滤 / 同名去重按 path 具体度 /
//       登录位探针 / registrableDomain（IPv6 / 端口 / 末尾点 / 粘贴 URL）/ specForHost（全站无内置平台）/
//       Netscape cookies.txt 导出格式 / manifest 通配权限
const core = require('./cookie_core.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}
function spec(dom) { return { label: dom, domains: [dom], keys: core.COMMON_KEYS, known: false }; }

console.log('== 通用登录位 keys（无内置平台表，全站统一）==');
t('COMMON_KEYS 恰 14 项', core.COMMON_KEYS.length === 14);
t('COMMON_KEYS 含 session', core.COMMON_KEYS.indexOf('session') >= 0);
t('COMMON_KEYS 含 PHPSESSID', core.COMMON_KEYS.indexOf('PHPSESSID') >= 0);
t('COMMON_KEYS 含 SUB', core.COMMON_KEYS.indexOf('SUB') >= 0);

console.log('== matchSpec：域名匹配（只认根域/子域，防后缀假命中）==');
const qs = spec('quark.cn'), bs = spec('baidu.com'), bis = spec('bilibili.com');
t('.quark.cn 命中 quark.cn', core.matchSpec({ domain: '.quark.cn' }, qs));
t('pan.quark.cn 命中 quark.cn', core.matchSpec({ domain: 'pan.quark.cn' }, qs));
t('.drive.quark.cn 命中 quark.cn', core.matchSpec({ domain: '.drive.quark.cn' }, qs));
t('quark.com 不误命中 quark.cn', !core.matchSpec({ domain: 'quark.com' }, qs));
t('notquark.cn 不误命中 quark.cn（后缀陷阱已修）', !core.matchSpec({ domain: 'notquark.cn' }, qs));
t('quark.cn.evil.com 不误命中', !core.matchSpec({ domain: 'quark.cn.evil.com' }, qs));
t('mail.126.net 不误命中 baidu.com', !core.matchSpec({ domain: 'mail.126.net' }, bs));
t('pan.baidu.com 命中 baidu.com', core.matchSpec({ domain: 'pan.baidu.com' }, bs));
t('www.bilibili.com 命中 bilibili.com', core.matchSpec({ domain: 'www.bilibili.com' }, bis));
t('passport.bilibili.com 命中 bilibili.com', core.matchSpec({ domain: 'passport.bilibili.com' }, bis));
t('notbilibili.com 不误命中 bilibili.com', !core.matchSpec({ domain: 'notbilibili.com' }, bis));
t('大小写不敏感：PAN.QUARK.CN 命中', core.matchSpec({ domain: 'PAN.QUARK.CN' }, qs));
t('spec.domains 多条任中即可', core.matchSpec({ domain: 'a.foo.com' }, { domains: ['bar.com', 'foo.com'] }));

console.log('== buildHeader：过滤/去重/拼接（全站通用 keys）==');
const future = Date.now() / 1000 + 3600;
const past = Date.now() / 1000 - 3600;
const cookies = [
  { name: '__pus', value: 'A_root', domain: '.quark.cn', path: '/', expires: future },
  { name: '__pus', value: 'B_deeper', domain: '.quark.cn', path: '/disk', expires: future },
  { name: '__puus', value: 'U', domain: '.quark.cn', path: '/', expires: future },
  { name: 'dead', value: 'X', domain: '.quark.cn', path: '/', expires: past },
  { name: 'session', value: 'S', domain: '.quark.cn', path: '/', expires: -1 },
  { name: 'PHPSESSID', value: 'P', domain: '.quark.cn', path: '/', expires: future },
  { name: 'baidu_only', value: 'Z', domain: '.baidu.com', path: '/', expires: future },
];
const r = core.buildHeader(cookies, spec('quark.cn'));
t('count=4（__pus/__puus/session/PHPSESSID）', r.count === 4);
t('__pus 取更具体 path 的值 B_deeper', /__pus=B_deeper/.test(r.header));
t('丢弃过期 dead', !/\bdead=/.test(r.header));
t('保留 session cookie session=S', /session=S/.test(r.header));
t('不含跨域 baidu_only', r.header.indexOf('baidu_only') < 0);
t('头格式 "k=v; k=v"', /^[\w.-]+=[^;]+(; [\w.-]+=[^;]+)*$/.test(r.header));
t('keysHit 命中通用键 session/PHPSESSID', r.keysHit.indexOf('session') >= 0 && r.keysHit.indexOf('PHPSESSID') >= 0);

console.log('== 未登录判定 ==');
const empty = core.buildHeader([{ name: 'x', value: '1', domain: '.example.com', path: '/', expires: future }], spec('quark.cn'));
t('无匹配 → count=0', empty.count === 0);
t('无匹配 → header 空串', empty.header === '');
t('无匹配 → keysHit 空', empty.keysHit.length === 0);

console.log('== registrableDomain（任意域名归类）==');
t('pan.quark.cn → quark.cn', core.registrableDomain('pan.quark.cn') === 'quark.cn');
t('www.bilibili.com → bilibili.com', core.registrableDomain('www.bilibili.com') === 'bilibili.com');
t('quark.cn → quark.cn（根域本身）', core.registrableDomain('quark.cn') === 'quark.cn');
t('a.b.c.example.com → example.com', core.registrableDomain('a.b.c.example.com') === 'example.com');
t('www.example.com.cn → example.com.cn（多级公共后缀）', core.registrableDomain('www.example.com.cn') === 'example.com.cn');
t('192.168.1.1 → 192.168.1.1（IPv4 原样）', core.registrableDomain('192.168.1.1') === '192.168.1.1');
t('localhost → localhost', core.registrableDomain('localhost') === 'localhost');

console.log('== specForHost（全站统一：无已知站、恒 known=false、通用 keys）==');
const sq = core.specForHost('pan.quark.cn');
t('pan.quark.cn → known=false（无内置平台）', sq.known === false);
t('pan.quark.cn → label=quark.cn（域名即标签）', sq.label === 'quark.cn');
t('pan.quark.cn → domains=["quark.cn"]', JSON.stringify(sq.domains) === '["quark.cn"]');
t('pan.quark.cn → keys 用通用 keys', sq.keys === core.COMMON_KEYS);
const sg = core.specForHost('www.google.com');
t('www.google.com → known=false', sg.known === false);
t('www.google.com → domains=["google.com"]', JSON.stringify(sg.domains) === '["google.com"]');
t('www.google.com → label=google.com', sg.label === 'google.com');
t('任意站 → keys 含 session', sg.keys.indexOf('session') >= 0);

console.log('== manifest v2：通配 host 权限 + 新权限集 ==');
const fs = require('fs');
const mf = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
t('host_permissions = ["*://*/*"]（不限网站）', JSON.stringify(mf.host_permissions) === '["*://*/*"]');
t('permissions 恰为 v2 六项',
  mf.permissions.slice().sort().join(',') === ['activeTab', 'clipboardWrite', 'cookies', 'storage', 'tabs', 'webNavigation'].sort().join(','));
t('version = 2.0.0', mf.version === '2.0.0');
t('service_worker 以 ES module 加载（Chrome157 必须）', mf.background && mf.background.type === 'module');

console.log('== registrableDomain 边界（IPv6 / 端口 / 末尾点 / 大小写 / 粘贴 URL）==');
t('www.example.co.uk → example.co.uk（另一种多级后缀）', core.registrableDomain('www.example.co.uk') === 'example.co.uk');
t('a.b.example.com.au → example.com.au', core.registrableDomain('a.b.example.com.au') === 'example.com.au');
t('example.com. 末尾点 → example.com', core.registrableDomain('example.com.') === 'example.com');
t('www.example.com.cn. 末尾点 + 多级后缀 → example.com.cn', core.registrableDomain('www.example.com.cn.') === 'example.com.cn');
t('WWW.Example.COM 大小写 → example.com', core.registrableDomain('WWW.Example.COM') === 'example.com');
t('pan.quark.cn:8080 带端口 → quark.cn', core.registrableDomain('pan.quark.cn:8080') === 'quark.cn');
t('192.168.1.1:8080 带端口 → 192.168.1.1', core.registrableDomain('192.168.1.1:8080') === '192.168.1.1');
t('[::1] IPv6 字面量 → ::1', core.registrableDomain('[::1]') === '::1');
t('[2606:4700::1111] IPv6 字面量 → 2606:4700::1111', core.registrableDomain('[2606:4700::1111]') === '2606:4700::1111');
t('裸 IPv6 ::1 → ::1', core.registrableDomain('::1') === '::1');
t('粘贴整条 URL → quark.cn', core.registrableDomain('https://pan.quark.cn/disk?a=1') === 'quark.cn');
t('空串 → 空串', core.registrableDomain('') === '');
t('null → 空串（不抛）', core.registrableDomain(null) === '');
t('全点 host → 空串', core.registrableDomain('...') === '');
t('[::1] 的 spec 能匹配自己的 cookie 域', core.matchSpec({ domain: '::1' }, core.specForHost('[::1]')));

console.log('== buildHeader：cookie 名撞 Object.prototype 时不丢 ==');
const protoCookies = [
  { name: '__proto__', value: 'P', domain: '.example.com', path: '/', expires: future },
  { name: 'constructor', value: 'C', domain: '.example.com', path: '/', expires: future },
  { name: 'toString', value: 'T', domain: '.example.com', path: '', expires: future },
];
const rp = core.buildHeader(protoCookies, spec('example.com'));
t('count=3（原型键名不参与去重）', rp.count === 3);
t('__proto__ 不被原型吞掉', rp.header.indexOf('__proto__=P') >= 0);
t('constructor 保留', rp.header.indexOf('constructor=C') >= 0);
t('toString（path 为空）保留', rp.header.indexOf('toString=T') >= 0);

console.log('== keysHit 子串匹配（记录当前行为，改不改待产品决策）==');
const fuzzy = core.buildHeader([
  { name: 'fluid_theme', value: '1', domain: '.example.com', path: '/', expires: future },
  { name: 'author_pref', value: '2', domain: '.example.com', path: '/', expires: future },
  { name: 'csrf_token', value: '3', domain: '.example.com', path: '/', expires: future },
], spec('example.com'));
t('当前子串匹配：fluid_theme 命中 uid（误报）', fuzzy.keysHit.indexOf('uid') >= 0);
t('当前子串匹配：author_pref 命中 auth（误报）', fuzzy.keysHit.indexOf('auth') >= 0);
t('csrf_token 命中 csrf（语义上真命中）', fuzzy.keysHit.indexOf('csrf') >= 0);
const caps = core.buildHeader([{ name: 'Session', value: 'x', domain: '.example.com', path: '/', expires: future }], spec('example.com'));
t('当前大小写敏感：Session 不算命中 session', caps.keysHit.length === 0);

console.log('== Netscape cookies.txt 导出格式（curl 可吃）==');
const nexText = (c) => core.netscapeText(c);
const NX = nexText([
  { domain: '.example.com', path: '/', secure: true, expires: 1764000000.9, name: 'a', value: 'A' },
  { domain: 'api.example.com', path: '/v1', secure: false, expires: 0, name: 'sess', value: 'S' },
  { domain: 'example.com', path: '/', secure: false, hostOnly: false, expires: 1764000000, name: 'b', value: 'B' },
  { domain: 'x.example.com', path: '/', secure: false, hostOnly: true, expires: 1764000000, name: 'c', value: 'C' },
  { domain: '.example.com', path: '/', secure: false, expires: 1764000000, name: 'bad', value: 'a\tb' },
  { path: '/', name: 'nodomain', value: 'D' },
]);
const nxLines = NX.split('\r\n');
const nxData = nxLines.filter(l => l && l.charAt(0) !== '#');
t('首行是 curl 认的魔数行', nxLines[0] === '# Netscape HTTP Cookie File');
t('文件以 CRLF 收尾', NX.slice(-2) === '\r\n');
t('数据行 = 4（制表符值 / 无域名的行被丢弃）', nxData.length === 4);
t('域 cookie 列：域/含子域/路径/secure/到期/名/值（到期取整）',
  nxData[0] === '.example.com\tTRUE\t/\tTRUE\t1764000000\ta\tA');
t('会话 cookie 到期列写 0（curl 视为 session）', nxData[1] === 'api.example.com\tFALSE\t/v1\tFALSE\t0\tsess\tS');
t('hostOnly 标记优先于域名前导点', nxData[2] === 'example.com\tTRUE\t/\tFALSE\t1764000000\tb\tB');
t('host-only cookie 列写 FALSE', nxData[3] === 'x.example.com\tFALSE\t/\tFALSE\t1764000000\tc\tC');
t('每行恰好 7 个字段', nxData.every(l => l.split('\t').length === 7));
t('含制表符的值不进文件', NX.indexOf('bad') < 0);

console.log('');
console.log(fail === 0
  ? 'SELFTEST PASS — ' + pass + '/' + pass + ' 断言通过'
  : 'SELFTEST FAIL — ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
