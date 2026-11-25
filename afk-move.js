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
             to: null, joy: null, stride: 0, v: 0, mdx: 0, mdy: 1, npcPending: null, lastT: 0, wrap: null, me: null };
  var SPEED = 150, SC = 0.62, STRIDE = 17, ACCEL_T = 0.08;
  var POS_KEY = 'afk_tw_pos';
  var savedPos = {}; try { savedPos = JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch (e) {}
  var CSS = [
    '#tw-view{position:relative;overflow:hidden;width:100%;height:clamp(240px,46vh,420px);border-radius:6px;background:#1b160f;touch-action:none;user-select:none;-webkit-user-select:none}',
    'body #tw-view #town-npc-map{display:block!important;position:absolute!important;left:0;top:0;margin:0!important;max-width:none!important;aspect-ratio:auto!important;transform-origin:0 0;will-change:transform}',
    'body.tw-on #afk-npclist{display:none!important}',
    '#tw-me{position:absolute;width:0;height:0;pointer-events:none}',
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
    '.afk-ts{color:#8d8a7e;font-size:.82em;margin-right:4px;font-family:ui-monospace,Consolas,monospace;font-weight:400}',
    /* 聊天泡泡（afk-mp 用） */
    '.mp-bub{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);max-width:180px;padding:3px 7px;border-radius:8px;background:rgba(255,255,255,.94);color:#222;font:600 12px/1.35 "Noto Serif TC",sans-serif;white-space:normal;word-break:break-all;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.45);pointer-events:none;z-index:50;animation:mvMark2 .2s ease-out}',
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
    var wh = Math.max(TW.vh * 2, 420), ww = Math.max(wh * 16 / 9, TW.vw * 1.4);
    if (Math.abs(ww - TW.ww) > 1 || Math.abs(wh - TW.wh) > 1) {
      var kx = TW.ww ? ww / TW.ww : 1, ky = TW.wh ? wh / TW.wh : 1;
      TW.px *= kx; TW.py *= ky; TW.ww = ww; TW.wh = wh;
      map.style.width = ww.toFixed(0) + 'px'; map.style.height = wh.toFixed(0) + 'px';
    }
    return true;
  }
  var Y0 = 0.16, Y1 = 0.97, X0 = 0.03, X1 = 0.97;   // 可走範圍（地圖上緣多半是建築／天空）
  function clampPos() { TW.px = clamp(TW.px, TW.ww * X0, TW.ww * X1); TW.py = clamp(TW.py, TW.wh * Y0, TW.wh * Y1); }
  function enterTown(t) {
    TW.town = t; TW.to = null; TW.npcPending = null; TW.v = 0;
    var s = savedPos[t];
    TW.px = (s ? s.x : 0.5) * TW.ww; TW.py = (s ? s.y : 0.82) * TW.wh; clampPos();
    TW.cx = TW.cy = null;
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
    nm.style.top = (-h * 0.86 + 6) + 'px';
  }
  // 移動：搖桿優先，其次點擊目標；起步加速、到點減速
  function stepMove(dt) {
    var tx = null, ty = null, want = SPEED, stopD = 3;
    if (TW.joy && (TW.joy.dx || TW.joy.dy)) {
      var jl = Math.hypot(TW.joy.dx, TW.joy.dy) || 1, k = Math.min(1, jl);
      want = SPEED * Math.max(0.35, k);
      TW.v = Math.min(want, TW.v + SPEED * dt / ACCEL_T);
      var ux = TW.joy.dx / jl, uy = TW.joy.dy / jl, st = TW.v * dt, ox = TW.px, oy = TW.py;
      TW.px += ux * st; TW.py += uy * st; clampPos();
      TW.stride += Math.hypot(TW.px - ox, TW.py - oy);
      TW.mdx += (ux - TW.mdx) * Math.min(1, dt * 10); TW.mdy += (uy - TW.mdy) * Math.min(1, dt * 10);
      TW.face = vec2dir(TW.mdx, TW.mdy); TW.walking = true; TW.to = null; TW.npcPending = null;
      return;
    }
    if (!TW.to) { TW.walking = false; TW.v = 0; return; }
    tx = TW.to.x; ty = TW.to.y;
    var dx = tx - TW.px, dy = ty - TW.py, d = Math.hypot(dx, dy);
    if (d <= stopD) { TW.to = null; TW.walking = false; TW.v = 0; arrive(); return; }
    want = SPEED;   // 等速走到點、到了就停（不滑行減速）
    TW.v = Math.min(want, TW.v + SPEED * dt / ACCEL_T);
    var s2 = Math.min(d, TW.v * dt), ox2 = TW.px, oy2 = TW.py;
    TW.px += dx / d * s2; TW.py += dy / d * s2; clampPos();
    TW.stride += Math.hypot(TW.px - ox2, TW.py - oy2);
    TW.mdx += (dx / d - TW.mdx) * Math.min(1, dt * 10); TW.mdy += (dy / d - TW.mdy) * Math.min(1, dt * 10);
    TW.face = vec2dir(TW.mdx, TW.mdy); TW.walking = true;
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
    var wantCx = clamp(TW.px - TW.vw / 2, 0, Math.max(0, TW.ww - TW.vw)), wantCy = clamp(TW.py - TW.vh * 0.6, 0, Math.max(0, TW.wh - TW.vh));
    if (TW.cx == null) { TW.cx = wantCx; TW.cy = wantCy; }
    var k = Math.min(1, dt * 8); TW.cx += (wantCx - TW.cx) * k; TW.cy += (wantCy - TW.cy) * k;
    var map = $('town-npc-map'); if (map) map.style.transform = 'translate(' + (-TW.cx).toFixed(1) + 'px,' + (-TW.cy).toFixed(1) + 'px)';
  }
  function townFrame(now, dt) {
    var t = inTown() ? String(mapState.current) : '';
    if (!t) { if (TW.on) { savePos(); unmount(); } return; }
    ensureStyle();
    if (!TW.on || !$('tw-view')) { if (!mount()) return; TW.on = true; document.body.classList.add('tw-on'); TW.ww = 0; TW.wh = 0; }
    if (!layout()) return;
    if (TW.town !== t) enterTown(t);
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
    if (Math.hypot(x - TW.px, (y + 14) - TW.py) < 46) return;   // 已經在旁邊 → 直接開
    e.stopPropagation(); e.preventDefault();
    var nm = el.querySelector('.tn-name'); TW.npcPending = nm ? nm.textContent : null;
    TW.to = { x: x, y: Math.min(TW.wh * Y1, y + 14) };
    mark(TW.to.x, TW.to.y, $('town-npc-map'));
  }, true);

  // =====================================================================================
  // ② ③ 點擊移動＋虛擬搖桿（村莊、狩獵共用）
  // =====================================================================================
  var press = null, joyEl = null, JOY_R = 50, HOLD_MS = 500;
  function mark(x, y, host) {
    if (!host) return;
    var m = document.createElement('div'); m.className = 'mv-mark'; m.style.left = x + 'px'; m.style.top = y + 'px';
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
    if (kind === 'town') { var r = TW.wrap.getBoundingClientRect(); return { x: cx - r.left + TW.cx, y: cy - r.top + TW.cy }; }
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
    if (p.kind === 'town') { TW.npcPending = null; TW.to = { x: clamp(w.x, TW.ww * X0, TW.ww * X1), y: clamp(w.y, TW.wh * Y0, TW.wh * Y1) }; mark(TW.to.x, TW.to.y, $('town-npc-map')); }
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
  window.AFK_MOVE = { town: TW };

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
