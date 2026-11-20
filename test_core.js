// test_core.js — cookie_core 逻辑自测（纯 Node，不需要 Chrome）
// 覆盖：域名匹配 / 过期过滤 / 同名去重按 path 具体度 / 登录位探针 / platformForHost /
//       v2 新增：registrableDomain / specForHost（不限网站的核心）/ manifest 通配权限
const core = require('./cookie_core.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}

const P = core.PLATFORMS;
const quark = P.find(x => x.tag === 'quark');

console.log('== 平台表（标签用，不再限制抓取范围）==');
t('平台数=15 (8 网盘 + bilibili/xhs/pixiv/douyin/kuaishou/weibo/acfun)', P.length === 15);
t('quark 探针含 __puus', quark.keys.indexOf('__puus') >= 0);
t('bilibili 探针含 SESSDATA', P.find(x => x.tag === 'bilibili').keys.indexOf('SESSDATA') >= 0);
t('xhs 探针含 web_session', P.find(x => x.tag === 'xhs').keys.indexOf('web_session') >= 0);
t('pixiv 探针含 PHPSESSID', P.find(x => x.tag === 'pixiv').keys.indexOf('PHPSESSID') >= 0);

console.log('== 域名匹配 ==');
t('.quark.cn 命中 quark', core.matchPlatform({ domain: '.quark.cn' }, quark));
t('pan.quark.cn 命中 quark', core.matchPlatform({ domain: 'pan.quark.cn' }, quark));
t('.drive.quark.cn 命中 quark', core.matchPlatform({ domain: '.drive.quark.cn' }, quark));
t('quark.com 不误命中', !core.matchPlatform({ domain: 'quark.com' }, quark));
t('notquark.cn 不误命中（后缀陷阱已修）', !core.matchPlatform({ domain: 'notquark.cn' }, quark));
t('.quark.cn.evil.com 不误命中', !core.matchPlatform({ domain: 'quark.cn.evil.com' }, quark));
t('126.net 不误命中 baidu', !core.matchPlatform({ domain: 'mail.126.net' }, P.find(x => x.tag === 'baidu')));
t('pan.baidu.com 命中 baidu', core.matchPlatform({ domain: 'pan.baidu.com' }, P.find(x => x.tag === 'baidu')));
t('www.bilibili.com 命中 bilibili', core.matchPlatform({ domain: 'www.bilibili.com' }, P.find(x => x.tag === 'bilibili')));
t('passport.bilibili.com 命中 bilibili', core.matchPlatform({ domain: 'passport.bilibili.com' }, P.find(x => x.tag === 'bilibili')));
t('notbilibili.com 不误命中 bilibili', !core.matchPlatform({ domain: 'notbilibili.com' }, P.find(x => x.tag === 'bilibili')));
t('www.xiaohongshu.com 命中 xhs', core.matchPlatform({ domain: 'www.xiaohongshu.com' }, P.find(x => x.tag === 'xhs')));
t('www.pixiv.net 命中 pixiv', core.matchPlatform({ domain: 'www.pixiv.net' }, P.find(x => x.tag === 'pixiv')));

console.log('== buildHeader：过滤/去重/拼接 ==');
const future = Date.now() / 1000 + 3600;
const past = Date.now() / 1000 - 3600;
const cookies = [
  { name: '__pus', value: 'A_root', domain: '.quark.cn', path: '/', expires: future },
  { name: '__pus', value: 'B_deeper', domain: '.quark.cn', path: '/disk', expires: future },
  { name: '__puus', value: 'U', domain: '.quark.cn', path: '/', expires: future },
  { name: 'dead', value: 'X', domain: '.quark.cn', path: '/', expires: past },
  { name: 'sess', value: 'S', domain: '.quark.cn', path: '/', expires: -1 },
  { name: 'baidu_only', value: 'Z', domain: '.baidu.com', path: '/', expires: future },
];
const r = core.buildHeader(cookies, quark);
t('count=3（去重+过期+跨平台后：__pus/__puus/sess）', r.count === 3);
t('__pus 取更具体 path 的值 B_deeper', /__pus=B_deeper/.test(r.header));
t('丢弃过期 dead', !/\bdead=/.test(r.header));
t('保留 session cookie sess=S', /sess=S/.test(r.header));
t('不含 baidu_only', r.header.indexOf('baidu_only') < 0);
t('头格式 "k=v; k=v"', /^[\w.-]+=[^;]+(; [\w.-]+=[^;]+)*$/.test(r.header));
t('keysHit 命中 __pus/__puus', r.keysHit.indexOf('__pus') >= 0 && r.keysHit.indexOf('__puus') >= 0);

console.log('== 未登录判定 ==');
const empty = core.buildHeader([{ name: 'x', value: '1', domain: '.example.com', path: '/', expires: future }], quark);
t('无匹配 → count=0', empty.count === 0);
t('无匹配 → header 空串', empty.header === '');
t('无匹配 → keysHit 空', empty.keysHit.length === 0);

console.log('== platformForHost（已知站点打标签）==');
t('pan.quark.cn → quark', core.platformForHost('pan.quark.cn').tag === 'quark');
t('www.123pan.com → pan123', core.platformForHost('www.123pan.com').tag === 'pan123');
t('yun.baidu.com → baidu', core.platformForHost('yun.baidu.com').tag === 'baidu');
t('yun.139.com → c139（移动云盘）', core.platformForHost('yun.139.com').tag === 'c139');
t('mail.10086.cn → c139', core.platformForHost('mail.10086.cn').tag === 'c139');
t('www.alipan.com → alipan', core.platformForHost('www.alipan.com').tag === 'alipan');
t('www.bilibili.com → bilibili', core.platformForHost('www.bilibili.com').tag === 'bilibili');
t('www.xiaohongshu.com → xhs', core.platformForHost('www.xiaohongshu.com').tag === 'xhs');
t('www.pixiv.net → pixiv', core.platformForHost('www.pixiv.net').tag === 'pixiv');
t('www.douyin.com → douyin', core.platformForHost('www.douyin.com').tag === 'douyin');
t('www.kuaishou.com → kuaishou', core.platformForHost('www.kuaishou.com').tag === 'kuaishou');
t('weibo.com → weibo', core.platformForHost('weibo.com').tag === 'weibo');
t('www.acfun.cn → acfun', core.platformForHost('www.acfun.cn').tag === 'acfun');
t('非内置站点 → null（但 v2 仍可用通用规则抓取）', core.platformForHost('www.google.com') === null);

console.log('== v2 核心：registrableDomain（任意域名归类）==');
t('pan.quark.cn → quark.cn', core.registrableDomain('pan.quark.cn') === 'quark.cn');
t('www.bilibili.com → bilibili.com', core.registrableDomain('www.bilibili.com') === 'bilibili.com');
t('quark.cn → quark.cn（根域本身）', core.registrableDomain('quark.cn') === 'quark.cn');
t('a.b.c.example.com → example.com', core.registrableDomain('a.b.c.example.com') === 'example.com');
t('www.example.com.cn → example.com.cn（多级公共后缀）', core.registrableDomain('www.example.com.cn') === 'example.com.cn');
t('192.168.1.1 → 192.168.1.1（IPv4 原样）', core.registrableDomain('192.168.1.1') === '192.168.1.1');
t('localhost → localhost', core.registrableDomain('localhost') === 'localhost');

console.log('== v2 核心：specForHost（已知站专属 keys / 未知站通用 keys）==');
const sq = core.specForHost('pan.quark.cn');
t('已知站 pan.quark.cn → known=true', sq.known === true);
t('已知站 → label=夸克网盘', sq.label === '夸克网盘');
t('已知站 → domains 含 quark.cn', sq.domains.indexOf('quark.cn') >= 0);
const sg = core.specForHost('www.google.com');
t('未知站 www.google.com → known=false', sg.known === false);
t('未知站 → domains=[google.com]', JSON.stringify(sg.domains) === '["google.com"]');
t('未知站 → label=google.com', sg.label === 'google.com');
t('未知站 → 用通用 keys（含 session）', sg.keys.indexOf('session') >= 0);

console.log('== manifest v2：通配 host 权限 + 新权限集 ==');
const fs = require('fs');
const mf = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
t('host_permissions = ["*://*/*"]（不限网站，非 29 条白名单）', JSON.stringify(mf.host_permissions) === '["*://*/*"]');
t('permissions 恰为 v2 六项（新增 tabs/webNavigation 用于自动抓取）',
  mf.permissions.slice().sort().join(',') === ['activeTab', 'clipboardWrite', 'cookies', 'storage', 'tabs', 'webNavigation'].sort().join(','));
t('version = 2.0.0', mf.version === '2.0.0');
t('service_worker 以 ES module 加载（Chrome157 必须）', mf.background && mf.background.type === 'module');

console.log('');
console.log(fail === 0
  ? 'SELFTEST PASS — ' + pass + '/' + pass + ' 断言通过'
  : 'SELFTEST FAIL — ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
