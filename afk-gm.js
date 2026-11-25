/* ============================================================================
 * afk-gm.js — GM 面板（只有知道秘密連結的人看得到）
 *
 * 解鎖：網址加上 #gm=<GM 碼>（例：.../idle-lineage-class/#gm=xxxx）打開一次 → 這台瀏覽器記住 GM 身分，
 *       左下角出現「GM」按鈕；面板裡可「鎖回去」。程式只存 GM 碼的 SHA-256，不存明碼。
 * 設定（存 localStorage 'afk_gm_cfg'，同一份設定給「線上遊玩」與「離線掛機結算」共用）：
 *   ・mobMult：怪物倍數（0.5～3）。一般狩獵地圖的怪物數＝30 × 倍數（afk-walkview 讀 AFK_GM.mobCount()）。
 * 改設定會發出 'afk-gm-change' 事件；afk-walkview 收到後立刻套用到目前地圖（多的怪移除、少的照常補滿）。
 * 之後接上多人連線（Firebase）時，設定改由伺服器下發、只有 GM 帳號能寫；本機這份當離線時的快取。
 * ========================================================================== */
(function () {
  'use strict';

  var GM_HASH = '1be2c0775729cab26323f941fa64eb67f285d25c7fba6d30b23e9398599afbcb';
  var CFG_KEY = 'afk_gm_cfg', UNLOCK_KEY = 'afk_gm_unlocked';
  var BASE_MOBS = 30;
  var MULTS = [0.5, 1, 1.5, 2, 2.5, 3];
  var DEF = { mobMult: 1 };

  function load() {
    var c = {}; try { c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) { c = {}; }
    var out = {}; for (var k in DEF) out[k] = (c[k] != null) ? c[k] : DEF[k];
    if (!(out.mobMult >= 0.5 && out.mobMult <= 3)) out.mobMult = 1;
    return out;
  }
  var cfg = load();
  function save() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }
  function isGM() { try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; } }

  var GM = window.AFK_GM = {
    get: function (k) { return cfg[k]; },
    all: function () { var o = {}; for (var k in cfg) o[k] = cfg[k]; return o; },
    set: function (k, v, silent) {
      if (k === 'mobMult') { v = Number(v); if (!(v >= 0.5 && v <= 3)) return false; }
      if (cfg[k] === v) return true;
      cfg[k] = v; save();
      if (!silent) try { window.dispatchEvent(new CustomEvent('afk-gm-change', { detail: { key: k, value: v } })); } catch (e) {}
      return true;
    },
    // 給連線模組用：整包覆寫（伺服器下發的設定），會觸發 change
    applyRemote: function (obj) { if (!obj) return; for (var k in DEF) if (obj[k] != null) GM.set(k, obj[k]); },
    mobCount: function () { return Math.max(5, Math.round(BASE_MOBS * (cfg.mobMult || 1))); },
    baseMobs: BASE_MOBS,
    isGM: isGM,
    // 給其他外掛加 GM 面板按鈕：AFK_GM.addSection('標題', function(){...})
    sections: [],
    addSection: function (label, fn) { GM.sections = GM.sections.filter(function (s) { return s.label !== label; }); GM.sections.push({ label: String(label), fn: fn }); }
  };

  // ---- 解鎖（#gm=碼 或 ?gm=碼）-------------------------------------------------
  function sha256(s) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.reject(new Error('no crypto'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function toast(msg) {
    try { if (typeof window.afkToast === 'function') { window.afkToast(msg); return; } } catch (e) {}
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:100000;background:rgba(20,14,6,.94);color:#f3d78a;border:1px solid #8a6a2a;padding:8px 14px;border-radius:6px;font:600 14px/1.4 "Noto Serif TC",serif;box-shadow:0 4px 14px rgba(0,0,0,.6)';
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  // 碼容錯：複製連結時常被多帶標點、空白、全形字或大寫 → 只留英數、全部轉小寫再比對
  function normCode(s) {
    s = String(s || '').replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function tryCode(raw) {
    var code = normCode(raw);
    if (!code) { toast('請輸入 GM 碼'); return Promise.resolve(false); }
    return sha256(code).then(function (h) {
      if (h !== GM_HASH) { toast('GM 碼不正確（收到 ' + code.length + ' 個字元，正確應為 12 個）'); return false; }
      unlockNow('已啟用 GM 面板（左下角「GM」按鈕）'); return true;
    }).catch(function () { toast('這個瀏覽器不支援 GM 驗證'); return false; });
  }
  function unlockNow(msg) {
    try { localStorage.setItem(UNLOCK_KEY, '1'); localStorage.removeItem('afk_gm_manual_lock'); } catch (e) {}
    if (msg) toast(msg);
    ensureButton(); openPanel();
  }
  // 輸入框：網址只打 #gm（不帶碼）就跳出來手動輸入
  function askCode() {
    if (document.getElementById('afk-gm-ask')) return;
    ensureStyle();
    var mask = document.createElement('div'); mask.id = 'afk-gm-mask'; mask.setAttribute('data-ask', '1');
    var p = document.createElement('div'); p.id = 'afk-gm-pan';
    p.innerHTML = '<h3>輸入 GM 碼<button class="x" data-act="close">×</button></h3><div class="b">' +
      '<input id="afk-gm-ask" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:8px;font-size:16px;background:#0a0806;border:1px solid #6d5426;border-radius:5px;color:#f3e2b5">' +
      '<div class="note" style="margin-top:6px">大小寫、空白、標點都沒關係。</div></div>' +
      '<div class="foot"><button data-act="ok">確定</button><button data-act="close">取消</button></div>';
    mask.appendChild(p); document.body.appendChild(mask);
    var inp = document.getElementById('afk-gm-ask'); setTimeout(function () { inp.focus(); }, 50);
    var go = function () { tryCode(inp.value).then(function (ok) { if (ok) { var m2 = document.querySelector('#afk-gm-mask[data-ask]'); if (m2) m2.remove(); openPanel(); } }); };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    p.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.act === 'ok') go(); else mask.remove(); });
  }
  function checkUnlock() {
    var code = null, m, bare = false;
    try {
      var hs = decodeURIComponent(location.hash || ''), qs = decodeURIComponent(location.search || '');
      if ((m = /(?:^|[#&])gm[=:＝]?([^&]*)/i.exec(hs))) { code = m[1]; bare = !normCode(code); }
      else if ((m = /[?&]gm=([^&]*)/i.exec(qs))) { code = m[1]; bare = !normCode(code); }
    } catch (e) {}
    if (code === null) return;
    // 不論對錯都把碼從網址拿掉（避免截圖／分享網址外流）
    try { var u = new URL(location.href); u.hash = ''; u.searchParams.delete('gm'); history.replaceState(null, '', u.pathname + u.search); } catch (e) {}
    if (bare) { askCode(); return; }
    tryCode(code);
  }
  // 用「被設成 GM 的帳號」登入 → 自動開啟 GM 面板，不用輸入碼
  setInterval(function () {
    try { if (isGM() || localStorage.getItem('afk_gm_manual_lock') === '1') return; var me = window.AFK_MP && AFK_MP.me && AFK_MP.me(); if (me && me.admin) unlockNow('GM 帳號已登入，GM 面板已啟用'); } catch (e) {}
  }, 3000);

  // ---- UI ----------------------------------------------------------------------
  var CSS = [
    '#afk-gm-btn{position:fixed;left:6px;bottom:calc(var(--m-nav-h,0px) + 70px);z-index:99990;width:38px;height:38px;border-radius:50%;border:1px solid #b08a3a;',
    'background:radial-gradient(circle at 35% 30%,#5a3c12,#1d1206);color:#ffd77a;font:800 13px/36px "Noto Serif TC",serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.6);cursor:pointer;opacity:.85}',
    '#afk-gm-mask{position:fixed;inset:0;z-index:99995;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}',
    '#afk-gm-pan{width:min(92vw,380px);background:linear-gradient(#2a1d0c,#150e05);border:1px solid #9a7a36;border-radius:8px;color:#ecd9a8;font:14px/1.5 "Noto Serif TC","PMingLiU",serif;box-shadow:0 8px 30px rgba(0,0,0,.7)}',
    '#afk-gm-pan h3{margin:0;padding:10px 14px;border-bottom:1px solid #5a4520;color:#ffd77a;font-size:16px;display:flex;justify-content:space-between;align-items:center}',
    '#afk-gm-pan .b{padding:12px 14px}',
    '#afk-gm-pan .row{margin:6px 0 12px}',
    '#afk-gm-pan .lbl{color:#f3d78a;font-weight:700;margin-bottom:6px}',
    '#afk-gm-pan .opts{display:flex;flex-wrap:wrap;gap:6px}',
    '#afk-gm-pan .opts button{flex:1 0 28%;padding:7px 0;border:1px solid #6d5426;border-radius:5px;background:#24180a;color:#e8d29a;font:600 14px/1 inherit;cursor:pointer}',
    '#afk-gm-pan .opts button.on{background:#7a5414;border-color:#e7b54a;color:#fff3c8}',
    '#afk-gm-pan .note{font-size:12px;color:#b9a57a}',
    '#afk-gm-pan .foot{display:flex;gap:8px;padding:10px 14px;border-top:1px solid #5a4520}',
    '#afk-gm-pan .foot button{flex:1;padding:8px 0;border:1px solid #6d5426;border-radius:5px;background:#2c1f0c;color:#e8d29a;font:600 14px/1 inherit;cursor:pointer}',
    '#afk-gm-pan .x{background:none;border:0;color:#cdb47a;font-size:20px;cursor:pointer;line-height:1}'
  ].join('');
  function ensureStyle() {
    if (document.getElementById('afk-gm-style')) return;
    var s = document.createElement('style'); s.id = 'afk-gm-style'; s.textContent = CSS; document.head.appendChild(s);
  }
  function ensureButton() {
    if (!isGM()) { var o = document.getElementById('afk-gm-btn'); if (o) o.remove(); return; }
    ensureStyle();
    if (document.getElementById('afk-gm-btn')) return;
    var b = document.createElement('div'); b.id = 'afk-gm-btn'; b.textContent = 'GM'; b.title = 'GM 設定';
    b.addEventListener('click', openPanel);
    document.body.appendChild(b);
  }
  function closePanel() { var m = document.getElementById('afk-gm-mask'); if (m) m.remove(); }
  function openPanel() {
    if (!isGM()) return;
    ensureStyle(); closePanel();
    var mask = document.createElement('div'); mask.id = 'afk-gm-mask';
    mask.addEventListener('click', function (e) { if (e.target === mask) closePanel(); });
    var p = document.createElement('div'); p.id = 'afk-gm-pan';
    var opts = MULTS.map(function (v) {
      return '<button data-v="' + v + '" class="' + (cfg.mobMult === v ? 'on' : '') + '">×' + v + '<br><small>' + Math.round(BASE_MOBS * v) + ' 隻</small></button>';
    }).join('');
    p.innerHTML =
      '<h3>GM 設定<button class="x" data-act="close">×</button></h3>' +
      '<div class="b">' +
        '<div class="row"><div class="lbl">怪物倍數（每張狩獵地圖的怪物數量）</div><div class="opts">' + opts + '</div>' +
        '<div class="note" style="margin-top:6px">基本 30 隻 × 倍數，立刻套用到目前地圖。離線掛機結算也用同一個倍數（怪越多，找下一隻怪的路越短、同時圍上來的怪也越多）。</div></div>' +
        '<div class="note">目前：×' + cfg.mobMult + '（' + GM.mobCount() + ' 隻）</div>' +
        (GM.sections.length ? '<div class="row" style="margin-top:12px"><div class="lbl">村莊管理</div><div class="opts">' + GM.sections.map(function (s, i) { return '<button data-sec="' + i + '">' + s.label.replace(/[&<>"]/g, '') + '</button>'; }).join('') + '</div></div>' : '') +
      '</div>' +
      '<div class="foot"><button data-act="lock">鎖回去（隱藏 GM）</button><button data-act="close">關閉</button></div>';
    p.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.v) { GM.set('mobMult', Number(t.dataset.v)); openPanel(); return; }
      if (t.dataset.sec) { var s = GM.sections[+t.dataset.sec]; closePanel(); if (s) try { s.fn(); } catch (e3) {} return; }
      if (t.dataset.act === 'close') closePanel();
      if (t.dataset.act === 'lock') { try { localStorage.removeItem(UNLOCK_KEY); localStorage.setItem('afk_gm_manual_lock', '1'); } catch (e2) {} closePanel(); ensureButton(); toast('已隱藏 GM 面板（要再用就重開 GM 連結）'); }
    });
    mask.appendChild(p); document.body.appendChild(mask);
  }
  GM.open = openPanel; GM.ask = askCode;

  function start() { checkUnlock(); ensureButton(); }
  window.addEventListener('hashchange', checkUnlock);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
