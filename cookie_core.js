(function (root) {
  'use strict';
  // 平台定义：domains 用 endswith 匹配 host_key；keys 是登录位探针（判断「登录态完整吗」）
  // 说明：这张表只用于「给已知站点打标签 + 标登录位」，不再是抓取范围的限制。
  //       v2 起抓取能力是任意域名（见 specForHost / registrableDomain）。
  var PLATFORMS = [
    { tag: 'quark',  label: '夸克网盘', domains: ['quark.cn'], keys: ['__pus', '__puus', '__kp', 'kps', 'sign', 'vcode'] },
    { tag: 'uc',     label: 'UC 网盘',  domains: ['uc.cn'],    keys: ['__pus', '__puus', 'kps_wg', 'sign_wg', 'vcode_wg'] },
    { tag: 'baidu',  label: '百度网盘', domains: ['baidu.com'], keys: ['BDUSS', 'STOKEN', 'BDUSS_BFESS'] },
    { tag: 'c139',   label: '移动云盘', domains: ['139.com', '10086.cn'], keys: ['authorization', 'token', 'mcloud', 'Account'] },
    { tag: 'pan123', label: '123网盘',  domains: ['123pan.com', '123684.com'], keys: ['uid', 'sid', 'sign', 'sToken'] },
    { tag: 'pan115', label: '115网盘',  domains: ['115.com', '115cdn.com'],    keys: ['UID', 'CID', 'SEID', 'KID'] },
    { tag: 'alipan', label: '阿里网盘', domains: ['alipan.com', 'aliyundrive.com', 'guangyapan.com'], keys: ['token', 'login_tm', 'refresh_token'] },
    { tag: 'lanzou', label: '蓝奏云',   domains: ['lanzou.com', 'lanzoui.com', 'lanzoux.com', 'lanzouq.com', 'lanzoug.com', 'lanzoum.com', 'lanzoup.com', 'lanzoub.com', 'lanzonn.com', 'lanzol.com'], keys: ['yToken', 'phpinfo', 'lid', 'kbzw'] },
    { tag: 'bilibili', label: '哔哩哔哩', domains: ['bilibili.com'], keys: ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'] },
    { tag: 'xhs',      label: '小红书',   domains: ['xiaohongshu.com'], keys: ['web_session'] },
    { tag: 'pixiv',    label: 'PIXIV',   domains: ['pixiv.net'], keys: ['PHPSESSID'] },
    { tag: 'douyin',   label: '抖音',     domains: ['douyin.com'], keys: ['sessionid', 'sid_tt'] },
    { tag: 'kuaishou', label: '快手',     domains: ['kuaishou.com'], keys: ['userId', 'kuaishou.server.web_st'] },
    { tag: 'weibo',    label: '微博',     domains: ['weibo.com'], keys: ['SUB', 'SUBP'] },
    { tag: 'acfun',    label: 'AcFun',   domains: ['acfun.cn'], keys: ['acfun_ueid', 'acfun_fast'] }
  ];

  // 未知站点的通用「登录位」提示（非精确，仅给个 ✓ 参考，不参与过滤）
  var COMMON_KEYS = ['session', 'sessionid', 'sid', 'token', 'access_token', 'auth', 'login',
                     'uid', 'userid', 'SUB', 'JSESSIONID', 'PHPSESSID', 'remember', 'csrf'];

  // 常见多级公共后缀：把 host 归类到「可注册域」用于分组（非安全边界，仅归类，够用即可）
  var MULTI_SUFFIX = ['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'co.uk',
                      'org.uk', 'gov.uk', 'com.au', 'org.au', 'co.jp', 'ne.jp', 'co.kr',
                      'com.br', 'com.tw', 'com.hk', 'co.nz', 'com.sg'];

  function nowSec() { return Date.now() / 1000; }
  function isLive(c) { return !c.expires || c.expires <= 0 || c.expires > nowSec(); }
  function matchPlatform(c, p) {
    var d = (c.domain || '').toLowerCase().replace(/^\./, '');
    for (var i = 0; i < p.domains.length; i++) {
      var t = p.domains[i];
      // 只认「等于根域」或「根域的子域」，避免 notquark.cn 这类假命中
      if (d === t || d.endsWith('.' + t)) return true;
    }
    return false;
  }
  // 同名去重：path 更长者优先（cookie 规范=更具体），同 path 则 domain 更长者（更具体）优先
  function buildHeader(cookies, p) {
    var best = {};
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i];
      if (!matchPlatform(c, p) || !isLive(c)) continue;
      var cur = best[c.name];
      if (!cur) { best[c.name] = c; continue; }
      var curPath = (cur.path || '').length, cPath = (c.path || '').length;
      if (cPath > curPath || (cPath === curPath && (c.domain || '').length > (cur.domain || '').length)) best[c.name] = c;
    }
    var names = Object.keys(best);
    var parts = [];
    for (var j = 0; j < names.length; j++) parts.push(names[j] + '=' + best[names[j]].value);
    var keysHit = [];
    var keyList = p.keys || [];
    for (var k = 0; k < keyList.length; k++) {
      var key = keyList[k];
      for (var n = 0; n < names.length; n++) {
        if (names[n] === key || names[n].indexOf(key) >= 0) { keysHit.push(key); break; }
      }
    }
    return { header: parts.join('; '), count: names.length, keysHit: keysHit };
  }
  // 从 URL/hostname 找已知平台（标签用）
  function platformForHost(host) {
    host = (host || '').toLowerCase();
    for (var i = 0; i < PLATFORMS.length; i++) {
      var p = PLATFORMS[i];
      for (var j = 0; j < p.domains.length; j++) {
        var t = p.domains[j];
        if (host === t || host.endsWith('.' + t)) return p;
      }
    }
    return null;
  }
  // host/IPv4 → 可注册域（分组 + 抓取范围）。只做归类，不追求完整 PSL。
  function registrableDomain(host) {
    host = (host || '').toLowerCase().trim().replace(/^\./, '').split('/')[0].split(':')[0];
    if (!host) return '';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host; // IPv4 原样
    var parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    var l2 = parts[parts.length - 2] + '.' + parts[parts.length - 1];
    var l3 = parts[parts.length - 3] + '.' + l2;
    if (MULTI_SUFFIX.indexOf(l2) >= 0) return l3;
    return l2;
  }
  // 任意 host → 抓取规格 {label, domains, keys, known}。已知平台用其专属 keys，否则用通用 keys。
  function specForHost(host) {
    var p = platformForHost(host);
    if (p) return { label: p.label, domains: p.domains, keys: p.keys, known: true };
    var dom = registrableDomain(host);
    return { label: dom, domains: [dom], keys: COMMON_KEYS, known: false };
  }

  var api = {
    PLATFORMS: PLATFORMS, COMMON_KEYS: COMMON_KEYS, MULTI_SUFFIX: MULTI_SUFFIX,
    isLive: isLive, matchPlatform: matchPlatform, buildHeader: buildHeader,
    platformForHost: platformForHost, registrableDomain: registrableDomain, specForHost: specForHost
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CookieExporterCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
