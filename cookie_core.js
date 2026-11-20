(function (root) {
  'use strict';
  // Cookie Exporter 核心逻辑：不限网站、无内置平台表。
  // 任何域名都用同一套通用 keys 抓取、归类到可注册域。

  // 通用「登录位」提示（非精确，仅给个 ✓ 参考，不参与过滤）
  var COMMON_KEYS = ['session', 'sessionid', 'sid', 'token', 'access_token', 'auth', 'login',
                     'uid', 'userid', 'SUB', 'JSESSIONID', 'PHPSESSID', 'remember', 'csrf'];

  // 常见多级公共后缀：把 host 归类到「可注册域」用于分组（非安全边界，仅归类，够用即可）
  var MULTI_SUFFIX = ['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'co.uk',
                      'org.uk', 'gov.uk', 'com.au', 'org.au', 'co.jp', 'ne.jp', 'co.kr',
                      'com.br', 'com.tw', 'com.hk', 'co.nz', 'com.sg'];

  function nowSec() { return Date.now() / 1000; }
  function isLive(c) { return !c.expires || c.expires <= 0 || c.expires > nowSec(); }

  // 判断一条 cookie 的域名是否属于 spec.domains（只认根域或子域，防 notxxx.cn 假命中）
  function matchSpec(c, spec) {
    var d = (c.domain || '').toLowerCase().replace(/^\./, '');
    var domains = (spec && spec.domains) || [];
    for (var i = 0; i < domains.length; i++) {
      var t = String(domains[i]).toLowerCase().replace(/^\./, '');
      if (t && (d === t || d.endsWith('.' + t))) return true;
    }
    return false;
  }

  // 同名去重：path 更长者优先（cookie 规范=更具体），同 path 则 domain 更长者（更具体）优先
  function buildHeader(cookies, spec) {
    var best = {};
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i];
      if (!matchSpec(c, spec) || !isLive(c)) continue;
      var cur = best[c.name];
      if (!cur) { best[c.name] = c; continue; }
      var curPath = (cur.path || '').length, cPath = (c.path || '').length;
      if (cPath > curPath || (cPath === curPath && (c.domain || '').length > (cur.domain || '').length)) best[c.name] = c;
    }
    var names = Object.keys(best);
    var parts = [];
    for (var j = 0; j < names.length; j++) parts.push(names[j] + '=' + best[names[j]].value);
    var keysHit = [];
    var keyList = (spec && spec.keys) || COMMON_KEYS;
    for (var k = 0; k < keyList.length; k++) {
      var key = keyList[k];
      for (var n = 0; n < names.length; n++) {
        if (names[n] === key || names[n].indexOf(key) >= 0) { keysHit.push(key); break; }
      }
    }
    return { header: parts.join('; '), count: names.length, keysHit: keysHit };
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

  // 任意 host → 抓取规格 {label, domains, keys, known}。全站统一走可注册域 + 通用 keys。
  function specForHost(host) {
    var dom = registrableDomain(host);
    return { label: dom, domains: [dom], keys: COMMON_KEYS, known: false };
  }

  var api = {
    COMMON_KEYS: COMMON_KEYS, MULTI_SUFFIX: MULTI_SUFFIX,
    isLive: isLive, matchSpec: matchSpec, buildHeader: buildHeader,
    registrableDomain: registrableDomain, specForHost: specForHost
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CookieExporterCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
