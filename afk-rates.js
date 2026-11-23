/* ============================================================================
 * afk-rates.js — 伺服器倍率：經驗／掉寶／金幣／強化成功率（＋只有特定連結才看得到的 GM 設定面板）
 *
 * 倍率來源（優先序）：
 *   1. 這台裝置的覆寫  localStorage['afk_rates_override']（GM 面板按「只套用這台裝置」）
 *   2. 網站上的 rates.json（GM 面板按「發布給所有玩家」→ 用 GM 自己的 GitHub token 寫回 repo）
 *   3. 都沒有 → 全部 1 倍（＝原版）
 *
 * 套用方式（只包核心函式，不改核心檔；離線補跑也走同一條 killMob 管線，所以一樣吃倍率）：
 *   經驗   getExpGainMult(lv)        × exp    （玩家與傭兵；滿等仍為 0）
 *   掉寶   classicDropMult() / trialItemDropMult(id) × drop  （核心所有掉落判定點都乘這兩個之一，不會重複相乘）
 *   金幣   monsterGoldRange(mob) 的 min/max × gold
 *   強化   enhanceOutcomeFromRoll(type,safe,en,r)：把骰值 r 除以倍率 → 成功率 × enhance（安定值內本來就 100%）
 *
 * GM 面板：網址帶 ?gm=<密鑰> 才出現（程式裡只存密鑰的 SHA-256，原始碼看不出密鑰）。
 *   注意：這只是把設定入口藏起來；真正能改到「所有玩家」的，是持有 repo 寫入權的 GitHub token。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'rates', name: '伺服器倍率', group: '其他', def: true,
      desc: '依伺服器設定調整經驗、掉寶、金幣與強化成功率倍率'
    });
    if (!AFK_TOGGLES.enabled('rates')) return;
  }

  var GM_HASH = 'b4436f898f4754eea8f57971915606c7a8d7b18db1c3fd175ef0670b84b03bc3';
  var LS_OVERRIDE = 'afk_rates_override', LS_TOKEN = 'afk_gm_token';
  var KEYS = [['exp', '經驗'], ['drop', '掉寶'], ['gold', '金幣'], ['enhance', '強化成功率'], ['bm', '黑市更新速度']];
  var MIN = 0.1, MAX = 100;

  var R = { exp: 1, drop: 1, gold: 1, enhance: 1, bm: 1, starter: null };
  var source = '原版';
  var server = null;   // rates.json 讀到的值

  function clampRate(v) { v = Number(v); if (!isFinite(v) || v <= 0) return 1; return Math.min(MAX, Math.max(MIN, v)); }
  function norm(o) {
    var r = {}; KEYS.forEach(function (k) { r[k[0]] = clampRate(o && o[k[0]] != null ? o[k[0]] : 1); });
    r.starter = normStarter(o && o.starter);
    return r;
  }
  // 新角色禮包：{ gold, items:[{id, en, cnt, equip}] }；格式不對就當作「沒設定」（afk-starterkit 會用它自己的預設）
  function normStarter(st) {
    if (!st || typeof st !== 'object' || !Array.isArray(st.items)) return null;
    var g = Math.max(0, Math.min(2000000000, Math.floor(Number(st.gold) || 0)));
    var items = st.items.filter(function (x) { return x && typeof x.id === 'string'; }).slice(0, 40).map(function (x) {
      return { id: x.id, en: Math.max(-7, Math.min(30, Math.floor(Number(x.en) || 0))), cnt: Math.max(1, Math.min(99999, Math.floor(Number(x.cnt) || 1))), equip: !!x.equip };
    });
    return { gold: g, items: items };
  }
  function readOverride() { try { var s = localStorage.getItem(LS_OVERRIDE); return s ? norm(JSON.parse(s)) : null; } catch (e) { return null; } }
  function recompute() {
    var ov = readOverride();
    if (ov) { R = ov; source = '這台裝置的設定'; }
    else if (server) { R = server; source = '伺服器設定'; }
    else { R = norm(null); source = '原版'; }
    window.AFK_RATES = { get: function () { return Object.assign({}, R); }, starter: function () { return R.starter ? JSON.parse(JSON.stringify(R.starter)) : null; }, source: source };
  }
  recompute();

  // 讀網站上的 rates.json（file:// 直接開檔時會讀不到 → 維持原版或裝置覆寫）
  try {
    fetch('rates.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { server = norm(j); recompute(); refreshPanel(); } })
      .catch(function () {});
  } catch (e) {}

  // ---- 包核心函式 -------------------------------------------------------------
  function wrap(name, make) {
    var f = window[name];
    if (typeof f !== 'function' || f._afkRates) return typeof f === 'function';
    var w = make(f); w._afkRates = true; window[name] = w; return true;
  }
  function on() { return !window.AFK_TOGGLES || AFK_TOGGLES.enabled('rates'); }
  function hookAll() {
    var ok = true;
    ok = wrap('getExpGainMult', function (o) { return function (lv) { var v = o.apply(this, arguments); return on() ? v * R.exp : v; }; }) && ok;
    ok = wrap('classicDropMult', function (o) { return function () { var v = o.apply(this, arguments); return on() ? v * R.drop : v; }; }) && ok;
    ok = wrap('trialItemDropMult', function (o) { return function () { var v = o.apply(this, arguments); return on() ? v * R.drop : v; }; }) && ok;
    ok = wrap('monsterGoldRange', function (o) {
      return function () {
        var g = o.apply(this, arguments);
        if (!on() || R.gold === 1 || !g) return g;
        return Object.assign({}, g, { min: Math.max(1, Math.round(g.min * R.gold)), max: Math.max(1, Math.round(g.max * R.gold)) });
      };
    }) && ok;
    ok = wrap('enhanceOutcomeFromRoll', function (o) {
      return function (type, safe, en, r) {
        if (on() && R.enhance !== 1 && typeof r === 'number') r = r / R.enhance;
        return o.call(this, type, safe, en, r);
      };
    }) && ok;
    // 黑市更新速度：核心每 10 秒呼叫一次 refreshPandoraMarket，用「上次輪換的時間點」往前／往後挪，
    //   讓經過的時間看起來是 bm 倍（間隔常數是核心的 const，不改它）。
    ok = wrap('refreshPandoraMarket', function (o) {
      var seen = null;
      return function (force) {
        try {
          var now = (typeof state !== 'undefined' && state) ? (state.ticks || 0) : 0;
          var m = (typeof player !== 'undefined' && player) ? player.pandoraMarket2 : null;
          if (on() && R.bm !== 1 && m && typeof m.lastTick === 'number' && seen != null && now > seen) {
            var d = now - seen, shift = Math.round(d * (R.bm - 1));
            var life = (typeof PANDORA_LIFETIME_TICKS !== 'undefined') ? PANDORA_LIFETIME_TICKS : 144000;
            m.lastTick = Math.min(now, Math.max(now - life + 1, m.lastTick - shift));
          }
          seen = now;
        } catch (e) {}
        return o.apply(this, arguments);
      };
    }) && ok;
    return ok;
  }
  if (!hookAll()) { var n = 0; (function retry() { if (!hookAll() && ++n < 40) setTimeout(retry, 250); })(); }

  // ---- GM 面板（只有 ?gm=<密鑰> 才建立） ----------------------------------------
  var panel = null;
  function sha256hex(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function gmParam() { try { return new URLSearchParams(location.search).get('gm'); } catch (e) { return null; } }

  var CSS = [
    '#afk-gm-btn{position:fixed;right:10px;bottom:calc(80px + var(--m-nav-h,0px));z-index:2147483000;padding:6px 12px;border-radius:6px;border:1px solid #d6b46a;background:#2a2218;color:#f5d27a;font-weight:700;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.6);}',
    '#afk-gm{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:16px;}',
    '#afk-gm.open{display:flex;}',
    '#afk-gm .box{width:100%;max-width:380px;max-height:90vh;overflow:auto;background:linear-gradient(180deg,#1d1812,#0f0d0a);border:1px solid #8a6a35;border-radius:8px;padding:14px;color:#ecdfbf;font-size:14px;}',
    '#afk-gm h3{margin:0 0 4px;font-size:18px;color:#d6b46a;display:flex;align-items:center;}',
    '#afk-gm h3 button{margin-left:auto;background:none;border:0;color:#ecdfbf;font-size:20px;}',
    '#afk-gm .src{font-size:12px;color:#a8996f;margin-bottom:10px;}',
    '#afk-gm .row{display:flex;align-items:center;gap:8px;margin:8px 0;}',
    '#afk-gm .row label{width:84px;}',
    '#afk-gm .row input[type=range]{flex:1;}',
    '#afk-gm .row input[type=number]{width:70px;background:#0a0907;border:1px solid #4b3a1d;color:#ecdfbf;border-radius:4px;padding:3px 5px;}',
    '#afk-gm .btns{display:grid;gap:6px;margin-top:12px;}',
    '#afk-gm .btns button{padding:8px;border-radius:5px;border:1px solid #8a6a35;background:linear-gradient(180deg,#2a2218,#15110c);color:#ecdfbf;font-weight:700;}',
    '#afk-gm .btns button.pub{background:linear-gradient(180deg,#2f6db0,#173a66);border-color:#7fb0e8;color:#fff;}',
    '#afk-gm .tok{display:none;margin-top:10px;font-size:12px;}',
    '#afk-gm .tok.show{display:block;}',
    '#afk-gm .tok input[type=password]{width:100%;margin:4px 0;background:#0a0907;border:1px solid #4b3a1d;color:#ecdfbf;border-radius:4px;padding:5px;}',
    '#afk-gm .msg{margin-top:8px;font-size:12.5px;min-height:1em;}',
    '#afk-gm .sec{margin:14px 0 4px;padding-top:8px;border-top:1px solid rgba(138,106,53,.5);color:#d6b46a;font-weight:700;}',
    '#afk-gm .kit .it{display:flex;align-items:center;gap:4px;padding:4px 0;border-bottom:1px solid rgba(75,58,29,.5);font-size:13px;}',
    '#afk-gm .kit .it .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#afk-gm .kit .it input[type=number]{width:46px;background:#0a0907;border:1px solid #4b3a1d;color:#ecdfbf;border-radius:4px;padding:2px 3px;}',
    '#afk-gm .kit .it button{background:none;border:0;color:#f87171;font-size:15px;}',
    '#afk-gm .kit .hd{display:flex;gap:4px;font-size:11px;color:#a8996f;padding-bottom:2px;}',
    '#afk-gm input[data-sq],#afk-gm input[data-sg]{background:#0a0907;border:1px solid #4b3a1d;color:#ecdfbf;border-radius:4px;padding:5px;}',
    '#afk-gm .res div{padding:5px 4px;cursor:pointer;border-bottom:1px solid rgba(75,58,29,.4);font-size:13px;}',
    '#afk-gm .res div:hover{background:rgba(214,180,106,.15);}'
  ].join('\n');

  function buildPanel() {
    if (panel) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var btn = document.createElement('button'); btn.id = 'afk-gm-btn'; btn.type = 'button'; btn.textContent = 'GM 倍率';
    btn.addEventListener('click', function () { refreshPanel(); panel.classList.add('open'); });
    document.body.appendChild(btn);
    panel = document.createElement('div'); panel.id = 'afk-gm';
    var rows = KEYS.map(function (k) {
      return '<div class="row"><label>' + k[1] + '</label><input type="range" min="0.1" max="20" step="0.1" data-k="' + k[0] + '">' +
        '<input type="number" min="' + MIN + '" max="' + MAX + '" step="0.1" data-n="' + k[0] + '">倍</div>';
    }).join('');
    panel.innerHTML = '<div class="box"><h3>倍率設定<button type="button" data-x>✕</button></h3><div class="src"></div>' + rows +
      '<div class="sec">新角色禮包</div><div class="row"><label>金幣</label><input type="number" min="0" data-sg style="flex:1"></div>' +
      '<div class="kit"></div><div class="row"><input data-sq placeholder="搜尋物品加入禮包" style="flex:1"></div><div class="res"></div>' +
      '<div class="btns"><button type="button" data-a="local">只套用這台裝置</button>' +
      '<button type="button" class="pub" data-a="pub">發布給所有玩家</button>' +
      '<button type="button" data-a="reset">全部恢復 1 倍</button>' +
      '<button type="button" data-a="toggles">外掛開關</button></div>' +
      '<div class="tok"><div>GitHub token（需有這個 repo 的 Contents 寫入權限）</div><input type="password" autocomplete="off">' +
      '<label><input type="checkbox" data-remember> 記在這台裝置</label><div class="btns"><button type="button" class="pub" data-a="send">確認發布</button></div></div>' +
      '<div class="msg"></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel || e.target.hasAttribute('data-x')) panel.classList.remove('open'); });
    KEYS.forEach(function (k) {
      var rg = panel.querySelector('[data-k="' + k[0] + '"]'), nb = panel.querySelector('[data-n="' + k[0] + '"]');
      rg.addEventListener('input', function () { nb.value = rg.value; });
      nb.addEventListener('input', function () { rg.value = Math.min(20, clampRate(nb.value)); });
    });
    panel.querySelector('[data-sq]').addEventListener('input', function () { searchItems(this.value); });
    panel.querySelector('[data-a="local"]').addEventListener('click', function () {
      try { localStorage.setItem(LS_OVERRIDE, JSON.stringify(formVals())); } catch (e) {}
      recompute(); refreshPanel(); msg('已套用到這台裝置。');
    });
    panel.querySelector('[data-a="reset"]').addEventListener('click', function () {
      KEYS.forEach(function (k) { setForm(k[0], 1); });
      kit = defaultKit(); renderKit();
      msg('已把欄位改回 1 倍，按「只套用這台裝置」或「發布給所有玩家」才會生效。');
    });
    panel.querySelector('[data-a="toggles"]').addEventListener('click', function () {
      panel.classList.remove('open');
      try { if (window.AFK_TOGGLES && AFK_TOGGLES.openPanel) AFK_TOGGLES.openPanel(); } catch (e) {}
    });
    panel.querySelector('[data-a="pub"]').addEventListener('click', function () {
      var t = panel.querySelector('.tok'); t.classList.add('show');
      try { var s = localStorage.getItem(LS_TOKEN); if (s) { t.querySelector('input[type=password]').value = s; t.querySelector('[data-remember]').checked = true; } } catch (e) {}
    });
    panel.querySelector('[data-a="send"]').addEventListener('click', publish);
  }
  function setForm(k, v) { panel.querySelector('[data-k="' + k + '"]').value = Math.min(20, v); panel.querySelector('[data-n="' + k + '"]').value = v; }
  function formVals() {
    var o = {}; KEYS.forEach(function (k) { o[k[0]] = clampRate(panel.querySelector('[data-n="' + k[0] + '"]').value); });
    readKit();
    o.starter = normStarter({ gold: panel.querySelector('[data-sg]').value, items: kit });
    return o;
  }
  // ---- 新角色禮包編輯 ----
  var kit = [];
  function defaultKit() { try { var d = window.AFK_STARTER_DEFAULT && AFK_STARTER_DEFAULT(); if (d) return d.items; } catch (e) {} return []; }
  function defaultGold() { try { var d = window.AFK_STARTER_DEFAULT && AFK_STARTER_DEFAULT(); if (d) return d.gold; } catch (e) {} return 1000; }
  function iname(id) { try { return DB.items[id] ? DB.items[id].n : id; } catch (e) { return id; } }
  function renderKit() {
    var box = panel.querySelector('.kit');
    box.innerHTML = '<div class="hd"><span style="flex:1">物品</span><span style="width:46px">強化</span><span style="width:46px">數量</span><span>穿上</span><span style="width:20px"></span></div>' +
      kit.map(function (x, i) {
        return '<div class="it" data-i="' + i + '"><span class="nm">' + iname(x.id).replace(/</g, '&lt;') + '</span>' +
          '<input type="number" min="-7" max="30" value="' + x.en + '" data-f="en"><input type="number" min="1" value="' + x.cnt + '" data-f="cnt">' +
          '<input type="checkbox" data-f="equip"' + (x.equip ? ' checked' : '') + '><button type="button" data-del>✕</button></div>';
      }).join('');
    box.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { readKit(); kit.splice(+b.parentNode.getAttribute('data-i'), 1); renderKit(); }; });
  }
  function readKit() {
    if (!panel) return;
    panel.querySelectorAll('.kit .it').forEach(function (row) {
      var x = kit[+row.getAttribute('data-i')]; if (!x) return;
      x.en = Math.floor(+row.querySelector('[data-f="en"]').value) || 0;
      x.cnt = Math.max(1, Math.floor(+row.querySelector('[data-f="cnt"]').value) || 1);
      x.equip = row.querySelector('[data-f="equip"]').checked;
    });
  }
  function searchItems(q) {
    var res = panel.querySelector('.res'); q = (q || '').trim();
    if (!q) { res.innerHTML = ''; return; }
    var out = [];
    try { for (var id in DB.items) { var d = DB.items[id]; if (d && d.n && d.n.indexOf(q) >= 0) { out.push(id); if (out.length >= 10) break; } } } catch (e) {}
    res.innerHTML = out.map(function (id) { var d = DB.items[id]; return '<div data-id="' + id + '">' + d.n.replace(/</g, '&lt;') + (typeof d.safe === 'number' ? '　<span style="color:#a8996f">安定 +' + d.safe + '</span>' : '') + '</div>'; }).join('') || '<div style="cursor:default;color:#a8996f">找不到</div>';
    res.querySelectorAll('[data-id]').forEach(function (el) {
      el.onclick = function () {
        var id = el.getAttribute('data-id'), d = DB.items[id];
        readKit();
        kit.push({ id: id, en: typeof d.safe === 'number' ? d.safe : 0, cnt: 1, equip: d.type === 'wpn' || d.type === 'arm' || d.type === 'acc' });
        renderKit(); res.innerHTML = ''; panel.querySelector('[data-sq]').value = '';
      };
    });
  }
  function msg(s, bad) { var m = panel.querySelector('.msg'); m.textContent = s; m.style.color = bad ? '#f87171' : '#a7f3d0'; }
  function refreshPanel() {
    if (!panel) return;
    KEYS.forEach(function (k) { setForm(k[0], R[k[0]]); });
    kit = R.starter ? JSON.parse(JSON.stringify(R.starter.items)) : defaultKit();
    panel.querySelector('[data-sg]').value = R.starter ? R.starter.gold : defaultGold();
    renderKit();
    var s = '目前生效：' + source;
    if (readOverride()) s += '（伺服器設定被這台裝置蓋過；發布後會自動清除）';
    panel.querySelector('.src').textContent = s;
  }

  function repoInfo() {
    var host = location.hostname, m = host.match(/^([^.]+)\.github\.io$/i);
    if (!m) return null;
    var seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: seg && !/\.html?$/.test(seg) ? seg : (m[1] + '.github.io') };
  }
  function b64utf8(s) { return btoa(unescape(encodeURIComponent(s))); }
  function publish() {
    var info = repoInfo();
    if (!info) { msg('只有在 github.io 網址上才能發布；本機請用「只套用這台裝置」。', true); return; }
    var tokIn = panel.querySelector('.tok input[type=password]'), tok = (tokIn.value || '').trim();
    if (!tok) { msg('請先貼上 GitHub token。', true); return; }
    try { if (panel.querySelector('[data-remember]').checked) localStorage.setItem(LS_TOKEN, tok); else localStorage.removeItem(LS_TOKEN); } catch (e) {}
    var vals = formVals(), body = JSON.stringify(vals, null, 2) + '\n';
    var api = 'https://api.github.com/repos/' + info.owner + '/' + info.repo + '/contents/rates.json';
    var hdr = { 'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json' };
    msg('發布中…');
    fetch(api, { headers: hdr, cache: 'no-store' })
      .then(function (r) { return r.status === 404 ? null : (r.ok ? r.json() : Promise.reject(r.status)); })
      .then(function (cur) {
        var payload = { message: '調整伺服器倍率', content: b64utf8(body) };
        if (cur && cur.sha) payload.sha = cur.sha;
        return fetch(api, { method: 'PUT', headers: hdr, body: JSON.stringify(payload) });
      })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function () {
        try { localStorage.removeItem(LS_OVERRIDE); } catch (e) {}
        server = norm(vals); recompute(); refreshPanel();
        msg('已發布。網站重新部署約需幾分鐘，玩家重新整理後生效。');
      })
      .catch(function (st) {
        msg(st === 401 || st === 403 ? '發布失敗：token 無效或沒有這個 repo 的寫入權限。' : '發布失敗（' + st + '），請稍後再試。', true);
        try { console.warn('[afk-rates] publish', st); } catch (e) {}
      });
  }

  function startGM() {
    var k = gmParam(); if (!k) return;
    sha256hex(k).then(function (h) { if (h === GM_HASH) { buildPanel(); refreshPanel(); } }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startGM); else startGM();
})();
