// test_core.js — cookie_core 逻辑自测（纯 Node，不需要 Chrome）
// 覆盖：域名匹配 / 过期过滤 / 同名去重按 path 具体度 / 登录位探针 / platformForHost
const core = require('./cookie_core.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}

const P = core.PLATFORMS;
const quark = P.find(x => x.tag === 'quark');

console.log('== 平台表 ==');
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
  { name: '__pus', value: 'B_deeper', domain: '.quark.cn', path: '/disk', expires: future },   // 更具体 → 应胜出
  { name: '__puus', value: 'U', domain: '.quark.cn', path: '/', expires: future },
  { name: 'dead', value: 'X', domain: '.quark.cn', path: '/', expires: past },                 // 已过期 → 应丢弃
  { name: 'sess', value: 'S', domain: '.quark.cn', path: '/', expires: -1 },                    // session cookie(expires<=0) → 应保留
  { name: 'baidu_only', value: 'Z', domain: '.baidu.com', path: '/', expires: future },         // 别的平台 → 不应进 quark 串
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

console.log('== platformForHost（右键菜单用）==');
t('pan.quark.cn → quark', core.platformForHost('pan.quark.cn').tag === 'quark');
t('www.123pan.com → pan123', core.platformForHost('www.123pan.com').tag === 'pan123');
t('yun.baidu.com → baidu', core.platformForHost('yun.baidu.com').tag === 'baidu');
t('yun.139.com → c139（移动云盘新增）', core.platformForHost('yun.139.com').tag === 'c139');
t('mail.10086.cn → c139', core.platformForHost('mail.10086.cn').tag === 'c139');
t('www.alipan.com → alipan', core.platformForHost('www.alipan.com').tag === 'alipan');
t('www.bilibili.com → bilibili', core.platformForHost('www.bilibili.com').tag === 'bilibili');
t('www.xiaohongshu.com → xhs', core.platformForHost('www.xiaohongshu.com').tag === 'xhs');
t('www.pixiv.net → pixiv', core.platformForHost('www.pixiv.net').tag === 'pixiv');
t('www.douyin.com → douyin', core.platformForHost('www.douyin.com').tag === 'douyin');
t('www.kuaishou.com → kuaishou', core.platformForHost('www.kuaishou.com').tag === 'kuaishou');
t('weibo.com → weibo', core.platformForHost('weibo.com').tag === 'weibo');
t('www.acfun.cn → acfun', core.platformForHost('www.acfun.cn').tag === 'acfun');
t('非网盘 → null', core.platformForHost('www.google.com') === null);

console.log('== manifest host_permissions 与平台表一致（漏一个就永远读不到）==');
const fs = require('fs');
const mf = JSON.parse(fs.readFileSync('./manifest.json', 'utf8'));
const granted = mf.host_permissions.map(h => h.replace(/^\*:\/\/\*\./, '').replace(/\/\*$/, ''));
const missing = [];
for (const p of P) for (const d of p.domains) if (!granted.includes(d)) missing.push(p.tag + ':' + d);
t('每个平台域都在 host_permissions 里' + (missing.length ? '（缺: ' + missing.join(', ') + '）' : ''), missing.length === 0);
t('没有 httpOnly 之外的额外权限（无 alarms/tabs 之类）',
  mf.permissions.sort().join(',') === ['activeTab', 'clipboardWrite', 'cookies', 'storage'].sort().join(','));

console.log('');
console.log(fail === 0
  ? 'SELFTEST PASS — ' + pass + '/' + pass + ' 断言通过'
  : 'SELFTEST FAIL — ' + pass + ' passed / ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
