/* ============================================================================
 * afk-talkscroll.js — 新道具「說話卷軸」：跟傳送師一樣，選目的地直接瞬移
 *
 * ・道具 id：scroll_talk（卷軸類，所有職業可用，每次傳送消耗 1 張）。
 *   各村莊雜貨商人（有賣瞬間移動卷軸的商人）都會一起賣；GM 自訂 NPC 也能在「卷軸」分類挑它來賣。
 * ・使用：背包點「使用」，或畫面右下的 📜 按鈕 → 跳出目的地清單（城鎮／野外／地監／象牙塔，可搜尋）。
 * ・走遊戲原本的換地圖流程（setMapSelectors＋changeMap），所以原本的進入條件全部照算：
 *   缺鑰匙、試煉未完成、受控（石化／麻痺…）、擔任傭兵中……都會被擋下，被擋下就不扣卷軸。
 * ⚠ 必須在讀檔之前定義道具（本檔在 index.html 跟其他外掛一起載入，早於按「進入遊戲」），
 *   否則存檔裡的說話卷軸可能被當成未知道具。
 * ========================================================================== */
(function () {
  'use strict';
  var ID = 'scroll_talk';

  // ---- 道具定義＋上架 -------------------------------------------------------------
  function defineItem() {
    if (typeof DB === 'undefined' || !DB.items) return false;
    if (!DB.items[ID]) {
      DB.items[ID] = {
        n: '說話卷軸', type: 'scroll', req: 'all', p: 300, c: 'text-amber-300',
        d: '使用後選擇目的地，直接瞬移到各城鎮、野外、地監與象牙塔（每次傳送消耗 1 張；未達進入條件的地方去不了）。',
        eff: 'talk_scroll', gachaWeight: 0, img: 'assets/icons/items/瞬間移動卷軸.png'
      };
    }
    try {
      if (typeof SHOP_LISTS !== 'undefined') for (var k in SHOP_LISTS) {
        var L = SHOP_LISTS[k], at = Array.isArray(L) ? L.indexOf('scroll_teleport') : -1;
        if (at >= 0 && L.indexOf(ID) < 0) L.splice(at + 1, 0, ID);
      }
    } catch (e) {}
    return true;
  }
  defineItem();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    try { if (typeof window.afkToast === 'function') { window.afkToast(msg); return; } } catch (e) {}
    var t = document.createElement('div'); t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:100002;background:rgba(20,14,6,.95);color:#f3d78a;border:1px solid #8a6a2a;padding:8px 14px;border-radius:6px;font:600 14px/1.4 "Noto Serif TC",serif;max-width:88vw;text-align:center';
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function scrollItem() { try { return player.inv.find(function (i) { return i && i.id === ID && (i.cnt || 1) >= 1; }) || null; } catch (e) { return null; } }
  function scrollCount() { try { return player.inv.reduce(function (s, i) { return s + (i && i.id === ID ? (i.cnt || 1) : 0); }, 0); } catch (e) { return 0; } }

  // ---- 目的地 ---------------------------------------------------------------------
  var TABS = [['town', '城鎮'], ['wild', '野外'], ['dungeon', '地監'], ['ivory', '象牙塔']];
  function cat(k) { try { return (MAP_CATEGORIES && MAP_CATEGORIES[k]) || []; } catch (e) { return []; } }
  function visible(m) { try { return !(m.classicHide && player.classicMode); } catch (e) { return true; } }
  function dests(tab) {
    var out = [];
    if (tab === 'town') out = cat('village');
    else if (tab === 'wild') out = cat('wild');
    else if (tab === 'dungeon') out = cat('dungeon').filter(function (m) { return !/象牙塔/.test(m.t); });
    else if (tab === 'ivory') ['village', 'dungeon', 'special', 'wild'].forEach(function (k) { cat(k).forEach(function (m) { if (/象牙塔/.test(m.t)) out.push(m); }); });
    return out.filter(visible);
  }
  function blocked(m) { try { return typeof mapOptDisabled === 'function' && mapOptDisabled(m); } catch (e) { return false; } }

  function travel(v, name) {
    var it = scrollItem();
    if (!it) { toast('沒有說話卷軸（各村莊雜貨商人有賣）'); return false; }
    var before = mapState.current;
    if (before === v) { toast('你已經在「' + name + '」了'); return false; }
    try { setMapSelectors(v); changeMap(); } catch (e) { try { console.warn('[afk-talkscroll]', e); } catch (e2) {} }
    if (mapState.current !== v) {   // 被原本的進入條件擋下 → 不扣卷軸
      try { if (typeof syncMapSelectors === 'function') syncMapSelectors(); } catch (e) {}
      toast('無法前往「' + name + '」（未達進入條件或目前無法行動）');
      return false;
    }
    it = player.inv.find(function (i) { return i && i.uid === it.uid; }) || scrollItem();
    if (it) { if ((it.cnt || 1) > 1) it.cnt -= 1; else player.inv.splice(player.inv.indexOf(it), 1); }
    try { if (typeof playTeleportFx === 'function') playTeleportFx(); } catch (e) {}
    try { logSys('<span class="text-amber-300">📜 你念出說話卷軸上的咒文，瞬間來到了「' + esc(name) + '」。</span>'); } catch (e) {}
    try { if (typeof renderTabs === 'function') renderTabs(true); } catch (e) {}
    try { if (typeof updateUI === 'function') updateUI(); } catch (e) {}
    try { if (typeof saveGame === 'function') saveGame(); } catch (e) {}
    return true;
  }

  // ---- 視窗 -----------------------------------------------------------------------
  var CSS = [
    '#tks-mask{position:fixed;inset:0;z-index:99996;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}',
    '#tks-pan{width:min(96vw,440px);max-height:86vh;display:flex;flex-direction:column;background:linear-gradient(#2a1d0c,#150e05);border:1px solid #9a7a36;border-radius:8px;color:#ecd9a8;font:13px/1.5 "Noto Serif TC","PMingLiU",serif;box-shadow:0 8px 30px rgba(0,0,0,.7)}',
    '#tks-pan h3{margin:0;padding:9px 12px;border-bottom:1px solid #5a4520;color:#ffd77a;font-size:15px;display:flex;justify-content:space-between;align-items:center;gap:8px}',
    '#tks-pan h3 small{color:#cdb47a;font-weight:400;font-size:12px}',
    '#tks-pan .x{background:none;border:0;color:#cdb47a;font-size:20px;cursor:pointer;line-height:1}',
    '#tks-pan .tabs{display:flex;gap:4px;padding:8px 12px 0}',
    '#tks-pan .tabs button{flex:1;padding:6px 0;border:1px solid #6d5426;border-radius:5px;background:#24180a;color:#e8d29a;font:700 13px/1 inherit;cursor:pointer}',
    '#tks-pan .tabs button.on{background:#7a5414;border-color:#e7b54a;color:#fff3c8}',
    '#tks-pan .q{margin:8px 12px 4px;padding:6px 8px;background:#0a0806;border:1px solid #5a4520;border-radius:5px;color:#f0e2bd;font-size:14px}',
    '#tks-pan .list{padding:4px 12px 12px;overflow-y:auto;flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(2,1fr);gap:6px}',
    '#tks-pan .list button{padding:8px 6px;border:1px solid #8a6a2a;border-radius:5px;background:linear-gradient(#3a2a10,#1e1407);color:#ffe3a0;font:600 13px/1.3 inherit;cursor:pointer;text-align:center}',
    '#tks-pan .list button:disabled{opacity:.4;cursor:default}',
    '#tks-pan .list button.here{border-color:#7fb0e8;color:#bfe0ff}',
    '#tks-pan .empty{grid-column:1/-1;color:#8a7a5a;text-align:center;padding:16px 0}',
    '#tks-btn{position:absolute;right:6px;bottom:6px;z-index:70;width:40px;height:40px;border-radius:50%;border:1px solid #b08a3a;background:radial-gradient(circle at 35% 30%,#5a3c12,#1d1206);color:#ffd77a;font:700 18px/38px serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.6);cursor:pointer;display:none}',
    '#tks-btn b{position:absolute;right:-4px;top:-4px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#8a2a1a;color:#fff;font:700 10px/16px sans-serif}',
    '#tks-btn.on{display:block}'
  ].join('\n');
  function ensureStyle() { if ($('afk-tks-style')) return; var s = document.createElement('style'); s.id = 'afk-tks-style'; s.textContent = CSS; document.head.appendChild(s); }
  var curTab = 'town', q = '';
  function close() { var m = $('tks-mask'); if (m) m.remove(); }
  function open() {
    ensureStyle(); close();
    if (!scrollItem()) { toast('沒有說話卷軸（各村莊雜貨商人有賣）'); return; }
    var mask = document.createElement('div'); mask.id = 'tks-mask';
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    var p = document.createElement('div'); p.id = 'tks-pan';
    mask.appendChild(p); document.body.appendChild(mask);
    function draw() {
      var list = dests(curTab).filter(function (m) { return !q || m.t.indexOf(q) >= 0; }), here = mapState.current;
      p.innerHTML = '<h3><span>📜 說話卷軸 <small>剩 ' + scrollCount() + ' 張・每次傳送消耗 1 張</small></span><button class="x" data-x="1">×</button></h3>' +
        '<div class="tabs">' + TABS.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (curTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
        '<input class="q" placeholder="搜尋地點…" value="' + esc(q) + '">' +
        '<div class="list">' + (list.map(function (m) {
          var dis = blocked(m), isHere = m.v === here;
          return '<button data-go="' + esc(m.v) + '" data-n="' + esc(m.t) + '"' + (dis || isHere ? ' disabled' : '') + ' class="' + (isHere ? 'here' : '') + '"' + (m.c && !dis ? ' style="color:' + esc(m.c) + '"' : '') + '>' + esc(m.t) + (isHere ? '<br><small>目前位置</small>' : dis ? '<br><small>未達條件</small>' : '') + '</button>';
        }).join('') || '<div class="empty">沒有符合的地點</div>') + '</div>';
      var qi = p.querySelector('.q');
      qi.oninput = function () { q = qi.value.trim(); var pos = qi.selectionStart; draw(); var n = p.querySelector('.q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    }
    p.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x) { close(); return; }
      if (b.dataset.tab) { curTab = b.dataset.tab; draw(); return; }
      if (b.dataset.go) { if (travel(b.dataset.go, b.dataset.n)) close(); else draw(); }
    });
    draw();
  }

  // ---- 掛到「使用道具」：背包裡按使用＝打開目的地清單 ---------------------------------------
  function hookUse() {
    if (typeof window.useItem !== 'function') return false;
    if (window.useItem._tks) return true;
    var orig = window.useItem;
    var w = function (uidv) {
      try {
        var it = player && player.inv && player.inv.find(function (i) { return i && i.uid === uidv; });
        if (it && it.id === ID) { open(); return; }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    w._tks = true; window.useItem = w; return true;
  }
  // 按鈕放在目前看得到的戰鬥畫面／村莊畫面右下角（跟著畫面走，不會蓋到聊天列、送出鈕）
  function anchorEl() {
    var bv = $('battle-view'), tv = $('town-view');
    if (bv && !bv.classList.contains('hidden') && bv.offsetHeight > 60) return bv;
    if (tv && !tv.classList.contains('hidden') && tv.offsetHeight > 60) return tv;
    return null;
  }
  function dock(b) {
    var a = anchorEl(); if (!a) return false;
    if (b.parentNode !== a) { try { if (getComputedStyle(a).position === 'static') a.style.position = 'relative'; } catch (e) {} a.appendChild(b); }
    return true;
  }
  // 📜 快捷鈕：背包有說話卷軸才出現（右上角數字＝剩幾張）
  function ensureBtn() {
    var b = $('tks-btn');
    if (!b) { ensureStyle(); b = document.createElement('div'); b.id = 'tks-btn'; b.title = '說話卷軸'; b.innerHTML = '📜<b></b>'; b.addEventListener('click', open); document.body.appendChild(b); }
    var n = 0, inGame = false;
    try { inGame = !!(player && player.inv && mapState && mapState.current); n = inGame ? scrollCount() : 0; } catch (e) {}
    var title = $('btn-start-menu'), onTitle = !!(title && title.offsetParent);
    var docked = dock(b);
    b.classList.toggle('on', n > 0 && !onTitle && docked);
    var c = b.querySelector('b'); if (c && c.textContent !== String(n)) c.textContent = String(n);
  }
  window.AFK_TALKSCROLL = { id: ID, open: open, travel: travel };
  function start() {
    defineItem();
    var tries = 0;
    (function w() { if (!hookUse() && ++tries < 40) setTimeout(w, 250); })();
    setInterval(function () { defineItem(); hookUse(); ensureBtn(); }, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
