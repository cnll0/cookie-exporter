// test_core.js — cookie_core 逻辑自测（纯 Node，不需要 Chrome）
// 覆盖：通用 keys / matchSpec 域名匹配 / 过期过滤 / 同名去重按 path 具体度 /
//       登录位探针 / registrableDomain / specForHost（全站无内置平台）/ manifest 通配权限
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

console.log('');
console.log(fail === 0
  ? 'SELFTEST PASS — ' + pass + '/' + pass + ' 断言通过'
  : 'SELFTEST FAIL — ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
