/* ============================================================================
 * afk-mp.js — 多人連線加強包（掛在 afk-online.js 的 Firebase 登入上）
 *
 * afk-online.js 負責：帳號登入／申請、在線名單、世界聊天面板、面對面交易（託管）、交易所。
 * 本檔加上（登入後才啟用；沒登入完全不動作）：
 *   ・聊天框（古金風聊天框「世界」分頁／#world-log）直接收發線上聊天：左邊標籤點一下切換「世界／地圖」。
 *     世界＝afk-online 的 /chat（面板裡也看得到），地圖＝/mchat/<地圖>（同地圖的人才看得到）。
 *   ・同地圖看得到其他玩家：在大地圖（afk-walkview）上畫出他們的角色與名字；位置每秒最多同步一次、沒動就 15 秒一次，
 *     分頁隱藏時不送（省 Firebase 流量）。點別人的角色或聊天裡的名字 → 選單：交易（走 afk-online 的託管交易）／決鬥。
 *   ・決鬥（PVP）：同一張狩獵地圖發起 → 對方接受 → 雙方交換「對戰名片」，各自用原本的決鬥競技場（js/28）開打，不掉裝不給經驗。
 *   ・跑馬燈：有人上線／下線時畫面上方捲動通知（/events）。
 *   ・GM 設定（afk-gm.js 的怪物倍數）存在 /config/gm，所有登入的玩家（含離線結算）吃同一份；只有 /admins/<uid>=true 的帳號能改。
 * ⚠ 存檔仍在各自瀏覽器：擋不住會改存檔的人，適合朋友間遊玩。
 * ========================================================================== */
(function () {
  'use strict';

  var CH_KEY = 'afk_mp_ch';
  var fb = null, auth = null, db = null, me = null, myName = '', isAdmin = false;
  var subs = [], roomSubs = {}, mapSub = null, posSub = null, curMap = null;
  var others = {};           // 同地圖其他玩家 uid → { d, el, x, y, maxF }
  var channel = 'w';
  try { if (localStorage.getItem(CH_KEY) === 'm') channel = 'm'; } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) { ensureStyle(); var t = document.createElement('div'); t.className = 'mp-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  function mapName(id) { try { return (typeof mapDisplayName === 'function' && mapDisplayName(id)) || id; } catch (e) { return id; } }
  function curMapId() { try { return String(mapState.current || ''); } catch (e) { return ''; } }
  function inGame() { var g = $('game-screen'); return !!(g && !g.classList.contains('hidden') && typeof player !== 'undefined' && player && player.cls); }
  function srvTs() { return fb.database.ServerValue.TIMESTAMP; }
  function errText(e) { return (e && e.code === 'PERMISSION_DENIED') ? '伺服器拒絕（權限不足）' : ((e && e.message) || String(e)); }

  // ---- CSS ----------------------------------------------------------------------
  var CSS = [
    '.mp-toast{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:100001;background:rgba(20,14,6,.95);color:#f3d78a;border:1px solid #8a6a2a;padding:8px 14px;border-radius:6px;font:600 14px/1.4 "Noto Serif TC",serif;box-shadow:0 4px 14px rgba(0,0,0,.6);max-width:86vw;text-align:center}',
    '#mp-mask{position:fixed;inset:0;z-index:99996;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}',
    '.mp-pan{width:min(92vw,360px);background:linear-gradient(#2a1d0c,#150e05);border:1px solid #9a7a36;border-radius:8px;color:#ecd9a8;font:13px/1.5 "Noto Serif TC","PMingLiU",serif;box-shadow:0 8px 30px rgba(0,0,0,.7)}',
    '.mp-pan h3{margin:0;padding:9px 12px;border-bottom:1px solid #5a4520;color:#ffd77a;font-size:15px;display:flex;justify-content:space-between;align-items:center}',
    '.mp-pan .b{padding:10px 12px}',
    '.mp-pan .x{background:none;border:0;color:#cdb47a;font-size:20px;cursor:pointer;line-height:1}',
    '.mp-pan .foot{display:flex;gap:8px;padding:8px 12px;border-top:1px solid #5a4520}',
    '.mp-pan .foot button{flex:1;padding:8px 0;border:1px solid #8a6a2a;border-radius:5px;background:linear-gradient(#4a3514,#241808);color:#ffe3a0;font:700 14px/1 inherit;cursor:pointer}',
    '.mp-pan .foot button.sub{background:#1c140a;color:#cdb47a}',
    '.mp-pan .foot button:disabled{opacity:.4;cursor:default}',
    '#mp-marquee{position:fixed;left:0;right:0;top:0;z-index:99997;height:22px;overflow:hidden;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(40,26,6,.88) 15%,rgba(40,26,6,.88) 85%,rgba(0,0,0,0));display:none}',
    '#mp-marquee span{position:absolute;white-space:nowrap;top:2px;left:100%;color:#ffe39a;font:700 13px/18px "Noto Serif TC",serif;text-shadow:0 1px 2px #000;animation:mpMq 9s linear forwards}',
    '@keyframes mpMq{from{transform:translateX(0)}to{transform:translateX(calc(-100vw - 100%))}}',
    '.mp-msg .mp-ch{color:#8fd0ff}.mp-msg.m .mp-ch{color:#9fe870}.mp-msg .mp-n{color:#ffd77a;font-weight:700;cursor:pointer}',
    '#mp-others{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
    '#mp-others .op{position:absolute;left:0;top:0;width:96px;height:96px;transform-origin:50% 86%;pointer-events:auto;cursor:pointer}',
    '#mp-others .op img{width:96px;height:96px;object-fit:contain}',
    '#mp-others .op b{position:absolute;left:50%;top:-4px;transform:translateX(-50%);white-space:nowrap;font:700 12px/1 "Noto Serif TC",serif;color:#9fe0ff;text-shadow:0 0 2px #000,0 0 2px #000}'
  ].join('\n');
  function ensureStyle() { if ($('afk-mp-style')) return; var s = document.createElement('style'); s.id = 'afk-mp-style'; s.textContent = CSS; document.head.appendChild(s); }

  // ---- 等 afk-online.js 把 Firebase 載好，跟著它的登入狀態走 -------------------------------
  var hooked = false;
  function tryHook() {
    if (hooked) return;
    var F = window.firebase; if (!F || !F.apps || !F.apps.length || !F.auth || !F.database) return;
    hooked = true; fb = F; auth = fb.auth(); db = fb.database();
    auth.onAuthStateChanged(onAuth);
  }
  function onAuth(u) {
    teardown();
    me = u || null; myName = ''; isAdmin = false;
    if (!me) return;
    var uid = me.uid;
    readName(uid, 5).then(function (nm) {
      if (!me || me.uid !== uid) return;
      myName = nm || '玩家';
      return db.ref('admins/' + uid).once('value').then(function (a) { isAdmin = a.val() === true; }, function () {});
    }).then(startSession).catch(function () {});
  }
  // 剛註冊完的那一刻名字還沒寫進資料庫 → 等一下再讀（最多約 7 秒）
  function readName(uid, n) {
    return db.ref('users/' + uid + '/name').once('value').then(function (s) {
      if (s.val() || n <= 0) return s.val();
      return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return readName(uid, n - 1); });
    });
  }
  var evtOutRef = null;
  function startSession() {
    if (!me) return;
    var uid = me.uid;
    var conn = db.ref('.info/connected');
    var onConn = function (s) {
      if (s.val() !== true) return;
      evtOutRef = db.ref('events').push();
      evtOutRef.onDisconnect().set({ uid: uid, name: myName, type: 'out', ts: srvTs() });
      db.ref('events').push({ uid: uid, name: myName, type: 'in', ts: srvTs() });
      if (curMap) db.ref('pos/' + curMap + '/' + uid).onDisconnect().remove();
    };
    conn.on('value', onConn); subs.push(function () { conn.off('value', onConn); });
    // 跑馬燈
    var er = db.ref('events').orderByChild('ts').startAt(Date.now() - 5000);
    var onE = function (s) { var v = s.val(); if (!v || v.uid === uid) return; marquee('📢 ' + v.name + (v.type === 'in' ? ' 上線了' : ' 下線了')); };
    er.on('child_added', onE); subs.push(function () { er.off('child_added', onE); });
    // 世界聊天（afk-online 的 /chat）→ 也顯示在遊戲內聊天框
    var wr = db.ref('chat').orderByChild('t').limitToLast(20);
    var onW = function (s) { var v = s.val(); if (v) showMsg('w', v); };
    wr.on('child_added', onW); subs.push(function () { wr.off('child_added', onW); });
    // 決鬥邀請
    var ib = db.ref('pvpinv/' + uid);
    var onI = function (s) { var v = s.val(); s.ref.remove(); if (v) onDuelInvite(v); };
    ib.on('child_added', onI); subs.push(function () { ib.off('child_added', onI); });
    // GM 設定
    var gr = db.ref('config/gm');
    var onG = function (s) { var v = s.val(); if (v && window.AFK_GM) { applyingRemote = true; try { AFK_GM.applyRemote(v); } finally { applyingRemote = false; } } };
    gr.on('value', onG); subs.push(function () { gr.off('value', onG); });
  }
  function teardown() {
    subs.forEach(function (f) { try { f(); } catch (e) {} }); subs = [];
    if (mapSub) { try { mapSub(); } catch (e) {} mapSub = null; }
    if (posSub) { try { posSub(); } catch (e) {} posSub = null; }
    try { if (me && curMap) db.ref('pos/' + curMap + '/' + me.uid).remove(); } catch (e) {}
    try { if (evtOutRef) { evtOutRef.onDisconnect().cancel(); if (me) db.ref('events').push({ uid: me.uid, name: myName, type: 'out', ts: srvTs() }); } } catch (e) {}
    evtOutRef = null; curMap = null;
    Object.keys(others).forEach(dropOther);
  }

  // GM 面板：管理員改倍數 → 寫伺服器；一般玩家的修改只在沒登入時有效
  var applyingRemote = false;
  window.addEventListener('afk-gm-change', function (e) {
    if (applyingRemote || !me || !db) return;
    if (!isAdmin) { toast('登入時以伺服器的 GM 設定為準，你的修改只在沒登入時有效'); return; }
    var k = e.detail && e.detail.key; if (!k) return;
    db.ref('config/gm/' + k).set(e.detail.value).catch(function (er) { toast('GM 設定寫入失敗：' + errText(er)); });
  });

  // ---- 聊天：遊戲內聊天框收發 ---------------------------------------------------------
  function showMsg(room, v) {
    var log = $('world-log'); if (!log) return;
    var d = document.createElement('div');
    d.className = 'mp-msg' + (room === 'w' ? '' : ' m');
    if (v.t) d.setAttribute('data-ts', String(v.t));   // afk-move 的時間戳用伺服器時間
    d.innerHTML = '<span class="mp-ch">[' + (room === 'w' ? '世界' : '地圖') + ']</span> <span class="mp-n" data-uid="' + esc(v.uid) + '">' + esc(v.name) + '</span>：' + esc(v.text);
    log.appendChild(d);
    if (!v.t || Date.now() - v.t < 15000) { try { bubble(v.uid, v.text); } catch (e) {} }   // 剛說的話 → 頭上冒泡泡
    while (log.children.length > 200) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  var lastSend = 0;
  function sendChat(text) {
    text = String(text || '').trim().slice(0, 100); if (!text || !me) return false;
    if (Date.now() - lastSend < 1500) { toast('說太快了，等一下'); return false; }
    lastSend = Date.now();
    var path = (channel === 'm' && curMap) ? 'mchat/' + curMap : 'chat';
    if (channel === 'm' && !curMap) toast('還沒進入地圖，先送到世界頻道');
    db.ref(path).push({ uid: me.uid, name: myName, text: text, t: srvTs() }).catch(function (e) { toast('送出失敗：' + errText(e)); });
    return true;
  }
  // 攔截原本世界頻道的送出（登入中才攔；沒登入照舊是 NPC 問答）
  document.addEventListener('click', function (e) {
    if (!me) return;
    var b = e.target.closest && e.target.closest('#world-send'); if (!b) return;
    var i = $('world-input'); if (!i) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (sendChat(i.value)) i.value = '';
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!me || e.key !== 'Enter' || !e.target || e.target.id !== 'world-input') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (sendChat(e.target.value)) e.target.value = '';
  }, true);
  // 點聊天框的頻道標籤（古金風 .pp-ch）切換世界／地圖；點訊息上的名字 → 玩家選單
  document.addEventListener('click', function (e) {
    if (!me) return;
    var ch = e.target.closest && e.target.closest('#pp-chat .pp-ch');
    if (ch) { channel = channel === 'w' ? 'm' : 'w'; try { localStorage.setItem(CH_KEY, channel); } catch (e2) {} syncChLabel(); return; }
    var n = e.target.closest && e.target.closest('.mp-n[data-uid]');
    if (n) openPlayer(n.getAttribute('data-uid'), n.textContent);
  });
  function syncChLabel() {
    var ch = document.querySelector('#pp-chat .pp-ch'), inp = document.querySelector('#pp-chat .pp-in input');
    var want = !me ? '世界' : (channel === 'm' ? '地圖' : '世界');
    if (ch && ch.textContent !== want) { ch.textContent = want; ch.style.cursor = me ? 'pointer' : ''; ch.title = me ? '點一下切換世界／地圖頻道' : ''; }
    if (inp) { var ph = !me ? '輸入聊天（送到世界頻道）' : (channel === 'm' ? '地圖頻道（同地圖的人看得到）' : '世界頻道（全部線上玩家）'); if (inp.placeholder !== ph) inp.placeholder = ph; }
  }

  // ---- 地圖切換：地圖頻道、位置同步 --------------------------------------------------
  function checkMap() {
    if (!me || !db) return;
    var m = inGame() ? curMapId() : '';
    if ((m || null) === curMap) return;
    var uid = me.uid;
    if (curMap) { try { db.ref('pos/' + curMap + '/' + uid).onDisconnect().cancel(); db.ref('pos/' + curMap + '/' + uid).remove(); } catch (e) {} }
    if (mapSub) { mapSub(); mapSub = null; }
    if (posSub) { posSub(); posSub = null; }
    Object.keys(others).forEach(dropOther);
    curMap = m || null; lastPos = '';
    if (!curMap) return;
    var mr = db.ref('mchat/' + curMap).orderByChild('t').startAt(Date.now() - 600000).limitToLast(15);
    var onM = function (s) { var v = s.val(); if (v) showMsg('m', v); };
    mr.on('child_added', onM); mapSub = function () { mr.off('child_added', onM); };
    db.ref('pos/' + curMap + '/' + uid).onDisconnect().remove();
    var pr = db.ref('pos/' + curMap);
    var onAdd = function (s) { if (s.key !== uid) upOther(s.key, s.val()); };
    var onRm = function (s) { dropOther(s.key); };
    pr.on('child_added', onAdd); pr.on('child_changed', onAdd); pr.on('child_removed', onRm);
    posSub = function () { pr.off('child_added', onAdd); pr.off('child_changed', onAdd); pr.off('child_removed', onRm); };
  }
  var lastPos = '', lastPosT = 0;
  function pushPos() {
    if (!me || !curMap || document.hidden) return;
    var W = afkView(); if (!W || !W.ww) return;
    var now = Date.now(); if (now - lastPosT < 1000) return;
    var form = null; try { form = _playerBattleForm(); } catch (e) {}
    var d = { x: Math.round(W.px / W.ww * 10000) / 10000, y: Math.round(W.py / W.wh * 10000) / 10000, w: W.walking ? 1 : 0, n: myName,
              b: form ? form.base : '', k: form ? (form.wpn || '') : '', lv: (player && player.lv) | 0, t: srvTs() };
    var sig = d.x + ',' + d.y + ',' + d.w + ',' + d.b + ',' + d.k;
    if (sig === lastPos && now - lastPosT < 15000) return;   // 沒動就 15 秒才送一次（心跳）
    lastPos = sig; lastPosT = now;
    db.ref('pos/' + curMap + '/' + me.uid).set(d).catch(function () {});
  }

  // ---- 畫出同地圖的其他玩家 ------------------------------------------------------------
  function upOther(uid, d) {
    if (!d) return dropOther(uid);
    var o = others[uid] || (others[uid] = { d: d, el: null, x: null, y: null, maxF: {} });
    o.d = d;
  }
  function dropOther(uid) { var o = others[uid]; if (o && o.el) o.el.remove(); delete others[uid]; }
  // 目前畫面：村莊（afk-move 的村莊地圖）或狩獵（afk-walkview）；座標都是世界座標
  function afkView() {
    try { if (typeof window.__afkView === 'function') return window.__afkView(); } catch (e) {}
    var W = window.__afkWV; return (W && W.on && W.ww) ? { host: $('battle-view'), px: W.px, py: W.py, ww: W.ww, wh: W.wh, cx: W.cx, cy: W.cy, walking: W.walking, sc: null, me: $('player-morph-sprite') } : null;
  }
  // 聊天泡泡：說話的人在同一張地圖、畫面看得到 → 頭上顯示 6 秒
  function bubble(uid, text) {
    var V = afkView(); if (!V) return;
    var el = (me && uid === me.uid) ? V.me : (others[uid] && others[uid].el);
    if (!el) return;
    var old = el.querySelector(':scope > .mp-bub'); if (old) old.remove();
    var b = document.createElement('div'); b.className = 'mp-bub'; b.textContent = String(text || '').slice(0, 60);
    var sc = V.sc || parseFloat(getComputedStyle(V.host).getPropertyValue('--wv-sc')) || 1;
    if (el.id === 'tw-me') b.style.bottom = Math.round(132 * sc * 0.86 + 16) + 'px';
    else b.style.fontSize = (12 / sc).toFixed(1) + 'px';
    el.appendChild(b);
    clearTimeout(el._bubT); el._bubT = setTimeout(function () { b.remove(); }, 6000);
  }
  function drawOthers() {
    var W = afkView(), bv = W && W.host, layer = $('mp-others');
    if (!W || !bv || !W.ww || !Object.keys(others).length) { if (layer) layer.style.display = 'none'; return; }
    ensureStyle();
    if (!layer) { layer = document.createElement('div'); layer.id = 'mp-others'; }
    if (layer.parentNode !== bv) bv.appendChild(layer);
    layer.style.display = '';
    var sc = W.sc || parseFloat(getComputedStyle(bv).getPropertyValue('--wv-sc')) || 1, now = Date.now();
    Object.keys(others).forEach(function (uid) {
      var o = others[uid], d = o.d;
      var tx = d.x * W.ww, ty = d.y * W.wh;
      if (o.x == null || Math.hypot(tx - o.x, ty - o.y) > 400) { o.x = tx; o.y = ty; }
      o.x += (tx - o.x) * 0.08; o.y += (ty - o.y) * 0.08;   // 一秒一筆 → 平滑內插
      var moving = Math.hypot(tx - o.x, ty - o.y) > 2 || d.w;
      if (!o.el) {
        o.el = document.createElement('div'); o.el.className = 'op';
        o.el.innerHTML = '<img alt=""><b></b>';
        o.el.addEventListener('click', function () { openPlayer(uid, (others[uid] && others[uid].d.n) || ''); });
        layer.appendChild(o.el);
      }
      var nm = o.el.querySelector('b'), lbl = d.n + (d.lv ? ' Lv' + d.lv : ''); if (nm.textContent !== lbl) nm.textContent = lbl;
      var img = o.el.querySelector('img');
      if (d.b) {
        var act = moving ? 'walk' : 'idle', key = d.b + '|' + d.k + '|' + act;
        if (o.maxF[key] === -1) { act = 'idle'; key = d.b + '|' + d.k + '|idle'; }
        var mx = o.maxF[key] != null ? Math.max(0, o.maxF[key]) : 7;
        var f = Math.floor(now / 125) % (mx + 1);
        var src = d.b + (d.k ? d.k + '_' : '') + act + '_' + f + '.png';
        if (img.getAttribute('src') !== src) {
          (function (k2, f2) { img.onerror = function () { o.maxF[k2] = f2 > 0 ? f2 - 1 : -1; }; })(key, f);
          img.setAttribute('src', src);
        }
      }
      o.el.style.transform = 'translate(' + (o.x - W.cx - 48).toFixed(1) + 'px,' + (o.y - W.cy - 82).toFixed(1) + 'px) scale(' + sc.toFixed(2) + ')';
      o.el.style.zIndex = String(10 + Math.round(o.y / 4));
    });
  }

  // ---- 玩家選單 ----------------------------------------------------------------------
  function closeMask() { var m = $('mp-mask'); if (m) m.remove(); }
  function modal(html) {
    closeMask(); ensureStyle();
    var mask = document.createElement('div'); mask.id = 'mp-mask';
    mask.addEventListener('click', function (e) { if (e.target === mask) closeMask(); });
    var p = document.createElement('div'); p.className = 'mp-pan'; p.innerHTML = html;
    mask.appendChild(p); document.body.appendChild(mask);
    p.addEventListener('click', function (e) { if (e.target.closest('.x')) closeMask(); });
    return p;
  }
  function openPlayer(uid, name) {
    if (!me || uid === me.uid) return;
    var here = !!others[uid], hunt = here && !/^town_/.test(curMapId());
    var p = modal('<h3>' + esc(name) + '<button class="x">×</button></h3><div class="b">' + (here ? '跟你在同一張地圖。' : '不在你這張地圖（同地圖才能決鬥；交易不限地圖）。') + '</div>' +
      '<div class="foot"><button data-a="t">交易</button><button data-a="p"' + (hunt ? '' : ' disabled') + '>決鬥</button></div>');
    p.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled || !b.dataset.a) return;
      closeMask();
      if (b.dataset.a === 't') {
        if (typeof window.__afkOnlineInvite === 'function') window.__afkOnlineInvite(uid);
        else toast('請從右下「💬 線上」面板的在線名單發起交易');
      } else startDuel(uid, name);
    });
  }

  // ---- 決鬥 --------------------------------------------------------------------------
  // pvp/<id>: { a, b, an, bn, map, st: ask|go|no, card: {a, b} }；邀請放 pvpinv/<對方 uid>/<push id>
  var duelRef = null, duelOff = null;
  function myCard() { try { return pvpCardEncode(pvpCardBuild()); } catch (e) { return ''; } }
  function startDuel(uid, name) {
    if (!me) return;
    if (typeof pvpCardBuild !== 'function' || typeof pvpArenaStart !== 'function') return toast('這個版本沒有決鬥系統');
    var ref = db.ref('pvp').push();
    ref.set({ a: me.uid, b: uid, an: myName, bn: name || '?', map: curMapId(), st: 'ask', ts: srvTs() })
      .then(function () { return db.ref('pvpinv/' + uid).push({ id: ref.key, from: me.uid, fromName: myName, ts: Date.now() }); })
      .then(function () { toast('已向 ' + (name || '對方') + ' 發起決鬥，等對方接受…'); watchDuel(ref.key, 'a'); })
      .catch(function (e) { toast('決鬥失敗：' + errText(e)); });
  }
  function onDuelInvite(v) {
    if (Date.now() - (v.ts || 0) > 120000) return;   // 太舊的邀請不理
    var q = modal('<h3>決鬥挑戰<button class="x">×</button></h3><div class="b"><b style="color:#ffd77a">' + esc(v.fromName) + '</b> 向你發起決鬥！（不掉裝、不給經驗，只記榮譽戰績）</div>' +
      '<div class="foot"><button data-a="y">接受</button><button class="sub" data-a="n">拒絕</button></div>');
    q.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !b.dataset.a) return;
      closeMask();
      if (b.dataset.a === 'n') { db.ref('pvp/' + v.id + '/st').set('no'); return; }
      var c = myCard(); if (!c) return toast('產生對戰名片失敗');
      db.ref('pvp/' + v.id).update({ st: 'go', 'card/b': c }).then(function () { watchDuel(v.id, 'b'); }).catch(function (er) { toast(errText(er)); });
    });
  }
  function watchDuel(id, side) {
    if (duelRef && duelOff) duelRef.off('value', duelOff);
    duelRef = db.ref('pvp/' + id); var started = false, sentCard = side === 'b';
    duelOff = function (s) {
      var v = s.val(); if (!v) return;
      if (v.st === 'no') { toast((side === 'a' ? v.bn : v.an) + ' 拒絕了決鬥'); duelRef.off('value', duelOff); return; }
      if (v.st !== 'go') return;
      if (!sentCard) { sentCard = true; duelRef.child('card/a').set(myCard()); }
      var oc = v.card && v.card[side === 'a' ? 'b' : 'a'];
      if (oc && !started) {
        started = true; duelRef.off('value', duelOff);
        var dec = null; try { dec = pvpCardDecode(oc); } catch (e) {}
        if (!dec || !dec.card) return toast('對方的對戰名片讀不出來');
        dec.card.n = side === 'a' ? v.bn : v.an;
        toast('⚔️ 決鬥開始！');
        try { pvpArenaStart(dec.card); } catch (e) { toast('開始決鬥失敗：' + e.message); }
      }
    };
    duelRef.on('value', duelOff);
  }

  // ---- 跑馬燈 ------------------------------------------------------------------------
  var mqQ = [], mqBusy = false;
  function marquee(text) {
    ensureStyle();
    mqQ.push(text); if (mqBusy) return;
    var next = function () {
      var t = mqQ.shift(), bar = $('mp-marquee');
      if (!t) { mqBusy = false; if (bar) bar.style.display = 'none'; return; }
      mqBusy = true;
      if (!bar) { bar = document.createElement('div'); bar.id = 'mp-marquee'; document.body.appendChild(bar); }
      bar.style.display = 'block'; bar.textContent = '';
      var s = document.createElement('span'); s.textContent = t; bar.appendChild(s);
      s.addEventListener('animationend', next);
    };
    next();
  }

  // ---- 主迴圈 ------------------------------------------------------------------------
  function loopSlow() { try { tryHook(); syncChLabel(); checkMap(); pushPos(); } catch (e) {} }
  function loopFast() { try { if (me) drawOthers(); } catch (e) {} requestAnimationFrame(loopFast); }
  function start() {
    setInterval(loopSlow, 500);
    requestAnimationFrame(loopFast);
    window.addEventListener('beforeunload', function () { try { if (me && curMap) db.ref('pos/' + curMap + '/' + me.uid).remove(); } catch (e) {} });
  }
  window.AFK_MP = { me: function () { return me && { uid: me.uid, name: myName, admin: isAdmin }; }, send: sendChat, others: function () { return others; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
