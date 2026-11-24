/* ============================================================================
 * afk-walkview.js — 「大地圖走位」戰鬥畫面
 *
 * 原本：戰鬥框＝一張固定背景，怪物排成一列、玩家站在固定位置原地對打。
 * 本外掛：把戰鬥框變成「一台跟著角色走的鏡頭」——
 *   ・地監式地形(子開關，預設開)：程式產生的地形（每張地圖固定種子）。碰撞格 228×128（舊版 72×41 的 10 倍細），
 *     貼圖 2048×1152：等角岩脊迷宮＋散布的樹叢／灌木／石頭／水晶／雪松＋地面細節（草叢、小花、碎石、水窪、沙紋）。
 *     地形在 Web Worker 背景產生，不卡畫面。關掉時改用原本的地圖圖片並自動分析障礙（72 欄格子）。
 *   ・大地圖多怪(子開關，預設開)：一般狩獵地圖 30 隻怪 × GM 怪物倍數（afk-gm.js），新怪出生在整張地圖、
 *     離玩家半個畫面以外、而且挑離其他怪最遠的地方 → 散在各處。
 *   ・碰撞：角色與怪物都只能走在「加厚一格」的移動碰撞格上（身體有寬度，腳不會踩進岩壁／樹裡），A* 繞路，撞牆沿牆滑。
 *   ・擬真：起步加速、到點減速、面向慢慢轉；走路有腳步起伏；出手時往目標撲一下；八方向怪走路時面向前進方向。
 *   ・打怪規則（核心補丁 15／16）：玩家要走到射程內（近戰貼身、遠程在射程內且看得到）才會出手；
 *     怪物要走到玩家身邊才會出手。主動怪看到玩家（200px 內、沒被擋）會追過來，被動怪被打才反擊，追太遠會放棄回家。
 *     離線掛機結算沒有畫面 → 用同一個 GM 倍數的簡化模型（走到下一隻的時間、同時圍攻的隻數）。
 *   ・自動選怪：選「最近、看得到」的那隻；玩家手動點的怪優先、不會被換掉。
 *   ・怪物腳下血條；目標紅框＋「▼ 目標」；地圖壓暗＋暗角；鏡頭縮放 wv.cam；狀態掛在 window.__afkWV 給 afk-pipiskin 畫小地圖。
 *   所有元素仍是核心原本的 DOM(怪物卡、玩家 sprite)，只改它們的「畫在哪」→ 傷害數字/特效/點選照常。
 *
 * 讀：mapState.mobs、player、_pmState、_morphBattleCache、_playerBattleForm、_vec2dir、playerMoveDelayMultiplier。
 * 寫：mapState.targetIdx（自動選最近的怪，經核心 setTarget）；GM 調低倍數時移除多出來的怪格。
 * 包兩支核心函式：_playerMorphApply（走路時換 walk 幀）、_mob8FaceDir（八方向怪走路時面向前進方向）。
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
      desc: '一般狩獵地圖有 30 隻怪（× GM 面板的怪物倍數）散在整張地圖；只有走到身邊的怪才會打你，角色要走到射程內才會出手。關掉＝原版 5 隻站成一排'
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
  //   數量＝30 × GM 怪物倍數（afk-gm.js 的 AFK_GM.mobCount()）。GM 改倍數時立刻套用：多出來的格子直接移除、少的由核心照常補。
  //   ⚠ 30 隻怪不能同時打人：核心補丁 15／16 另外問兩個鉤子——
  //     __afkMobIdle(m,i)  ：這隻怪這一拍「不出手」（線上＝不在玩家身邊；離線結算＝不在「同時圍攻名額」內）
  //     __afkPlayerHold()  ：玩家這一拍「不出手」（線上＝還沒走到射程內；離線結算＝殺完一隻後走向下一隻的路程）
  //   兩個鉤子只在「大地圖多怪」的地圖生效（格數 > 8），其他地圖一律回 false＝完全照原版。
  var slotMap = null, slotVal = 5;
  function wantSlots(c) {
    if (window.AFK_TOGGLES && !AFK_TOGGLES.enabled('walkview-more')) return 5;
    if (c === 'rift_battle' || (typeof KING_ROOMS !== 'undefined' && KING_ROOMS[c]) || (typeof isSiegeArea === 'function' && isSiegeArea(c))) return 5;
    if (typeof PURE_BOSS_MAPS !== 'undefined' && PURE_BOSS_MAPS.indexOf(c) >= 0) return 5;
    if (/^town_/.test(String(c || ''))) return 5;
    return (window.AFK_GM && typeof AFK_GM.mobCount === 'function') ? AFK_GM.mobCount() : 30;
  }
  window.__afkBackSlots = function () {
    try {
      var c = mapState.current;
      if (c === slotMap) return slotVal;
      slotMap = c; slotVal = wantSlots(c);
      return slotVal;
    } catch (e) { return 5; }
  };
  function bigMap() { try { return slotVal > 8 && slotMap === mapState.current; } catch (e) { return false; } }
  function gmMult() { try { return (window.AFK_GM && AFK_GM.get('mobMult')) || 1; } catch (e) { return 1; } }
  window.addEventListener('afk-gm-change', function () {
    try {
      var c = mapState.current, n = wantSlots(c), old = slotVal;
      slotMap = c; slotVal = n;
      if (n < old && mapState.mobs && mapState.mobs.length > n) {
        mapState.mobs.splice(n);
        if (mapState.spawnAt && mapState.spawnAt.length > n) mapState.spawnAt.splice(n);
        if (mapState.targetIdx >= n) mapState.targetIdx = -1;
        if (typeof renderMobs === 'function') renderMobs();
      }
    } catch (e) {}
  });

  var MOBILE_MQ = '(max-width: 768px), (max-height: 520px) and (pointer: coarse)';
  var WORLD_ZOOM = 2.2;      // 世界高＝戰鬥框高 × 這個倍數（越大地圖越廣、鏡頭捲越多）
  var SPRITE_SCALE_M = 0.85; // 手機上 sprite 縮放（讓角色在大地圖上看起來小一點、視野更廣）
  var SPRITE_SCALE_D = 1;
  var WALK_SPEED = 150;      // 世界 px / 秒（再乘核心移動速度倍率：加速藥水／勇敢會走比較快）
  var ACCEL_T = 0.22;        // 從停下到全速要幾秒（起步加速、到點前減速 → 不會瞬間滑動）
  var MELEE_STOP = 54, RANGED_STOP = 150;
  var SPAWN_MIN = 150, SPAWN_MAX = 280;
  var MOB_CHASE = 72, MOB_WANDER = 28;   // 怪物追玩家／閒晃的速度（世界 px / 秒）
  var MOB_REACH = 46, MOB_GAP = 30;      // 怪物走到離玩家多近停下／怪與怪之間至少隔多遠
  var AGGRO_R = 200, LEASH_R = 520;      // 主動怪看到玩家的距離／追離出生點太遠就放棄
  var GEN_WORLD_H = 2100;                 // 產生地形時的世界高度（px，再乘鏡頭縮放）：跟螢幕大小無關，手機桌機一樣大，30 隻怪才散得開
  var GEN_W = 2048, GEN_H = 1152;         // 地形貼圖解析度（在背景執行緒產生，每張地圖只做一次）
  var GW_GEN = 228;                       // 產生地形的碰撞格欄數（228×128≈2.9 萬格，舊版 72×41 的 10 倍）

  var wv = { on: false, px: null, py: null, ww: 0, wh: 0, vw: 0, vh: 0, cx: 0, cy: 0, mobs: new Map(),
             walking: false, face: 5, wanderT: 0, wanderTo: null, lastT: 0, bgUrl: '', imgW: 1920, imgH: 1080,
             cam: 0.7, tgtUid: null, grid: null, pa: null, inRange: false, rangeUid: null, manualUid: null, retgtT: 0 };
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
    wv.wh = Math.max(wv.gen ? GEN_WORLD_H * wv.cam : wv.vh * WORLD_ZOOM * wv.cam, wv.vh + 10);
    wv.ww = Math.max(wv.wh * (wv.imgW / wv.imgH), wv.vw + 10);
    // 世界尺寸變了（鏡頭縮放／戰鬥框高度改變）→ 角色與怪物位置等比例搬過去，不會整群跳走
    if (oldW && oldH && wv.px != null && (Math.abs(oldW - wv.ww) > 0.5 || Math.abs(oldH - wv.wh) > 0.5)) {
      var kx = wv.ww / oldW, ky = wv.wh / oldH;
      wv.px *= kx; wv.py *= ky;
      wv.mobs.forEach(function (p) { p.x *= kx; p.y *= ky; p.hx *= kx; p.hy *= ky; p.path = null; p.wx = null; unstick(p); });
      if (wv.pa) wv.pa.path = null;
      var pp = { x: wv.px, y: wv.py }; unstick(pp); wv.px = pp.x; wv.py = pp.y;
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
  // 地形在背景執行緒(Web Worker)產生：2048×1152 貼圖＋228×128 碰撞格算一次約 0.5～2 秒，放主執行緒會卡畫面。
  // Worker 開不起來（舊瀏覽器）才退回主執行緒同步算。
  var genWorker = null, genJobs = {}, genSeq = 0;
  function getWorker() {
    if (genWorker === false) return null;
    if (genWorker) return genWorker;
    try {
      var src = 'var genTerrain=' + genTerrain.toString() + ';\n' +
        'self.onmessage=function(e){var d=e.data;try{var r=genTerrain(d.mapId,d.theme,d.W,d.H,d.gw,d.gh);' +
        'self.postMessage({id:d.id,rgba:r.rgba,block:r.block},[r.rgba.buffer,r.block.buffer]);}catch(err){self.postMessage({id:d.id,err:String(err)});}};';
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      genWorker = new Worker(url);
      genWorker.onmessage = function (e) { var cb = genJobs[e.data.id]; delete genJobs[e.data.id]; if (cb) cb(e.data); };
      genWorker.onerror = function () { genWorker = false; var js = genJobs; genJobs = {}; for (var k in js) js[k]({ err: 'worker' }); };
      return genWorker;
    } catch (e) { genWorker = false; return null; }
  }
  function runGen(mapId, theme, gw, gh, cb) {
    var w = getWorker();
    if (w) {
      var id = ++genSeq;
      genJobs[id] = function (d) {
        if (d.err) { try { cb(genTerrain(mapId, theme, GEN_W, GEN_H, gw, gh)); } catch (e) { cb(null); } return; }
        cb({ rgba: new Uint8ClampedArray(d.rgba.buffer || d.rgba), block: d.block });
      };
      w.postMessage({ id: id, mapId: mapId, theme: theme, W: GEN_W, H: GEN_H, gw: gw, gh: gh });
      return;
    }
    setTimeout(function () { try { cb(genTerrain(mapId, theme, GEN_W, GEN_H, gw, gh)); } catch (e) { cb(null); } }, 30);
  }
  function startGen(key, mapId) {
    var hit = genCache.get(mapId);
    if (hit) { applyGen(key, hit); return; }
    var gw = GW_GEN, gh = Math.round(GW_GEN * 9 / 16);
    runGen(mapId, mapTheme(mapId), gw, gh, function (r) {
      if (!r) { try { console.warn('[afk-walkview] 地形產生失敗，改用原本地圖'); } catch (e2) {} return; }
      try {
        var cv = document.createElement('canvas'); cv.width = GEN_W; cv.height = GEN_H;
        cv.getContext('2d').putImageData(new ImageData(r.rgba, GEN_W, GEN_H), 0, 0);
        cv.toBlob(function (blob) {
          if (!blob) return;
          var ent = { url: URL.createObjectURL(blob), grid: gridFromBlock(r.block, gw, gh, 1) };
          genCache.set(mapId, ent);
          if (genCache.size > 6) { var first = genCache.keys().next().value; try { URL.revokeObjectURL(genCache.get(first).url); } catch (e) {} genCache.delete(first); }
          if (wv.key === key) applyGen(key, ent);
        }, 'image/jpeg', 0.85);
      } catch (e) { try { console.warn('[afk-walkview] 地形貼圖失敗', e); } catch (e2) {} }
    });
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
  // 只留最大一塊相連的可走區（其餘填成障礙）；回傳可走格數
  function keepLargest(b, gw, gh) {
    var n = gw * gh, i, best = -1, bestSize = 0, cid = 0, comp = new Int32Array(n).fill(-1), q = new Int32Array(n);
    for (i = 0; i < n; i++) {
      if (b[i] || comp[i] >= 0) continue;
      var h = 0, t = 0, size = 0; q[t++] = i; comp[i] = cid;
      while (h < t) {
        var c = q[h++]; size++; var X = c % gw, Y = (c / gw) | 0;
        if (X > 0 && !b[c - 1] && comp[c - 1] < 0) { comp[c - 1] = cid; q[t++] = c - 1; }
        if (X < gw - 1 && !b[c + 1] && comp[c + 1] < 0) { comp[c + 1] = cid; q[t++] = c + 1; }
        if (Y > 0 && !b[c - gw] && comp[c - gw] < 0) { comp[c - gw] = cid; q[t++] = c - gw; }
        if (Y < gh - 1 && !b[c + gw] && comp[c + gw] < 0) { comp[c + gw] = cid; q[t++] = c + gw; }
      }
      if (size > bestSize) { bestSize = size; best = cid; }
      cid++;
    }
    for (i = 0; i < n; i++) if (!b[i] && comp[i] !== best) b[i] = 1;
    return bestSize;
  }
  // block＝畫面上的障礙；mv＝「移動用」碰撞格：障礙往外加厚 clr 格（角色／怪物有身體寬度，腳不會踩進岩壁或樹裡）
  function gridFromBlock(b, gw, gh, clr) {
    var n = gw * gh, i;
    for (i = 0; i < gw; i++) { b[i] = 1; b[(gh - 1) * gw + i] = 1; }
    for (i = 0; i < gh; i++) { b[i * gw] = 1; b[i * gw + gw - 1] = 1; }
    var walk = keepLargest(b, gw, gh), mv = b;
    if (clr > 0) {
      mv = new Uint8Array(n);
      for (var y = 0; y < gh; y++) for (var x = 0; x < gw; x++) {
        if (!b[y * gw + x]) continue;
        for (var j = -clr; j <= clr; j++) for (var k = -clr; k <= clr; k++) {
          var X = x + k, Y = y + j; if (X >= 0 && Y >= 0 && X < gw && Y < gh) mv[Y * gw + X] = 1;
        }
      }
      walk = keepLargest(mv, gw, gh);
    }
    return { gw: gw, gh: gh, block: b, mv: mv, walk: walk, mm: miniFromBlock(b, gw, gh) };
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
  // ---- 地監式地形 v2（精細版）：碰撞格 228×128、貼圖 2048×1152 ------------------------------
  // 1) 等角迷宮岩脊（18×18 格迷宮，拆牆造迴圈）＝大地形
  // 2) 散布小障礙物：野外＝樹叢／灌木／石頭，洞穴＝石筍／岩塊／水晶，沙漠＝砂岩／枯灌木，雪原＝雪松／雪石
  // 3) 地面細節：草叢、小花、碎石、裂縫、水窪、沙紋……（只是貼圖，不擋路）
  // 岩脊距離場先在半解析度格點算好再雙線性內插（最貴的雜訊只算 1/4 次）。整支函式不碰 DOM，可丟進 Worker 跑。
  function genTerrain(seedStr, theme, W, H, gw, gh) {
    var i, j, x, y, p;
    var seed = 2166136261; for (i = 0; i < seedStr.length; i++) { seed ^= seedStr.charCodeAt(i); seed = Math.imul(seed, 16777619) >>> 0; }
    var rnd = function () { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    var P = 256, perm = new Uint8Array(P * 2), vals = new Float32Array(P);
    for (i = 0; i < P; i++) { perm[i] = i; vals[i] = rnd(); }
    for (i = P - 1; i > 0; i--) { j = (rnd() * (i + 1)) | 0; var t0 = perm[i]; perm[i] = perm[j]; perm[j] = t0; }
    for (i = 0; i < P; i++) perm[P + i] = perm[i];
    var noise = function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var X0 = xi & 255, X1 = (xi + 1) & 255, Y0 = yi & 255, Y1 = (yi + 1) & 255;
      var a = vals[perm[(perm[X0] + Y0) & 511]], b = vals[perm[(perm[X1] + Y0) & 511]], c = vals[perm[(perm[X0] + Y1) & 511]], d = vals[perm[(perm[X1] + Y1) & 511]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    var fbm = function (x, y, o) { var s = 0, a = 0.5, f = 1, n = 0; for (var k = 0; k < o; k++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; };
    var open = theme !== 'cave';

    // ---- 迷宮
    var N = 18, span = (gh + gw / 1.8) + 12, S = Math.ceil(span / N) + 1;
    var eW = [], sW = [], seen = [];
    for (i = 0; i < N; i++) { eW.push([]); sW.push([]); seen.push([]); for (j = 0; j < N; j++) { eW[i].push(true); sW[i].push(true); seen[i].push(false); } }
    var st = [[(N / 2) | 0, (N / 2) | 0]]; seen[st[0][0]][st[0][1]] = true;
    while (st.length) {
      var cur = st[st.length - 1], ci = cur[0], cj = cur[1], nb = [];
      if (ci > 0 && !seen[ci - 1][cj]) nb.push([-1, 0]); if (ci < N - 1 && !seen[ci + 1][cj]) nb.push([1, 0]);
      if (cj > 0 && !seen[ci][cj - 1]) nb.push([0, -1]); if (cj < N - 1 && !seen[ci][cj + 1]) nb.push([0, 1]);
      if (!nb.length) { st.pop(); continue; }
      var dd0 = nb[(rnd() * nb.length) | 0], ni = ci + dd0[0], nj = cj + dd0[1];
      if (dd0[0] === 1) eW[ci][cj] = false; else if (dd0[0] === -1) eW[ni][nj] = false;
      else if (dd0[1] === 1) sW[ci][cj] = false; else sW[ni][nj] = false;
      seen[ni][nj] = true; st.push([ni, nj]);
    }
    var BRAID = open ? 0.62 : 0.5;
    for (i = 0; i < N; i++) for (j = 0; j < N; j++) { if (eW[i][j] && rnd() < BRAID) eW[i][j] = false; if (sW[i][j] && rnd() < BRAID) sW[i][j] = false; }
    var post = new Uint8Array(N * N); for (i = 0; i < N * N; i++) post[i] = rnd() < (open ? 0.3 : 0.45) ? 1 : 0;
    var WT = open ? 1.7 : 2.1;   // 牆半厚（碰撞格）
    var wallDist = function (u, v) {
      if (u < 0 || v < 0 || u >= N * S || v >= N * S) return -1;
      var i = Math.floor(u / S), j = Math.floor(v / S), fu = u - i * S, fv = v - j * S, best = 1e9;
      var west = i === 0 || eW[i - 1][j], east = i === N - 1 || eW[i][j], north = j === 0 || sW[i][j - 1], south = j === N - 1 || sW[i][j];
      if (west) best = Math.min(best, fu); if (east) best = Math.min(best, S - fu);
      if (north) best = Math.min(best, fv); if (south) best = Math.min(best, S - fv);
      if (post[i * N + j]) { var cu = Math.min(fu, S - fu), cv = Math.min(fv, S - fv); best = Math.min(best, Math.max(cu, cv) - 1.4); }
      return best - WT;
    };
    var toUV = function (gx, gy) {
      var a = (gx - gw / 2) / 0.9, b = (gy - gh / 2) / 0.5;
      var sum = b + N * S; return [(sum + a) / 2, (sum - a) / 2];
    };
    var distAt = function (gx, gy) {   // 碰撞格座標 → 有號牆距（<0＝在岩壁裡）
      var jx = (fbm(gx * 0.055, gy * 0.055, 3) - 0.5) * 9 + (noise(gx * 0.33 + 50, gy * 0.33) - 0.5) * 1.8;
      var jy = (fbm(gx * 0.055 + 40, gy * 0.055 + 40, 3) - 0.5) * 9 + (noise(gx * 0.33, gy * 0.33 + 50) - 0.5) * 1.8;
      var uv = toUV(gx + jx, gy + jy); return wallDist(uv[0], uv[1]) + (fbm(gx * 0.2, gy * 0.2, 2) - 0.5) * 2.2;
    };
    // 半解析度距離格點
    var LW = (W >> 1) + 2, LH = (H >> 1) + 2, L = new Float32Array(LW * LH), kx = gw / W, ky = gh / H;
    for (y = 0; y < LH; y++) for (x = 0; x < LW; x++) L[y * LW + x] = distAt(x * 2 * kx, y * 2 * ky);
    var Ld = function (px, py) {
      var fx = px / 2, fy = py / 2, x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
      if (x0 >= LW - 1) { x0 = LW - 2; ax = 1; } if (y0 >= LH - 1) { y0 = LH - 2; ay = 1; }
      var q = y0 * LW + x0;
      return (L[q] * (1 - ax) + L[q + 1] * ax) * (1 - ay) + (L[q + LW] * (1 - ax) + L[q + LW + 1] * ax) * ay;
    };
    var M = new Uint8Array(W * H), D = new Float32Array(W * H);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { var dv = Ld(x, y); p = y * W + x; if (dv < 0) { M[p] = 1; D[p] = Math.min(1, -dv * 0.4); } }
    var FH = Math.round(H * 0.022);
    var face = new Uint8Array(W * H);
    for (x = 0; x < W; x++) { var run = 999; for (y = 0; y < H; y++) { p = y * W + x; if (M[p]) run = 0; else { run++; if (run <= FH) face[p] = run; } } }

    // ---- 散布障礙物（只放在離岩壁夠遠的空地上）
    // 類型：1 樹冠 2 灌木 3 石頭 4 水晶 5 雪松
    var OBJ = new Float32Array(W * H), OBT = new Uint8Array(W * H), cpx = W / gw;
    var kinds = { field: [1, 1, 2, 2, 3], cave: [3, 3, 3, 4], sand: [3, 3, 2], snow: [5, 5, 3, 2] }[theme] || [1, 2, 3];
    var want = open ? 260 : 180, placed = 0, pts = [];
    for (var tries = 0; tries < want * 6 && placed < want; tries++) {
      var gx0 = 3 + rnd() * (gw - 6), gy0 = 4 + rnd() * (gh - 7);
      var kind = kinds[(rnd() * kinds.length) | 0];
      var r = (kind === 1 || kind === 5) ? 1.8 + rnd() * 1.6 : kind === 2 ? 1.1 + rnd() * 0.9 : kind === 4 ? 0.9 + rnd() * 0.7 : 1.2 + rnd() * 1.6;
      if (distAt(gx0, gy0) < r * 1.6 + 6) continue;   // 跟岩壁之間至少留一條走得過的路
      var ok = true;
      for (var q2 = 0; q2 < pts.length; q2++) { var o = pts[q2]; if (Math.hypot(o[0] - gx0, (o[1] - gy0) * 1.3) < o[2] + r + 6) { ok = false; break; } }
      if (!ok) continue;
      pts.push([gx0, gy0, r]); placed++;
      var cx = gx0 * cpx, cy = gy0 * (H / gh), rp = r * cpx, ph = rnd() * 100;
      var x0 = Math.max(0, Math.floor(cx - rp * 1.4)), x1 = Math.min(W - 1, Math.ceil(cx + rp * 1.4));
      var y0 = Math.max(0, Math.floor(cy - rp * 1.3)), y1 = Math.min(H - 1, Math.ceil(cy + rp * 1.3));
      for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
        var ddx = (x - cx) / rp, ddy = (y - cy) / rp * (kind === 4 ? 0.8 : 1.22), rr = Math.sqrt(ddx * ddx + ddy * ddy);
        var wob = 1 + (noise(x * 0.12 + ph, y * 0.12 + ph) - 0.5) * (kind === 3 ? 0.45 : kind === 4 ? 0.2 : 0.6);
        if (rr >= wob) continue;
        var h = 1 - rr / wob; p = y * W + x;
        if (h > OBJ[p]) { OBJ[p] = h; OBT[p] = kind; }
      }
    }

    var PAL = {
      field: { floor: [92, 112, 58], floor2: [120, 110, 70], top: [96, 92, 78], top2: [140, 134, 112], face: [58, 52, 42], shade: 0.55 },
      cave: { floor: [112, 92, 68], floor2: [92, 76, 58], top: [92, 78, 62], top2: [150, 128, 100], face: [52, 42, 33], shade: 0.5 },
      sand: { floor: [178, 150, 102], floor2: [158, 128, 84], top: [140, 112, 76], top2: [196, 166, 118], face: [92, 70, 46], shade: 0.6 },
      snow: { floor: [208, 214, 222], floor2: [176, 186, 198], top: [120, 124, 132], top2: [196, 200, 210], face: [70, 74, 84], shade: 0.68 }
    }[theme] || { floor: [92, 112, 58], floor2: [120, 110, 70], top: [96, 92, 78], top2: [140, 134, 112], face: [58, 52, 42], shade: 0.55 };
    var out = new Uint8ClampedArray(W * H * 4), SH = Math.round(W * 0.009), SO = Math.max(3, Math.round(cpx * 0.9));
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      p = y * W + x; var gx = x * kx, gy = y * ky, r0, g0, b0;
      var n1 = fbm(gx * 0.3, gy * 0.3, 3), n2 = noise(x * 0.21, y * 0.21);
      if (M[p]) {   // 岩頂
        var lit = !M[Math.max(0, p - W * 3 - 3)] ? 1.3 : (!M[Math.min(W * H - 1, p + W * 3 + 3)] ? 0.75 : 1);
        var rg = 1 - Math.abs(2 * fbm(gx * 0.42 + 9, gy * 0.42 + 9, 2) - 1);
        var kk = (0.5 + 0.55 * Math.pow(D[p], 0.6)) * (0.75 + 0.5 * n1) * lit * (rg > 0.95 ? 0.7 : 1) * (0.94 + 0.12 * n2), tt = n1;
        r0 = (PAL.top[0] * (1 - tt) + PAL.top2[0] * tt) * kk; g0 = (PAL.top[1] * (1 - tt) + PAL.top2[1] * tt) * kk; b0 = (PAL.top[2] * (1 - tt) + PAL.top2[2] * tt) * kk;
      } else if (OBT[p]) {   // 障礙物：上緣受光、下緣背光
        var hh = OBJ[p], kd = OBT[p];
        var up = (y > 2 && x > 2) ? OBJ[p - W * 2 - 2] : 0, dn = (y < H - 3 && x < W - 3) ? OBJ[p + W * 2 + 2] : 0;
        var lt = Math.max(0.55, Math.min(1.35, 0.95 + (dn - up) * -6 + hh * 0.25));
        var leaf = noise(x * 0.35, y * 0.35);
        if (kd === 1) { r0 = 40; g0 = 78; b0 = 34; lt *= 0.8 + 0.45 * leaf; if (leaf > 0.78 && hh > 0.35) { r0 = 70; g0 = 112; b0 = 48; } }
        else if (kd === 2) { r0 = theme === 'sand' ? 112 : 62; g0 = theme === 'sand' ? 98 : 96; b0 = theme === 'sand' ? 56 : 44; lt *= 0.8 + 0.4 * leaf; }
        else if (kd === 3) { r0 = PAL.top2[0] * 0.92; g0 = PAL.top2[1] * 0.92; b0 = PAL.top2[2] * 0.92; lt *= 0.85 + 0.3 * n2; if (noise(x * 0.5, y * 0.5) > 0.86) lt *= 0.7; }
        else if (kd === 4) { r0 = 96; g0 = 150; b0 = 190; lt *= 0.8 + 0.6 * hh; if (hh > 0.6) { r0 = 170; g0 = 220; b0 = 240; } }
        else { r0 = 34; g0 = 62; b0 = 44; lt *= 0.8 + 0.4 * leaf; if (leaf > 0.6 && up < hh) { r0 = 222; g0 = 228; b0 = 236; lt = 1; } }
        r0 *= lt; g0 *= lt; b0 *= lt;
        if (hh < 0.12) { r0 *= 0.7; g0 *= 0.7; b0 *= 0.7; }   // 外緣描暗
      } else if (face[p]) {   // 岩壁立面
        var fk = (0.55 + 0.35 * noise(x * 0.6, y * 0.06)) * (0.75 + 0.25 * (face[p] / FH));
        r0 = PAL.face[0] * fk * 1.4; g0 = PAL.face[1] * fk * 1.4; b0 = PAL.face[2] * fk * 1.4;
      } else {   // 地面
        var t2 = fbm(gx * 0.11 + 7, gy * 0.11 + 7, 3);
        var k2 = 0.85 + 0.3 * n1 + 0.08 * (n2 - 0.5);
        r0 = (PAL.floor[0] * (1 - t2) + PAL.floor2[0] * t2) * k2; g0 = (PAL.floor[1] * (1 - t2) + PAL.floor2[1] * t2) * k2; b0 = (PAL.floor[2] * (1 - t2) + PAL.floor2[2] * t2) * k2;
        var n3 = noise(x * 0.45 + 11, y * 0.9 + 3), n4 = noise(x * 0.08 + 31, y * 0.08 + 17);
        if (theme === 'field') {
          if (n3 > 0.8 && n4 > 0.45) { r0 *= 0.78; g0 *= 0.92; b0 *= 0.72; }                       // 草叢
          else if (n3 < 0.035 && n4 > 0.62) { var fl = (x * 7 + y * 13) % 3; r0 = fl === 0 ? 230 : fl === 1 ? 240 : 200; g0 = fl === 0 ? 210 : fl === 1 ? 240 : 70; b0 = fl === 0 ? 80 : fl === 1 ? 235 : 70; }   // 小花
        } else if (theme === 'cave') {
          if (n4 < 0.18 && fbm(gx * 0.25 + 3, gy * 0.25, 2) < 0.32) { r0 *= 0.55; g0 *= 0.58; b0 *= 0.66; }   // 水窪／深色濕地
        } else if (theme === 'sand') {
          var rip = Math.sin(y * 0.22 + x * 0.05 + n1 * 9); if (rip > 0.85) { r0 *= 1.07; g0 *= 1.06; b0 *= 1.04; } else if (rip < -0.85) { r0 *= 0.92; g0 *= 0.91; b0 *= 0.9; }   // 沙紋
        } else if (theme === 'snow') {
          if (n3 > 0.9) { r0 = g0 = b0 = 248; }   // 雪面反光
        }
        var pb = noise(x * 0.3 + 3, y * 0.3 + 3);
        if (pb > 0.92) { r0 *= 1.2; g0 *= 1.17; b0 *= 1.12; } else if (pb < 0.06) { r0 *= 0.72; g0 *= 0.72; b0 *= 0.72; }   // 碎石
        var crk = 1 - Math.abs(2 * fbm(gx * 0.16 + 77, gy * 0.16 + 77, 2) - 1); if (crk > 0.988 && n1 > 0.5) { r0 *= 0.8; g0 *= 0.8; b0 *= 0.8; }   // 裂縫
        // 陰影：光從左上來
        var sx = x - SH, sy = y - SH;
        if (sx >= 0 && sy >= 0 && M[sy * W + sx]) { r0 *= PAL.shade + 0.2; g0 *= PAL.shade + 0.2; b0 *= PAL.shade + 0.2; }
        else if (sx >= 0 && sy >= 0 && face[sy * W + sx]) { r0 *= 0.8; g0 *= 0.8; b0 *= 0.8; }
        else if (x >= SO && y >= SO && OBJ[(y - SO) * W + x - SO] > 0.05) { r0 *= 0.62; g0 *= 0.62; b0 *= 0.62; }
      }
      var oo = p * 4; out[oo] = r0; out[oo + 1] = g0; out[oo + 2] = b0; out[oo + 3] = 255;
    }
    // ---- 碰撞格：岩頂＋上半立面＋障礙物
    var block = new Uint8Array(gw * gh), cw = W / gw, ch = H / gh;
    for (var cy2 = 0; cy2 < gh; cy2++) for (var cx2 = 0; cx2 < gw; cx2++) {
      var cnt = 0, oc = 0, tot = 0;
      for (y = Math.floor(cy2 * ch); y < Math.floor((cy2 + 1) * ch); y += 2) for (x = Math.floor(cx2 * cw); x < Math.floor((cx2 + 1) * cw); x += 2) {
        p = y * W + x; tot++; if (M[p] || (face[p] && face[p] <= FH * 0.5)) cnt++; if (OBJ[p] > 0.08) oc++;
      }
      block[cy2 * gw + cx2] = (cnt / tot > 0.3 || oc / tot > 0.3) ? 1 : 0;
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
    return { gw: gw, gh: gh, block: b, mv: b, walk: bestSize, mm: miniFromBlock(b, gw, gh) };
  }
  function cellW() { return wv.grid ? wv.ww / wv.grid.gw : 20; }
  function cellH() { return wv.grid ? wv.wh / wv.grid.gh : 20; }
  function walkW(x, y) {   // 世界座標能不能站（用加厚過的移動碰撞格 mv）
    if (x < 20 || y < 40 || x > wv.ww - 20 || y > wv.wh - 14) return false;
    var g = wv.grid; if (!g) return true;
    var cx = Math.floor(x / wv.ww * g.gw), cy = Math.floor(y / wv.wh * g.gh);
    if (cx < 0 || cy < 0 || cx >= g.gw || cy >= g.gh) return false;
    return !(g.mv || g.block)[cy * g.gw + cx];
  }
  function los(x0, y0, x1, y1) {   // 兩點之間直線有沒有被擋
    var dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy), step = Math.max(3, Math.min(cellW(), cellH()) * 0.5);
    var n = Math.ceil(dist / step);
    for (var i = 1; i <= n; i++) { var k = i / n; if (!walkW(x0 + dx * k, y0 + dy * k)) return false; }
    return true;
  }
  function cellFree(cx, cy) { var g = wv.grid; return g && cx >= 0 && cy >= 0 && cx < g.gw && cy < g.gh && !(g.mv || g.block)[cy * g.gw + cx]; }
  function randomWalkable(x, y, rMin, rMax) {
    for (var i = 0; i < 40; i++) {
      var a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      var px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.7;
      if (walkW(px, py)) return { x: px, y: py };
    }
    return anyWalkable();
  }
  function anyWalkable() {
    var g = wv.grid; if (!g) return null;
    for (var i = 0; i < 400; i++) {
      var cx = (Math.random() * g.gw) | 0, cy = (Math.random() * g.gh) | 0;
      if (cellFree(cx, cy)) return { x: (cx + 0.5) * cellW(), y: (cy + 0.5) * cellH() };
    }
    return null;
  }
  // 新怪出生點：整張地圖隨機，但離玩家至少半個畫面（不會在眼前憑空冒出來），
  // 並從幾個候選點裡挑「離其他怪最遠」的那個 → 怪物平均散在地圖各處，不會擠成一團。
  function spawnSpot() {
    if (!wv.grid) return randomWalkable(wv.px, wv.py, SPAWN_MIN, SPAWN_MAX);
    var minD = Math.max(180, Math.min(wv.vw * 0.55, wv.ww * 0.3)), best = null, bestScore = -1;
    for (var k = 0; k < 8; k++) {
      var c = null;
      for (var t = 0; t < 30 && !c; t++) { var q = anyWalkable(); if (q && Math.hypot(q.x - wv.px, q.y - wv.py) >= minD) c = q; }
      if (!c) continue;
      var near = 1e9; wv.mobs.forEach(function (p) { var d = Math.hypot(p.hx - c.x, p.hy - c.y); if (d < near) near = d; });
      if (near > bestScore) { bestScore = near; best = c; }
    }
    return best || anyWalkable() || randomWalkable(wv.px, wv.py, SPAWN_MIN, SPAWN_MAX);
  }
  // A* 尋路（8 方向、不切牆角），回傳世界座標的路徑點；找不到回 null。
  // 格子 2.9 萬格：陣列重複使用（以「第幾次搜尋」當標記，不必每次清空），每幀最多算 PATH_BUDGET 次，其餘下一幀再算。
  var PATH_BUDGET = 4, pathLeft = PATH_BUDGET, AS = null;
  function findPath(sx, sy, tx, ty) {
    var g = wv.grid; if (!g) return null;
    if (pathLeft <= 0) return undefined; pathLeft--;
    var gw = g.gw, gh = g.gh, B = g.mv || g.block, cw = cellW(), ch = cellH(), n = gw * gh;
    if (!AS || AS.n !== n) AS = { n: n, gs: new Float32Array(n), from: new Int32Array(n), mark: new Uint32Array(n), shut: new Uint32Array(n), run: 0 };
    var run = ++AS.run, gs = AS.gs, from = AS.from, mark = AS.mark, shut = AS.shut;
    var cellOf = function (x, y) { return Math.min(gh - 1, Math.max(0, Math.floor(y / ch))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(x / cw))); };
    var nearFree = function (c0) {
      if (!B[c0]) return c0;
      var ex = c0 % gw, ey = (c0 / gw) | 0;
      for (var r = 1; r < 8; r++) for (var j = -r; j <= r; j++) for (var k = -r; k <= r; k++) {
        if (Math.max(Math.abs(j), Math.abs(k)) !== r) continue;
        var X = ex + k, Y = ey + j; if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
        if (!B[Y * gw + X]) return Y * gw + X;
      }
      return -1;
    };
    var s = nearFree(cellOf(sx, sy)), e = nearFree(cellOf(tx, ty));
    if (s < 0 || e < 0) return null;
    var heap = [], hf = [];
    var push = function (i, f) { heap.push(i); hf.push(f); var c = heap.length - 1; while (c > 0) { var p = (c - 1) >> 1; if (hf[p] <= hf[c]) break; var t = heap[p]; heap[p] = heap[c]; heap[c] = t; t = hf[p]; hf[p] = hf[c]; hf[c] = t; c = p; } };
    var pop = function () { var top = heap[0], li = heap.pop(), lf = hf.pop(); if (heap.length) { heap[0] = li; hf[0] = lf; var c = 0; for (;;) { var l = c * 2 + 1, r2 = l + 1, m = c; if (l < heap.length && hf[l] < hf[m]) m = l; if (r2 < heap.length && hf[r2] < hf[m]) m = r2; if (m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; t = hf[m]; hf[m] = hf[c]; hf[c] = t; c = m; } } return top; };
    var exx = e % gw, eyy = (e / gw) | 0;
    var hh = function (i) { var dx = Math.abs(i % gw - exx), dy = Math.abs(((i / gw) | 0) - eyy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    mark[s] = run; gs[s] = 0; from[s] = -1; push(s, hh(s));
    var iter = 0, found = false;
    while (heap.length && iter++ < 30000) {
      var c = pop(); if (c === e) { found = true; break; } if (shut[c] === run) continue; shut[c] = run;
      var cx = c % gw, cy = (c / gw) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        var ni = ny * gw + nx; if (B[ni] || shut[ni] === run) continue;
        if (dx && dy && (B[cy * gw + nx] || B[ny * gw + cx])) continue;   // 不切牆角
        var ng = gs[c] + (dx && dy ? 1.414 : 1);
        if (mark[ni] !== run || ng < gs[ni]) { mark[ni] = run; gs[ni] = ng; from[ni] = c; push(ni, ng + hh(ni)); }
      }
    }
    if (!found && e !== s) return null;
    var path = [], cur = e;
    while (cur !== s && cur >= 0) { path.push({ x: (cur % gw + 0.5) * cw, y: (((cur / gw) | 0) + 0.5) * ch }); cur = from[cur]; }
    path.reverse();
    return path;
  }
  // 讓 a（有 x,y 的物件）往 (gx,gy) 走，停在 stop 距離內；有障礙就照 A* 繞。回傳這一幀有沒有在走。
  // 擬真：起步加速（ACCEL_T 秒到全速）、快到時減速；每一步都檢查碰撞格，撞牆就沿牆滑，滑不動才停。
  function steer(a, gx, gy, speed, stop, dt) {
    var dx = gx - a.x, dy = gy - a.y, dist = Math.hypot(dx, dy);
    if (dist <= stop) { a.path = null; a.v = 0; return false; }
    var tx = gx, ty = gy, direct = los(a.x, a.y, gx, gy);
    if (!direct) {
      a.rt = (a.rt || 0) - dt;
      if (!a.path || a.rt <= 0 || Math.hypot((a.pgx || 0) - gx, (a.pgy || 0) - gy) > cellW() * 4) {
        var np = findPath(a.x, a.y, gx, gy);
        if (np !== undefined) { a.path = np; a.rt = 0.8 + Math.random() * 0.4; a.pgx = gx; a.pgy = gy; }
      }
      while (a.path && a.path.length > 1 && los(a.x, a.y, a.path[1].x, a.path[1].y)) a.path.shift();
      if (!a.path || !a.path.length) { a.v = 0; return false; }
      tx = a.path[0].x; ty = a.path[0].y;
      if (Math.hypot(tx - a.x, ty - a.y) < 3) { a.path.shift(); if (!a.path.length) { a.v = 0; return false; } tx = a.path[0].x; ty = a.path[0].y; }
    } else a.path = null;
    var ddx = tx - a.x, ddy = ty - a.y, dd = Math.hypot(ddx, ddy) || 1;
    var want = speed;
    if (direct) want = Math.min(want, Math.max(speed * 0.3, (dist - stop) * 5));   // 快到了就放慢
    a.v = Math.min(want, (a.v || 0) + speed * dt / ACCEL_T);
    var step = Math.min(direct ? dist - stop : dd, a.v * dt);
    var nx = a.x + ddx / dd * step, ny = a.y + ddy / dd * step;
    if (walkW(nx, ny)) { a.x = nx; a.y = ny; }
    else if (walkW(nx, a.y)) a.x = nx;
    else if (walkW(a.x, ny)) a.y = ny;
    else { a.path = null; a.rt = 0; a.v = 0; return false; }
    // 面向慢慢轉過去（不會一幀就 180 度大迴轉）
    var tw = Math.min(1, dt * 10);
    a.mdx = (a.mdx == null ? ddx / dd : a.mdx + (ddx / dd - a.mdx) * tw);
    a.mdy = (a.mdy == null ? ddy / dd : a.mdy + (ddy / dd - a.mdy) * tw);
    return true;
  }
  // 站在障礙裡（地形剛換、鏡頭縮放後）→ 搬到最近可走的地方
  function unstick(a) {
    if (walkW(a.x, a.y)) return;
    var g = wv.grid; if (!g) return;
    var cx = Math.floor(a.x / cellW()), cy = Math.floor(a.y / cellH());
    for (var r = 1; r < 12; r++) for (var j = -r; j <= r; j++) for (var k = -r; k <= r; k++) {
      if (Math.max(Math.abs(j), Math.abs(k)) !== r) continue;
      if (cellFree(cx + k, cy + j)) { a.x = (cx + k + 0.5) * cellW(); a.y = (cy + j + 0.5) * cellH(); a.path = null; return; }
    }
  }

  // ---- 怪物站位與行為 ------------------------------------------------------------
  function mobPos(uid) {
    var p = wv.mobs.get(uid);
    if (!p) {
      var c = (bigMap() ? spawnSpot() : randomWalkable(wv.px, wv.py, SPAWN_MIN, SPAWN_MAX)) || { x: clamp(wv.px + 160, 50, wv.ww - 50), y: wv.py };
      p = { x: c.x, y: c.y, hx: c.x, hy: c.y, path: null, rt: 0, wt: Math.random() * 3, wx: null, wy: null, v: 0, aggro: 0, inReach: false };
      wv.mobs.set(uid, p);
    }
    return p;
  }
  function recentAct(m, now) { var a = m._animAct; return !!(a && (a.k === 'attack' || a.k === 'skill') && now - a.t < 2500); }
  // 怪物 AI（純畫面上的走位；「打不打得到」由 inReach 交給核心補丁 15 判斷）：
  //   ・玩家鎖定的那隻、主動怪在 AGGRO_R 內看得到玩家、被打過還在附近的 → 追過來，貼身才出手
  //   ・追離出生點超過 LEASH_R（又不是玩家正在打的）→ 放棄、走回出生點
  //   ・其餘：在出生點附近閒晃
  function moveMobs(alive, lockUid, dt, dead) {
    var now = Date.now(), list = [];
    alive.forEach(function (m) {
      var uid = String(m.uid), p = mobPos(uid); list.push(p);
      p.moving = false;
      var d = Math.hypot(p.x - wv.px, p.y - wv.py);
      p.inReach = !dead && d <= MOB_REACH + 16;
      if (m.noAttack) { p.inReach = false; return; }   // 城門／守護塔／寶箱：不會動
      var passiveFull = m.beh === '被動' && m.curHp >= m.hp;
      var see = d < AGGRO_R && los(p.x, p.y, wv.px, wv.py);
      if (!dead && (uid === lockUid || recentAct(m, now) || (!passiveFull && see) || (m.curHp < m.hp && d < AGGRO_R * 1.6))) p.aggro = 4;
      else p.aggro = Math.max(0, p.aggro - dt);
      if (p.aggro > 0 && uid !== lockUid && Math.hypot(p.x - p.hx, p.y - p.hy) > LEASH_R) p.aggro = 0;
      if (p.aggro > 0) {
        p.wx = null;
        p.moving = steer(p, wv.px, wv.py, MOB_CHASE, MOB_REACH, dt);
        return;
      }
      p.wt -= dt;
      if (p.wt <= 0) {
        p.wt = 2.5 + Math.random() * 3.5;
        var far = Math.hypot(p.x - p.hx, p.y - p.hy) > 140;
        var c = far ? { x: p.hx, y: p.hy } : (Math.random() < 0.55 ? randomWalkable(p.hx, p.hy, 20, 110) : null);
        p.wx = c ? c.x : null; p.wy = c ? c.y : null; p.path = null;
      }
      if (p.wx != null) { p.moving = steer(p, p.wx, p.wy, MOB_WANDER, 3, dt); if (!p.moving) p.wx = null; }
      else p.v = 0;
    });
    // 互相推開（推過去那格必須可走），也不准疊在玩家身上
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j], dx = b.x - a.x, dy = b.y - a.y;
        if (dx > MOB_GAP || dx < -MOB_GAP || dy > MOB_GAP || dy < -MOB_GAP) continue;
        var d2 = Math.hypot(dx, dy);
        if (d2 > 0.01 && d2 < MOB_GAP) {
          var push = (MOB_GAP - d2) * 0.25, ux = dx / d2 * push, uy = dy / d2 * push;
          if (walkW(a.x - ux, a.y - uy)) { a.x -= ux; a.y -= uy; }
          if (walkW(b.x + ux, b.y + uy)) { b.x += ux; b.y += uy; }
        }
      }
      var px = a.x - wv.px, py = a.y - wv.py, pd = Math.hypot(px, py), minP = MOB_REACH * 0.7;
      if (pd > 0.01 && pd < minP) { var k2 = (minP - pd) / pd; if (walkW(a.x + px * k2, a.y + py * k2)) { a.x += px * k2; a.y += py * k2; } }
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
      if (typeof isRangedArmed === 'function' && isRangedArmed(player)) return true;
      return player && (player.cls === 'mage' || player.cls === 'illusionist');
    } catch (e) { return false; }
  }
  function moveMult() { try { var m = (typeof playerMoveDelayMultiplier === 'function') ? playerMoveDelayMultiplier() : 1; return (m > 0.2 && m < 5) ? 1 / m : 1; } catch (e) { return 1; } }

  // ---- 核心補丁 15／16 的鉤子 ------------------------------------------------------
  // 線上（畫面正在跑大地圖）：照實際距離判斷。離線結算／背景補跑（state.ff、或畫面沒在跑）：用簡化模型，
  // 讓離線收益跟線上同一個 GM 倍數走——怪越多，殺完一隻走到下一隻的路越短、同時圍上來的怪也越多。
  function liveGeo() { try { return wv.on && !state.ff && !!wv.grid && (Date.now() - wv.lastFrameMs) < 400; } catch (e) { return false; } }
  var offTick = -1, offSet = null, offTgt = null, offHoldUntil = 0;
  function offActive(i) {
    if (state.ticks !== offTick) {
      offTick = state.ticks; offSet = {};
      var k = Math.max(2, Math.min(4, Math.round(1 + gmMult()))), list = [];
      var t = mapState.targetIdx; if (mapState.mobs[t] && !mapState.mobs[t]._dead) { offSet[t] = 1; k--; }
      for (var j = 0; j < mapState.mobs.length; j++) { var m = mapState.mobs[j]; if (m && !m._dead && m.curHp > 0 && j !== t) list.push(j); }
      list.sort(function (x, y) { return (mapState.mobs[x]._born || 0) - (mapState.mobs[y]._born || 0); });
      for (j = 0; j < list.length && k > 0; j++, k--) offSet[list[j]] = 1;
    }
    return !!offSet[i];
  }
  window.__afkMobIdle = function (m, i) {
    try {
      if (!bigMap() || !m) return false;
      if (liveGeo()) { var p = wv.mobs.get(String(m.uid)); return !(p && p.inReach); }
      return !offActive(i);
    } catch (e) { return false; }
  };
  window.__afkPlayerHold = function () {
    try {
      if (!bigMap()) return false;
      var t = mapState.mobs[mapState.targetIdx]; if (!t || t._dead || t.curHp <= 0) return false;
      if (liveGeo()) return !(wv.inRange && wv.rangeUid === String(t.uid));
      var u = String(t.uid);
      if (u !== offTgt) { offTgt = u; offHoldUntil = state.ticks + Math.round(20 / Math.sqrt(gmMult())); }   // 走向下一隻：倍數 1＝2 秒
      return state.ticks < offHoldUntil;
    } catch (e) { return false; }
  };
  // 玩家手動點怪 → 記住，自動選怪不會把它換掉
  document.addEventListener('pointerdown', function (e) {
    try { var c = e.target && e.target.closest && e.target.closest('#mob-list .mob-target[data-uid]'); if (c) wv.manualUid = c.getAttribute('data-uid'); } catch (e2) {}
  }, true);
  // 自動選怪：核心預設鎖「出生最早」的怪（可能在地圖另一頭）→ 大地圖改成「最近、走得到」的那隻；手動點的優先
  function autoTarget(alive) {
    if (!bigMap() || !alive.length) return;
    var cur = null; try { cur = mapState.mobs[mapState.targetIdx]; } catch (e) {}
    if (cur && (cur._dead || cur.curHp <= 0)) cur = null;
    if (cur && String(cur.uid) === wv.manualUid) return;
    var best = null, bestD = 1e9, curD = 1e9;
    alive.forEach(function (m) {
      if (m.noAttack) return;
      var p = mobPos(String(m.uid)), d = Math.hypot(p.x - wv.px, p.y - wv.py);
      if (!los(wv.px, wv.py, p.x, p.y)) d *= 1.6;
      if (m === cur) curD = d;
      if (d < bestD) { bestD = d; best = m; }
    });
    if (!best || best === cur) return;
    if (cur && bestD > curD * 0.6) return;   // 差不多近就別一直換目標
    var idx = mapState.mobs.indexOf(best);
    if (idx >= 0) { if (typeof setTarget === 'function') setTarget(idx); else mapState.targetIdx = idx; }
  }

  // ---- 每幀：移動＋鏡頭＋擺位 --------------------------------------------------
  function frame(t) {
    requestAnimationFrame(frame);
    var dt = wv.lastT ? Math.min(0.1, (t - wv.lastT) / 1000) : 0; wv.lastT = t;
    pathLeft = PATH_BUDGET;
    var bv = $('battle-view');
    var ok = sceneOK(bv);
    if (bv) bv.classList.toggle('wv-on', ok);
    wv.on = ok;
    if (!ok) { wv.walking = false; return; }
    wv.lastFrameMs = Date.now();
    measure(bv);

    var dead = false; try { dead = !!player.dead || player.hp <= 0; } catch (e) {}
    var alive = aliveMobs(), tgt = null;
    if (!dead && wv.grid) { wv.retgtT -= dt; if (wv.retgtT <= 0) { wv.retgtT = 0.4; autoTarget(alive); } }
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

    // 角色：走向目標，進到射程（近戰貼身／遠程射程內且看得到）才算 inRange → 核心才讓玩家出手
    var pa = wv.pa || (wv.pa = {}); pa.x = wv.px; pa.y = wv.py;
    wv.walking = false; wv.inRange = false; wv.rangeUid = lockUid;
    var spd = WALK_SPEED * moveMult();
    if (!dead) {
      if (tgt) {
        var tp = mobPos(lockUid), ranged = isRanged(), stop = ranged ? RANGED_STOP : MELEE_STOP;
        var see = los(wv.px, wv.py, tp.x, tp.y);
        if (ranged && !see) stop = MELEE_STOP;
        wv.wanderTo = null;
        wv.walking = steer(pa, tp.x, tp.y + 4, spd, stop, dt);
        var dNow = Math.hypot(pa.x - tp.x, pa.y - tp.y - 4);
        wv.inRange = dNow <= stop + 12 && (see || dNow <= MELEE_STOP + 12);
      } else {
        wv.wanderT -= dt;
        if (wv.wanderT <= 0) { wv.wanderT = 2 + Math.random() * 3; wv.wanderTo = Math.random() < 0.6 ? randomWalkable(wv.px, wv.py, 40, 160) : null; }
        if (wv.wanderTo) { wv.walking = steer(pa, wv.wanderTo.x, wv.wanderTo.y, spd * 0.45, 4, dt); if (!wv.walking) wv.wanderTo = null; }
      }
    }
    if (wv.walking) { wv.px = pa.x; wv.py = pa.y; try { wv.face = _vec2dir(pa.mdx, pa.mdy); } catch (e) {} }
    moveMobs(alive, lockUid, dt, dead);

    // 鏡頭：角色置中、不超出世界邊；稍微延遲跟上（比較像攝影機在跟）
    var wantCx = clamp(wv.px - wv.vw / 2, 0, Math.max(0, wv.ww - wv.vw));
    var wantCy = clamp(wv.py - wv.vh * 0.58, 0, Math.max(0, wv.wh - wv.vh));
    var ck = Math.min(1, dt * 8);
    if (!wv._camInit || Math.abs(wantCx - wv.cx) > wv.vw || Math.abs(wantCy - wv.cy) > wv.vh) { wv.cx = wantCx; wv.cy = wantCy; wv._camInit = true; }
    else { wv.cx += (wantCx - wv.cx) * ck; wv.cy += (wantCy - wv.cy) * ck; }
    var s = bv.style;
    s.setProperty('--wv-ww', wv.ww.toFixed(1) + 'px'); s.setProperty('--wv-wh', wv.wh.toFixed(1) + 'px');
    s.setProperty('--wv-cx', wv.cx.toFixed(1) + 'px'); s.setProperty('--wv-cy', wv.cy.toFixed(1) + 'px');
    s.setProperty('--wv-sc', String(((isMobile() ? SPRITE_SCALE_M : SPRITE_SCALE_D) * wv.cam).toFixed(2)));

    // 怪物卡擺位（核心重建卡片時 inline style 會被洗掉 → 每幀重設，成本只有幾個變數）
    var ml = $('mob-list'), seen = {}, byUid = {}, now = Date.now();
    alive.forEach(function (m) { byUid[String(m.uid)] = m; });
    wv.tgtUid = lockUid;
    if (ml) {
      var cards = ml.querySelectorAll('.mob-target[data-uid]');
      for (var i = 0; i < cards.length; i++) {
        var uid = cards[i].getAttribute('data-uid'); seen[uid] = 1;
        var p = mobPos(uid), mb = byUid[uid], ox = 0, oy = 0;
        // 擬真：出手時往玩家方向撲一下；走路時腳步上下起伏
        if (mb && mb._animAct && (mb._animAct.k === 'attack' || mb._animAct.k === 'skill')) {
          var age = now - mb._animAct.t;
          if (age < 320) { var lx = wv.px - p.x, ly = wv.py - p.y, ll = Math.hypot(lx, ly) || 1, lk2 = Math.sin(Math.PI * age / 320) * 10; ox = lx / ll * lk2; oy = ly / ll * lk2; }
        } else if (p.moving) oy = -Math.abs(Math.sin(now / 95 + (uid.length * 7))) * 2.2;
        place(cards[i], p.x, p.y, ox, oy);
        var hp = mb ? Math.max(0, Math.min(100, Math.round(mb.curHp / (mb.hp || 1) * 100))) + '%' : '0%';
        if (cards[i].style.getPropertyValue('--pp-hp') !== hp) cards[i].style.setProperty('--pp-hp', hp);
        var isT = uid === wv.tgtUid;
        if (cards[i].classList.contains('pp-tgt') !== isT) cards[i].classList.toggle('pp-tgt', isT);
      }
    }
    wv.mobs.forEach(function (_, k) { if (!seen[k] && !byUid[k]) wv.mobs.delete(k); });

    var pm = $('player-morph-sprite');
    if (pm) {
      var px2 = 0, py2 = 0;
      try {
        if (_pmState && (_pmState.act === 'attack' || _pmState.act === 'skill') && tgt) {
          var ag = now - (_pmState.t || 0);
          if (ag < 300) { var tq = mobPos(lockUid), qx = tq.x - wv.px, qy = tq.y - wv.py, ql = Math.hypot(qx, qy) || 1, qk = Math.sin(Math.PI * ag / 300) * (isRanged() ? 3 : 9); px2 = qx / ql * qk; py2 = qy / ql * qk; }
        } else if (wv.walking) py2 = -Math.abs(Math.sin(now / 90)) * 1.6;
      } catch (e) {}
      place(pm, wv.px, wv.py, px2, py2);
    }
  }
  function place(el, x, y, ox, oy) {
    var sx = (x + (ox || 0) - wv.cx).toFixed(1) + 'px', sy = (y + (oy || 0) - wv.cy).toFixed(1) + 'px', sz = String(10 + Math.round(y / 4));
    var st = el.style;
    if (st.getPropertyValue('--sx') !== sx) st.setProperty('--sx', sx);
    if (st.getPropertyValue('--sy') !== sy) st.setProperty('--sy', sy);
    if (st.getPropertyValue('--sz') !== sz) st.setProperty('--sz', sz);
  }

  // ---- 八方向怪：走路時面向前進方向（原本一律面向玩家）-----------------------------
  function hookFace() {
    if (typeof window._mob8FaceDir !== 'function') return false;
    if (window._mob8FaceDir._wv) return true;
    var orig = window._mob8FaceDir;
    var w = function (m, box) {
      try {
        if (wv.on && m && !(m._animAct && (m._animAct.k === 'attack' || m._animAct.k === 'skill'))) {
          var p = wv.mobs.get(String(m.uid));
          if (p && p.moving && (p.mdx || p.mdy) && !p.inReach) { var d = _vec2dir(p.mdx, p.mdy); m._face8 = d; return d; }
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    w._wv = true; window._mob8FaceDir = w; return true;
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
    (function waitHook() { var a = hook(), b = hookFace(); if (!(a && b) && ++tries < 40) setTimeout(waitHook, 250); })();
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
