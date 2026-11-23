/* ============================================================================
 * afk-walkview.js — 「大地圖走位」戰鬥畫面（純視覺，不動戰鬥規則）
 *
 * 原本：戰鬥框＝一張固定背景，怪物排成一列、玩家站在固定位置原地對打。
 * 本外掛：把戰鬥框變成「一台跟著角色走的鏡頭」——
 *   ・地圖放大成比畫面大很多的世界(背景圖等比放大)，鏡頭跟著角色捲動。
 *   ・怪物散在角色周圍的地面上(每隻依 uid 記住自己的位置)，不再排一列。
 *   ・角色會走到目前攻擊的怪身邊(近戰貼身、弓/法術停在射程外)，走路時播 8 方向行走幀。
 *   ・沒怪時在附近慢慢閒晃。
 *   所有元素仍是核心原本的 DOM(怪物卡、玩家 sprite)，只改它們的「畫在哪」→ 傷害數字/特效/點選照常。
 *
 * 只讀不寫：mapState.mobs、player、_pmState、_morphBattleCache、_playerBattleForm、_vec2dir。
 * 只包一支核心函式：_playerMorphApply(8fps 玩家動畫)——原函式照跑，跑完若「正在走路」才把三層圖換成 walk 幀。
 * 攻城/決鬥/頭目大圖等「固定站位」場景自動不套用(沿用原版)。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'walkview', name: '大地圖走位戰鬥', group: '遊戲介面', def: true,
      desc: '戰鬥畫面改成會跟著角色捲動的大地圖：怪物散在四周，角色自己走過去打'
    });
    if (!AFK_TOGGLES.enabled('walkview')) return;
  }

  var MOBILE_MQ = '(max-width: 768px), (max-height: 520px) and (pointer: coarse)';
  var WORLD_ZOOM = 2.2;      // 世界高＝戰鬥框高 × 這個倍數（越大地圖越廣、鏡頭捲越多）
  var SPRITE_SCALE_M = 0.85; // 手機上 sprite 縮放（讓角色在大地圖上看起來小一點、視野更廣）
  var SPRITE_SCALE_D = 1;
  var WALK_SPEED = 150;      // 世界 px / 秒
  var MELEE_STOP = 58, RANGED_STOP = 105;
  var SPAWN_MIN = 150, SPAWN_MAX = 280;

  var wv = { on: false, px: null, py: null, ww: 0, wh: 0, vw: 0, vh: 0, cx: 0, cy: 0, mobs: new Map(),
             walking: false, face: 5, wanderT: 0, wanderTo: null, lastT: 0, bgUrl: '', imgW: 1920, imgH: 1080 };

  function $(id) { return document.getElementById(id); }
  function isMobile() { try { return document.body.classList.contains('m-mobile') || matchMedia(MOBILE_MQ).matches; } catch (e) { return false; } }

  // ---- CSS ------------------------------------------------------------------
  var CSS = [
    '#battle-view.wv-on{overflow:hidden!important;background-size:var(--wv-ww) var(--wv-wh)!important;background-position:calc(var(--wv-cx) * -1) calc(var(--wv-cy) * -1)!important;background-repeat:no-repeat!important;}',
    'body.m-mobile #battle-view.wv-on{height:var(--wv-mh,300px)!important;aspect-ratio:auto!important;}',
    '#battle-view.wv-on #mob-list{position:absolute!important;inset:0!important;display:block!important;gap:0!important;}',
    '#battle-view.wv-on #mob-list>.mob-target:not([data-uid]){display:none!important;}',
    '#battle-view.wv-on #mob-list>.mob-target[data-uid]{position:absolute!important;left:var(--sx,-999px)!important;top:var(--sy,-999px)!important;right:auto!important;bottom:auto!important;margin:0!important;' +
      'transform:translate(-50%,-78%) scale(var(--wv-sc))!important;transform-origin:50% 78%!important;z-index:var(--sz,5)!important;transition:none!important;}',
    '#battle-view.wv-on #player-morph-sprite{left:var(--sx,50%)!important;top:var(--sy,50%)!important;bottom:auto!important;transition:none!important;' +
      'transform:translate(-50%,-86%) scale(var(--wv-sc))!important;transform-origin:50% 86%!important;z-index:var(--sz,20)!important;}',
    /* 地面陰影圈讓角色腳下有「站在地上」的感覺 */
    '#battle-view.wv-on::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 40px rgba(0,0,0,.55);z-index:60;}'
  ].join('\n');
  function ensureStyle() {
    if ($('afk-walkview-style')) return;
    var st = document.createElement('style'); st.id = 'afk-walkview-style'; st.textContent = CSS; document.head.appendChild(st);
  }

  // ---- 場景判斷 --------------------------------------------------------------
  function sceneOK(bv) {
    if (!bv || bv.classList.contains('hidden') || !bv.classList.contains('area-fit')) return false;
    var ml = $('mob-list'); if (!ml) return false;
    if (ml.querySelector('.siege-fixed,.duel-fixed,.boss-slot')) return false;   // 固定站位場景沿用原版
    return true;
  }

  // ---- 世界尺寸 ---------------------------------------------------------------
  function measure(bv) {
    var r = bv.getBoundingClientRect();
    wv.vw = r.width; wv.vh = r.height;
    var bg = getComputedStyle(bv).backgroundImage || '';
    var m = bg.match(/url\("?([^")]+)"?\)/);
    if (m && m[1] !== wv.bgUrl) {   // 換地圖：重新量背景原圖比例、清掉怪物站位、角色放回地圖中央
      wv.bgUrl = m[1]; wv.mobs.clear(); wv.px = null;
      var im = new Image(); im.onload = function () { wv.imgW = im.naturalWidth || 1920; wv.imgH = im.naturalHeight || 1080; }; im.src = m[1];
    }
    wv.wh = Math.max(wv.vh * WORLD_ZOOM, wv.vh + 10);
    wv.ww = Math.max(wv.wh * (wv.imgW / wv.imgH), wv.vw + 10);
    if (wv.px == null) { wv.px = wv.ww / 2; wv.py = wv.wh * 0.62; }
  }

  // ---- 怪物站位 ---------------------------------------------------------------
  function mobPos(uid) {
    var p = wv.mobs.get(uid);
    if (!p) {
      var a = Math.random() * Math.PI * 2, d = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      p = { x: clamp(wv.px + Math.cos(a) * d, 50, wv.ww - 50), y: clamp(wv.py + Math.sin(a) * d * 0.6, 90, wv.wh - 30) };
      wv.mobs.set(uid, p);
    }
    return p;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function aliveMobs() {
    try { return (mapState && mapState.mobs) ? mapState.mobs.filter(function (m) { return m && m.curHp > 0 && !m._dead; }) : []; } catch (e) { return []; }
  }
  function isRanged() {
    try {
      var f = (typeof _playerBattleForm === 'function') ? _playerBattleForm() : null;
      if (f && /bow|staff|wand/i.test(f.wpn || '')) return true;
      return player && (player.cls === 'mage' || player.cls === 'illusionist');
    } catch (e) { return false; }
  }

  // ---- 每幀：移動＋鏡頭＋擺位 --------------------------------------------------
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = wv.lastT ? Math.min(0.1, (t - wv.lastT) / 1000) : 0; wv.lastT = t;
    var bv = $('battle-view');
    var ok = sceneOK(bv);
    if (bv) bv.classList.toggle('wv-on', ok);
    wv.on = ok;
    if (!ok) { wv.walking = false; return; }
    measure(bv);

    // 角色移動
    var dead = false; try { dead = !!player.dead || player.hp <= 0; } catch (e) {}
    var alive = aliveMobs(), tgt = null;
    if (alive.length) {
      try { tgt = alive.find(function (m) { return m.uid === player._faceTgtUid; }) || null; } catch (e) {}
      if (!tgt) {   // 沒鎖定 → 最近的那隻
        var best = 1e9;
        alive.forEach(function (m) { var p = mobPos(String(m.uid)), d = Math.hypot(p.x - wv.px, p.y - wv.py); if (d < best) { best = d; tgt = m; } });
      }
    }
    var goal = null, stop = 0;
    if (tgt) { var tp = mobPos(String(tgt.uid)); goal = { x: tp.x, y: tp.y + 4 }; stop = isRanged() ? RANGED_STOP : MELEE_STOP; wv.wanderTo = null; }
    else {
      wv.wanderT -= dt;
      if (wv.wanderT <= 0) {
        wv.wanderT = 2 + Math.random() * 3;
        wv.wanderTo = Math.random() < 0.6 ? { x: clamp(wv.px + (Math.random() - 0.5) * 220, 60, wv.ww - 60), y: clamp(wv.py + (Math.random() - 0.5) * 120, 100, wv.wh - 30) } : null;
      }
      goal = wv.wanderTo; stop = 4;
    }
    wv.walking = false;
    if (goal && !dead) {
      var dx = goal.x - wv.px, dy = goal.y - wv.py, dist = Math.hypot(dx, dy);
      if (dist > stop + 2) {
        var step = Math.min(dist - stop, WALK_SPEED * (tgt ? 1 : 0.45) * dt);
        wv.px += dx / dist * step; wv.py += dy / dist * step;
        wv.walking = true;
        try { wv.face = _vec2dir(dx, dy); } catch (e) {}
      } else if (!tgt) wv.wanderTo = null;
    }

    // 鏡頭：角色置中、不超出世界邊
    wv.cx = clamp(wv.px - wv.vw / 2, 0, Math.max(0, wv.ww - wv.vw));
    wv.cy = clamp(wv.py - wv.vh * 0.58, 0, Math.max(0, wv.wh - wv.vh));
    var s = bv.style;
    s.setProperty('--wv-ww', wv.ww.toFixed(1) + 'px'); s.setProperty('--wv-wh', wv.wh.toFixed(1) + 'px');
    s.setProperty('--wv-cx', wv.cx.toFixed(1) + 'px'); s.setProperty('--wv-cy', wv.cy.toFixed(1) + 'px');
    s.setProperty('--wv-sc', String(isMobile() ? SPRITE_SCALE_M : SPRITE_SCALE_D));

    // 怪物卡擺位（核心重建卡片時 inline style 會被洗掉 → 每幀重設，成本只有兩個變數）
    var ml = $('mob-list'), seen = {};
    if (ml) {
      var cards = ml.querySelectorAll('.mob-target[data-uid]');
      for (var i = 0; i < cards.length; i++) {
        var uid = cards[i].getAttribute('data-uid'); seen[uid] = 1;
        var p = mobPos(uid);
        place(cards[i], p.x, p.y);
      }
    }
    wv.mobs.forEach(function (_, k) { if (!seen[k]) wv.mobs.delete(k); });

    var pm = $('player-morph-sprite');
    if (pm) place(pm, wv.px, wv.py);
  }
  function place(el, x, y) {
    var sx = (x - wv.cx).toFixed(1) + 'px', sy = (y - wv.cy).toFixed(1) + 'px', sz = String(10 + Math.round(y / 4));
    var st = el.style;
    if (st.getPropertyValue('--sx') !== sx) st.setProperty('--sx', sx);
    if (st.getPropertyValue('--sy') !== sy) st.setProperty('--sy', sy);
    if (st.getPropertyValue('--sz') !== sz) st.setProperty('--sz', sz);
  }

  // ---- 包核心玩家動畫：走路時換成 walk 幀＋朝向 ---------------------------------
  function hook() {
    if (typeof window._playerMorphApply !== 'function' || window._playerMorphApply._wvWrapped) return !!(window._playerMorphApply && window._playerMorphApply._wvWrapped);
    var orig = window._playerMorphApply;
    var wrapped = function () {
      var walking = wv.on && wv.walking;
      try { if (walking && player) player._faceD = wv.face; } catch (e) {}
      var r = orig.apply(this, arguments);
      if (!walking) return r;
      try {
        if (_pmState.act) return r;   // 攻擊/施法/受擊/死亡動作優先，不蓋
        player._faceD = wv.face;      // 核心停下時會轉向目標；走路中維持前進方向
        var form = _playerBattleForm(); if (!form) return r;
        var a = _morphBattleCache[form.key]; if (!a || a === 'probing' || !a.walk || !a.walk.length) return r;
        var f = Math.floor(Date.now() / (1000 / MOB_ANIM_FPS)) % a.walk.length, I = _pmState.imgs; if (!I) return r;
        if (I.bd.src !== a.walk[f].src) I.bd.src = a.walk[f].src;
        var ss = a.shadow && a.shadow.walk;
        if (ss && ss.length) { var sf = f % ss.length; I.sh.style.visibility = ''; if (I.sh.src !== ss[sf].src) I.sh.src = ss[sf].src; }
        var ws = a.weapon && a.weapon.walk;
        if (ws && ws[f]) { I.wp.style.visibility = ''; if (I.wp.src !== ws[f].src) I.wp.src = ws[f].src; }
        else I.wp.style.visibility = 'hidden';
      } catch (e) {}
      return r;
    };
    wrapped._wvWrapped = true;
    window._playerMorphApply = wrapped;
    return true;
  }

  function start() {
    ensureStyle();
    var tries = 0;
    (function waitHook() { if (!hook() && ++tries < 40) setTimeout(waitHook, 250); })();
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
