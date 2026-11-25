/* ============================================================================
 * afk-petctl.js — 遊戲畫面上的「寵物控制」介面
 *
 * 右下 🐾 按鈕（有寵物才出現）→ 小面板，每隻出戰中的寵物一列：
 *   頭像、名稱等級、HP／MP 條、倒地狀態
 *   指令（天堂寵物控制的概念）：
 *     ⚔ 攻擊：自己找最近的怪打（原本的行為）
 *     🎯 協助：只打「我正在打的目標」
 *     🛡 防禦：只打「正在圍攻我的怪」，沒有就待在我身邊
 *     💤 休息：不打怪，跟在我身邊
 *   喝水：HP 低於多少 % 自動喝藥（遊戲原本的寵物喝水設定，這裡直接改）
 *   收回：把這隻收回寵物保管
 * 上方一排「全部」可以一次下指令給所有寵物。指令記在這台裝置（localStorage），換地圖、重開都保留。
 * 做法：包住核心的 _petPickTarget（選目標）與 _petWanderStep（寵物走位），其他戰鬥計算完全不動。
 * ========================================================================== */
(function () {
  'use strict';
  var LS = 'afk_petstance';
  var MODES = [['attack', '⚔ 攻擊'], ['assist', '🎯 協助'], ['defend', '🛡 防禦'], ['rest', '💤 休息']];
  var stance = {};
  try { stance = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { stance = {}; }
  function save() { try { localStorage.setItem(LS, JSON.stringify(stance)); } catch (e) {} }
  function modeOf(p) { return stance[p.uid] || 'attack'; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function outs() { try { return (typeof petsOutList === 'function' && player && player.cls) ? petsOutList() : []; } catch (e) { return []; } }
  function rosterN() { try { return typeof petRoster === 'function' ? petRoster().length : 0; } catch (e) { return 0; } }
  function aliveMobs() { try { return mapState.mobs.filter(function (m) { return m && m.curHp > 0; }); } catch (e) { return []; } }
  function playerTarget() {
    try { var m = mapState.mobs[mapState.targetIdx]; return (m && m.curHp > 0) ? m : null; } catch (e) { return null; }
  }
  // 正在圍攻玩家的怪：走位層判定已貼身（inReach），或最近出過手、或已經被打過還在追
  function attackersOfMe() {
    var wv = window.__afkWV, now = Date.now();
    return aliveMobs().filter(function (m) {
      try {
        var p = wv && wv.on && wv.mobs ? wv.mobs.get(String(m.uid)) : null;
        if (p && (p.inReach || p.aggro > 0)) return true;
        var a = m._animAct; return !!(a && (a.k === 'attack' || a.k === 'skill') && now - a.t < 3000);
      } catch (e) { return false; }
    });
  }
  function pickFor(p, orig) {
    var md = modeOf(p);
    if (md === 'rest') return null;
    if (md === 'assist') return playerTarget();
    if (md === 'defend') {
      var list = attackersOfMe(); if (!list.length) return null;
      var pt = playerTarget(); if (pt && list.indexOf(pt) >= 0) return pt;
      return list[0];
    }
    return orig(p);
  }

  // ---- 掛核心 ------------------------------------------------------------------------
  function hookPick() {
    if (typeof window._petPickTarget !== 'function') return false;
    if (window._petPickTarget._pc) return true;
    var orig = window._petPickTarget;
    var w = function (p) {
      try { if (p && p.uid && outs().some(function (o) { return o.uid === p.uid; })) { var t = pickFor(p, orig); p._pcTgt = t ? t.uid : null; return t; } } catch (e) {}
      return orig.apply(this, arguments);
    };
    w._pc = true; window._petPickTarget = w; return true;
  }
  // 走位：非「攻擊」模式時，有目標就走向目標，沒有目標就跟在玩家身邊（不會亂跑去追別隻怪）
  function playerPoint(hr) {
    var pm = $('player-morph-sprite'); if (!pm || !hr.width) return null;
    var r = pm.getBoundingClientRect(); if (!r.width) return null;
    return { x: (r.left + r.width / 2 - hr.left) / hr.width, y: (r.top + r.height * 0.92 - hr.top) / hr.height };
  }
  function hookWander() {
    if (typeof window._petWanderStep !== 'function') return false;
    if (window._petWanderStep._pc) return true;
    var orig = window._petWanderStep;
    var w = function (p, host, hostRect) {
      try {
        var md = p && p.uid ? stance[p.uid] : null;
        if (md && md !== 'attack' && !p._downed && host) {
          var hr = hostRect || host.getBoundingClientRect();
          if (p._px == null) { p._px = 0.4; p._py = 0.75; }
          var speed = 0.06 / (typeof PET_ANIM_FPS !== 'undefined' ? PET_ANIM_FPS : 8), tx = null, ty = null, stop = 0.1;
          var tgtUid = md === 'rest' ? null : p._pcTgt;
          var r = (tgtUid != null && typeof _vfxSlotRect === 'function') ? _vfxSlotRect(tgtUid) : null;
          if (r && r.width && hr.width) { tx = (r.left + r.width / 2 - hr.left) / hr.width; ty = (r.top + r.height * 0.9 - hr.top) / hr.height; p._faceMobUid = tgtUid; }
          else {
            var pp = playerPoint(hr);
            if (pp) { var idx = outs().findIndex(function (o) { return o.uid === p.uid; }), ang = (idx < 0 ? 0 : idx) * 1.7 + 2.2; tx = pp.x + Math.cos(ang) * 0.07; ty = pp.y + Math.sin(ang) * 0.05; stop = 0.025; }
          }
          if (tx != null) {
            var dx = tx - p._px, dy = ty - p._py, dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > stop) { var k = Math.min(dist - stop, speed * (dist > 0.3 ? 2.6 : 1.6)); p._px += dx / dist * k; p._py += dy / dist * k; p._moving = true; }
            else p._moving = false;
            try { p._dir = _vec2dir(dx * (hr.width || 800), dy * (hr.height || 242)); } catch (e) {}
          } else p._moving = false;
          p._px = Math.max(0.02, Math.min(0.98, p._px)); p._py = Math.max(0.12, Math.min(0.98, p._py));
          return;
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    w._pc = true; window._petWanderStep = w; return true;
  }

  // ---- 介面 -----------------------------------------------------------------------
  var CSS = [
    '#pc-btn{position:fixed;right:6px;bottom:calc(var(--m-nav-h,0px) + 116px);z-index:99989;width:40px;height:40px;border-radius:50%;border:1px solid #b08a3a;background:radial-gradient(circle at 35% 30%,#5a3c12,#1d1206);color:#ffd77a;font:700 19px/38px serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.6);cursor:pointer;display:none}',
    '#pc-btn.on{display:block}',
    '#pc-btn b{position:absolute;right:-4px;top:-4px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#2a6a2a;color:#fff;font:700 10px/16px sans-serif}',
    '#pc-pan{position:fixed;right:52px;bottom:calc(var(--m-nav-h,0px) + 70px);z-index:99990;width:min(calc(100vw - 64px),340px);max-height:min(70vh,460px);overflow-y:auto;background:linear-gradient(rgba(42,29,12,.97),rgba(21,14,5,.97));border:1px solid #9a7a36;border-radius:8px;color:#ecd9a8;font:12px/1.4 "Noto Serif TC","PMingLiU",serif;box-shadow:0 6px 24px rgba(0,0,0,.7)}',
    '#pc-pan h4{margin:0;padding:7px 10px;border-bottom:1px solid #5a4520;color:#ffd77a;font-size:14px;display:flex;justify-content:space-between;align-items:center}',
    '#pc-pan h4 button{background:none;border:0;color:#cdb47a;font-size:18px;cursor:pointer;line-height:1}',
    '#pc-pan .all{display:flex;gap:4px;align-items:center;padding:6px 10px;border-bottom:1px dashed rgba(138,106,53,.45)}',
    '#pc-pan .all span{color:#cdb47a;flex:0 0 auto}',
    '#pc-pan .md{display:flex;gap:3px;flex:1}',
    '#pc-pan .md button{flex:1;padding:4px 0;border:1px solid #6d5426;border-radius:4px;background:#24180a;color:#e8d29a;font:700 11.5px/1.1 inherit;cursor:pointer;white-space:nowrap}',
    '#pc-pan .md button.on{background:#7a5414;border-color:#e7b54a;color:#fff3c8}',
    '#pc-pan .pet{padding:7px 10px;border-bottom:1px solid rgba(90,69,32,.6)}',
    '#pc-pan .top{display:flex;gap:8px;align-items:center}',
    '#pc-pan .top img{width:40px;height:40px;object-fit:contain;image-rendering:pixelated;background:rgba(0,0,0,.35);border:1px solid #3a2d16;border-radius:5px}',
    '#pc-pan .inf{flex:1;min-width:0}',
    '#pc-pan .nm{font-weight:700;color:#fff0c0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#pc-pan .nm small{color:#cdb47a;font-weight:400}',
    '#pc-pan .bar{position:relative;height:9px;margin-top:3px;background:#1a0b08;border:1px solid #000;border-radius:2px;overflow:hidden}',
    '#pc-pan .bar i{position:absolute;left:0;top:0;bottom:0}',
    '#pc-pan .bar.hp i{background:linear-gradient(#e6463a,#9c1c12)}',
    '#pc-pan .bar.mp i{background:linear-gradient(#4b8ff0,#1d4fa8)}',
    '#pc-pan .bar em{position:absolute;inset:0;font:700 8px/9px sans-serif;color:#fff;text-align:center;font-style:normal;text-shadow:0 0 2px #000}',
    '#pc-pan .down{color:#ff8a7a;font-weight:700}',
    '#pc-pan .row2{display:flex;gap:6px;align-items:center;margin-top:6px}',
    '#pc-pan .row2 select{background:#0a0806;border:1px solid #5a4520;border-radius:4px;color:#f0e2bd;font-size:12px;padding:2px}',
    '#pc-pan .row2 .bk{margin-left:auto;padding:3px 8px;border:1px solid #8a3a2a;border-radius:4px;background:#2c1408;color:#ffb8a0;font:700 11.5px/1.2 inherit;cursor:pointer}',
    '#pc-pan .empty{padding:14px 10px;color:#a8946a;line-height:1.6}'
  ].join('\n');
  function ensureStyle() { if ($('afk-pc-style')) return; var s = document.createElement('style'); s.id = 'afk-pc-style'; s.textContent = CSS; document.head.appendChild(s); }
  var openFlag = false;
  function pct(a, b) { return Math.max(0, Math.min(100, Math.round((a || 0) / Math.max(1, b || 1) * 100))); }
  function mhp(p) { try { return typeof petMhpEff === 'function' ? petMhpEff(p) : p.mhp; } catch (e) { return p.mhp; } }
  function mmp(p) { try { var d = petDerive(p); return p.mmp + ((d && d.mmpBonus) || 0); } catch (e) { return p.mmp; } }
  function name(p) { try { return petDisplayName(p); } catch (e) { return p.name || p.form; } }
  function mdButtons(cur, data) { return '<div class="md">' + MODES.map(function (m) { return '<button data-md="' + m[0] + '" ' + data + ' class="' + (cur === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>'; }
  function render() {
    var pan = $('pc-pan'); if (!pan) return;
    var list = outs();
    var allMode = list.length && list.every(function (p) { return modeOf(p) === modeOf(list[0]); }) ? modeOf(list[0]) : '';
    var html = '<h4><span>🐾 寵物控制</span><button data-close="1">×</button></h4>';
    if (!list.length) html += '<div class="empty">目前沒有出戰的寵物。<br>到村莊找「寵物保管」NPC 讓寵物出戰（最多 ' + (typeof PET_CARRY_MAX !== 'undefined' ? PET_CARRY_MAX : 4) + ' 隻）。</div>';
    else {
      html += '<div class="all"><span>全部</span>' + mdButtons(allMode, 'data-all="1"') + '</div>';
      html += list.map(function (p) {
        var hp = Math.max(0, p.hp | 0), mh = mhp(p), mp = Math.max(0, p.mp | 0), mm = mmp(p);
        var pot = p.potPct || 0, opts = [0, 20, 30, 40, 50, 60, 70, 80].map(function (v) { return '<option value="' + v + '"' + (v === pot ? ' selected' : '') + '>' + (v ? 'HP<' + v + '%' : '不喝') + '</option>'; }).join('');
        if ([0, 20, 30, 40, 50, 60, 70, 80].indexOf(pot) < 0) opts = '<option value="' + pot + '" selected>HP<' + pot + '%</option>' + opts;
        return '<div class="pet" data-uid="' + esc(p.uid) + '"><div class="top">' +
          '<img src="assets/anim/' + encodeURIComponent(p.formGfx || p.form) + '/d6/idle_0.png" alt="">' +
          '<div class="inf"><div class="nm">' + esc(name(p)) + ' <small>Lv.' + (p.lv || 1) + '</small>' + (p._downed ? ' <span class="down">倒地</span>' : '') + '</div>' +
          '<div class="bar hp"><i style="width:' + pct(hp, mh) + '%"></i><em>' + hp + ' / ' + mh + '</em></div>' +
          (mm > 0 ? '<div class="bar mp"><i style="width:' + pct(mp, mm) + '%"></i><em>' + mp + ' / ' + mm + '</em></div>' : '') +
          '</div></div>' + mdButtons(modeOf(p), 'data-uid="' + esc(p.uid) + '"').replace('<div class="md">', '<div class="md" style="margin-top:6px">') +
          '<div class="row2">喝水 <select data-pot="' + esc(p.uid) + '">' + opts + '</select><button class="bk" data-back="' + esc(p.uid) + '">收回</button></div></div>';
      }).join('');
    }
    // 只在內容變了才重畫（避免下拉選單被每秒刷新打斷）
    if (pan._html !== html && !(document.activeElement && document.activeElement.tagName === 'SELECT' && pan.contains(document.activeElement))) { pan.innerHTML = html; pan._html = html; }
  }
  function openPanel(on) {
    ensureStyle(); openFlag = on == null ? !openFlag : !!on;
    var pan = $('pc-pan');
    if (!openFlag) { if (pan) pan.remove(); return; }
    if (!pan) {
      pan = document.createElement('div'); pan.id = 'pc-pan'; document.body.appendChild(pan);
      pan.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.close) { openPanel(false); return; }
        if (b.dataset.md) {
          var targets = b.dataset.all ? outs().map(function (p) { return p.uid; }) : [b.dataset.uid];
          targets.forEach(function (u) { if (b.dataset.md === 'attack') delete stance[u]; else stance[u] = b.dataset.md; });
          save(); pan._html = ''; render();
          var lbl = (MODES.filter(function (m) { return m[0] === b.dataset.md; })[0] || [])[1] || '';
          try { logSys('<span class="text-emerald-300">🐾 ' + (b.dataset.all ? '全部寵物' : '寵物') + '：' + lbl.replace(/^\S+\s/, '') + '</span>'); } catch (e2) {}
          return;
        }
        if (b.dataset.back) { try { petDeployToggle(b.dataset.back); if (typeof renderTabs === 'function') renderTabs(true); } catch (e3) {} pan._html = ''; render(); }
      });
      pan.addEventListener('change', function (e) {
        var s = e.target.closest('select[data-pot]'); if (!s) return;
        try { petSetPotPct(s.dataset.pot, s.value); } catch (e4) {}
        pan._html = ''; render();
      });
    }
    render();
  }
  function ensureBtn() {
    ensureStyle();
    var b = $('pc-btn');
    if (!b) { b = document.createElement('div'); b.id = 'pc-btn'; b.title = '寵物控制'; b.innerHTML = '🐾<b></b>'; b.addEventListener('click', function () { openPanel(); }); document.body.appendChild(b); }
    var title = $('btn-start-menu'), onTitle = !!(title && title.offsetParent), n = 0, has = false;
    try { has = !!(player && player.cls) && rosterN() > 0; n = outs().length; } catch (e) {}
    var show = has && !onTitle;
    b.classList.toggle('on', show);
    var c = b.querySelector('b'); if (c && c.textContent !== String(n)) c.textContent = String(n);
    if (!show && openFlag) openPanel(false);
  }
  window.AFK_PETCTL = { open: function () { openPanel(true); }, stance: function (uid, m) { if (m) { if (m === 'attack') delete stance[uid]; else stance[uid] = m; save(); } return stance[uid] || 'attack'; } };
  function start() {
    var tries = 0;
    (function w() { var a = hookPick(), b = hookWander(); if (!(a && b) && ++tries < 40) setTimeout(w, 250); })();
    setInterval(function () { hookPick(); hookWander(); ensureBtn(); if (openFlag) render(); }, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
