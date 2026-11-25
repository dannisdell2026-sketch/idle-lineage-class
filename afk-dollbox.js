/* ============================================================================
 * afk-dollbox.js — 新道具「娃娃寶箱」：打開隨機獲得一隻魔法娃娃，品級越高機率越低
 *
 * 機率（遊戲裡娃娃分一～六階，四個機率分成四檔）：
 *   一、二階 95%　三、四階 4%　五階 0.9%　六階 0.1%
 *   同一檔裡每隻娃娃機率相同（例：六階有 4 隻 → 每隻 0.025%）。
 * ・道具 id：doll_box_lucky。背包按「使用」打開；開獎視窗可「再開一個」或「全部打開」。
 * ・取得：GM 在「NPC 管理」把它加進販售清單（在「魔法娃娃」分類裡），售價由 GM 決定。
 * ・抽到五、六階會在系統訊息以金色公告。
 * ⚠ 道具要在讀檔前定義（本檔跟其他外掛一起在 index.html 載入，早於按「進入遊戲」）。
 * ========================================================================== */
(function () {
  'use strict';
  var ID = 'doll_box_lucky';
  var GROUPS = [
    { p: 95, tiers: [1, 2], label: '一～二階' },
    { p: 4, tiers: [3, 4], label: '三～四階' },
    { p: 0.9, tiers: [5], label: '五階' },
    { p: 0.1, tiers: [6], label: '六階' }
  ];
  var TIER_NAME = { 1: '一階', 2: '二階', 3: '三階', 4: '四階', 5: '五階', 6: '六階' };

  function defineItem() {
    if (typeof DB === 'undefined' || !DB.items) return false;
    if (!DB.items[ID]) {
      DB.items[ID] = {
        n: '娃娃寶箱', type: 'misc', p: 20000, c: 'text-pink-300', eff: 'doll_box_lucky', dollBox: true, gachaWeight: 0,
        img: 'assets/icons/items/高級魔法娃娃的盒子.png',
        d: '打開隨機獲得一隻魔法娃娃。機率：一～二階 95%、三～四階 4%、五階 0.9%、六階 0.1%。'
      };
    }
    return true;
  }
  defineItem();

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pool(tiers) {
    var D = DB.items, out = [];
    for (var k in D) { var d = D[k]; if (d && d.doll && tiers.indexOf(d.dollTier) >= 0) out.push(k); }
    return out;
  }
  // 抽一次：先依機率決定哪一檔，再在那一檔裡平均抽一隻（那一檔剛好沒有娃娃就往下一檔退）
  function rollOnce() {
    var r = Math.random() * 100, acc = 0, gi = 0;
    for (var i = 0; i < GROUPS.length; i++) { acc += GROUPS[i].p; if (r < acc) { gi = i; break; } gi = i; }
    for (var j = gi; j >= 0; j--) { var list = pool(GROUPS[j].tiers); if (list.length) return list[(Math.random() * list.length) | 0]; }
    return null;
  }
  function boxCount() { try { return player.inv.reduce(function (s, i) { return s + (i && i.id === ID ? (i.cnt || 1) : 0); }, 0); } catch (e) { return 0; } }
  function takeOne() {
    var it = player.inv.find(function (i) { return i && i.id === ID && (i.cnt || 1) >= 1; }); if (!it) return false;
    if ((it.cnt || 1) > 1) it.cnt -= 1; else player.inv.splice(player.inv.indexOf(it), 1);
    return true;
  }
  var lastGot = [];
  // 開箱走遊戲原本的道具交易（失敗會整筆還原）；交易可能是非同步的 → 結果記在 lastGot，開完再顯示
  function openThen(n) { lastGot = []; return Promise.resolve(open(n)).then(function () { if (lastGot.length) show(lastGot); }, function () {}); }
  function open(n) {
    if (typeof runItemTransaction === 'function' && typeof _itemTransaction !== 'undefined' && !_itemTransaction) return runItemTransaction('娃娃寶箱', function () { return open(n); });
    var have = boxCount(); if (!have) { toast('沒有娃娃寶箱'); return []; }
    n = Math.max(1, Math.min(have, n || 1));
    var got = [];
    for (var i = 0; i < n; i++) {
      var id = rollOnce(); if (!id || !takeOne()) break;
      try { gainItem(id, 1, true, true, false, true); } catch (e) { try { gainItem(id, 1, true, true); } catch (e2) {} }
      got.push(id);
    }
    try { if (typeof autoSortInventory === 'function') autoSortInventory(); } catch (e) {}
    var cnt = {}; got.forEach(function (id) { cnt[id] = (cnt[id] || 0) + 1; });
    var parts = Object.keys(cnt).map(function (id) { var d = DB.items[id]; return '<span class="' + (d.c || 'text-pink-300') + ' font-bold">' + esc(d.n) + '</span>' + (cnt[id] > 1 ? ' ×' + cnt[id] : ''); });
    try { logSys('🎁 打開娃娃寶箱 ×' + got.length + '，獲得：' + parts.join('、') + '。'); } catch (e) {}
    got.forEach(function (id) { var d = DB.items[id]; if (d.dollTier >= 5) try { logSys('<span class="text-amber-300 font-bold">✨ 恭喜！從娃娃寶箱抽到' + TIER_NAME[d.dollTier] + '魔法娃娃【' + esc(d.n.replace('魔法娃娃：', '')) + '】！</span>'); } catch (e) {} });
    try { if (typeof calcStats === 'function') calcStats(); } catch (e) {}
    try { if (typeof renderTabs === 'function') renderTabs(true); } catch (e) {}
    try { if (typeof updateUI === 'function') updateUI(); } catch (e) {}
    try { if (typeof saveGame === 'function') saveGame(); } catch (e) {}
    lastGot = got;
    return got;
  }

  // ---- 開獎視窗 -------------------------------------------------------------------
  var CSS = [
    '#dbx-mask{position:fixed;inset:0;z-index:99996;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:70px 0 12px;box-sizing:border-box}',
    '#dbx-pan{width:min(94vw,380px);max-height:100%;display:flex;flex-direction:column;background:linear-gradient(#2a1d0c,#150e05);border:1px solid #9a7a36;border-radius:8px;color:#ecd9a8;font:13px/1.5 "Noto Serif TC","PMingLiU",serif;box-shadow:0 8px 30px rgba(0,0,0,.7)}',
    '#dbx-pan h3{margin:0;padding:9px 12px;border-bottom:1px solid #5a4520;color:#ffd77a;font-size:15px;display:flex;justify-content:space-between;align-items:center}',
    '#dbx-pan .x{background:none;border:0;color:#cdb47a;font-size:20px;cursor:pointer;line-height:1}',
    '#dbx-pan .b{padding:10px 12px;overflow-y:auto;flex:1 1 auto;min-height:0}',
    '#dbx-pan .got{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}',
    '#dbx-pan .card{width:96px;padding:8px 4px;border:1px solid #5a4520;border-radius:6px;background:rgba(0,0,0,.35);text-align:center;animation:dbxIn .35s ease-out both}',
    '#dbx-pan .card img{width:48px;height:48px;object-fit:contain;image-rendering:pixelated}',
    '#dbx-pan .card .nm{font-weight:700;font-size:12.5px;line-height:1.3;margin-top:3px}',
    '#dbx-pan .card .tr{font-size:11px;color:#a8946a}',
    '#dbx-pan .card.t5{border-color:#f0a040;box-shadow:0 0 12px rgba(240,160,64,.6)}',
    '#dbx-pan .card.t6{border-color:#ff5050;box-shadow:0 0 16px rgba(255,80,80,.8)}',
    '#dbx-pan .sum{margin-top:8px;text-align:center;color:#cdb47a}',
    '#dbx-pan .odds{margin-top:10px;font-size:11.5px;color:#8a7a5a;text-align:center}',
    '#dbx-pan .foot{display:flex;gap:8px;padding:8px 12px;border-top:1px solid #5a4520}',
    '#dbx-pan .foot button{flex:1;padding:8px 0;border:1px solid #8a6a2a;border-radius:5px;background:linear-gradient(#4a3514,#241808);color:#ffe3a0;font:700 13.5px/1.2 inherit;cursor:pointer}',
    '#dbx-pan .foot button:disabled{opacity:.4;cursor:default}',
    '@keyframes dbxIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}'
  ].join('\n');
  function ensureStyle() { if ($('afk-dbx-style')) return; var s = document.createElement('style'); s.id = 'afk-dbx-style'; s.textContent = CSS; document.head.appendChild(s); }
  function toast(msg) {
    try { if (typeof window.afkToast === 'function') { window.afkToast(msg); return; } } catch (e) {}
    try { logSys(msg); } catch (e) {}
  }
  function icon(d) { try { return typeof getIconUrl === 'function' ? getIconUrl(d) : ''; } catch (e) { return ''; } }
  function show(got) {
    ensureStyle();
    var m = $('dbx-mask'); if (m) m.remove();
    var mask = document.createElement('div'); mask.id = 'dbx-mask';
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    var left = boxCount();
    var cards = got.slice(0, 60).map(function (id, i) {
      var d = DB.items[id] || {}, t = d.dollTier || 1;
      return '<div class="card t' + t + '" style="animation-delay:' + Math.min(i * 0.04, 1.2) + 's"><img src="' + esc(icon(d)) + '" alt="" onerror="this.style.visibility=\'hidden\'"><div class="nm ' + esc(d.c || '') + '">' + esc((d.n || id).replace('魔法娃娃：', '')) + '</div><div class="tr">' + (TIER_NAME[t] || '') + '</div></div>';
    }).join('');
    var tally = {}; got.forEach(function (id) { var t = (DB.items[id] || {}).dollTier || 1; tally[t] = (tally[t] || 0) + 1; });
    var sum = got.length > 1 ? Object.keys(tally).sort().map(function (t) { return TIER_NAME[t] + ' ×' + tally[t]; }).join('　') : '';
    var p = document.createElement('div'); p.id = 'dbx-pan';
    p.innerHTML = '<h3><span>🎁 娃娃寶箱' + (got.length > 1 ? ' ×' + got.length : '') + '</span><button class="x" data-x="1">×</button></h3>' +
      '<div class="b"><div class="got">' + (cards || '<div style="color:#a8946a">沒有開出東西</div>') + '</div>' +
      (got.length > 60 ? '<div class="sum">（只顯示前 60 隻，其餘已放進背包）</div>' : '') +
      (sum ? '<div class="sum">' + sum + '</div>' : '') +
      '<div class="odds">機率：一～二階 95%・三～四階 4%・五階 0.9%・六階 0.1%</div></div>' +
      '<div class="foot"><button data-one="1"' + (left ? '' : ' disabled') + '>再開一個（剩 ' + left + '）</button><button data-all="1"' + (left > 1 ? '' : ' disabled') + '>全部打開</button></div>';
    p.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x) { mask.remove(); return; }
      if (b.dataset.one) { openThen(1); return; }
      if (b.dataset.all) { openThen(boxCount()); }
    });
    mask.appendChild(p); document.body.appendChild(mask);
  }
  function useBox() { openThen(1); }

  function hookUse() {
    if (typeof window.useItem !== 'function') return false;
    if (window.useItem._dbx) return true;
    var orig = window.useItem;
    var w = function (uidv) {
      try {
        var it = player && player.inv && player.inv.find(function (i) { return i && i.uid === uidv; });
        if (it && it.id === ID) { useBox(); return; }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    for (var k in orig) if (k.charAt(0) === '_') { try { w[k] = orig[k]; } catch (e) {} }   // 保留外層其他外掛的標記，避免互相重複包
    w._dbx = true; window.useItem = w; return true;
  }
  window.AFK_DOLLBOX = { id: ID, open: openThen, show: show, roll: rollOnce, groups: GROUPS };
  function start() {
    defineItem();
    var tries = 0;
    (function w() { if (!hookUse() && ++tries < 40) setTimeout(w, 250); })();
    setInterval(function () { defineItem(); hookUse(); }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
