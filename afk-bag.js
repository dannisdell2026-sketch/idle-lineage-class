/* ============================================================================
 * afk-bag.js — 天堂風格背包（四分類方格）＋ 左上人物圖卡改成實際角色樣子
 *
 * ① 背包（底部「背包」）：只剩四個分類 ── 全部／裝備／消耗品／材料，物品以方格排列（像天堂背包）：
 *    圖示、右下數量、左上強化值、鎖定／廢品標記、祝福光暈；下方顯示金幣與物品數。
 *    ・點一下＝開物品視窗（原本的詳細資料與所有操作）；點兩下＝直接裝備／使用（同原本清單）。
 *    ・桌機滑鼠停留、手機長按＝原本的物品資訊框。
 *    分類：裝備＝武器／防具／飾品（箭矢除外）；消耗品＝藥水、卷軸、技能書、箭矢、可使用的道具；材料＝其餘。
 * ② 原本右欄上方那排 12 個按鈕（能力／裝備／技能／武器／防具／道具／統計／收藏／自動賣出／社交／血盟／設定）
 *    收起來，全部改由底部五個按鈕進入（角色／背包／技能／社交／更多；其餘在「更多」裡）。
 *    只在有底部導覽列（手機版面）時生效，桌機版面維持原樣。
 * ③ 左上人物圖卡：改顯示目前角色真正的樣子（職業、武器、變身都會跟著換），待機動畫。
 * ========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var CSS = [
    /* ② 收起上方 12 鍵（有底部導覽時） */
    'body.afk-nav5 #col-right > .tab-bar{display:none!important}',
    /* ① 背包 */
    'body.afk-bag-on #tab-content-panel > :not(#afk-bag){display:none!important}',
    '#afk-bag{display:none;flex:1 1 auto;min-height:0;flex-direction:column;background:linear-gradient(#1e170e,#120d07);border:1px solid #6d5426;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.8),inset 0 0 0 2px rgba(214,180,106,.15);color:#ecd9a8;font:13px/1.4 "Noto Serif TC","PMingLiU",serif}',
    'body.afk-bag-on #afk-bag{display:flex}',
    '#afk-bag .ab-tabs{display:flex;gap:4px;padding:8px 8px 6px}',
    '#afk-bag .ab-tabs button{flex:1;padding:7px 0;border:1px solid #6d5426;border-radius:4px;background:linear-gradient(#2a2016,#16100a);color:#cdb47a;font:700 13.5px/1 inherit;cursor:pointer}',
    '#afk-bag .ab-tabs button.on{background:linear-gradient(#6b4a14,#3a2608);border-color:#e7b54a;color:#fff3c8;box-shadow:0 0 6px rgba(231,181,74,.35)}',
    '#afk-bag .ab-tabs button small{display:block;font-size:10.5px;font-weight:400;color:#a8946a;margin-top:2px}',
    '#afk-bag .ab-tabs button.on small{color:#f3d78a}',
    '#afk-bag .ab-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:4px 8px 8px;-webkit-overflow-scrolling:touch}',
    '#afk-bag .ab-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:3px}',
    '#afk-bag .ab-cell{position:relative;aspect-ratio:1/1;background:linear-gradient(145deg,#0d0a06,#1d160d);border:1px solid #3e301a;border-radius:3px;box-shadow:inset 1px 1px 0 rgba(0,0,0,.9),inset -1px -1px 0 rgba(214,180,106,.12);display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}',
    '#afk-bag .ab-cell.empty{cursor:default;opacity:.55}',
    '#afk-bag .ab-cell:not(.empty):hover{border-color:#b08a3a}',
    '#afk-bag .ab-cell img{width:72%;height:72%;object-fit:contain;pointer-events:none;image-rendering:auto}',
    '#afk-bag .ab-cell .cnt{position:absolute;right:2px;bottom:0;font:700 10.5px/1.1 Arial,sans-serif;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000,1px 1px 0 #000;pointer-events:none}',
    '#afk-bag .ab-cell .en{position:absolute;left:2px;top:1px;font:700 10.5px/1.1 Arial,sans-serif;color:#7fe3ff;text-shadow:0 0 2px #000,1px 1px 0 #000;pointer-events:none}',
    '#afk-bag .ab-cell .lk{position:absolute;right:1px;top:0;font-size:10px;line-height:1;pointer-events:none}',
    '#afk-bag .ab-cell.junk img{filter:grayscale(1) brightness(.7)}',
    '#afk-bag .ab-cell.junk:after{content:"廢";position:absolute;left:2px;bottom:0;font:700 10px/1.1 sans-serif;color:#ff7a6a;text-shadow:0 0 2px #000}',
    '#afk-bag .ab-cell.dim img{opacity:.35;filter:grayscale(.6)}',
    '#afk-bag .ab-cell.bless{box-shadow:inset 0 0 6px rgba(255,220,90,.55),inset 1px 1px 0 rgba(0,0,0,.9)}',
    '#afk-bag .ab-cell.curse{box-shadow:inset 0 0 6px rgba(200,60,60,.6),inset 1px 1px 0 rgba(0,0,0,.9)}',
    '#afk-bag .ab-foot{display:flex;justify-content:space-between;gap:8px;padding:7px 10px;border-top:1px solid #4a3a1e;color:#cdb47a;font-size:12.5px}',
    '#afk-bag .ab-foot b{color:#ffd77a}',
    '#afk-bag .ab-hint{padding:0 10px 6px;color:#7d6c4c;font-size:11px}',
    /* ③ 人物圖卡 */
    '#pp-head .pp-pt{background-image:none!important;background:radial-gradient(circle at 50% 38%,#4a3a22,#140e07 72%)!important;position:relative;overflow:hidden}',
    '#pp-head .pp-pt .afk-pt{position:absolute;max-width:none!important;max-height:none!important;pointer-events:none}',
    '#pp-head .pp-pt .afk-pt.s{opacity:.6}'
  ].join('\n');
  function ensureStyle() { if ($('afk-bag-style')) return; var s = document.createElement('style'); s.id = 'afk-bag-style'; s.textContent = CSS; document.head.appendChild(s); }

  // =====================================================================================
  // ① 背包
  // =====================================================================================
  var CATS = [['all', '全部'], ['eq', '裝備'], ['use', '消耗品'], ['mat', '材料']];
  var cat = 'all';
  try { cat = localStorage.getItem('afk_bag_cat') || 'all'; } catch (e) {}
  function catOf(d) {
    if (!d) return 'mat';
    if ((d.type === 'wpn' && !d.isArrow) || d.type === 'arm' || d.type === 'acc') return 'eq';
    if (d.isArrow || d.type === 'pot' || d.type === 'heal' || d.type === 'scroll' || d.type === 'skillbk' || (d.type === 'misc' && d.eff && !d.noUse) || /卷軸/.test(d.n || '')) return 'use';
    return 'mat';
  }
  function icon(d) { try { return getIconUrl(d); } catch (e) { return ''; } }
  function canEquip(i) { try { return checkCanEquip(i); } catch (e) { return true; } }
  function glow(i, d) { try { return getGlowClass(i, d) || ''; } catch (e) { return ''; } }
  function bagOn() {
    var b = document.querySelector('#m-nav .pp-nav [data-k="bag"]');
    return !!(b && b.classList.contains('on') && document.body.classList.contains('mview-right'));
  }
  function ensureBag() {
    var tcp = $('tab-content-panel'); if (!tcp) return null;
    var bag = $('afk-bag');
    if (!bag) {
      bag = document.createElement('div'); bag.id = 'afk-bag';
      bag.innerHTML = '<div class="ab-tabs"></div><div class="ab-scroll"><div class="ab-grid"></div></div><div class="ab-hint">點一下看物品／操作，點兩下直接裝備或使用</div><div class="ab-foot"><span class="g"></span><span class="n"></span></div>';
      bag.querySelector('.ab-tabs').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        cat = b.dataset.c; try { localStorage.setItem('afk_bag_cat', cat); } catch (er) {}
        sig = ''; render(true);
      });
      bindCells(bag.querySelector('.ab-grid'));
    }
    if (bag.parentNode !== tcp) tcp.insertBefore(bag, tcp.firstChild);
    return bag;
  }
  var clickT = null;
  function findItem(uid) { try { return player.inv.find(function (i) { return i && i.uid === uid; }); } catch (e) { return null; } }
  function bindCells(grid) {
    grid.addEventListener('click', function (e) {
      var c = e.target.closest('.ab-cell[data-uid]'); if (!c) return;
      var uid = c.getAttribute('data-uid');
      clearTimeout(clickT);
      clickT = setTimeout(function () { var it = findItem(uid); if (it) try { openModal(it, false); } catch (er) {} }, 230);
    });
    grid.addEventListener('dblclick', function (e) {
      var c = e.target.closest('.ab-cell[data-uid]'); if (!c) return;
      e.preventDefault(); clearTimeout(clickT);
      var it = findItem(c.getAttribute('data-uid')); if (!it) return;
      var d = DB.items[it.id] || {};
      try {
        if (d.type === 'wpn' || d.type === 'arm' || d.type === 'acc') equipItem(it);
        else if (it.id !== 'candle' && (d.type === 'pot' || d.type === 'skillbk' || d.type === 'scroll' || (d.type === 'misc' && d.eff && !d.noUse))) useItem(it.uid);
        else openModal(it, false);
      } catch (er) {}
    });
  }
  var sig = '';
  function render(force) {
    var bag = ensureBag(); if (!bag) return;
    var inv = []; try { inv = player.inv.filter(function (i) { return i && DB.items[i.id]; }); } catch (e) {}
    var counts = { all: inv.length, eq: 0, use: 0, mat: 0 };
    inv.forEach(function (i) { counts[catOf(DB.items[i.id])]++; });
    var list = cat === 'all' ? inv : inv.filter(function (i) { return catOf(DB.items[i.id]) === cat; });
    var s = cat + '|' + list.map(function (i) { return i.uid + ':' + (i.cnt || 1) + ':' + (i.en || 0) + ':' + (i.lock ? 1 : 0) + (i.junk ? 1 : 0) + (i.bless || ''); }).join(',') + '|' + ((player && player.gold) || 0);
    if (!force && s === sig) return; sig = s;
    bag.querySelector('.ab-tabs').innerHTML = CATS.map(function (c) { return '<button type="button" data-c="' + c[0] + '" class="' + (cat === c[0] ? 'on' : '') + '">' + c[1] + '<small>' + counts[c[0]] + '</small></button>'; }).join('');
    var grid = bag.querySelector('.ab-grid'), html = [];
    list.forEach(function (i) {
      var d = DB.items[i.id], cls = 'ab-cell tip-host';
      if (i.lock) cls += ' locked'; else if (i.junk) cls += ' junk';
      if ((d.type === 'wpn' || d.type === 'arm' || d.type === 'acc') && !canEquip(i)) cls += ' dim';
      if (i.bless === 1 || i.bless === true) cls += ' bless'; else if (i.bless === -1) cls += ' curse';
      var en = (Number(i.en) || 0) > 0 ? '<span class="en">+' + (Number(i.en) | 0) + '</span>' : '';
      var cnt = (i.cnt || 1) > 1 ? '<span class="cnt">' + ((i.cnt >= 10000) ? Math.floor(i.cnt / 1000) + 'k' : i.cnt) + '</span>' : '';
      html.push('<div class="' + cls + '" data-uid="' + esc(i.uid) + '" data-tip-uid="' + esc(i.uid) + '" data-tip-src="inv" title=""><img src="' + esc(icon(d)) + '" class="' + esc(glow(i, d)) + '" onerror="this.style.opacity=0" alt="">' + en + cnt + (i.lock ? '<span class="lk">🔒</span>' : '') + '</div>');
    });
    var cols = Math.max(1, Math.floor((grid.clientWidth + 3) / 49)) || 6, min = Math.max(cols * 6, Math.ceil(list.length / cols) * cols);
    for (var k = list.length; k < min; k++) html.push('<div class="ab-cell empty"></div>');   // 補滿空格，看起來像天堂背包
    grid.innerHTML = html.join('');
    bag.querySelector('.ab-foot .g').innerHTML = '💰 <b>' + (((player && player.gold) || 0).toLocaleString()) + '</b>';
    bag.querySelector('.ab-foot .n').innerHTML = '物品 <b>' + inv.length + '</b> 種';
  }
  function bagTick() {
    var navMode = !!document.querySelector('#m-nav .pp-nav');
    document.body.classList.toggle('afk-nav5', navMode && document.body.classList.contains('pp-skin'));
    var on = navMode && bagOn();
    document.body.classList.toggle('afk-bag-on', on);
    if (on) render(false);
  }

  // =====================================================================================
  // ③ 左上人物圖卡：實際角色（正面 d5、待機動畫）
  // =====================================================================================
  var PT = { base: '', box: null, n: 8, fr: 0, bad: {} };
  function frontBase(f) {
    var b = f.base || '';
    if (/d\d\/$/.test(b)) return b.replace(/d\d\/$/, 'd5/');
    if (/classanim\//.test(b) && !PT.bad[b]) return b.replace(/\/$/, 'd5/');
    return b;
  }
  function measure(src, cb) {
    var im = new Image();
    im.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        var x = c.getContext('2d'); x.drawImage(im, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height).data, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (var y = 0; y < c.height; y++) for (var xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        cb(x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1, w: im.naturalWidth, h: im.naturalHeight });
      } catch (e) { cb({ x0: im.naturalWidth * 0.39, y0: im.naturalHeight * 0.2, x1: im.naturalWidth * 0.59, y1: im.naturalHeight * 0.67, w: im.naturalWidth, h: im.naturalHeight }); }
    };
    im.onerror = function () { cb(false); };
    im.src = src;
  }
  function portrait() {
    var pt = document.querySelector('#pp-head .pp-pt'); if (!pt) return;
    var f = null; try { f = _playerBattleForm(); } catch (e) {}
    if (!f || !f.base) return;
    var base = frontBase(f), pre = base + (f.wpn ? f.wpn + '_' : '');
    if (pre !== PT.base) {
      PT.base = pre; PT.box = null;
      var a = null; try { a = _morphBattleCache[f.key]; } catch (e) {}
      PT.n = (a && a !== 'probing' && a.idle && a.idle.length) || 8;
      var want = pre;
      measure(pre + 'idle_0.png', function (bb) {
        if (PT.base !== want) return;
        if (bb === false) { if (base !== f.base) { PT.bad[f.base] = true; PT.base = ''; } return; }   // 沒有 d5 圖 → 退回原本資料夾
        PT.box = bb;
      });
    }
    if (!PT.box) return;
    var im = pt.querySelector('img.afk-pt.b'), sh = pt.querySelector('img.afk-pt.s');
    if (!im) {
      sh = document.createElement('img'); sh.className = 'afk-pt s'; sh.alt = ''; sh.onerror = function () { this.style.visibility = 'hidden'; };
      im = document.createElement('img'); im.className = 'afk-pt b'; im.alt = '';
      pt.appendChild(sh); pt.appendChild(im);
    }
    var W = pt.clientWidth, H = pt.clientHeight, bb = PT.box;
    var cw = bb.x1 - bb.x0 + 1, ch = bb.y1 - bb.y0 + 1;
    var k = Math.min((H - 8) / ch, (W - 6) / cw, 1.8);
    var w = bb.w * k, h = bb.h * k, left = W / 2 - (bb.x0 + bb.x1) / 2 * k, top = H - 4 - (bb.y1 + 1) * k;
    [im, sh].forEach(function (e) { e.style.width = w.toFixed(1) + 'px'; e.style.height = h.toFixed(1) + 'px'; e.style.left = left.toFixed(1) + 'px'; e.style.top = top.toFixed(1) + 'px'; });
    PT.fr = (PT.fr + 1) % Math.max(1, PT.n);
    var src = PT.base + 'idle_' + PT.fr + '.png';
    if (im.getAttribute('src') !== src) { im.onerror = function () { PT.n = Math.max(1, PT.fr); }; im.setAttribute('src', src); }
    var ss = PT.base + 'idle_s_' + PT.fr + '.png';
    if (sh.getAttribute('src') !== ss) { sh.style.visibility = ''; sh.setAttribute('src', ss); }
  }

  function start() {
    ensureStyle();
    setInterval(function () { try { bagTick(); } catch (e) {} }, 400);
    setInterval(function () { try { portrait(); } catch (e) {} }, 140);
    // 物品變動 → 背包立即重畫
    var tries = 0;
    (function hook() {
      if (typeof window.renderTabs === 'function' && !window.renderTabs._ab) {
        var orig = window.renderTabs;
        var w = function () { var r = orig.apply(this, arguments); try { if (document.body.classList.contains('afk-bag-on')) render(false); } catch (e) {} return r; };
        for (var k in orig) if (k.charAt(0) === '_') { try { w[k] = orig[k]; } catch (e) {} }
        w._ab = true; window.renderTabs = w;
      } else if (++tries < 40) setTimeout(hook, 250);
    })();
  }
  window.AFK_BAG = { render: function () { sig = ''; render(true); }, catOf: catOf };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
