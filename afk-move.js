/* ============================================================================
 * afk-move.js — 村莊可走動地圖、點擊／觸控移動、虛擬搖桿、日誌時間戳、移除假玩家聊天
 *
 * ① 村莊地圖：村莊背景變成一張可捲動的大地圖（約畫面高的 2 倍），角色站在地圖上、鏡頭跟著走。
 *    ・點地面＝走過去；點 NPC＝先走到 NPC 旁邊再打開對話（GM 拖曳模式時不走路）。
 *    ・角色用八方向職業動畫（走路幀照實際走的距離播放）。
 *    ・開著「NPC 條列式」時，村莊改顯示地圖（清單收起）。
 * ② 狩獵地圖：點地面＝走過去（暫停自動追怪約 4 秒）；點怪物＝鎖定（原本行為）。
 * ③ 虛擬搖桿：在村莊或狩獵畫面上「按住 0.5 秒」出現搖桿，拖曳控制方向，放開就收起。
 * ④ 對外介面 window.__afkView()：目前畫面的世界座標（給 afk-mp 畫其他玩家、聊天泡泡用）。
 * ⑤ 日誌時間戳：戰鬥／系統（含掉落）／世界頻道每一行前面加上 [時:分:秒]。
 * ⑥ 移除假玩家聊天：世界頻道的 NPC 假人閒聊、互嗆、回答、私訊挑釁全部關掉，只留真人聊天。
 * ========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function inTown() { try { return /^town_/.test(String(mapState.current || '')) && !$('town-view').classList.contains('hidden'); } catch (e) { return false; } }
  function inBattle() { var W = window.__afkWV; var bv = $('battle-view'); return !!(W && W.on && bv && !bv.classList.contains('hidden')); }

  // =====================================================================================
  // ① 村莊走動
  // =====================================================================================
  var TW = { on: false, town: '', px: 0, py: 0, ww: 0, wh: 0, vw: 0, vh: 0, cx: 0, cy: 0, walking: false, face: 5,
             to: null, joy: null, stride: 0, v: 0, mdx: 0, mdy: 1, npcPending: null, lastT: 0, wrap: null, me: null, z: 0.5, path: null, hx: null, hy: null };
  // 世界座標＝村莊原圖的像素（1920×1080，不再壓扁/拉伸）；整張圖用 scale(TW.z) 縮到視窗裡
  var IW = 1920, IH = 1080;
  var VIEW_FRAC = 0.68;      // 視窗看得到地圖高度的 68%（原本 50%）→ 鏡頭拉遠
  var NPC_SC = 1.35;         // NPC 在原圖座標裡的大小（保持跟原本一樣的人／建築比例）
  var SPEED = 210, SC = 0.85, STRIDE = 25, ACCEL_T = 0.1;   // 單位都是原圖 px
  var POS_KEY = 'afk_tw_pos';
  var savedPos = {}; try { savedPos = JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch (e) {}
  var CSS = [
    '#tw-view{position:relative;overflow:hidden;width:100%;height:clamp(240px,46vh,420px);border-radius:6px;background:#1b160f;touch-action:none;user-select:none;-webkit-user-select:none}',
    'body #tw-view #town-npc-map{display:block!important;position:absolute!important;left:0;top:0;margin:0!important;max-width:none!important;aspect-ratio:auto!important;transform-origin:0 0;will-change:transform}',
    'body.tw-on #afk-npclist{display:none!important}',
    '#tw-me{position:absolute;width:0;height:0;pointer-events:none}',
    /* NPC：錨點在腳底（translate(-50%,-100%)）→ 以 0 0 為原點縮放，腳的位置不變 */
    '#tw-view .town-npc{transform-origin:0 0!important;scale:var(--tw-ns,1)}',
    /* 地圖整張縮小後，名字／泡泡反向放大，螢幕上維持原本字級 */
    '#town-npc-map #tw-me .mp-bub{font-size:calc(8pt / var(--tw-z,1))!important;max-width:calc(180px / var(--tw-z,1))!important;padding:calc(3px / var(--tw-z,1)) calc(7px / var(--tw-z,1))!important;border-radius:calc(8px / var(--tw-z,1))!important}',
    '#town-npc-map .op .mp-bub{font-size:calc(8pt / var(--tw-z,1) / var(--tw-sc,1))!important;max-width:calc(180px / var(--tw-z,1) / var(--tw-sc,1))!important}',
    '#town-npc-map .op b{font-size:calc(11px / var(--tw-z,1) / var(--tw-sc,1))!important}',
    '#battle-view .op .mp-bub,#player-morph-sprite .mp-bub{font-size:calc(8pt / var(--wv-sc,1))!important}',
    '#tw-walls{position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none;opacity:.45;z-index:1}',
    '#tw-me img{max-width:none!important;max-height:none!important}',   /* 全站 img{max-width:100%} 會把寬度 0 的錨點裡的圖縮成 0 */
    '#tw-me .b,#tw-me .s{position:absolute;left:0;top:0;transform-origin:50% 86%;image-rendering:auto}',
    '#tw-me .s{opacity:.85}',
    '#tw-me .nm{position:absolute;left:0;transform:translateX(-50%);white-space:nowrap;font:700 12px/1.2 "Noto Serif TC",serif;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000,0 1px 2px #000;pointer-events:none}',
    '.mv-mark{position:absolute;width:22px;height:10px;margin:-5px 0 0 -11px;border:2px solid rgba(255,230,120,.9);border-radius:50%;pointer-events:none;animation:mvMark .6s ease-out forwards;z-index:3}',
    '@keyframes mvMark{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}',
    '#mv-joy{position:fixed;z-index:100003;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.08),rgba(255,255,255,.18));border:2px solid rgba(255,225,150,.55);box-shadow:0 0 12px rgba(0,0,0,.5);pointer-events:none;display:none}',
    '#mv-joy i{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe9a8,#b7862e);box-shadow:0 2px 6px rgba(0,0,0,.6)}',
    '#battle-view.wv-on{touch-action:none}',
    /* 時間戳 */
    /* 對話／戰鬥／系統日誌文字：8 號字（8pt） */
    '#combat-log,#sys-log,#world-log,#combat-log *,#sys-log *,#world-log *{font-size:8pt!important;line-height:1.4!important}',
    '.afk-ts{color:#8d8a7e;font-size:.82em!important;margin-right:4px;font-family:ui-monospace,Consolas,monospace;font-weight:400}',
    /* 聊天泡泡（afk-mp 用） */
    '.mp-bub{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);max-width:180px;padding:3px 7px;border-radius:8px;background:rgba(255,255,255,.94);color:#222;font:600 8pt/1.35 "Noto Serif TC",sans-serif;white-space:normal;word-break:break-all;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.45);pointer-events:none;z-index:50;animation:mvMark2 .2s ease-out}',
    '.mp-bub:after{content:"";position:absolute;left:50%;top:100%;margin-left:-5px;border:5px solid transparent;border-top-color:rgba(255,255,255,.94)}',
    '@keyframes mvMark2{from{transform:translateX(-50%) scale(.6);opacity:0}to{transform:translateX(-50%);opacity:1}}'
  ].join('\n');
  function ensureStyle() { if ($('afk-move-style')) return; var s = document.createElement('style'); s.id = 'afk-move-style'; s.textContent = CSS; document.head.appendChild(s); }

  function form() { try { return _playerBattleForm(); } catch (e) { return null; } }
  // 幀數：核心快取有就照快取；還沒載入（剛進村莊）就先當職業動畫的標準 8 幀待機／4 幀走路，缺圖時 onerror 自動縮減
  function frameInfo(f, key) {
    var a = null; try { a = _morphBattleCache[key || f.key] || _morphBattleCache[f.key]; } catch (e) {}
    var ok = a && a !== 'probing', cls = /^class:/.test(String(f.domKey || f.key || ''));
    return { idle: ok && a.idle ? a.idle.length : 8, walk: ok ? (a.walk && a.walk.length ? a.walk.length : 0) : (cls ? 4 : 0), shadow: ok ? !!(a.shadow && a.shadow.idle && a.shadow.idle.length) : cls };
  }
  // 方向資料夾：照核心的對照（0 西北＝<職業>2、1 北＝<職業>F、2 東北＝<職業>、3～7＝<職業>d3～d7）
  function dirInfo(f, dir) {
    var m = /^class:([^:]+):(.*)$/.exec(String(f.domKey || ''));
    if (!m) return { base: f.base, key: f.key };
    var fname = m[1], eight = false, sfx = '';
    try { eight = typeof CLASS_ANIM_8DIR !== 'undefined' && CLASS_ANIM_8DIR.has(fname); } catch (e) {}
    try { sfx = _animDirSfx(dir, eight); } catch (e) { return { base: f.base, key: f.key }; }
    return { base: 'assets/classanim/' + encodeURIComponent(fname + sfx) + '/', key: 'class:' + fname + sfx + ':' + m[2] };
  }
  // 村莊裡核心給的職業圖資料夾沒有方向（男妖精/）→ 自己補上方向（男妖精d3/），角色才會轉向走路；沒有方向圖的形態退回原資料夾
  var noDir = {};
  function dirBase(base, dir) {
    if (/d\d\/$/.test(base)) return base.replace(/d\d\/$/, 'd' + dir + '/');
    if (/classanim\//.test(base) && !noDir[base]) return base.replace(/\/$/, 'd' + dir + '/');
    return base;
  }
  function vec2dir(dx, dy) { try { return _vec2dir(dx, dy); } catch (e) { return 5; } }

  // 把 #town-npc-map 包進可捲動的視窗（#tw-view）
  function mount() {
    var map = $('town-npc-map'); if (!map) return false;
    var wrap = $('tw-view');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'tw-view'; }
    if (map.parentNode !== wrap) { map.parentNode.insertBefore(wrap, map); wrap.appendChild(map); }
    TW.wrap = wrap; return true;
  }
  function unmount() {
    var wrap = $('tw-view'), map = $('town-npc-map');
    if (wrap && map && map.parentNode === wrap) { wrap.parentNode.insertBefore(map, wrap); }
    if (wrap) wrap.remove();
    if (map) { map.style.width = ''; map.style.height = ''; map.style.transform = ''; }
    var me = $('tw-me'); if (me) me.remove();
    document.body.classList.remove('tw-on');
    TW.on = false; TW.wrap = null;
  }
  function layout() {
    var wrap = TW.wrap, map = $('town-npc-map'); if (!wrap || !map) return false;
    TW.vw = wrap.clientWidth; TW.vh = wrap.clientHeight; if (!TW.vw || !TW.vh) return false;
    TW.z = Math.max(TW.vh / (IH * VIEW_FRAC), TW.vw / IW);
    if (TW.ww !== IW || TW.wh !== IH || map.style.width !== IW + 'px') {
      TW.ww = IW; TW.wh = IH; map.style.width = IW + 'px'; map.style.height = IH + 'px';
    }
    var zs = TW.z.toFixed(4);
    if (map.style.getPropertyValue('--tw-z') !== zs) { map.style.setProperty('--tw-z', zs); map.style.setProperty('--tw-sc', String(SC)); map.style.setProperty('--tw-ns', String(NPC_SC)); }
    return true;
  }

  // ---- 建築／圍牆／水面碰撞（afk-townwalls.js 描好的多邊形 → 192×108 格，每格 10 原圖 px）--------------
  var GW = 192, GH = 108, grid = null;
  function townImg(t) { try { return (typeof TOWN_BG_1920 !== 'undefined' && TOWN_BG_1920[t]) || ''; } catch (e) { return ''; } }
  function buildGrid(t) {
    var polys = null; try { polys = window.AFK_TOWN_WALLS && AFK_TOWN_WALLS[townImg(t)]; } catch (e) {}
    var g = new Uint8Array(GW * GH), x, y;
    for (x = 0; x < GW; x++) { g[x] = 1; g[(GH - 1) * GW + x] = 1; }
    for (y = 0; y < GH; y++) { g[y * GW] = 1; g[y * GW + GW - 1] = 1; }
    (polys || []).forEach(function (p) {
      var xs = [], ys = [];
      for (var i = 0; i + 1 < p.length; i += 2) { xs.push(p[i] / 100 * GW); ys.push(p[i + 1] / 100 * GH); }
      var y0 = Math.max(0, Math.floor(Math.min.apply(null, ys))), y1 = Math.min(GH - 1, Math.ceil(Math.max.apply(null, ys)));
      for (var cy = y0; cy <= y1; cy++) {
        var yy = cy + 0.5, nodes = [];
        for (var a = 0, b = xs.length - 1; a < xs.length; b = a++) if ((ys[a] < yy) !== (ys[b] < yy)) nodes.push(xs[a] + (yy - ys[a]) / (ys[b] - ys[a]) * (xs[b] - xs[a]));
        nodes.sort(function (m, n) { return m - n; });
        for (var k = 0; k + 1 < nodes.length; k += 2) {
          var x0 = Math.max(0, Math.ceil(nodes[k] - 0.5)), x1 = Math.min(GW - 1, Math.floor(nodes[k + 1] - 0.5));
          for (var cx = x0; cx <= x1; cx++) g[cy * GW + cx] = 1;
        }
      }
    });
    grid = { g: g, town: t, has: !!(polys && polys.length) };
    if (TW.wallsOn) drawWalls();
  }
  function cellX(x) { return Math.min(GW - 1, Math.max(0, Math.floor(x / IW * GW))); }
  function cellY(y) { return Math.min(GH - 1, Math.max(0, Math.floor(y / IH * GH))); }
  function freeAt(x, y) { return !grid || !grid.g[cellY(y) * GW + cellX(x)]; }
  function nearestFree(x, y) {
    if (freeAt(x, y)) return { x: x, y: y };
    var X0 = cellX(x), Y0 = cellY(y);
    for (var r = 1; r < 60; r++) {
      var best = null, bd = 1e9;
      for (var j = -r; j <= r; j++) for (var k = -r; k <= r; k++) {
        if (Math.max(Math.abs(j), Math.abs(k)) !== r) continue;
        var X = X0 + k, Y = Y0 + j; if (X < 0 || Y < 0 || X >= GW || Y >= GH || grid.g[Y * GW + X]) continue;
        var d = j * j + k * k; if (d < bd) { bd = d; best = { x: (X + 0.5) * IW / GW, y: (Y + 0.5) * IH / GH }; }
      }
      if (best) return best;
    }
    return { x: x, y: y };
  }
  function losT(x0, y0, x1, y1) { var n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4); for (var i = 1; i <= n; i++) { var q = i / n; if (!freeAt(x0 + (x1 - x0) * q, y0 + (y1 - y0) * q)) return false; } return true; }
  // A*（八方向、不切牆角）→ 回傳路點；之後每幀用「看得到就跳過」把折線拉直
  function pathTo(sx, sy, tx, ty) {
    if (!grid) return [{ x: tx, y: ty }];
    if (losT(sx, sy, tx, ty)) return [{ x: tx, y: ty }];
    var B = grid.g, n = GW * GH, s = cellY(sy) * GW + cellX(sx), e = cellY(ty) * GW + cellX(tx);
    if (B[e]) return null;
    var gs = new Float32Array(n), from = new Int32Array(n), st = new Uint8Array(n), heap = [], hf = [];
    for (var i = 0; i < n; i++) gs[i] = 1e9;
    var ex = e % GW, ey = (e / GW) | 0;
    var hh = function (c) { var dx = Math.abs(c % GW - ex), dy = Math.abs(((c / GW) | 0) - ey); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    var push = function (c, f) { heap.push(c); hf.push(f); var k = heap.length - 1; while (k > 0) { var p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; var tt = heap[p]; heap[p] = heap[k]; heap[k] = tt; tt = hf[p]; hf[p] = hf[k]; hf[k] = tt; k = p; } };
    var pop = function () { var top = heap[0], li = heap.pop(), lf = hf.pop(); if (heap.length) { heap[0] = li; hf[0] = lf; var k = 0; for (;;) { var l = k * 2 + 1, r2 = l + 1, m = k; if (l < heap.length && hf[l] < hf[m]) m = l; if (r2 < heap.length && hf[r2] < hf[m]) m = r2; if (m === k) break; var tt = heap[m]; heap[m] = heap[k]; heap[k] = tt; tt = hf[m]; hf[m] = hf[k]; hf[k] = tt; k = m; } } return top; };
    gs[s] = 0; from[s] = -1; push(s, hh(s));
    var found = false, it = 0;
    while (heap.length && it++ < 40000) {
      var c = pop(); if (c === e) { found = true; break; } if (st[c]) continue; st[c] = 1;
      var cx = c % GW, cy = (c / GW) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        var ni = ny * GW + nx; if (B[ni] || st[ni]) continue;
        if (dx && dy && (B[cy * GW + nx] || B[ny * GW + cx])) continue;
        var ng = gs[c] + (dx && dy ? 1.414 : 1);
        if (ng < gs[ni]) { gs[ni] = ng; from[ni] = c; push(ni, ng + hh(ni)); }
      }
    }
    if (!found) return null;
    var path = [{ x: tx, y: ty }], cur = from[e];
    while (cur !== s && cur >= 0) { path.push({ x: (cur % GW + 0.5) * IW / GW, y: (((cur / GW) | 0) + 0.5) * IH / GH }); cur = from[cur]; }
    return path.reverse();
  }
  // GM 檢查用：AFK_MOVE.showWalls(true) 把擋住的地方塗紅
  function drawWalls() {
    var map = $('town-npc-map'), cv = $('tw-walls');
    if (!TW.wallsOn || !grid || !map) { if (cv) cv.remove(); return; }
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'tw-walls'; cv.width = GW; cv.height = GH; }
    if (cv.parentNode !== map) map.appendChild(cv);
    var g = cv.getContext('2d'); g.clearRect(0, 0, GW, GH); g.fillStyle = '#f00';
    for (var i = 0; i < GW * GH; i++) if (grid.g[i]) g.fillRect(i % GW, (i / GW) | 0, 1, 1);
  }
  function clampPos() { TW.px = clamp(TW.px, IW * 0.01, IW * 0.99); TW.py = clamp(TW.py, IH * 0.01, IH * 0.99); }
  function enterTown(t) {
    TW.town = t; TW.to = null; TW.path = null; TW.npcPending = null; TW.v = 0;
    buildGrid(t);
    var s = savedPos[t];
    TW.px = (s ? s.x : 0.5) * IW; TW.py = (s ? s.y : 0.82) * IH; clampPos();
    var f = nearestFree(TW.px, TW.py); TW.px = f.x; TW.py = f.y;
    TW.cx = TW.cy = null;
  }
  // 面向防抖：偏離目前方向中心超過 31° 才換
  var DIR_ANG = [-135, -90, -45, 0, 45, 90, 135, 180];
  function faceTo(dx, dy) {
    if (!dx && !dy) return;
    var a = Math.atan2(dy, dx) * 180 / Math.PI, cur = TW.face;
    if (cur != null && Math.abs(((a - DIR_ANG[cur]) % 360 + 540) % 360 - 180) <= 31) return;
    TW.face = vec2dir(dx, dy);
  }
  function savePos() {
    if (!TW.town || !TW.ww) return;
    savedPos[TW.town] = { x: Math.round(TW.px / TW.ww * 1000) / 1000, y: Math.round(TW.py / TW.wh * 1000) / 1000 };
    try { localStorage.setItem(POS_KEY, JSON.stringify(savedPos)); } catch (e) {}
  }
  function ensureMe(map) {
    var me = $('tw-me');
    if (!me) {
      me = document.createElement('div'); me.id = 'tw-me';
      me.innerHTML = '<img class="s" alt="" draggable="false"><img class="b" alt="" draggable="false"><div class="nm"></div>';
      me.querySelector('.s').onerror = function () { this.style.visibility = 'hidden'; };
    }
    if (me.parentNode !== map) map.appendChild(me);
    TW.me = me; return me;
  }
  var mx = {};   // 圖檔缺幀時記下最大可用幀
  function drawMe(now) {
    var map = $('town-npc-map'); if (!map) return;
    var me = ensureMe(map), f = form(); if (!f) return;
    var di = dirInfo(f, TW.face), fi = frameInfo(f, di.key), walking = TW.walking && fi.walk > 0;
    var act = walking ? 'walk' : 'idle', n = walking ? fi.walk : fi.idle;
    var fr = walking ? Math.floor(TW.stride / STRIDE) % n : Math.floor(now / 125) % Math.max(1, n);
    var base = noDir[f.base] ? f.base : di.base, pre = base + (f.wpn ? f.wpn + '_' : '');
    if (walking && mx[pre + 'walk'] === -1) { walking = false; act = 'idle'; n = fi.idle; fr = Math.floor(now / 125) % Math.max(1, n); }   // 這個形態沒有走路圖 → 用待機圖
    var k = pre + act; if (mx[k] != null && fr > mx[k]) fr = mx[k];
    var b = me.querySelector('.b'), s = me.querySelector('.s');
    var src = pre + act + '_' + fr + '.png';
    if (b.getAttribute('src') !== src) { (function (kk, ff, bb) { b.onerror = function () { if (ff === 0 && /walk$/.test(kk)) mx[kk] = -1; else if (ff === 0 && bb !== f.base) noDir[f.base] = true; else mx[kk] = Math.max(0, ff - 1); }; })(k, fr, base); b.setAttribute('src', src); }
    var ss = pre + act + '_s_' + fr + '.png';
    if (fi.shadow) { if (s.getAttribute('src') !== ss) { s.style.visibility = ''; s.setAttribute('src', ss); } } else s.style.visibility = 'hidden';
    var w = 199 * SC, h = 132 * SC;
    [b, s].forEach(function (im) { im.style.width = w + 'px'; im.style.height = h + 'px'; im.style.left = (-w / 2) + 'px'; im.style.top = (-h * 0.86) + 'px'; });
    var bob = (TW.walking && !fi.walk) ? -Math.abs(Math.sin(TW.stride / STRIDE * Math.PI)) * 1.6 : 0;
    me.style.transform = 'translate(' + TW.px.toFixed(1) + 'px,' + (TW.py + bob).toFixed(1) + 'px)';
    me.style.zIndex = String(Math.round(TW.py / TW.wh * 1000));   // 跟 NPC 一樣用 y 排前後（NPC z＝top%×10）
    var nm = me.querySelector('.nm'), name = '';
    try { name = (window.AFK_MP && AFK_MP.me && AFK_MP.me() && AFK_MP.me().name) || player.name || ''; } catch (e) {}
    if (nm.textContent !== name) nm.textContent = name;
    nm.style.top = (-h * 0.86 + 6) + 'px'; nm.style.fontSize = (12 / (TW.z || 1)).toFixed(1) + 'px';
  }
  // 移動：搖桿優先，其次點擊目標。碰撞格擋住就沿牆滑；點地面／NPC 用 A* 繞過建築。
  // 走位平滑：實際前進方向慢慢轉向要去的方向（過轉角是弧線），面向有防抖。
  function moveStep(ux, uy, st) {
    var nx = TW.px + ux * st, ny = TW.py + uy * st;
    if (freeAt(nx, ny)) { TW.px = nx; TW.py = ny; return true; }
    if (Math.abs(ux) > 0.15 && freeAt(nx, TW.py)) { TW.px = nx; return true; }
    if (Math.abs(uy) > 0.15 && freeAt(TW.px, ny)) { TW.py = ny; return true; }
    return false;
  }
  function turn(ux, uy, dt, snap) {
    if (TW.hx == null || snap) { TW.hx = ux; TW.hy = uy; return; }
    var dot = TW.hx * ux + TW.hy * uy, k = Math.min(1, dt * (dot < -0.17 ? 22 : 11));
    var hx = TW.hx + (ux - TW.hx) * k, hy = TW.hy + (uy - TW.hy) * k, l = Math.hypot(hx, hy) || 1;
    TW.hx = hx / l; TW.hy = hy / l;
  }
  function stepMove(dt) {
    var ox = TW.px, oy = TW.py, moved = false;
    if (TW.joy && (TW.joy.dx || TW.joy.dy)) {
      var jl = Math.hypot(TW.joy.dx, TW.joy.dy) || 1, k = Math.min(1, jl), want = SPEED * Math.max(0.35, k);
      TW.to = null; TW.path = null; TW.npcPending = null;
      TW.v = Math.min(want, TW.v + SPEED * dt / ACCEL_T);
      turn(TW.joy.dx / jl, TW.joy.dy / jl, dt, TW.v <= SPEED * 0.15);
      moved = moveStep(TW.hx, TW.hy, TW.v * dt);
    } else if (TW.to) {
      if (!TW.path) { TW.path = pathTo(TW.px, TW.py, TW.to.x, TW.to.y); if (!TW.path) { TW.to = null; TW.walking = false; TW.v = 0; return; } }
      while (TW.path.length > 1 && losT(TW.px, TW.py, TW.path[1].x, TW.path[1].y)) TW.path.shift();
      var wp = TW.path[0], dx = wp.x - TW.px, dy = wp.y - TW.py, d = Math.hypot(dx, dy);
      if (d <= 3) {
        TW.path.shift();
        if (!TW.path.length) { TW.to = null; TW.path = null; TW.walking = false; TW.v = 0; TW.hx = null; arrive(); return; }
        wp = TW.path[0]; dx = wp.x - TW.px; dy = wp.y - TW.py; d = Math.hypot(dx, dy) || 1;
      }
      var last = TW.path.length === 1;
      TW.v = Math.min(SPEED, TW.v + SPEED * dt / ACCEL_T);
      turn(dx / d, dy / d, dt, TW.v <= SPEED * 0.15 || (last && d < 30));
      moved = moveStep(TW.hx, TW.hy, Math.min(last ? d : 1e9, TW.v * dt));
      if (!moved) { TW.stuck = (TW.stuck || 0) + dt; TW.path = null; if (TW.stuck > 0.5) { TW.stuck = 0; TW.to = null; TW.walking = false; TW.v = 0; arrive(); return; } }
      else TW.stuck = 0;
    } else { TW.walking = false; TW.v = 0; TW.hx = null; return; }
    var md = Math.hypot(TW.px - ox, TW.py - oy);
    TW.stride += md;
    if (md > 0.01) {
      var mx2 = (TW.px - ox) / md, my2 = (TW.py - oy) / md, tk = Math.min(1, dt * 10);
      TW.mdx += (mx2 - TW.mdx) * tk; TW.mdy += (my2 - TW.mdy) * tk; faceTo(TW.mdx, TW.mdy);
    }
    TW.walking = md > 0.01;
    if (!TW.walking) TW.v = 0;
  }
  function arrive() {
    savePos();
    var pn = TW.npcPending; TW.npcPending = null; if (!pn) return;
    var map = $('town-npc-map'); if (!map) return;
    var els = map.querySelectorAll('.town-npc'), hit = null;
    for (var i = 0; i < els.length; i++) { var nm = els[i].querySelector('.tn-name'); if (nm && nm.textContent === pn) { hit = els[i]; break; } }
    if (hit) { var fdx = parseFloat(hit.style.left) / 100 * TW.ww - TW.px, fdy = parseFloat(hit.style.top) / 100 * TW.wh - TW.py; TW.face = vec2dir(fdx, fdy); passClick = true; try { hit.click(); } finally { passClick = false; } }
  }
  function camera(dt) {
    var vwI = TW.vw / TW.z, vhI = TW.vh / TW.z;
    var wantCx = clamp(TW.px - vwI / 2, 0, Math.max(0, IW - vwI)), wantCy = clamp(TW.py - vhI * 0.58, 0, Math.max(0, IH - vhI));
    if (TW.cx == null) { TW.cx = wantCx; TW.cy = wantCy; }
    var k = Math.min(1, dt * 6); TW.cx += (wantCx - TW.cx) * k; TW.cy += (wantCy - TW.cy) * k;
    var map = $('town-npc-map'); if (map) map.style.transform = 'translate(' + (-TW.cx * TW.z).toFixed(1) + 'px,' + (-TW.cy * TW.z).toFixed(1) + 'px) scale(' + TW.z.toFixed(4) + ')';
  }
  function townFrame(now, dt) {
    var t = inTown() ? String(mapState.current) : '';
    if (!t) { if (TW.on) { savePos(); unmount(); } return; }
    ensureStyle();
    if (!TW.on || !$('tw-view')) { if (!mount()) return; TW.on = true; document.body.classList.add('tw-on'); TW.ww = 0; TW.wh = 0; }
    if (!layout()) return;
    if (TW.town !== t) enterTown(t);
    else if (grid && !grid.has && window.AFK_TOWN_WALLS && AFK_TOWN_WALLS[townImg(t)]) buildGrid(t);
    stepMove(dt); camera(dt); drawMe(now);
  }
  var passClick = false;
  // 點 NPC：離太遠就先走過去，到了再打開
  document.addEventListener('click', function (e) {
    if (passClick || !TW.on || !e.isTrusted) return;
    if (document.body.classList.contains('gmt-drag')) return;
    var el = e.target.closest && e.target.closest('#town-npc-map .town-npc'); if (!el) return;
    var x = parseFloat(el.style.left) / 100 * TW.ww, y = parseFloat(el.style.top) / 100 * TW.wh;
    if (!isFinite(x) || !isFinite(y)) return;
    if (Math.hypot(x - TW.px, (y + 20) - TW.py) < 80) return;   // 已經在旁邊 → 直接開
    e.stopPropagation(); e.preventDefault();
    var nm = el.querySelector('.tn-name'); TW.npcPending = nm ? nm.textContent : null;
    TW.to = nearestFree(x, y + 20); TW.path = null;
    mark(TW.to.x, TW.to.y, $('town-npc-map'));
  }, true);

  // =====================================================================================
  // ② ③ 點擊移動＋虛擬搖桿（村莊、狩獵共用）
  // =====================================================================================
  var press = null, joyEl = null, JOY_R = 50, HOLD_MS = 500;
  function mark(x, y, host) {
    if (!host) return;
    var m = document.createElement('div'); m.className = 'mv-mark'; m.style.left = x + 'px'; m.style.top = y + 'px';
    if (host.id === 'town-npc-map' && TW.z) { var iz = 1 / TW.z; m.style.width = (22 * iz) + 'px'; m.style.height = (10 * iz) + 'px'; m.style.margin = (-5 * iz) + 'px 0 0 ' + (-11 * iz) + 'px'; m.style.borderWidth = (2 * iz) + 'px'; }
    host.appendChild(m); setTimeout(function () { m.remove(); }, 650);
  }
  function groundTarget(e) {
    var t = e.target;
    if (!t || !t.closest) return null;
    if (t.closest('button,input,select,textarea,a,canvas,label,.town-npc,.mob-target,.op,#tks-btn,#pc-btn,#pc-pan,[onclick],[id^="pp-"],[id^="m-"],[id^="afk-"],[id^="gmt-"]')) return null;
    var tv = t.closest('#tw-view'); if (tv && TW.on) return 'town';
    var bv = t.closest('#battle-view'); if (bv && inBattle()) return 'battle';
    return null;
  }
  function worldPoint(kind, cx, cy) {
    if (kind === 'town') { var r = TW.wrap.getBoundingClientRect(); return { x: (cx - r.left) / TW.z + TW.cx, y: (cy - r.top) / TW.z + TW.cy }; }
    var W = window.__afkWV, br = $('battle-view').getBoundingClientRect(); return { x: cx - br.left + W.cx, y: cy - br.top + W.cy };
  }
  function setJoy(kind, dx, dy) {
    if (kind === 'town') TW.joy = (dx || dy) ? { dx: dx, dy: dy } : null;
    else { var W = window.__afkWV; if (W) W.joy = (dx || dy) ? { dx: dx, dy: dy } : null; }
  }
  function showJoy(x, y) {
    if (!joyEl) { joyEl = document.createElement('div'); joyEl.id = 'mv-joy'; joyEl.innerHTML = '<i></i>'; document.body.appendChild(joyEl); }
    joyEl.style.left = x + 'px'; joyEl.style.top = y + 'px'; joyEl.style.display = 'block';
    joyEl.querySelector('i').style.transform = 'translate(0,0)';
  }
  function hideJoy() { if (joyEl) joyEl.style.display = 'none'; }
  document.addEventListener('pointerdown', function (e) {
    if (e.button && e.button !== 0) return;
    var kind = groundTarget(e); if (!kind) return;
    press = { kind: kind, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, joy: false, t: Date.now() };
    press.timer = setTimeout(function () {
      if (!press || press.moved) return;
      press.joy = true; showJoy(press.x, press.y);
      try { if (navigator.vibrate) navigator.vibrate(15); } catch (er) {}
    }, HOLD_MS);
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!press || e.pointerId !== press.id) return;
    var dx = e.clientX - press.x, dy = e.clientY - press.y, d = Math.hypot(dx, dy);
    if (!press.joy) { if (d > 10) { press.moved = true; clearTimeout(press.timer); } return; }
    e.preventDefault();
    var k = Math.min(1, d / JOY_R), ux = d ? dx / d : 0, uy = d ? dy / d : 0;
    if (joyEl) joyEl.querySelector('i').style.transform = 'translate(' + (ux * k * JOY_R).toFixed(0) + 'px,' + (uy * k * JOY_R).toFixed(0) + 'px)';
    if (d < 8) setJoy(press.kind, 0, 0); else setJoy(press.kind, ux * k, uy * k);
  }, { capture: true, passive: false });
  function endPress(e) {
    if (!press || (e && e.pointerId !== press.id)) return;
    clearTimeout(press.timer);
    var p = press; press = null;
    if (p.joy) { hideJoy(); setJoy(p.kind, 0, 0); return; }
    if (p.moved || !e || e.type === 'pointercancel') return;
    // 點一下：走到那裡
    var w = worldPoint(p.kind, p.x, p.y);
    if (p.kind === 'town') { TW.npcPending = null; TW.to = nearestFree(clamp(w.x, IW * 0.01, IW * 0.99), clamp(w.y, IH * 0.01, IH * 0.99)); TW.path = null; mark(TW.to.x, TW.to.y, $('town-npc-map')); }
    else { var W = window.__afkWV; if (W) { W.manualTo = { x: w.x, y: w.y }; var bv = $('battle-view'); mark(w.x - W.cx, w.y - W.cy, bv); } }
  }
  document.addEventListener('pointerup', endPress, true);
  document.addEventListener('pointercancel', endPress, true);
  // 搖桿按住時避免手機捲動頁面／跳出選單
  document.addEventListener('touchmove', function (e) { if (press && press.joy) e.preventDefault(); }, { passive: false, capture: true });
  document.addEventListener('contextmenu', function (e) { if (press) e.preventDefault(); }, true);

  // =====================================================================================
  // ④ 目前畫面（給 afk-mp：其他玩家、聊天泡泡）
  // =====================================================================================
  window.__afkView = function () {
    if (TW.on && TW.ww) return { kind: 'town', host: $('town-npc-map'), px: TW.px, py: TW.py, ww: TW.ww, wh: TW.wh, cx: 0, cy: 0, walking: TW.walking, sc: SC, me: $('tw-me') };
    var W = window.__afkWV;
    if (W && W.on && W.ww) return { kind: 'battle', host: $('battle-view'), px: W.px, py: W.py, ww: W.ww, wh: W.wh, cx: W.cx, cy: W.cy, walking: W.walking, sc: null, me: $('player-morph-sprite') };
    return null;
  };
  window.AFK_MOVE = { town: TW, showWalls: function (on) { TW.wallsOn = on !== false; drawWalls(); return TW.wallsOn; }, freeAt: freeAt };

  // =====================================================================================
  // ⑤ 日誌時間戳（新出現的每一行加上 [時:分:秒]；afk-mp 的真人聊天用伺服器時間）
  // =====================================================================================
  function hms(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  var FAKE_SEL = '[data-wc-npc-id],.wc-answer,.wc-idle-chat,.wc-trash,.wc-npc';
  function stamp(node) {
    if (!node || node.nodeType !== 1 || node.getAttribute('data-afk-ts')) return;
    if (node.matches && (node.matches(FAKE_SEL) || node.querySelector(FAKE_SEL))) { node.remove(); return; }   // ⑥ 假玩家聊天
    var t = Number(node.getAttribute('data-ts')) || Date.now();
    node.setAttribute('data-afk-ts', '1');
    var s = document.createElement('span'); s.className = 'afk-ts'; s.textContent = '[' + hms(t) + ']';
    node.insertBefore(s, node.firstChild);
  }
  var observed = {};
  function watchLogs() {
    ['combat-log', 'sys-log', 'world-log'].forEach(function (id) {
      var el = $(id); if (!el || observed[id] === el) return;
      observed[id] = el;
      if (id === 'world-log') Array.prototype.slice.call(el.querySelectorAll(FAKE_SEL)).forEach(function (n) { var row = n.closest('#world-log > *') || n; row.remove(); });
      new MutationObserver(function (muts) { muts.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, stamp); }); }).observe(el, { childList: true });
    });
  }

  // =====================================================================================
  // ⑥ 關掉假玩家（世界頻道 NPC）的發話來源
  // =====================================================================================
  var MUTE = ['_wcPostIdleChat', '_wcPostTrashTalk', 'logTrollEncounterTrashTalk', 'logPvpRevengeTrashTalk', '_wcLogOptionalNpcLine'];
  function muteFakes() {
    MUTE.forEach(function (n) { try { if (typeof window[n] === 'function' && !window[n]._mv) { var f = function () {}; f._mv = true; window[n] = f; } } catch (e) {} });
  }

  // =====================================================================================
  var lastT = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016; lastT = now;
    try { townFrame(Date.now(), dt); } catch (e) { if (!loop._err) { loop._err = 1; try { console.warn('[afk-move]', e); } catch (e2) {} } }
  }
  function start() {
    ensureStyle(); muteFakes(); watchLogs();
    setInterval(function () { muteFakes(); watchLogs(); if (TW.on && TW.walking) savePos(); }, 2000);
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
