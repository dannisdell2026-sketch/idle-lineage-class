/* ============================================================================
 * afk-walkview.js — 「大地圖走位」戰鬥畫面（純視覺，不動戰鬥規則）
 *
 * 原本：戰鬥框＝一張固定背景，怪物排成一列、玩家站在固定位置原地對打。
 * 本外掛：把戰鬥框變成「一台跟著角色走的鏡頭」——
 *   ・地圖放大成比畫面大很多的世界(背景圖等比放大)，鏡頭跟著角色捲動。
 *   ・怪物散在角色周圍的地面上(每隻依 uid 記住自己的位置)，不再排一列。
 *   ・角色會走到目前攻擊的怪身邊(近戰貼身、弓/法術停在射程外)，走路時播 8 方向行走幀。
 *   ・沒怪時在附近慢慢閒晃。
 *   ・地監式地形(子開關，預設開)：用程式產生斜向岩脊迷宮當地圖（洞穴土色／野外草地），碰撞格直接由岩脊算出。
 *     關掉時改用原本的地圖圖片，並從圖上自動分析障礙：
 *   ・地形：從背景圖自動分析出走不過去的地方（岩壁、深谷、暗處），角色與怪物用 A* 尋路繞過障礙；
 *     正在跟玩家打的怪會走過來，其他怪在出生點附近閒晃；小地圖畫出地形(wv.grid.mm)。
 *   ・怪物腳下畫血條；核心鎖定的目標(mapState.targetIdx)加紅色描邊與「▼ 目標」，角色也優先走向它。
 *   ・地圖背景壓暗＋暗角(地監氣氛)；一般狩獵同時最多 8 隻怪(子開關「大地圖多怪」，靠核心補丁 14 的 __afkBackSlots 鉤子)。
 *   ・鏡頭縮放 wv.cam(0.6～1.3，存 localStorage)；狀態掛在 window.__afkWV 給 afk-pipiskin 畫小地圖(唯讀)。
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
      desc: '戰鬥畫面改成會跟著角色捲動的大地圖：怪物散在四周、腳下有血條，目前目標紅框標示，角色自己走過去打'
    });
    AFK_TOGGLES.register({
      id: 'walkview-more', name: '大地圖多怪', group: '遊戲介面', def: true, parent: 'walkview',
      desc: '一般狩獵地圖同時最多 8 隻怪（原版 5 隻）。怪多＝經驗掉寶較快，但同時被打也比較痛；切換後下次換地圖生效'
    });
    AFK_TOGGLES.register({
      id: 'walkview-terrain', name: '地監式地形', group: '遊戲介面', def: true, parent: 'walkview',
      desc: '狩獵地圖改用程式產生的斜向岩脊迷宮地形（洞穴／地監／塔＝土色岩壁，野外＝草地，沙漠＝沙地，雪原＝雪地），角色和怪物會繞過岩壁走；關掉＝用原本的地圖圖片'
    });
    if (!AFK_TOGGLES.enabled('walkview')) return;
  }

  // ---- 大地圖多怪：核心補丁 14 的格數鉤子 ---------------------------------------
  // js/03 出怪排程與 js/09 畫怪物都問 window.__afkBackSlots()（只在「後排模式」＝一般狩獵等地圖才會問）。
  // 攻城／時空裂痕／軍王之室維持原版 5 格（那些地圖有固定站位或自己的出怪規則）。
  // 數值「一張地圖算一次」：中途關掉開關也不會讓已經生出來的第 6～8 隻突然不畫(看不到卻在打你)，下次換地圖才生效。
  var MORE_SLOTS = 8, slotMap = null, slotVal = 5;
  window.__afkBackSlots = function () {
    try {
      var c = mapState.current;
      if (c === slotMap) return slotVal;
      slotMap = c; slotVal = MORE_SLOTS;
      if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('walkview-more')) slotVal = 5;
      else if (c === 'rift_battle' || (typeof KING_ROOMS !== 'undefined' && KING_ROOMS[c]) || (typeof isSiegeArea === 'function' && isSiegeArea(c))) slotVal = 5;
      return slotVal;
    } catch (e) { return 5; }
  };

  var MOBILE_MQ = '(max-width: 768px), (max-height: 520px) and (pointer: coarse)';
  var WORLD_ZOOM = 2.2;      // 世界高＝戰鬥框高 × 這個倍數（越大地圖越廣、鏡頭捲越多）
  var SPRITE_SCALE_M = 0.85; // 手機上 sprite 縮放（讓角色在大地圖上看起來小一點、視野更廣）
  var SPRITE_SCALE_D = 1;
  var WALK_SPEED = 150;      // 世界 px / 秒
  var MELEE_STOP = 58, RANGED_STOP = 105;
  var SPAWN_MIN = 150, SPAWN_MAX = 280;
  var MOB_CHASE = 70, MOB_WANDER = 30;   // 怪物追玩家／閒晃的速度（世界 px / 秒）
  var MOB_REACH = 46, MOB_GAP = 30;
  var WORLD_ZOOM_GEN = 4;                 // 產生地形時世界更大（迷宮要有空間走）
  var GEN_W = 1024, GEN_H = 576;          // 地形貼圖解析度（16:9；產生一次約 0.2～0.6 秒，每張地圖只做一次）      // 怪物走到離玩家多近停下／怪與怪之間至少隔多遠

  var wv = { on: false, px: null, py: null, ww: 0, wh: 0, vw: 0, vh: 0, cx: 0, cy: 0, mobs: new Map(),
             walking: false, face: 5, wanderT: 0, wanderTo: null, lastT: 0, bgUrl: '', imgW: 1920, imgH: 1080,
             cam: 0.7, tgtUid: null, grid: null, pa: null };
  // 鏡頭縮放（afk-pipiskin 小地圖的 +／− 會改這個值）：0.6＝拉最遠看更大範圍，1.3＝拉近；預設 0.7＝角色小、視野廣
  try { var _c = parseFloat(localStorage.getItem('afk-wv-cam')); if (_c >= 0.6 && _c <= 1.3) wv.cam = _c; } catch (e) {}
  wv.setCam = function (c) { wv.cam = Math.max(0.6, Math.min(1.3, Math.round(c * 10) / 10)); try { localStorage.setItem('afk-wv-cam', String(wv.cam)); } catch (e) {} return wv.cam; };
  window.__afkWV = wv;   // 唯讀分享給 afk-pipiskin（小地圖、經驗飄字位置）；那支關掉不影響本檔

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
    /* 怪物腳下血條＋目前目標紅框／「▼ 目標」字樣（--pp-hp 每幀由 frame() 寫入） */
    '#battle-view.wv-on .mob-target[data-uid] .mob-hp-bar{display:none!important;}',
    '#battle-view.wv-on .mob-target[data-uid]::after{content:"";position:absolute;left:50%;top:calc(78% + 3px);width:46px;height:5px;transform:translateX(-50%);pointer-events:none;' +
      'background:linear-gradient(90deg,#e3261c var(--pp-hp,100%),#2a0b0b 0);border:1px solid #000;box-shadow:0 0 0 1px rgba(255,255,255,.12);}',
    '#battle-view.wv-on .mob-target.pp-tgt .mob-img-inner{filter:drop-shadow(0 0 1px #ff2a2a) drop-shadow(0 0 1px #ff2a2a) drop-shadow(0 0 4px rgba(255,30,30,.85));}',
    '#battle-view.wv-on .mob-target.pp-tgt .mob-name{visibility:hidden;}',
    '#battle-view.wv-on .mob-target.pp-tgt .mob-img-wrap{position:relative;}',
    '#battle-view.wv-on .mob-target.pp-tgt .mob-img-wrap::before{content:"▼ 目標";position:absolute;left:50%;top:4px;transform:translateX(-50%);white-space:nowrap;pointer-events:none;z-index:2;' +
      'font:700 13px/1 "Noto Serif TC","PMingLiU",serif;color:#ffd34d;text-shadow:0 0 2px #000,0 0 2px #000,0 1px 2px #000;}',
    /* 地監氣氛：背景整體壓暗＋四周暗角（::before 在怪物/角色底下，只暗地圖；::after 在最上層壓邊） */
    '#battle-view.wv-on.wv-gen{background-image:none!important;background-color:#2a2219!important;}',
    '#wv-ground{position:absolute;inset:0;z-index:0;pointer-events:none;display:none;background-size:var(--wv-ww) var(--wv-wh);background-position:calc(var(--wv-cx) * -1) calc(var(--wv-cy) * -1);background-repeat:no-repeat;}',
    '#battle-view.wv-on.wv-gen #wv-ground{display:block;}',
    '#battle-view.wv-on.wv-gen::before{background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 40%,rgba(0,0,0,.45) 100%)!important;}',
    '#battle-view.wv-on::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:1;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 30%,rgba(0,0,0,.55) 100%),rgba(10,7,4,.32);}',
    '#battle-view.wv-on::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 70px rgba(0,0,0,.75);z-index:60;}'
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
    var bg = bv.classList.contains('wv-gen') ? (wv.coreBg || '') : (getComputedStyle(bv).backgroundImage || '');
    var m = bg.match(/url\("?([^")]+)"?\)/);
    if (m) wv.coreBg = bg;
    var mapId = ''; try { mapId = String(mapState.current || ''); } catch (e) {}
    var useGen = !window.AFK_TOGGLES || AFK_TOGGLES.enabled('walkview-terrain');
    var key = useGen ? 'gen:' + mapId : 'img:' + (m ? m[1] : '');
    if (key !== wv.key) {   // 換地圖（或切換地形開關）：清掉怪物站位、重算地形，角色放回地圖中央
      wv.key = key; wv.mobs.clear(); wv.px = null; wv.grid = null; wv.pa = { x: 0, y: 0 }; wv.gen = false; wv.bgUrl = '';
      bv.classList.remove('wv-gen');
      if (useGen && mapId) { startGen(key, mapId); }
    }
    if (m && !useGen && m[1] !== wv.bgUrl) {   // 用原本地圖圖片：自動分析圖上的障礙
      wv.bgUrl = m[1];
      var url = m[1], im = new Image();
      im.onload = function () {
        wv.imgW = im.naturalWidth || 1920; wv.imgH = im.naturalHeight || 1080;
        if (wv.bgUrl !== url || wv.gen) return;
        try { wv.grid = buildGrid(im); } catch (e) { wv.grid = null; }
        wv.px = null; if (wv.pa) wv.pa.path = null;
        // 地形算好之前就生出來的怪，可能站在障礙裡 → 搬到附近可走的地方
        wv.mobs.forEach(function (p) {
          if (walkW(p.x, p.y)) return;
          var c = randomWalkable(p.x, p.y, 0, 120); if (c) { p.x = p.hx = c.x; p.y = p.hy = c.y; p.path = null; }
        });
      };
      im.src = url;
    }
    if (wv.gen) { bv.classList.add('wv-gen'); ensureGround(bv); }
    var oldW = wv.ww, oldH = wv.wh;
    wv.wh = Math.max(wv.vh * (wv.gen ? WORLD_ZOOM_GEN : WORLD_ZOOM) * wv.cam, wv.vh + 10);
    wv.ww = Math.max(wv.wh * (wv.imgW / wv.imgH), wv.vw + 10);
    // 世界尺寸變了（鏡頭縮放／戰鬥框高度改變）→ 角色與怪物位置等比例搬過去，不會整群跳走
    if (oldW && oldH && wv.px != null && (Math.abs(oldW - wv.ww) > 0.5 || Math.abs(oldH - wv.wh) > 0.5)) {
      var kx = wv.ww / oldW, ky = wv.wh / oldH;
      wv.px *= kx; wv.py *= ky;
      wv.mobs.forEach(function (p) { p.x *= kx; p.y *= ky; p.hx *= kx; p.hy *= ky; p.path = null; });
      if (wv.pa) wv.pa.path = null;
    }
    if (wv.px == null) {
      var c = randomWalkable(wv.ww / 2, wv.wh * 0.6, 0, 160) || { x: wv.ww / 2, y: wv.wh * 0.6 };
      wv.px = c.x; wv.py = c.y; if (wv.pa) wv.pa.path = null;
    }
  }

  // ---- 地監式地形：程式產生（不用任何外部圖檔） ----------------------------------------
  // 每張地圖以地圖代號當亂數種子 → 同一張地圖每次進來地形都一樣。
  // 版面：等角（斜 45°）迷宮，牆是不規則岩脊（岩頂＋往下的立面＋右下方陰影），拆掉部分牆做出迴圈與空地。
  // 地圖名有洞／穴／地監／塔／神殿……＝洞穴土色；其餘＝野外草地。碰撞格直接由同一份岩脊算出，不用猜。
  // 樣式：核心的地圖分類(mapCategoryOf)＝地監／塔／城 → 洞穴；名字有沙漠／金字塔 → 沙地；雪原 → 雪地；
  //       名字像洞穴（但不是「周邊」）→ 洞穴；其餘 → 野外草地
  var CAVE_RE = /洞|穴|地監|地下|塔|神殿|墓|迷宮|窟|監獄|遺跡|地牢|礦|巢|祭壇|深淵|地獄|魔族|研究室|訓練場|之室/;
  function mapTheme(mapId) {
    var name = '', cat = '';
    try { name = (typeof mapDisplayName === 'function' && mapDisplayName(mapId)) || ''; } catch (e) {}
    try { cat = (typeof mapCategoryOf === 'function' && mapCategoryOf(mapId)) || ''; } catch (e) {}
    if (!name) try { var sel = $('map-select'); if (sel) { for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === mapId) { name = sel.options[i].text; break; } } } catch (e) {}
    if (/沙漠|金字塔|底比斯/.test(name)) return 'sand';
    if (/雪/.test(name)) return 'snow';
    if (cat === 'dungeon' || cat === 'tower' || cat === 'castle' || /^pride_/.test(mapId)) return 'cave';
    if (CAVE_RE.test(name) && !/周邊|地區|港口/.test(name)) return 'cave';
    return 'field';
  }
  var genCache = new Map();   // mapId → { url, grid }（最多留 6 張，避免記憶體越積越多）
  function startGen(key, mapId) {
    var hit = genCache.get(mapId);
    if (hit) { applyGen(key, hit); return; }
    setTimeout(function () {   // 讓換地圖的畫面先畫出來再算
      if (wv.key !== key) return;
      try {
        var r = genTerrain(mapId, mapTheme(mapId), GEN_W, GEN_H, GW, Math.round(GW * 9 / 16));
        var cv = document.createElement('canvas'); cv.width = GEN_W; cv.height = GEN_H;
        cv.getContext('2d').putImageData(new ImageData(r.rgba, GEN_W, GEN_H), 0, 0);
        cv.toBlob(function (blob) {
          if (!blob) return;
          var ent = { url: URL.createObjectURL(blob), grid: gridFromBlock(r.block, GW, Math.round(GW * 9 / 16)) };
          genCache.set(mapId, ent);
          if (genCache.size > 6) { var first = genCache.keys().next().value; try { URL.revokeObjectURL(genCache.get(first).url); } catch (e) {} genCache.delete(first); }
          if (wv.key === key) applyGen(key, ent);
        }, 'image/jpeg', 0.86);
      } catch (e) { try { console.warn('[afk-walkview] 地形產生失敗，改用原本地圖', e); } catch (e2) {} }
    }, 30);
  }
  function applyGen(key, ent) {
    if (wv.key !== key) return;
    wv.gen = true; wv.genUrl = ent.url; wv.grid = ent.grid; wv.imgW = 16; wv.imgH = 9;
    wv.px = null; wv.mobs.clear(); if (wv.pa) wv.pa.path = null;
    var g = $('wv-ground'); if (g) g.style.backgroundImage = 'url("' + ent.url + '")';
  }
  function ensureGround(bv) {
    var g = $('wv-ground');
    if (!g) { g = document.createElement('div'); g.id = 'wv-ground'; }
    if (g.parentNode !== bv) bv.insertBefore(g, bv.firstChild);
    var want = 'url("' + wv.genUrl + '")';
    if (wv.genUrl && g.style.backgroundImage !== want) g.style.backgroundImage = want;
  }
  function gridFromBlock(b, gw, gh) {
    var n = gw * gh, i, best = -1, bestSize = 0, cid = 0, comp = new Int32Array(n).fill(-1), q = new Int32Array(n);
    for (i = 0; i < gw; i++) { b[i] = 1; b[(gh - 1) * gw + i] = 1; }
    for (i = 0; i < gh; i++) { b[i * gw] = 1; b[i * gw + gw - 1] = 1; }
    for (i = 0; i < n; i++) {   // 只留最大一塊相連可走區
      if (b[i] || comp[i] >= 0) continue;
      var h = 0, t = 0, size = 0; q[t++] = i; comp[i] = cid;
      while (h < t) {
        var c = q[h++]; size++; var X = c % gw, Y = (c / gw) | 0;
        var ns = [X > 0 ? c - 1 : -1, X < gw - 1 ? c + 1 : -1, Y > 0 ? c - gw : -1, Y < gh - 1 ? c + gw : -1];
        for (var z = 0; z < 4; z++) { var u = ns[z]; if (u >= 0 && !b[u] && comp[u] < 0) { comp[u] = cid; q[t++] = u; } }
      }
      if (size > bestSize) { bestSize = size; best = cid; }
      cid++;
    }
    for (i = 0; i < n; i++) if (!b[i] && comp[i] !== best) b[i] = 1;
    return { gw: gw, gh: gh, block: b, walk: bestSize, mm: miniFromBlock(b, gw, gh) };
  }
  function miniFromBlock(b, gw, gh) {
    var mm = document.createElement('canvas'); mm.width = gw; mm.height = gh;
    var mc = mm.getContext('2d'), md = mc.createImageData(gw, gh);
    for (var i = 0; i < gw * gh; i++) {
      var o = i * 4;
      if (b[i]) { md.data[o] = 22; md.data[o + 1] = 17; md.data[o + 2] = 12; md.data[o + 3] = 235; }
      else { md.data[o] = 170; md.data[o + 1] = 146; md.data[o + 2] = 100; md.data[o + 3] = 210; }
    }
    mc.putImageData(md, 0, 0);
    return mm;
  }
  function genTerrain(seedStr, theme, W, H, gw, gh) {
    var seed = 2166136261; for (var i = 0; i < seedStr.length; i++) { seed ^= seedStr.charCodeAt(i); seed = Math.imul(seed, 16777619) >>> 0; }
    var rnd = function () { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    // value noise
    var P = 256, perm = new Uint8Array(P * 2), vals = new Float32Array(P);
    for (i = 0; i < P; i++) { perm[i] = i; vals[i] = rnd(); }
    for (i = P - 1; i > 0; i--) { var j = (rnd() * (i + 1)) | 0, t0 = perm[i]; perm[i] = perm[j]; perm[j] = t0; }
    for (i = 0; i < P; i++) perm[P + i] = perm[i];
    var lat = function (x, y) { return vals[perm[(perm[x & 255] + (y & 255)) & 511]]; };
    var noise = function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = lat(xi, yi), b = lat(xi + 1, yi), c = lat(xi, yi + 1), d = lat(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    var fbm = function (x, y, o) { var s = 0, a = 0.5, f = 1, n = 0; for (var k = 0; k < o; k++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; };

    // ---- 迷宮（u,v 平面，N×N 格），隨機深度優先＋拆牆造迴圈與空地
    var N = 10, S = 9;                      // S＝每格寬（以碰撞格為單位）
    var eW = [], sW = [];                   // eW[i][j]: (i,j) 與 (i+1,j) 之間有牆；sW: 與 (i,j+1)
    for (i = 0; i < N; i++) { eW.push([]); sW.push([]); for (j = 0; j < N; j++) { eW[i].push(true); sW[i].push(true); } }
    var seen = [], st = [[(N / 2) | 0, (N / 2) | 0]]; for (i = 0; i < N; i++) { seen.push(new Array(N).fill(false)); }
    seen[st[0][0]][st[0][1]] = true;
    while (st.length) {
      var cur = st[st.length - 1], ci = cur[0], cj = cur[1], nb = [];
      if (ci > 0 && !seen[ci - 1][cj]) nb.push([-1, 0]); if (ci < N - 1 && !seen[ci + 1][cj]) nb.push([1, 0]);
      if (cj > 0 && !seen[ci][cj - 1]) nb.push([0, -1]); if (cj < N - 1 && !seen[ci][cj + 1]) nb.push([0, 1]);
      if (!nb.length) { st.pop(); continue; }
      var d = nb[(rnd() * nb.length) | 0], ni = ci + d[0], nj = cj + d[1];
      if (d[0] === 1) eW[ci][cj] = false; else if (d[0] === -1) eW[ni][nj] = false;
      else if (d[1] === 1) sW[ci][cj] = false; else sW[ni][nj] = false;
      seen[ni][nj] = true; st.push([ni, nj]);
    }
    var open = theme !== 'cave';   // 野外／沙地／雪地比較開闊
    var BRAID = open ? 0.5 : 0.4;   // 拆掉多少剩下的牆：野外比較開闊
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) { if (eW[i][j] && rnd() < BRAID) eW[i][j] = false; if (sW[i][j] && rnd() < BRAID) sW[i][j] = false; }

    var post = new Uint8Array(N * N); for (i = 0; i < N * N; i++) post[i] = rnd() < (open ? 0.3 : 0.45) ? 1 : 0;
    // 牆的有號距離（u,v 單位；<0＝在牆裡）。牆厚 WT，邊緣用雜訊扭曲成不規則岩脊
    var WT = open ? 0.9 : 1.15;
    var wallDist = function (u, v) {
      if (u < 0 || v < 0 || u >= N * S || v >= N * S) return -1;
      var i = Math.floor(u / S), j = Math.floor(v / S), fu = u - i * S, fv = v - j * S, best = 1e9;
      var west = i === 0 || eW[i - 1][j], east = i === N - 1 || eW[i][j], north = j === 0 || sW[i][j - 1], south = j === N - 1 || sW[i][j];
      if (west) best = Math.min(best, fu); if (east) best = Math.min(best, S - fu);
      if (north) best = Math.min(best, fv); if (south) best = Math.min(best, S - fv);
      // 柱頭：四角一律有一小塊岩石（讓拆牆後的交叉口還有岩柱）
      if (post[i * N + j]) { var cu = Math.min(fu, S - fu), cv = Math.min(fv, S - fv); best = Math.min(best, Math.max(cu, cv) - 0.4); }
      return best - WT;
    };
    // 螢幕（碰撞格座標 gx,gy）→ 迷宮平面（等角：x 往右下＝u、往左下＝v）
    var span = (gh + gw / 1.8) + 4, s0 = (N * S - span) / 2;
    var toUV = function (gx, gy) {
      var a = (gx - gw / 2) / 0.9, b = (gy - gh / 2) / 0.5;      // a=u-v, b=u+v-(N*S)
      var sum = b + N * S; return [(sum + a) / 2, (sum - a) / 2];
    };
    // 加一點雜訊扭曲後的牆距（rock 形狀不規則）
    var dist = function (gx, gy) {
      var jx = (fbm(gx * 0.18, gy * 0.18, 3) - 0.5) * 3.2, jy = (fbm(gx * 0.18 + 40, gy * 0.18 + 40, 3) - 0.5) * 3.2;
      var uv = toUV(gx + jx, gy + jy); return wallDist(uv[0], uv[1]) + (fbm(gx * 0.6, gy * 0.6, 2) - 0.5) * 0.9;
    };

    // ---- 像素：先算牆遮罩，再著色
    var M = new Float32Array(W * H), kx = gw / W, ky = gh / H, x, y, p;
    var D = new Float32Array(W * H);   // 岩石內部深度 0~1（越靠中央越高）
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { var dd = dist(x * kx, y * ky); M[y * W + x] = dd < 0 ? 1 : 0; D[y * W + x] = dd < 0 ? Math.min(1, -dd * 0.9) : 0; }
    var FH = Math.round(H * 0.03);   // 岩壁立面高度（像素）
    var face = new Uint8Array(W * H);  // 0＝不是立面，>0＝距離岩頂往下第幾像素
    for (x = 0; x < W; x++) { var run = 999; for (y = 0; y < H; y++) { p = y * W + x; if (M[p] > 0.5) run = 0; else { run++; if (run <= FH) face[p] = run; } } }
    var PAL = {
      field: { floor: [92, 112, 58], floor2: [120, 110, 70], top: [96, 92, 78], top2: [140, 134, 112], face: [58, 52, 42], shade: 0.55 },
      cave: { floor: [112, 92, 68], floor2: [92, 76, 58], top: [92, 78, 62], top2: [150, 128, 100], face: [52, 42, 33], shade: 0.5 },
      sand: { floor: [178, 150, 102], floor2: [158, 128, 84], top: [140, 112, 76], top2: [196, 166, 118], face: [92, 70, 46], shade: 0.6 },
      snow: { floor: [208, 214, 222], floor2: [176, 186, 198], top: [120, 124, 132], top2: [196, 200, 210], face: [70, 74, 84], shade: 0.68 }
    }[theme] || null;
    if (!PAL) PAL = { floor: [92, 112, 58], floor2: [120, 110, 70], top: [96, 92, 78], top2: [140, 134, 112], face: [58, 52, 42], shade: 0.55 };
    var out = new Uint8ClampedArray(W * H * 4), SH = Math.round(W * 0.012);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      p = y * W + x; var gx = x * kx, gy = y * ky, r, g, b, m = M[p];
      var n1 = fbm(gx * 0.9, gy * 0.9, 3), n2 = noise(gx * 4.1, gy * 4.1);
      if (m > 0.5) {   // 岩頂：中央隆起較亮、邊緣較暗，左上緣打光，裂縫
        var lit = (M[Math.max(0, p - W * 3 - 3)] < 0.5) ? 1.3 : (M[Math.min(W * H - 1, p + W * 3 + 3)] < 0.5 ? 0.75 : 1);
        var rg = 1 - Math.abs(2 * fbm(gx * 1.3 + 9, gy * 1.3 + 9, 2) - 1);
        var k = (0.5 + 0.55 * Math.pow(D[p], 0.6)) * (0.75 + 0.5 * n1) * lit * (rg > 0.95 ? 0.7 : 1), t = n1;
        r = (PAL.top[0] * (1 - t) + PAL.top2[0] * t) * k; g = (PAL.top[1] * (1 - t) + PAL.top2[1] * t) * k; b = (PAL.top[2] * (1 - t) + PAL.top2[2] * t) * k;
      } else if (face[p]) {   // 立面：深色、直條紋
        var fk = (0.55 + 0.35 * noise(gx * 7, gy * 0.8)) * (0.75 + 0.25 * (face[p] / FH));
        r = PAL.face[0] * fk * 1.4; g = PAL.face[1] * fk * 1.4; b = PAL.face[2] * fk * 1.4;
      } else {         // 地面：兩種土色混合＋碎石點
        var t2 = fbm(gx * 0.35 + 7, gy * 0.35 + 7, 3);
        var k2 = 0.85 + 0.3 * n1 + 0.06 * (n2 - 0.5);
        r = (PAL.floor[0] * (1 - t2) + PAL.floor2[0] * t2) * k2; g = (PAL.floor[1] * (1 - t2) + PAL.floor2[1] * t2) * k2; b = (PAL.floor[2] * (1 - t2) + PAL.floor2[2] * t2) * k2;
        var pb = noise(gx * 2.3 + 3, gy * 2.3 + 3);
        if (pb > 0.9) { r *= 1.2; g *= 1.17; b *= 1.12; } else if (pb < 0.07) { r *= 0.72; g *= 0.72; b *= 0.72; }
        var crk = 1 - Math.abs(2 * fbm(gx * 0.5 + 77, gy * 0.5 + 77, 2) - 1); if (crk > 0.988 && n1 > 0.5) { r *= 0.82; g *= 0.82; b *= 0.82; }
        // 陰影：光從左上來，岩脊右下方的地面變暗
        var sx = x - SH, sy = y - SH; if (sx >= 0 && sy >= 0 && M[sy * W + sx] > 0.5) { r *= PAL.shade + 0.2; g *= PAL.shade + 0.2; b *= PAL.shade + 0.2; }
        else if (sx >= 0 && sy >= 0 && face[sy * W + sx]) { r *= 0.8; g *= 0.8; b *= 0.8; }
      }
      var o = p * 4; out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
    // ---- 碰撞格：岩頂＋立面都算牆（格內超過三成是牆就擋）
    var block = new Uint8Array(gw * gh), cw = W / gw, ch = H / gh;
    for (var cy = 0; cy < gh; cy++) for (var cx2 = 0; cx2 < gw; cx2++) {
      var cnt = 0, tot = 0;
      for (y = Math.floor(cy * ch); y < Math.floor((cy + 1) * ch); y += 2) for (x = Math.floor(cx2 * cw); x < Math.floor((cx2 + 1) * cw); x += 2) { p = y * W + x; tot++; if (M[p] > 0.5 || (face[p] && face[p] <= FH * 0.5)) cnt++; }
      block[cy * gw + cx2] = (cnt / tot > 0.3) ? 1 : 0;
    }
    return { rgba: out, block: block };
  }

  // ---- 地形：從背景圖自動判斷「走不過去」的地方 ------------------------------------
  // 背景縮成 GW 欄的格子，每格量四件事：紋理多粗糙（亮度起伏＝岩石、石筍、樹叢、雜物）、多暗（岩壁、深谷）、
  // 偏藍（水）。地面通常是平滑的土／草 → 分數低；分數最高的約 32% 格子當障礙，特別暗的格子一律當障礙。
  // 再清掉零星雜點、把被包住的小空地填起來，最後只留「最大的一塊相連可走區」→ 不會生在走不出去的角落。
  // 純視覺：只影響角色／怪物在畫面上怎麼走，不影響任何戰鬥計算。
  var GW = 72, SUB = 8, BLOCK_RATIO = 0.32;
  function buildGrid(img) {
    var gw = GW, gh = Math.max(16, Math.round(GW * img.naturalHeight / img.naturalWidth));
    var W = gw * SUB, H = gh * SUB;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, W, H);
    var d = cx.getImageData(0, 0, W, H).data, n = gw * gh, i, x, y;
    var Lp = new Float32Array(W * H);
    for (i = 0; i < W * H; i++) Lp[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    var Lm = new Float32Array(n), L2 = new Float32Array(n), Gm = new Float32Array(n), Bl = new Float32Array(n), k2 = SUB * SUB;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var p = y * W + x, c = ((y / SUB) | 0) * gw + ((x / SUB) | 0), l = Lp[p];
      Lm[c] += l; L2[c] += l * l;
      Gm[c] += Math.abs((x < W - 1 ? Lp[p + 1] : l) - l) + Math.abs((y < H - 1 ? Lp[p + W] : l) - l);
      Bl[c] += d[p * 4 + 2] - d[p * 4];
    }
    var Sd = new Float32Array(n);
    for (i = 0; i < n; i++) { Lm[i] /= k2; Gm[i] /= k2; Bl[i] /= k2; Sd[i] = Math.sqrt(Math.max(0, L2[i] / k2 - Lm[i] * Lm[i])); }
    var stats = function (arr) { var s = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; }); var q = function (p) { return s[Math.min(n - 1, Math.floor(n * p))]; }; return { med: q(0.5), iqr: (q(0.75) - q(0.25)) || 1 }; };
    var sG = stats(Gm), sS = stats(Sd), sL = stats(Lm), sB = stats(Bl);
    var score = new Float32Array(n);
    for (i = 0; i < n; i++) {
      score[i] = (Gm[i] - sG.med) / sG.iqr + 0.6 * (Sd[i] - sS.med) / sS.iqr - 0.7 * (Lm[i] - sL.med) / sL.iqr + 0.8 * Math.max(0, (Bl[i] - sB.med) / sB.iqr);
      if (Lm[i] < sL.med * 0.6) score[i] = 1e6;   // 特別暗：岩壁／深谷
    }
    var srt = Array.prototype.slice.call(score).sort(function (a, b) { return a - b; });
    var thr = srt[Math.min(n - 1, Math.floor(n * (1 - BLOCK_RATIO)))];
    var b = new Uint8Array(n);
    for (i = 0; i < n; i++) b[i] = score[i] > thr ? 1 : 0;
    for (x = 0; x < gw; x++) { b[x] = 1; b[(gh - 1) * gw + x] = 1; }   // 上下左右各留一格邊界
    for (y = 0; y < gh; y++) { b[y * gw] = 1; b[y * gw + gw - 1] = 1; }
    for (y = 0; y < 3; y++) for (x = 0; x < gw; x++) b[y * gw + x] = 1;   // 最上面幾格是天空/牆頂，角色站上去會被頂端介面擋住
    var nb = function (arr, x, y) { var c = 0; for (var j = -1; j <= 1; j++) for (var k = -1; k <= 1; k++) { if (!j && !k) continue; var X = x + k, Y = y + j; if (X < 0 || Y < 0 || X >= gw || Y >= gh || arr[Y * gw + X]) c++; } return c; };
    for (var pass = 0; pass < 2; pass++) {
      var b2 = new Uint8Array(b);
      for (y = 1; y < gh - 1; y++) for (x = 1; x < gw - 1; x++) {
        var k = nb(b, x, y), idx = y * gw + x;
        if (b[idx] && k <= 2) b2[idx] = 0;        // 零星暗點：不算障礙
        else if (!b[idx] && k >= 6) b2[idx] = 1;  // 被障礙包住的小空地：填掉
      }
      b = b2;
    }
    // 只留最大一塊相連的可走區
    var comp = new Int32Array(n).fill(-1), best = -1, bestSize = 0, cid = 0, q = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (b[i] || comp[i] >= 0) continue;
      var h = 0, t = 0, size = 0; q[t++] = i; comp[i] = cid;
      while (h < t) {
        var c = q[h++]; size++; var X = c % gw, Y = (c / gw) | 0;
        var ns = [X > 0 ? c - 1 : -1, X < gw - 1 ? c + 1 : -1, Y > 0 ? c - gw : -1, Y < gh - 1 ? c + gw : -1];
        for (var z = 0; z < 4; z++) { var u = ns[z]; if (u >= 0 && !b[u] && comp[u] < 0) { comp[u] = cid; q[t++] = u; } }
      }
      if (size > bestSize) { bestSize = size; best = cid; }
      cid++;
    }
    for (i = 0; i < n; i++) if (!b[i] && comp[i] !== best) b[i] = 1;
    // 小地圖用的地形圖（可走＝淡土色、障礙＝深色），由 afk-pipiskin 畫在右上角
    return { gw: gw, gh: gh, block: b, walk: bestSize, mm: miniFromBlock(b, gw, gh) };
  }
  function cellW() { return wv.grid ? wv.ww / wv.grid.gw : 20; }
  function cellH() { return wv.grid ? wv.wh / wv.grid.gh : 20; }
  function walkW(x, y) {   // 世界座標能不能站
    if (x < 20 || y < 40 || x > wv.ww - 20 || y > wv.wh - 14) return false;
    var g = wv.grid; if (!g) return true;
    var cx = Math.floor(x / wv.ww * g.gw), cy = Math.floor(y / wv.wh * g.gh);
    if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) return false;
    return !g.block[cy * g.gw + cx];
  }
  function los(x0, y0, x1, y1) {   // 兩點之間直線有沒有被擋
    var dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy), step = Math.max(4, Math.min(cellW(), cellH()) * 0.45);
    var n = Math.ceil(dist / step);
    for (var i = 1; i <= n; i++) { var k = i / n; if (!walkW(x0 + dx * k, y0 + dy * k)) return false; }
    return true;
  }
  function randomWalkable(x, y, rMin, rMax) {
    for (var i = 0; i < 40; i++) {
      var a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      var px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.7;
      if (walkW(px, py)) return { x: px, y: py };
    }
    var g = wv.grid; if (!g) return null;
    for (i = 0; i < 300; i++) {   // 附近找不到 → 整張圖隨便找一格可走的
      var cx = (Math.random() * g.gw) | 0, cy = (Math.random() * g.gh) | 0;
      if (!g.block[cy * g.gw + cx]) return { x: (cx + 0.5) * cellW(), y: (cy + 0.5) * cellH() };
    }
    return null;
  }
  // A* 尋路（8 方向、不切牆角），回傳世界座標的路徑點；找不到回 null
  function findPath(sx, sy, tx, ty) {
    var g = wv.grid; if (!g) return null;
    var gw = g.gw, gh = g.gh, B = g.block, cw = cellW(), ch = cellH();
    var s = Math.min(gh - 1, Math.max(0, Math.floor(sy / ch))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(sx / cw)));
    var e = Math.min(gh - 1, Math.max(0, Math.floor(ty / ch))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(tx / cw)));
    if (B[e]) {   // 目標站在障礙上 → 改去它旁邊最近的可走格
      var ex = e % gw, ey = (e / gw) | 0, found = -1;
      for (var r = 1; r < 6 && found < 0; r++) for (var j = -r; j <= r && found < 0; j++) for (var k = -r; k <= r; k++) {
        var X = ex + k, Y = ey + j; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
        if (!B[Y * gw + X]) { found = Y * gw + X; break; }
      }
      if (found < 0) return null; e = found;
    }
    var n = gw * gh, gs = new Float32Array(n).fill(1e9), from = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    var heap = [], hf = [];
    var push = function (i, f) { heap.push(i); hf.push(f); var c = heap.length - 1; while (c > 0) { var p = (c - 1) >> 1; if (hf[p] <= hf[c]) break; var t = heap[p]; heap[p] = heap[c]; heap[c] = t; t = hf[p]; hf[p] = hf[c]; hf[c] = t; c = p; } };
    var pop = function () { var top = heap[0], li = heap.pop(), lf = hf.pop(); if (heap.length) { heap[0] = li; hf[0] = lf; var c = 0; for (;;) { var l = c * 2 + 1, r2 = l + 1, m = c; if (l < heap.length && hf[l] < hf[m]) m = l; if (r2 < heap.length && hf[r2] < hf[m]) m = r2; if (m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; t = hf[m]; hf[m] = hf[c]; hf[c] = t; c = m; } } return top; };
    var exx = e % gw, eyy = (e / gw) | 0;
    var hh = function (i) { var dx = Math.abs(i % gw - exx), dy = Math.abs(((i / gw) | 0) - eyy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    gs[s] = 0; push(s, hh(s));
    var iter = 0;
    while (heap.length && iter++ < 4000) {
      var c = pop(); if (c === e) break; if (closed[c]) continue; closed[c] = 1;
      var cx = c % gw, cy = (c / gw) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        var ni = ny * gw + nx; if (B[ni] || closed[ni]) continue;
        if (dx && dy && (B[cy * gw + nx] || B[ny * gw + cx])) continue;   // 不切牆角
        var ng = gs[c] + (dx && dy ? 1.414 : 1);
        if (ng < gs[ni]) { gs[ni] = ng; from[ni] = c; push(ni, ng + hh(ni)); }
      }
    }
    if (from[e] < 0 && e !== s) return null;
    var path = [], cur = e;
    while (cur !== s && cur >= 0) { path.push({ x: (cur % gw + 0.5) * cw, y: (((cur / gw) | 0) + 0.5) * ch }); cur = from[cur]; }
    path.reverse();
    return path;
  }
  // 讓 a（有 x,y 的物件）往 (gx,gy) 走，停在 stop 距離內；有障礙就照 A* 繞。回傳這一幀有沒有在走
  function steer(a, gx, gy, speed, stop, dt) {
    var dx = gx - a.x, dy = gy - a.y, dist = Math.hypot(dx, dy);
    if (dist <= stop) { a.path = null; return false; }
    var tx = gx, ty = gy, direct = los(a.x, a.y, gx, gy);
    if (!direct) {
      a.rt = (a.rt || 0) - dt;
      if (!a.path || a.rt <= 0 || Math.hypot((a.pgx || 0) - gx, (a.pgy || 0) - gy) > cellW() * 2) {
        a.path = findPath(a.x, a.y, gx, gy); a.rt = 0.7; a.pgx = gx; a.pgy = gy;
      }
      while (a.path && a.path.length > 1 && los(a.x, a.y, a.path[1].x, a.path[1].y)) a.path.shift();
      if (!a.path || !a.path.length) return false;
      tx = a.path[0].x; ty = a.path[0].y;
      if (Math.hypot(tx - a.x, ty - a.y) < 3) { a.path.shift(); if (!a.path.length) return false; tx = a.path[0].x; ty = a.path[0].y; }
    } else a.path = null;
    var ddx = tx - a.x, ddy = ty - a.y, dd = Math.hypot(ddx, ddy) || 1;
    var step = Math.min(direct ? dist - stop : dd, speed * dt);
    var nx = a.x + ddx / dd * step, ny = a.y + ddy / dd * step;
    if (walkW(nx, ny)) { a.x = nx; a.y = ny; }
    else if (walkW(nx, a.y)) a.x = nx;
    else if (walkW(a.x, ny)) a.y = ny;
    else { a.path = null; a.rt = 0; return false; }
    a.mdx = ddx; a.mdy = ddy;
    return true;
  }

  // ---- 怪物站位與行為 ------------------------------------------------------------
  function mobPos(uid) {
    var p = wv.mobs.get(uid);
    if (!p) {
      var c = randomWalkable(wv.px, wv.py, SPAWN_MIN, SPAWN_MAX) || { x: clamp(wv.px + 160, 50, wv.ww - 50), y: wv.py };
      p = { x: c.x, y: c.y, hx: c.x, hy: c.y, path: null, rt: 0, wt: Math.random() * 2, wx: null, wy: null };
      wv.mobs.set(uid, p);
    }
    return p;
  }
  // 正在跟玩家打的怪：核心鎖定的目標，以及最近 2.5 秒內出過攻擊／技能動作的怪 → 走到玩家身邊；其餘在出生點附近閒晃
  function engaged(m, lockUid, now) {
    if (String(m.uid) === lockUid) return true;
    var a = m._animAct; return !!(a && (a.k === 'attack' || a.k === 'skill') && now - a.t < 2500);
  }
  function moveMobs(alive, lockUid, dt, dead) {
    var now = Date.now(), list = [];
    alive.forEach(function (m) {
      var p = mobPos(String(m.uid)); list.push(p);
      p.moving = false;
      if (!dead && engaged(m, lockUid, now)) {
        p.wx = null;
        p.moving = steer(p, wv.px, wv.py, MOB_CHASE, MOB_REACH, dt);
        if (!p.moving && Math.hypot(p.x - wv.px, p.y - wv.py) <= MOB_REACH + 2) { p.hx = p.x; p.hy = p.y; }
        return;
      }
      p.wt -= dt;
      if (p.wt <= 0) {
        p.wt = 2.5 + Math.random() * 3.5;
        var c = Math.random() < 0.55 ? randomWalkable(p.hx, p.hy, 20, 110) : null;
        p.wx = c ? c.x : null; p.wy = c ? c.y : null; p.path = null;
      }
      if (p.wx != null) { p.moving = steer(p, p.wx, p.wy, MOB_WANDER, 3, dt); if (!p.moving) p.wx = null; }
    });
    // 互相推開，避免疊成一團（推過去那格必須可走）
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0.01 && d < MOB_GAP) {
        var push = (MOB_GAP - d) * 0.25, ux = dx / d * push, uy = dy / d * push;
        if (walkW(a.x - ux, a.y - uy)) { a.x -= ux; a.y -= uy; }
        if (walkW(b.x + ux, b.y + uy)) { b.x += ux; b.y += uy; }
      }
    }
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

    var dead = false; try { dead = !!player.dead || player.hp <= 0; } catch (e) {}
    var alive = aliveMobs(), tgt = null;
    if (alive.length) {
      // 先走向核心真正鎖定的目標（mapState.targetIdx＝實際在打的那隻／玩家點選的那隻），沒有才看面向目標
      try { var lk = mapState.mobs[mapState.targetIdx]; if (lk && !lk._dead && lk.curHp > 0) tgt = lk; } catch (e) {}
      if (!tgt) try { tgt = alive.find(function (m) { return m.uid === player._faceTgtUid; }) || null; } catch (e) {}
      if (!tgt) {   // 沒鎖定 → 最近的那隻
        var best = 1e9;
        alive.forEach(function (m) { var p = mobPos(String(m.uid)), d = Math.hypot(p.x - wv.px, p.y - wv.py); if (d < best) { best = d; tgt = m; } });
      }
    }
    var lockUid = tgt ? String(tgt.uid) : null;

    // 角色：走向目標（遠程站在射程外，但被擋住看不到就繼續靠近）；沒怪就在附近閒晃
    var pa = wv.pa || (wv.pa = {}); pa.x = wv.px; pa.y = wv.py;
    wv.walking = false;
    if (!dead) {
      if (tgt) {
        var tp = mobPos(lockUid), stop = isRanged() ? RANGED_STOP : MELEE_STOP;
        if (stop > MELEE_STOP && !los(wv.px, wv.py, tp.x, tp.y)) stop = MELEE_STOP;
        wv.wanderTo = null;
        wv.walking = steer(pa, tp.x, tp.y + 4, WALK_SPEED, stop, dt);
      } else {
        wv.wanderT -= dt;
        if (wv.wanderT <= 0) { wv.wanderT = 2 + Math.random() * 3; wv.wanderTo = Math.random() < 0.6 ? randomWalkable(wv.px, wv.py, 40, 160) : null; }
        if (wv.wanderTo) { wv.walking = steer(pa, wv.wanderTo.x, wv.wanderTo.y, WALK_SPEED * 0.45, 4, dt); if (!wv.walking) wv.wanderTo = null; }
      }
    }
    if (wv.walking) { wv.px = pa.x; wv.py = pa.y; try { wv.face = _vec2dir(pa.mdx, pa.mdy); } catch (e) {} }
    moveMobs(alive, lockUid, dt, dead);

    // 鏡頭：角色置中、不超出世界邊
    wv.cx = clamp(wv.px - wv.vw / 2, 0, Math.max(0, wv.ww - wv.vw));
    wv.cy = clamp(wv.py - wv.vh * 0.58, 0, Math.max(0, wv.wh - wv.vh));
    var s = bv.style;
    s.setProperty('--wv-ww', wv.ww.toFixed(1) + 'px'); s.setProperty('--wv-wh', wv.wh.toFixed(1) + 'px');
    s.setProperty('--wv-cx', wv.cx.toFixed(1) + 'px'); s.setProperty('--wv-cy', wv.cy.toFixed(1) + 'px');
    s.setProperty('--wv-sc', String(((isMobile() ? SPRITE_SCALE_M : SPRITE_SCALE_D) * wv.cam).toFixed(2)));

    // 怪物卡擺位（核心重建卡片時 inline style 會被洗掉 → 每幀重設，成本只有兩個變數）
    var ml = $('mob-list'), seen = {}, byUid = {};
    alive.forEach(function (m) { byUid[String(m.uid)] = m; });
    wv.tgtUid = lockUid;
    if (ml) {
      var cards = ml.querySelectorAll('.mob-target[data-uid]');
      for (var i = 0; i < cards.length; i++) {
        var uid = cards[i].getAttribute('data-uid'); seen[uid] = 1;
        var p = mobPos(uid);
        place(cards[i], p.x, p.y);
        var mb = byUid[uid], hp = mb ? Math.max(0, Math.min(100, Math.round(mb.curHp / (mb.hp || 1) * 100))) + '%' : '0%';
        if (cards[i].style.getPropertyValue('--pp-hp') !== hp) cards[i].style.setProperty('--pp-hp', hp);
        var isT = uid === wv.tgtUid;
        if (cards[i].classList.contains('pp-tgt') !== isT) cards[i].classList.toggle('pp-tgt', isT);
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
