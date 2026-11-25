/* ============================================================================
 * afk-gmtown.js — GM 自訂村莊 NPC（商店）與雕像（祈禱增加屬性）
 *
 * GM 面板（afk-gm.js）多兩顆按鈕：「NPC 管理」「雕像管理」。
 *   ・NPC：名稱、職稱、外觀；販售清單＝GM 挑的裝備／藥水／卷軸／魔法娃娃＋各自售價，之後可再編輯。
 *     每個村莊都會出現（玩家點它＝打開商店，用金幣購買）。
 *   ・雕像：名稱、要加哪些屬性、加多少、持續幾分鐘。玩家點雕像「祈禱」＝獲得那段時間的屬性加成
 *     （用遊戲本身的增益系統：狀態欄看得到、時間到自動結束、離線結算照算；持續中不能重複祈禱）。
 *   ・位置：管理視窗按「拖曳調整位置」→ 在村莊地圖上用滑鼠或手指拖 NPC／雕像，放開就存（每個村莊各存一份）。
 *     有開「NPC 條列式」時，拖曳模式會暫時換回地圖。
 * 設定存在伺服器 /config/town（所有玩家共用；任何人都能讀，只有 /admins 裡的 GM 帳號能寫），本機 localStorage 留一份快取。
 * GM 沒登入 GM 帳號時，修改只存在這台裝置（面板上會標示）。
 * ⚠ 本檔必須排在 afk-npclist.js 之前載入：npclist 包 renderTownNPCMap 時才會連我們加的 NPC 一起做成條列。
 * ========================================================================== */
(function () {
  'use strict';

  var LS_KEY = 'afk_gmtown';
  var cfg = { npcs: {}, statues: {} };
  var dbUrl = '';
  var dragMode = false;

  // 雕像可加的屬性（key＝遊戲增益系統 DB.skills[x].d 認得的欄位）
  var STATS = [
    ['str', '力量'], ['dex', '敏捷'], ['con', '體質'], ['int', '智力'], ['wis', '精神'], ['cha', '魅力'],
    ['ac', '防禦 AC（正數＝變強）'], ['mr', '魔法防禦'], ['er', '迴避'], ['dr', '傷害減免'],
    ['meleeDmg', '近距離傷害'], ['meleeHit', '近距離命中'], ['rangedDmg', '遠距離傷害'], ['rangedHit', '遠距離命中'],
    ['magicDmg', '魔法傷害'], ['extraDmg', '額外傷害'], ['extraHit', '額外命中'], ['mpR', 'MP 回復']
  ];
  var STAT_NAME = {}; STATS.forEach(function (s) { STAT_NAME[s[0]] = s[1].replace(/（.*/, ''); });
  var NPC_LOOKS = ['1256', '1307', '1305', '1049', '1254', '1222', '1768', '918', '916', '920', '914', '727', '864', '98', '949', '100', '457', '460', '902', '866', '237', '1045'];
  var CATS = [['eq', '裝備'], ['pot', '藥水'], ['scroll', '卷軸'], ['doll', '魔法娃娃']];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    var t = document.createElement('div'); t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:100002;background:rgba(20,14,6,.95);color:#f3d78a;border:1px solid #8a6a2a;padding:8px 14px;border-radius:6px;font:600 14px/1.4 "Noto Serif TC",serif;max-width:88vw;text-align:center';
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2800);
  }
  function uid() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function isGM() { return !!(window.AFK_GM && AFK_GM.isGM && AFK_GM.isGM()); }
  function items() { return (typeof DB !== 'undefined' && DB.items) || {}; }
  function itemCat(id) {
    var d = items()[id]; if (!d) return null;
    if (d.doll || d.slot === 'doll' || d.dollBox || id === 'doll_bag' || id === 'doll_box_high') return 'doll';   // 娃娃寶箱／娃娃袋子也放在「魔法娃娃」分類
    if (d.type === 'scroll' || /卷軸/.test(d.n || '')) return 'scroll';
    if (d.type === 'heal' || d.type === 'pot') return 'pot';
    if (d.type === 'wpn' || d.type === 'arm' || d.type === 'acc') return 'eq';
    return null;
  }
  function curTown() { try { var c = String(mapState.current || ''); return /^town_/.test(c) ? c : ''; } catch (e) { return ''; } }

  // ---- 設定：讀寫 --------------------------------------------------------------------
  function norm(c) {
    c = c || {}; var o = { npcs: {}, statues: {} };
    Object.keys(c.npcs || {}).forEach(function (k) {
      var n = c.npcs[k]; if (!n) return;
      var its = Array.isArray(n.items) ? n.items : Object.keys(n.items || {}).map(function (i) { return n.items[i]; });
      o.npcs[k] = { n: String(n.n || 'NPC').slice(0, 12), title: String(n.title || '商人').slice(0, 10), spr: String(n.spr || '1256'),
        items: its.filter(function (x) { return x && x.id && items()[x.id]; }).map(function (x) { return { id: x.id, price: Math.max(1, Math.floor(Number(x.price) || 1)) }; }),
        pos: n.pos || {}, at: n.at || 0 };
    });
    Object.keys(c.statues || {}).forEach(function (k) {
      var s = c.statues[k]; if (!s) return;
      var b = {}; STATS.forEach(function (st) { var v = Math.round(Number((s.buffs || {})[st[0]]) || 0); if (v) b[st[0]] = Math.max(-50, Math.min(100, v)); });
      o.statues[k] = { n: String(s.n || '雕像').slice(0, 12), buffs: b, mins: Math.max(1, Math.min(1440, Math.floor(Number(s.mins) || 30))), pos: s.pos || {}, at: s.at || 0 };
    });
    return o;
  }
  function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) {} }
  function applyCfg(c) { cfg = norm(c); saveLocal(); registerBuffs(); refreshTown(); }
  try { cfg = norm(JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) {}

  function fbReady() { var F = window.firebase; return !!(F && F.apps && F.apps.length && F.auth && F.database); }
  function amAdmin() { try { var m = window.AFK_MP && AFK_MP.me && AFK_MP.me(); return !!(m && m.admin); } catch (e) { return false; } }
  function storeLabel() { return amAdmin() ? '儲存到伺服器（所有玩家都看得到）' : '⚠ 目前只存在這台裝置：要讓所有玩家看到，請先用 GM 帳號登入（帳號要先被設成 GM）'; }
  function commit(msg) {
    cfg = norm(cfg); saveLocal(); registerBuffs(); refreshTown();
    if (amAdmin() && fbReady()) {
      window.firebase.database().ref('config/town').set(cfg).then(function () { toast(msg + '（已同步給所有玩家）'); }, function (e) { toast(msg + '，但伺服器寫入失敗：' + ((e && e.code) || e)); });
    } else toast(msg + '（只存在這台裝置）');
  }
  // 讀伺服器：沒登入也能讀（REST，公開可讀）；登入後改用即時監聽
  function pullRest() {
    fetch('firebase-config.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (!c || !c.databaseURL) return;
      dbUrl = c.databaseURL.replace(/\/$/, '');
      return fetch(dbUrl + '/config/town.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (v) { if (v) applyCfg(v); });
    }).catch(function () {});
  }
  var live = false;
  function tryLive() {
    if (live || !fbReady()) return;
    live = true;
    window.firebase.database().ref('config/town').on('value', function (s) { var v = s.val(); if (v) applyCfg(v); }, function () { live = false; });
  }

  // ---- 雕像增益：掛進遊戲的增益系統 ----------------------------------------------------------
  function buffKey(id) { return 'gm_st_' + id; }
  function registerBuffs() {
    if (typeof DB === 'undefined' || !DB.skills) return;
    Object.keys(cfg.statues).forEach(function (id) {
      var s = cfg.statues[id];
      DB.skills[buffKey(id)] = { n: '雕像祝福：' + s.n, type: 'buff', procOnly: true, dur: s.mins * 60, d: Object.assign({}, s.buffs), msg: '雕像的力量灌注到你身上。' };
    });
  }
  function buffText(b) { var t = Object.keys(b || {}).map(function (k) { return (STAT_NAME[k] || k) + (b[k] > 0 ? '+' : '') + b[k]; }).join('、'); return t || '（沒有設定屬性）'; }
  function pray(id) {
    var s = cfg.statues[id]; if (!s || typeof player === 'undefined' || !player) return;
    registerBuffs();
    var k = buffKey(id), left = (player.buffs && player.buffs[k]) || 0;
    if (left > 0) { toast('祝福還有 ' + Math.ceil(left / 60) + ' 分鐘，結束後才能再祈禱'); return; }
    player.buffs = player.buffs || {};
    player.buffs[k] = s.mins * 60;
    try { if (typeof calcStats === 'function') calcStats(); } catch (e) {}
    try { if (typeof logSys === 'function') logSys('🗿 你向「' + esc(s.n) + '」祈禱：' + esc(buffText(s.buffs)) + '，持續 ' + s.mins + ' 分鐘。'); } catch (e) {}
    try { if (typeof updateUI === 'function') updateUI(); } catch (e) {}
    toast('獲得祝福：' + buffText(s.buffs) + '（' + s.mins + ' 分鐘）');
  }

  // ---- 村莊畫面：把 GM 的 NPC／雕像加進地圖 -----------------------------------------------------
  function defaultPos(i, kind) { return kind === 'st' ? { x: 50 + ((i % 3) - 1) * 12, y: 58 } : { x: 20 + (i % 6) * 12, y: 78 - Math.floor(i / 6) * 10 }; }
  function sprOf(key) { try { return (typeof NPC_SPR !== 'undefined' && NPC_SPR[key]) || null; } catch (e) { return null; } }
  var animEls = [];
  function addEl(map, townId, kind, id, o, i) {
    var p = (o.pos && o.pos[townId]) || defaultPos(i, kind);
    var el = document.createElement('div');
    el.className = 'town-npc gmt-npc' + (kind === 'st' ? ' gmt-statue' : '');
    el.setAttribute('data-gmt', kind + ':' + id);
    el.style.left = p.x + '%'; el.style.top = p.y + '%'; el.style.zIndex = Math.round(p.y * 10);
    var g = kind === 'st' ? '2725' : ((sprOf(o.spr) || {}).g || '1256');
    var title = kind === 'st' ? '雕像' : (o.title || '商人');
    el.innerHTML = '<div class="tn-label"><span class="tn-name">' + esc(o.n) + '</span><span class="tn-title">' + esc(title) + '</span></div>' +
      '<img class="tn-body" src="assets/npc/' + g + '/idle_0.png" alt="">';
    el.addEventListener('click', function (e) {
      if (dragMode || el._dragged) { el._dragged = false; e.stopPropagation(); return; }
      if (kind === 'st') openStatue(id); else openShop(id);
    });
    map.appendChild(el);
    var spr = kind === 'st' ? null : sprOf(o.spr);
    if (spr && spr.f > 1) animEls.push({ img: el.querySelector('.tn-body'), g: spr.g, f: spr.f, ph: i * 2 });
  }
  function decorate(townId) {
    var map = $('town-npc-map'); if (!map || !townId) return;
    animEls = [];
    map.querySelectorAll('.gmt-npc').forEach(function (e) { e.remove(); });
    Object.keys(cfg.npcs).forEach(function (id, i) { addEl(map, townId, 'npc', id, cfg.npcs[id], i); });
    Object.keys(cfg.statues).forEach(function (id, i) { addEl(map, townId, 'st', id, cfg.statues[id], i); });
  }
  var origRender = window.renderTownNPCMap;
  if (typeof origRender === 'function') {
    window.renderTownNPCMap = function (townId) {
      var r = origRender.apply(this, arguments);
      try { decorate(townId); } catch (e) {}
      return r;
    };
  }
  function refreshTown() {
    var t = curTown(), tv = $('town-view');
    if (!t || !tv || tv.classList.contains('hidden')) return;
    try { window.renderTownNPCMap(t); } catch (e) {}
  }
  setInterval(function () {   // GM NPC 的待機動畫（簡單逐幀）
    if (!animEls.length) return;
    var f = Math.floor(Date.now() / 150);
    animEls.forEach(function (a) { if (!a.img.isConnected) return; var src = 'assets/npc/' + a.g + '/idle_' + ((f + a.ph) % a.f) + '.png'; if (a.img.getAttribute('src') !== src) a.img.setAttribute('src', src); });
  }, 150);

  // ---- 玩家：商店／雕像視窗 ------------------------------------------------------------------
  function floatWin(name, title, fn) {
    if (typeof openTownFloatWindow === 'function') { openTownFloatWindow(name, title, fn); return; }
    var c = modal('<h3>' + esc(name) + '<button class="x">×</button></h3><div class="b"></div>'); fn(c.querySelector('.b'));
  }
  function openShop(id) {
    var n = cfg.npcs[id]; if (!n) return;
    floatWin(n.n, n.title, function (box) {
      var D = items();
      if (!n.items.length) { box.innerHTML = '<div style="padding:10px;color:#a8946a">這位商人還沒有商品。</div>'; return; }
      box.innerHTML = '<div class="gmt-shop">' + n.items.map(function (x, i) {
        var d = D[x.id] || {};
        return '<div class="gmt-row"><span class="nm ' + esc(d.c || '') + '">' + esc(d.n || x.id) + '</span><span class="pr">' + x.price.toLocaleString() + ' 金</span>' +
          '<input type="number" min="1" max="999" value="1" data-q="' + i + '"><button type="button" data-buy="' + i + '">購買</button></div>';
      }).join('') + '</div><div class="gmt-gold">持有金幣：<b>' + ((player && player.gold) || 0).toLocaleString() + '</b></div>';
      box.onclick = function (e) {
        var b = e.target.closest('[data-buy]'); if (!b) return;
        var x = n.items[+b.dataset.buy]; if (!x) return;
        var q = Math.max(1, Math.min(999, Math.floor(Number(box.querySelector('[data-q="' + b.dataset.buy + '"]').value) || 1)));
        var cost = x.price * q;
        if ((player.gold || 0) < cost) { toast('金幣不足（需要 ' + cost.toLocaleString() + '）'); return; }
        player.gold -= cost;
        try { gainItem(x.id, q, true, true); } catch (er) { player.gold += cost; toast('購買失敗'); return; }
        try { logSys('向 ' + esc(n.n) + ' 購買了 ' + esc((D[x.id] || {}).n || x.id) + (q > 1 ? ' ×' + q : '') + '（' + cost.toLocaleString() + ' 金）。'); } catch (er) {}
        try { updateUI(); } catch (er) {}
        var g = box.querySelector('.gmt-gold b'); if (g) g.textContent = (player.gold || 0).toLocaleString();
        toast('購買成功');
      };
    });
  }
  function openStatue(id) {
    var s = cfg.statues[id]; if (!s) return;
    floatWin(s.n, '雕像', function (box) {
      var left = (player && player.buffs && player.buffs[buffKey(id)]) || 0;
      box.innerHTML = '<div style="padding:8px 4px;line-height:1.7">向雕像祈禱可獲得：<br><b style="color:#ffd77a">' + esc(buffText(s.buffs)) + '</b><br>持續 <b>' + s.mins + '</b> 分鐘' +
        (left > 0 ? '<br><span style="color:#9fe870">祝福中，還剩 ' + Math.ceil(left / 60) + ' 分鐘</span>' : '') +
        '</div><button type="button" class="gmt-pray"' + (left > 0 ? ' disabled' : '') + '>🙏 祈禱</button>';
      box.onclick = function (e) { if (e.target.closest('.gmt-pray')) { pray(id); openStatue(id); } };
    });
  }

  // ---- 拖曳調整位置（GM）-----------------------------------------------------------------------
  function setDrag(on) {
    dragMode = !!on && isGM();
    document.body.classList.toggle('gmt-drag', dragMode);
    var bar = $('gmt-dragbar');
    if (dragMode) {
      if (!bar) { bar = document.createElement('div'); bar.id = 'gmt-dragbar'; document.body.appendChild(bar); bar.addEventListener('click', function (e) { if (e.target.closest('button')) setDrag(false); }); }
      bar.innerHTML = '✋ 拖曳模式：在村莊地圖上拖 GM 的 NPC／雕像，放開就存 <button type="button">完成</button>';
      try { if (typeof closeNpcInteraction === 'function') closeNpcInteraction(); } catch (e) {}
      if (!curTown()) toast('請先回到村莊再拖曳');
    } else if (bar) bar.remove();
    refreshTown();
  }
  (function bindDrag() {
    var cur = null;
    document.addEventListener('pointerdown', function (e) {
      if (!dragMode) return;
      var el = e.target.closest && e.target.closest('#town-npc-map .gmt-npc'); if (!el) return;
      var map = $('town-npc-map'); if (!map) return;
      e.preventDefault();
      cur = { el: el, map: map, moved: false, id: el.getAttribute('data-gmt') };
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!cur) return;
      var r = cur.map.getBoundingClientRect(); if (!r.width) return;
      var x = Math.max(2, Math.min(98, (e.clientX - r.left) / r.width * 100)), y = Math.max(8, Math.min(98, (e.clientY - r.top) / r.height * 100));
      cur.el.style.left = x.toFixed(1) + '%'; cur.el.style.top = y.toFixed(1) + '%'; cur.el.style.zIndex = Math.round(y * 10);
      cur.x = x; cur.y = y; cur.moved = true;
    }, true);
    var end = function () {
      if (!cur) return;
      var c = cur; cur = null;
      if (!c.moved) return;
      c.el._dragged = true;
      var parts = c.id.split(':'), o = parts[0] === 'st' ? cfg.statues[parts[1]] : cfg.npcs[parts[1]], t = curTown();
      if (!o || !t) return;
      o.pos = o.pos || {}; o.pos[t] = { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 };
      commit('位置已儲存');
    };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
  })();

  // ---- GM 管理視窗 --------------------------------------------------------------------------
  var CSS = [
    '#gmt-mask{position:fixed;inset:0;z-index:99995;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}',
    '.gmt-pan{width:min(96vw,460px);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(#2a1d0c,#150e05);border:1px solid #9a7a36;border-radius:8px;color:#ecd9a8;font:13px/1.5 "Noto Serif TC","PMingLiU",serif;box-shadow:0 8px 30px rgba(0,0,0,.7)}',
    '.gmt-pan h3{margin:0;padding:9px 12px;border-bottom:1px solid #5a4520;color:#ffd77a;font-size:15px;display:flex;justify-content:space-between;align-items:center}',
    '.gmt-pan .b{padding:8px 12px;overflow-y:auto;flex:1 1 auto;min-height:0}',
    '.gmt-pan .x{background:none;border:0;color:#cdb47a;font-size:20px;cursor:pointer;line-height:1}',
    '.gmt-pan .foot{display:flex;gap:8px;padding:8px 12px;border-top:1px solid #5a4520;flex-wrap:wrap}',
    '.gmt-pan button{padding:5px 10px;border:1px solid #8a6a2a;border-radius:4px;background:#2c1f0c;color:#ffe3a0;font:600 13px/1.2 inherit;cursor:pointer}',
    '.gmt-pan .foot button{flex:1;padding:8px 0;font-size:14px}',
    '.gmt-pan button.pri{background:linear-gradient(#4a3514,#241808)}',
    '.gmt-pan button.del{border-color:#8a3a2a;color:#ffb8a0}',
    '.gmt-pan input,.gmt-pan select{box-sizing:border-box;background:#0a0806;border:1px solid #5a4520;border-radius:4px;color:#f0e2bd;padding:4px 6px;font-size:13px}',
    '.gmt-pan .fl{display:flex;gap:6px;align-items:center;margin:5px 0}',
    '.gmt-pan .fl>span{flex:0 0 64px;color:#cdb47a}',
    '.gmt-pan .fl>input,.gmt-pan .fl>select{flex:1;min-width:0}',
    '.gmt-pan .li{display:flex;gap:6px;align-items:center;padding:5px 0;border-bottom:1px dashed rgba(138,106,53,.35)}',
    '.gmt-pan .li .nm{flex:1;min-width:0}',
    '.gmt-pan .li small,.gmt-pan .note{color:#a8946a}',
    '.gmt-pan .note{font-size:12px;margin:4px 0}',
    '.gmt-pan .tabs{display:flex;gap:4px;margin:6px 0}',
    '.gmt-pan .tabs button.on{background:#7a5414;border-color:#e7b54a}',
    '.gmt-pan .res{max-height:150px;overflow-y:auto;border:1px solid #3a2d16;border-radius:4px}',
    '.gmt-pan .res div{padding:3px 6px;cursor:pointer;border-bottom:1px solid rgba(80,60,30,.4)}',
    '.gmt-pan .res div:hover{background:#3a2a10}',
    '.gmt-pan .it{display:flex;gap:5px;align-items:center;padding:3px 0}',
    '.gmt-pan .it .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.gmt-pan .it input{width:86px}',
    '.gmt-pan .looks{display:flex;flex-wrap:wrap;gap:4px}',
    '.gmt-pan .looks img{width:44px;height:44px;object-fit:contain;border:1px solid #3a2d16;border-radius:4px;background:#0a0806;cursor:pointer}',
    '.gmt-pan .looks img.on{border-color:#e7b54a;box-shadow:0 0 0 1px #e7b54a}',
    '.gmt-pan .stats{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px}',
    '.gmt-pan .stats label{display:flex;justify-content:space-between;align-items:center;gap:4px}',
    '.gmt-pan .stats input{width:58px}',
    '.gmt-shop .gmt-row{display:flex;gap:6px;align-items:center;padding:6px 4px;border-bottom:1px solid rgba(100,80,40,.4)}',
    '.gmt-shop .nm{flex:1;min-width:0}.gmt-shop .pr{color:#ffd77a;white-space:nowrap}',
    '.gmt-shop input{width:54px;background:#0a0806;border:1px solid #5a4520;border-radius:4px;color:#f0e2bd;padding:3px}',
    '.gmt-shop button,.gmt-pray{padding:4px 10px;border:1px solid #8a6a2a;border-radius:4px;background:linear-gradient(#4a3514,#241808);color:#ffe3a0;font-weight:700;cursor:pointer}',
    '.gmt-pray{display:block;width:100%;padding:9px 0;font-size:15px}.gmt-pray:disabled{opacity:.45;cursor:default}',
    '.gmt-gold{padding:6px 4px;color:#cdb47a}',
    'body.gmt-drag #town-npc-map{display:block!important;}',
    'body.afk-npclist.gmt-drag #town-npc-map{display:block!important;}',
    'body.gmt-drag #afk-npclist{display:none!important;}',
    'body.gmt-drag #town-npc-map .gmt-npc{cursor:move;outline:2px dashed #e7b54a;outline-offset:2px;touch-action:none}',
    '#gmt-dragbar{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483000;background:rgba(40,26,6,.95);color:#ffe39a;border:1px solid #b08a3a;border-radius:6px;padding:6px 10px;font:600 13px/1.4 "Noto Serif TC",serif;max-width:94vw}',
    '#gmt-dragbar button{margin-left:8px;padding:3px 10px;border:1px solid #8a6a2a;border-radius:4px;background:#2c1f0c;color:#ffe3a0;font-weight:700;cursor:pointer}'
  ].join('\n');
  function ensureStyle() { if ($('afk-gmtown-style')) return; var s = document.createElement('style'); s.id = 'afk-gmtown-style'; s.textContent = CSS; document.head.appendChild(s); }
  function closeMask() { var m = $('gmt-mask'); if (m) m.remove(); }
  function modal(html) {
    ensureStyle(); closeMask();
    var mask = document.createElement('div'); mask.id = 'gmt-mask';
    var p = document.createElement('div'); p.className = 'gmt-pan'; p.innerHTML = html;
    mask.appendChild(p); document.body.appendChild(mask);
    p.addEventListener('click', function (e) { if (e.target.closest('.x')) closeMask(); });
    return p;
  }

  // NPC 清單
  function openNpcManager() {
    if (!isGM()) return;
    var ids = Object.keys(cfg.npcs);
    var p = modal('<h3>NPC 管理（每個村莊都會出現）<button class="x">×</button></h3><div class="b">' +
      '<div class="note">' + esc(storeLabel()) + '</div>' +
      (ids.length ? ids.map(function (id) { var n = cfg.npcs[id]; return '<div class="li"><div class="nm"><b>' + esc(n.n) + '</b> <small>[' + esc(n.title) + ']・' + n.items.length + ' 樣商品</small></div><button data-e="' + id + '">編輯</button><button class="del" data-d="' + id + '">刪除</button></div>'; }).join('') : '<div class="note">還沒有 GM NPC。</div>') +
      '</div><div class="foot"><button class="pri" data-new="1">＋ 新增 NPC</button><button data-drag="1">✋ 拖曳調整位置</button></div>');
    p.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.new) editNpc(null);
      else if (b.dataset.e) editNpc(b.dataset.e);
      else if (b.dataset.d) { if (confirm('確定刪除「' + cfg.npcs[b.dataset.d].n + '」？')) { delete cfg.npcs[b.dataset.d]; commit('已刪除 NPC'); openNpcManager(); } }
      else if (b.dataset.drag) { closeMask(); setDrag(true); }
    });
  }
  // NPC 編輯：名稱／職稱／外觀／商品與售價
  function editNpc(id) {
    var src = id ? cfg.npcs[id] : { n: '新商人', title: '商人', spr: '1256', items: [], pos: {} };
    var w = JSON.parse(JSON.stringify(src)), cat = 'eq', q = '';
    var p = modal('<h3>' + (id ? '編輯 NPC' : '新增 NPC') + '<button class="x">×</button></h3><div class="b"></div><div class="foot"><button class="pri" data-save="1">儲存</button><button data-back="1">返回</button></div>');
    var body = p.querySelector('.b');
    function draw() {
      var D = items();
      var res = Object.keys(D).filter(function (k) { return itemCat(k) === cat && (!q || (D[k].n || '').indexOf(q) >= 0) && !w.items.some(function (x) { return x.id === k; }); }).slice(0, 150);
      body.innerHTML =
        '<div class="fl"><span>名稱</span><input data-f="n" maxlength="12" value="' + esc(w.n) + '"></div>' +
        '<div class="fl"><span>職稱</span><input data-f="title" maxlength="10" value="' + esc(w.title) + '"></div>' +
        '<div class="fl" style="align-items:flex-start"><span>外觀</span><div class="looks">' + NPC_LOOKS.filter(sprOf).map(function (k) { return '<img data-spr="' + k + '" class="' + (w.spr === k ? 'on' : '') + '" src="assets/npc/' + sprOf(k).g + '/idle_0.png" alt="">'; }).join('') + '</div></div>' +
        '<div style="margin-top:8px;color:#ffd77a;font-weight:700">販售商品（' + w.items.length + '）</div>' +
        (w.items.length ? w.items.map(function (x, i) { var d = D[x.id] || {}; return '<div class="it"><span class="nm">' + esc(d.n || x.id) + '</span><input type="number" min="1" data-pr="' + i + '" value="' + x.price + '"> 金<button class="del" data-rm="' + i + '">移除</button></div>'; }).join('') : '<div class="note">還沒有商品，從下面加入。</div>') +
        '<div style="margin-top:8px;color:#ffd77a;font-weight:700">加入商品</div>' +
        '<div class="tabs">' + CATS.map(function (c) { return '<button data-cat="' + c[0] + '" class="' + (cat === c[0] ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div>' +
        '<input data-q placeholder="搜尋名稱…" value="' + esc(q) + '" style="width:100%">' +
        '<div class="res" style="margin-top:4px">' + (res.map(function (k) { return '<div data-add="' + k + '">' + esc(D[k].n) + ' <small style="color:#a8946a">（原價 ' + (D[k].p || 0).toLocaleString() + '）</small></div>'; }).join('') || '<div style="color:#6b6252;cursor:default">沒有符合的物品</div>') + '</div>';
      var qi = body.querySelector('[data-q]');
      qi.oninput = function () { q = qi.value.trim(); var pos = qi.selectionStart; draw(); var n = body.querySelector('[data-q]'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    }
    function grab() {
      body.querySelectorAll('[data-f]').forEach(function (i) { w[i.dataset.f] = i.value.trim(); });
      body.querySelectorAll('[data-pr]').forEach(function (i) { var x = w.items[+i.dataset.pr]; if (x) x.price = Math.max(1, Math.floor(Number(i.value) || 1)); });
    }
    draw();
    p.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset.spr) { grab(); w.spr = t.dataset.spr; draw(); return; }
      if (t.dataset.cat) { grab(); cat = t.dataset.cat; draw(); return; }
      var add = t.closest('[data-add]'); if (add) { grab(); var d = items()[add.dataset.add] || {}; w.items.push({ id: add.dataset.add, price: Math.max(1, d.p || 100) }); draw(); return; }
      if (t.dataset.rm) { grab(); w.items.splice(+t.dataset.rm, 1); draw(); return; }
      if (t.dataset.save) {
        grab(); if (!w.n) { toast('請輸入名稱'); return; }
        var key = id || uid(); w.at = Date.now(); cfg.npcs[key] = w; commit('NPC 已儲存'); openNpcManager(); return;
      }
      if (t.dataset.back) openNpcManager();
    });
  }
  // 雕像清單與編輯
  function openStatueManager() {
    if (!isGM()) return;
    var ids = Object.keys(cfg.statues);
    var p = modal('<h3>雕像管理（每個村莊都會出現）<button class="x">×</button></h3><div class="b">' +
      '<div class="note">' + esc(storeLabel()) + '</div>' +
      (ids.length ? ids.map(function (id) { var s = cfg.statues[id]; return '<div class="li"><div class="nm"><b>' + esc(s.n) + '</b> <small>' + esc(buffText(s.buffs)) + '・' + s.mins + ' 分鐘</small></div><button data-e="' + id + '">編輯</button><button class="del" data-d="' + id + '">刪除</button></div>'; }).join('') : '<div class="note">還沒有雕像。</div>') +
      '</div><div class="foot"><button class="pri" data-new="1">＋ 新增雕像</button><button data-drag="1">✋ 拖曳調整位置</button></div>');
    p.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.new) editStatue(null);
      else if (b.dataset.e) editStatue(b.dataset.e);
      else if (b.dataset.d) { if (confirm('確定刪除「' + cfg.statues[b.dataset.d].n + '」？')) { delete cfg.statues[b.dataset.d]; commit('已刪除雕像'); openStatueManager(); } }
      else if (b.dataset.drag) { closeMask(); setDrag(true); }
    });
  }
  function editStatue(id) {
    var s = id ? cfg.statues[id] : { n: '祝福雕像', buffs: { str: 1, dex: 1 }, mins: 30, pos: {} };
    var p = modal('<h3>' + (id ? '編輯雕像' : '新增雕像') + '<button class="x">×</button></h3><div class="b">' +
      '<div class="fl"><span>名稱</span><input data-f="n" maxlength="12" value="' + esc(s.n) + '"></div>' +
      '<div class="fl"><span>持續時間</span><input data-f="mins" type="number" min="1" max="1440" value="' + s.mins + '"> 分鐘</div>' +
      '<div style="margin:8px 0 4px;color:#ffd77a;font-weight:700">增加的屬性（0＝不加，負數＝扣）</div>' +
      '<div class="stats">' + STATS.map(function (st) { return '<label>' + esc(st[1]) + '<input type="number" data-st="' + st[0] + '" value="' + ((s.buffs || {})[st[0]] || 0) + '"></label>'; }).join('') + '</div>' +
      '<div class="note">玩家祈禱後持續期間不能重複祈禱；時間到自動結束。改設定後，已經在祝福中的玩家要等下次祈禱才會套用新數值。</div>' +
      '</div><div class="foot"><button class="pri" data-save="1">儲存</button><button data-back="1">返回</button></div>');
    p.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset.back) { openStatueManager(); return; }
      if (!t.dataset.save) return;
      var w = { n: p.querySelector('[data-f="n"]').value.trim(), mins: Number(p.querySelector('[data-f="mins"]').value), buffs: {}, pos: s.pos || {}, at: Date.now() };
      p.querySelectorAll('[data-st]').forEach(function (i) { var v = Math.round(Number(i.value) || 0); if (v) w.buffs[i.dataset.st] = v; });
      if (!w.n) { toast('請輸入名稱'); return; }
      if (!Object.keys(w.buffs).length) { toast('至少設定一項屬性'); return; }
      cfg.statues[id || uid()] = w; commit('雕像已儲存'); openStatueManager();
    });
  }

  // ---- 啟動 ---------------------------------------------------------------------------------
  function start() {
    ensureStyle(); registerBuffs(); pullRest();
    setInterval(function () { tryLive(); if (typeof DB !== 'undefined' && DB.skills && Object.keys(cfg.statues).some(function (id) { return !DB.skills[buffKey(id)]; })) registerBuffs(); }, 2000);
    var tries = 0;
    (function hookGM() {
      if (window.AFK_GM && AFK_GM.addSection) {
        AFK_GM.addSection('🏪 NPC 管理', openNpcManager);
        AFK_GM.addSection('🗿 雕像管理', openStatueManager);
      } else if (++tries < 40) setTimeout(hookGM, 250);
    })();
  }
  window.AFK_GMTOWN = { cfg: function () { return cfg; }, openNpcs: openNpcManager, openStatues: openStatueManager, drag: setDrag };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
