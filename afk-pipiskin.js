/* ============================================================================
 * afk-pipiskin.js — 手機「古金風」版面（深色底＋古金框，直式單手操作）
 *
 * 只在手機殼(afk-mobile 的 body.m-mobile)＋上游手機幾何那條 media query 都成立、且在遊戲畫面時套用
 * (body.pp-skin)。純外觀＋入口搬移，不碰任何遊戲計算與存檔：
 *   ① #pp-head   頂端角色資訊：頭像、Lv/職業、名字、金幣、防/魔防、HP/MP/EXP 三條。
 *                 資料「鏡射」桌機狀態面板的元素(st-* / txt-* / bar-*)，讀不到就顯示 --。
 *   ② #pp-viewbar 切到角色/背包等頁面時，頂端出現「標題＋關閉 ✕」，關閉＝回戰鬥。
 *   ③ #pp-chat   戰鬥框下方的日誌框：全部/戰鬥/系統/世界/掉落 分頁，鏡射 #combat-log / #sys-log / #world-log
 *                 最後幾十行(cloneNode，不搬原節點)；底下輸入列代送到世界頻道 #world-input / #world-send。
 *   ④ #pp-actions 動作列：瞬移/黑市/出發(回村)/掛機設定/日誌 —— 全部是「代按」原本的按鈕或呼叫原本的入口。
 *   ⑤ 底部導覽：在 #m-nav 裡加一組 角色/背包/技能/社交/更多（原按鈕只隱藏不刪：別支外掛會 querySelector
 *                 `#m-nav [data-view=…]` 再 .click()，必須留著）。元素仍在 #m-nav 內 → --m-nav-h 量到的就是新高度。
 *
 * 關掉本外掛＝一個 class 都不掛、注入的元素全部 display:none，回到原本手機版面。
 * ========================================================================== */
(function () {
  'use strict';

  // 先登錄再問開關（檔頭早退型 → 也列進 afk-toggles 內建目錄，避免關掉後開不回來）
  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'pipiskin', name: '古金風手機介面', group: '遊戲介面', def: true,
      desc: '手機改成深色古金框版面：上方角色資訊、戰鬥框下方日誌、底部角色／背包／技能／社交／更多'
    });
    if (!AFK_TOGGLES.enabled('pipiskin')) return;
  }

  // 與 css/style.css 手機版面那條完全一致（afk-mobile / battlehud / skillbar 同一條）
  var MOBILE_MQ = '(max-width: 768px), (max-height: 520px) and (pointer: coarse)';
  var TICK_MS = 400;
  var CHAT_MAX = 40;

  var ICON = {
    char: 'assets/icons/armors/克特頭盔.png',
    bag: 'assets/icons/items/上鎖的歐西里斯初級寶箱.png',
    skill: 'assets/icons/items/技術書(衝擊之暈).png',
    social: 'assets/icons/items/兒子的信.png',
    more: 'assets/icons/items/古代的卷軸.png'
  };

  function $(id) { return document.getElementById(id); }
  function txt(id) { var e = $(id); return e ? (e.textContent || '').trim() : ''; }
  function mqOn() { try { return matchMedia(MOBILE_MQ).matches; } catch (e) { return false; } }
  function inGame() { var gs = $('game-screen'); return !!(gs && !gs.classList.contains('hidden')); }
  function view() { var m = document.body.className.match(/mview-(left|center|right)/); return m ? m[1] : 'center'; }
  function setView(v) {
    try { if (window.__afkm && __afkm.setView) { __afkm.setView(v); return; } } catch (e) {}
    var b = document.querySelector('#m-nav [data-view="' + v + '"]'); if (b) b.click();
  }
  // 代按右欄分頁鈕（switchTab 需要按鈕本身當第二參數，直接按原鈕最穩）
  function clickTab(tab) {
    var b = document.querySelector('#col-right .tab-bar [onclick^="switchTab(\'' + tab + '\'"]');
    if (b) b.click(); else try { window.switchTab(tab, null); } catch (e) {}
  }
  function proxy(id) { var b = $(id); if (b) b.click(); }

  // ---- CSS ------------------------------------------------------------------
  var G = '#d6b46a', G2 = '#8a6a35', INK = '#ecdfbf', BG = '#0c0a08';
  var FRAME = 'background:linear-gradient(180deg,#1d1812,#0f0d0a)!important;border:1px solid ' + G2 + '!important;' +
    'box-shadow:inset 0 0 0 1px rgba(0,0,0,.85),inset 0 0 0 2px rgba(214,180,106,.22),0 3px 12px rgba(0,0,0,.6)!important;border-radius:6px!important;';
  var BTN = 'background:linear-gradient(180deg,#2a2218,#15110c)!important;border:1px solid ' + G2 + '!important;color:' + INK + '!important;' +
    'box-shadow:inset 0 1px 0 rgba(255,230,170,.12),0 1px 3px rgba(0,0,0,.6)!important;border-radius:5px!important;' +
    'font-family:"Noto Serif TC","Songti TC","PMingLiU",serif!important;letter-spacing:1px;text-shadow:0 1px 1px #000;';
  var SERIF = 'font-family:"Noto Serif TC","Songti TC","PMingLiU",serif;';
  var CSS = [
    /* 注入的元素預設不顯示：只有 body.pp-skin 時才出現（關掉外掛/離開遊戲＝乾淨） */
    '#pp-head,#pp-viewbar,#pp-chat,#pp-actions,#m-nav .pp-nav,#pp-more{display:none;}',

    '@media ' + MOBILE_GEOM() + '{',
    /* 底色 */
    'body.pp-skin #game-screen{background:' + BG + ' radial-gradient(ellipse at 50% 0,rgba(214,180,106,.08),transparent 60%)!important;}',
    'body.pp-skin.game-bg-dim #game-screen::before{opacity:.35;}',
    /* 原本的狀態列讓位給 #pp-head */
    'body.pp-skin #m-status,body.pp-skin #mobile-vitals{display:none!important;}',

    /* ① 頂端角色資訊 */
    'body.pp-skin #pp-head{display:flex;gap:8px;position:sticky;top:0;order:-12;z-index:40;width:100%;padding:6px 8px;margin:0 0 6px;' + FRAME + '}',
    '#pp-head .pp-pt{width:58px;height:74px;flex:0 0 58px;border:1px solid ' + G2 + ';border-radius:4px;background:#000 82% 6% / 210% auto no-repeat;box-shadow:inset 0 0 8px #000;}',
    '#pp-head .pp-in{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;}',
    '#pp-head .pp-r1{display:flex;align-items:baseline;gap:8px;line-height:1.1;}',
    '#pp-head .pp-lv{color:#cbd5e1;font-size:12px;}',
    '#pp-head .pp-nm{color:#7cc4ff;font-size:15px;font-weight:700;' + SERIF + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%;}',
    '#pp-head .pp-gold{margin-left:auto;color:#f5d27a;font-weight:700;font-size:13px;white-space:nowrap;}',
    '#pp-head .pp-gold::before{content:"";display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff3b0,#d4a017 55%,#7a5a0a);vertical-align:-1px;}',
    '#pp-head .pp-chips{display:flex;gap:4px;}',
    '#pp-head .pp-chip{font-size:10.5px;color:' + INK + ';background:#1b1610;border:1px solid #4b3a1d;border-radius:3px;padding:0 5px;line-height:15px;}',
    '#pp-head .pp-bar{position:relative;height:13px;border:1px solid #3a2c15;background:#120f0b;border-radius:2px;overflow:hidden;}',
    '#pp-head .pp-bar i{position:absolute;left:0;top:0;bottom:0;width:0;transition:width .25s;}',
    '#pp-head .pp-bar.hp i{background:linear-gradient(180deg,#e0524a,#9b1c16);}',
    '#pp-head .pp-bar.mp i{background:linear-gradient(180deg,#5b8fe8,#1d3f9a);}',
    '#pp-head .pp-bar.ex{height:9px;} #pp-head .pp-bar.ex i{background:linear-gradient(180deg,#f3d27a,#a77b1c);}',
    '#pp-head .pp-bar b{position:relative;display:block;text-align:center;font:700 10px/13px ' + '"Georgia",serif;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;}',
    '#pp-head .pp-bar.ex b{font-size:8.5px;line-height:9px;text-align:left;padding-left:4px;}',

    /* ② 頁面標題列 */
    'body.pp-skin.mview-left #pp-viewbar,body.pp-skin.mview-right #pp-viewbar{display:flex;align-items:center;order:-11;width:100%;padding:8px 10px;margin:0 0 6px;' + FRAME + '}',
    '#pp-viewbar .pp-vt{flex:1;color:' + G + ';font-size:19px;font-weight:700;letter-spacing:3px;' + SERIF + 'text-shadow:0 1px 2px #000;}',
    '#pp-viewbar button{display:flex;align-items:center;gap:6px;background:none;border:0;color:' + INK + ';font-size:14px;' + SERIF + '}',
    '#pp-viewbar button i{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#e46a5e,#8f1510 70%);border:2px solid ' + G + ';color:#fff;font-style:normal;font-weight:900;line-height:24px;text-align:center;font-size:15px;box-shadow:0 0 6px rgba(0,0,0,.7);}',

    /* 面板／按鈕換皮 */
    'body.pp-skin #game-screen .panel:not(#status-panel){' + FRAME + '}',
    /* 分頁內容裡上游的藍灰底/框換成暗褐/古金 */
    'body.pp-skin #game-screen :is(.bg-slate-700,.bg-slate-800,.bg-slate-900,.bg-gray-800,.bg-gray-900){background-color:#17130e!important;}',
    'body.pp-skin #game-screen :is(.border-slate-500,.border-slate-600,.border-slate-700,.border-gray-600,.border-gray-700){border-color:#4b3a1d!important;}',
    'body.pp-skin #game-screen input[type=text],body.pp-skin #game-screen input[type=search]{background:#0a0907!important;border-color:#4b3a1d!important;color:' + INK + '!important;}',
    'body.pp-skin #game-screen .panel-header{background:transparent!important;border-color:rgba(138,106,53,.45)!important;}',
    'body.pp-skin #col-right .tab-bar .btn,body.pp-skin #map-view-panel .panel-header select{' + BTN + '}',
    'body.pp-skin #col-right .tab-bar .btn.active{border-color:' + G + '!important;color:#fff3cf!important;box-shadow:inset 0 0 10px rgba(214,180,106,.35),0 0 0 1px rgba(214,180,106,.45)!important;}',
    /* 地圖列：黑市/瞬移/出發 搬到下方動作列 → 這裡只留地區/地圖兩個下拉 */
    'body.pp-skin #btn-pandora-shortcut,body.pp-skin #btn-teleport,body.pp-skin #btn-return-town{display:none!important;}',

    /* ③ 日誌框 */
    'body.pp-skin #pp-chat:not(.pp-off){display:flex;flex-direction:column;margin-top:6px;height:178px;' + FRAME + 'padding:0!important;overflow:hidden;}',
    '#pp-chat .pp-tabs{display:flex;gap:3px;padding:4px;border-bottom:1px solid rgba(138,106,53,.45);overflow-x:auto;scrollbar-width:none;}',
    '#pp-chat .pp-tabs button{flex:0 0 auto;padding:2px 9px;font-size:12.5px;' + BTN + '}',
    '#pp-chat .pp-tabs button.on{color:#fff3cf!important;border-color:' + G + '!important;background:linear-gradient(180deg,#4a3a1e,#251c0f)!important;}',
    '#pp-chat .pp-log{flex:1;overflow-y:auto;padding:4px 8px;font-size:12.5px;line-height:1.45;color:#d6cfc0;}',
    '#pp-chat .pp-log>*{margin:0!important;padding:1px 0!important;font-size:12.5px!important;background:none!important;border:0!important;}',
    '#pp-chat .pp-empty{color:#6b6252;font-size:12px;}',
    '#pp-chat .pp-in{display:flex;gap:4px;padding:4px;border-top:1px solid rgba(138,106,53,.45);}',
    '#pp-chat .pp-in input{flex:1;min-width:0;background:#0a0907;border:1px solid #4b3a1d;border-radius:4px;color:' + INK + ';padding:4px 8px;font-size:13px;}',
    '#pp-chat .pp-in button{padding:3px 12px;font-size:13px;' + BTN + 'background:linear-gradient(180deg,#24456e,#122844)!important;border-color:#5b7fb0!important;}',

    /* ④ 動作列 */
    'body.pp-skin #pp-actions{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:6px;}',
    '#pp-actions button{padding:7px 0;font-size:13.5px;font-weight:700;' + BTN + '}',
    '#pp-actions button.pp-go{background:linear-gradient(180deg,#2f6db0,#173a66)!important;border-color:#7fb0e8!important;color:#fff!important;}',
    '#pp-actions button.pp-red{background:linear-gradient(180deg,#9b2a22,#561510)!important;border-color:#e07a6d!important;color:#fff!important;}',
    '#pp-actions button.pp-hide{visibility:hidden;}',
    /* 主動技能列(afk-skillbar)換成古金方格 */
    'body.pp-skin #m-skillbar .mskb-btn{' + BTN + 'padding:3px!important;}',

    /* ⑤ 底部導覽 */
    'body.pp-skin #m-nav{background:linear-gradient(180deg,#1a140d,#0a0806)!important;border-top:2px solid ' + G2 + '!important;box-shadow:0 -4px 14px rgba(0,0,0,.7);}',
    'body.pp-skin #m-nav .m-nav-btn{display:none!important;}',
    'body.pp-skin #m-nav .pp-nav{display:flex;width:100%;padding:4px 2px 3px;}',
    '#m-nav .pp-nav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;background:none;border:0;color:' + INK + ';font-size:12.5px;' + SERIF + 'letter-spacing:2px;text-shadow:0 1px 2px #000;padding:0;}',
    '#m-nav .pp-nav button span{width:40px;height:40px;border-radius:7px;border:1px solid ' + G2 + ';background:#120e09 center/80% auto no-repeat;box-shadow:inset 0 0 8px #000,0 0 0 1px #000;}',
    '#m-nav .pp-nav button.on{color:#fff3cf;}',
    '#m-nav .pp-nav button.on span{border-color:' + G + ';box-shadow:inset 0 0 10px rgba(214,180,106,.45),0 0 8px rgba(214,180,106,.55);}',

    /* 「更多」選單 */
    'body.pp-skin #pp-more.open{display:flex;position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,.55);align-items:flex-end;justify-content:center;padding:0 10px calc(var(--m-nav-h,0px) + 8px);}',
    '#pp-more .pp-sheet{width:100%;max-width:420px;max-height:70vh;overflow-y:auto;padding:10px;' + FRAME + '}',
    '#pp-more .pp-sh{display:flex;align-items:center;margin-bottom:8px;color:' + G + ';font-size:18px;' + SERIF + 'letter-spacing:3px;}',
    '#pp-more .pp-sh button{margin-left:auto;background:none;border:0;color:' + INK + ';font-size:22px;}',
    '#pp-more .pp-grid{display:grid;grid-template-columns:1fr;gap:6px;}',
    '#pp-more .pp-grid button{padding:11px 0;font-size:15.5px;' + BTN + '}',
    '}'
  ].join('\n');
  function MOBILE_GEOM() { return MOBILE_MQ; }

  function ensureStyle() {
    if ($('afk-pipiskin-style')) return;
    var st = document.createElement('style'); st.id = 'afk-pipiskin-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---- ① 頂端角色資訊 -------------------------------------------------------
  var head = null;
  function buildHead() {
    var gs = $('game-screen'); if (!gs) return;
    if (!head) {
      head = document.createElement('div'); head.id = 'pp-head';
      head.innerHTML =
        '<div class="pp-pt"></div><div class="pp-in">' +
        '<div class="pp-r1"><span class="pp-lv"></span><span class="pp-nm"></span><span class="pp-gold"></span></div>' +
        '<div class="pp-chips"><span class="pp-chip pp-ac"></span><span class="pp-chip pp-mr"></span></div>' +
        '<div class="pp-bar hp"><i></i><b></b></div><div class="pp-bar mp"><i></i><b></b></div><div class="pp-bar ex"><i></i><b></b></div></div>';
      head.querySelector('.pp-pt').addEventListener('click', function () { navGo('char'); });
    }
    if (head.parentNode !== gs || gs.firstElementChild !== head) gs.insertBefore(head, gs.firstChild);
  }
  var lastHead = '';
  function setText(sel, v) { var e = head.querySelector(sel); if (e && e.textContent !== v) e.textContent = v; }
  function width(id) { var e = $(id); return e && e.style.width ? e.style.width : '0%'; }
  function updateHead() {
    if (!head) return;
    var cls = txt('st-classname') || '--', nick = txt('st-class') || cls;
    var hp = txt('txt-hp') || '--', mp = txt('txt-mp') || '--', ex = txt('txt-exp') || width('bar-exp');
    var bg = '';
    try { var sp = $('status-panel'); bg = sp ? (sp.style.backgroundImage || '') : ''; } catch (e) {}   // 讀內聯值：computed 會被本檔的面板底色蓋掉
    var sig = [cls, nick, txt('st-lv'), txt('st-gold'), txt('st-ac'), txt('st-mr'), hp, mp, ex, width('bar-hp'), width('bar-mp'), width('bar-exp'), bg].join('|');
    if (sig === lastHead) return; lastHead = sig;
    setText('.pp-lv', 'Lv.' + (txt('st-lv') || '--') + ' ' + cls);
    setText('.pp-nm', nick);
    setText('.pp-gold', txt('st-gold') || '--');
    setText('.pp-ac', '防 ' + (txt('st-ac') || '--'));
    setText('.pp-mr', '魔防 ' + (txt('st-mr') || '--'));
    setText('.pp-bar.hp b', 'HP ' + hp.replace(/\s*\/\s*/, ' / '));
    setText('.pp-bar.mp b', 'MP ' + mp.replace(/\s*\/\s*/, ' / '));
    setText('.pp-bar.ex b', 'EXP ' + ex);
    head.querySelector('.pp-bar.hp i').style.width = width('bar-hp');
    head.querySelector('.pp-bar.mp i').style.width = width('bar-mp');
    head.querySelector('.pp-bar.ex i').style.width = width('bar-exp');
    var pt = head.querySelector('.pp-pt'); if (bg && bg !== 'none' && pt.style.backgroundImage !== bg) pt.style.backgroundImage = bg;
  }

  // ---- ② 頁面標題列 ---------------------------------------------------------
  var viewbar = null, viewTitle = '角色資訊';
  function buildViewbar() {
    var gs = $('game-screen'); if (!gs) return;
    if (!viewbar) {
      viewbar = document.createElement('div'); viewbar.id = 'pp-viewbar';
      viewbar.innerHTML = '<span class="pp-vt"></span><button type="button">關閉<i>✕</i></button>';
      viewbar.querySelector('button').addEventListener('click', function () { setView('center'); markNav(); });
    }
    if (viewbar.parentNode !== gs) gs.insertBefore(viewbar, head ? head.nextSibling : gs.firstChild);
    var t = view() === 'left' ? '隊伍' : viewTitle;
    var vt = viewbar.querySelector('.pp-vt'); if (vt.textContent !== t) vt.textContent = t;
  }

  // ---- ③ 日誌框 -------------------------------------------------------------
  var chat = null, chatTab = 'all', seq = 0, seen = new WeakMap(), lastChatSig = '';
  var SOURCES = { combat: 'combat-log', sys: 'sys-log', world: 'world-log' };
  var TABS = [['all', '全部'], ['combat', '戰鬥'], ['sys', '系統'], ['world', '世界'], ['drop', '掉落']];
  var DROP_RE = /獲得|得到|撿|拾取|掉落/;
  function buildChat() {
    var anchor = $('m-battle-buffs') || $('m-skillbar') || $('battle-view');
    if (!anchor || !anchor.parentNode) return;
    if (!chat) {
      chat = document.createElement('div'); chat.id = 'pp-chat';
      var tabs = document.createElement('div'); tabs.className = 'pp-tabs';
      TABS.forEach(function (t) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = t[1]; b.setAttribute('data-t', t[0]);
        b.addEventListener('click', function () { chatTab = t[0]; lastChatSig = ''; markTabs(); renderChat(true); });
        tabs.appendChild(b);
      });
      var log = document.createElement('div'); log.className = 'pp-log';
      var inp = document.createElement('div'); inp.className = 'pp-in';
      inp.innerHTML = '<input type="text" maxlength="60" autocomplete="off" placeholder="向世界頻道發問…"><button type="button">送出</button>';
      var send = function () {
        var src = $('world-input'), i = inp.querySelector('input');
        if (!src || !i.value.trim()) return;
        src.value = i.value; i.value = '';
        try { src.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        proxy('world-send');
        chatTab = 'world'; lastChatSig = ''; markTabs(); setTimeout(function () { renderChat(true); }, 300);
      };
      inp.querySelector('button').addEventListener('click', send);
      inp.querySelector('input').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
      chat.appendChild(tabs); chat.appendChild(log); chat.appendChild(inp);
      markTabs();
    }
    var after = $('m-battle-buffs') || $('m-skillbar') || $('battle-view');
    if (chat.previousSibling !== after) after.parentNode.insertBefore(chat, after.nextSibling);
    if (!$('world-input')) chat.querySelector('.pp-in').style.display = 'none';
  }
  function markTabs() {
    if (!chat) return;
    var bs = chat.querySelectorAll('.pp-tabs button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-t') === chatTab);
  }
  function collect(key) {
    var el = $(SOURCES[key]); if (!el) return [];
    var out = [], kids = el.children, from = Math.max(0, kids.length - CHAT_MAX);
    for (var i = from; i < kids.length; i++) {
      var n = kids[i];
      if (!seen.has(n)) seen.set(n, ++seq);
      out.push({ n: n, s: seen.get(n), k: key });
    }
    return out;
  }
  function renderChat(force) {
    if (!chat) return;
    var rows;
    if (chatTab === 'all') rows = collect('combat').concat(collect('sys'), collect('world'));
    else if (chatTab === 'drop') rows = collect('sys').filter(function (r) { return DROP_RE.test(r.n.textContent || ''); });
    else rows = collect(chatTab);
    rows.sort(function (a, b) { return a.s - b.s; });
    if (rows.length > CHAT_MAX) rows = rows.slice(rows.length - CHAT_MAX);
    var sig = chatTab + ':' + rows.length + ':' + (rows.length ? rows[rows.length - 1].s : 0);
    if (!force && sig === lastChatSig) return; lastChatSig = sig;
    var log = chat.querySelector('.pp-log');
    var atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var c = r.n.cloneNode(true);
      c.removeAttribute && c.removeAttribute('id');
      var ids = c.querySelectorAll ? c.querySelectorAll('[id]') : [];
      for (var i = 0; i < ids.length; i++) ids[i].removeAttribute('id');   // 複製品不可帶 id（避免核心 getElementById 抓錯）
      frag.appendChild(c);
    });
    if (!rows.length) { var e = document.createElement('div'); e.className = 'pp-empty'; e.textContent = '尚無訊息'; frag.appendChild(e); }
    log.textContent = ''; log.appendChild(frag);
    if (atBottom || force) log.scrollTop = log.scrollHeight;
  }

  // ---- ④ 動作列 -------------------------------------------------------------
  var actions = null;
  var ACTS = [
    { k: 'tp', label: '瞬移', src: 'btn-teleport' },
    { k: 'bm', label: '黑市', src: 'btn-pandora-shortcut' },
    { k: 'go', label: '出發', src: 'btn-return-town', cls: 'pp-go' },
    { k: 'set', label: '掛機設定', fn: function () { navGo('auto'); } },
    { k: 'log', label: '日誌', fn: function () { var b = document.querySelector('#m-nav [data-view="log"]'); if (b) b.click(); } }
  ];
  function buildActions() {
    if (!chat || !chat.parentNode) return;
    if (!actions) {
      actions = document.createElement('div'); actions.id = 'pp-actions';
      ACTS.forEach(function (a) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = a.label; b.setAttribute('data-k', a.k);
        if (a.cls) b.className = a.cls;
        b.addEventListener('click', a.fn || function () { proxy(a.src); });
        actions.appendChild(b);
      });
    }
    if (actions.previousSibling !== chat) chat.parentNode.insertBefore(actions, chat.nextSibling);
  }
  function updateActions() {
    if (!actions) return;
    ACTS.forEach(function (a) {
      if (!a.src) return;
      var b = actions.querySelector('[data-k="' + a.k + '"]'), s = $(a.src);
      var gone = !s || s.classList.contains('hidden') || s.disabled;
      if (s && a.k === 'go') {
        var t = (s.textContent || '').trim() || '出發';
        if (b.textContent !== t) b.textContent = t;
        b.classList.toggle('pp-red', /回村/.test(t)); b.classList.toggle('pp-go', !/回村/.test(t));
      }
      b.classList.toggle('pp-hide', gone);
    });
  }

  // ---- ⑤ 底部導覽 / 更多 ----------------------------------------------------
  var NAV = [
    { k: 'char', label: '角色', icon: ICON.char, title: '角色資訊' },
    { k: 'bag', label: '背包', icon: ICON.bag, title: '背包' },
    { k: 'skill', label: '技能', icon: ICON.skill, title: '魔法技能' },
    { k: 'social', label: '社交', icon: ICON.social, title: '社交' },
    { k: 'more', label: '更多', icon: ICON.more }
  ];
  var MORE = [
    { label: '隊伍', go: function () { setView('left'); } },
    { label: '裝備', tab: 'equip', title: '裝備' },
    { label: '武器', tab: 'weapons', title: '武器' },
    { label: '防具', tab: 'armors', title: '防具' },
    { label: '收藏', go: function () { try { openCollectionPanel(); } catch (e) {} } },
    { label: '自動賣出', go: function () { proxy('btn-autosell'); } },
    { label: '血盟', tab: 'clan', title: '血盟' },
    { label: '統計／存檔', go: function () { navGo('audit'); } },
    { label: '掛機設定', tab: 'automation', title: '掛機設定' },
    { label: '怪物／掉落查詢', go: function () { proxy('m-dex-open'); }, need: 'm-dex-open' },
    { label: '小百科', go: function () { proxy('m-wiki-open'); }, need: 'm-wiki-open' },
    { label: '登出', go: function () { var b = document.querySelector('#m-nav [data-view="logout"]'); if (b) b.click(); } }
  ];
  var navSel = null;
  function navGo(k) {
    var map = { char: ['stats', '角色資訊'], bag: ['items', '背包'], skill: ['skill', '魔法技能'], social: ['pvp', '社交'], auto: ['automation', '掛機設定'], audit: ['audit', '統計／存檔'] };
    if (k === 'more') { openMore(); return; }
    var m = map[k]; if (!m) return;
    viewTitle = m[1]; navSel = (k === 'auto' || k === 'audit') ? null : k;
    setView('right'); clickTab(m[0]);
    if (k === 'audit') try { saveGame(); } catch (e) {}
    var gs = $('game-screen'); if (gs) gs.scrollTop = 0;
    markNav();
  }
  function markNav() {
    var nav = document.querySelector('#m-nav .pp-nav'); if (!nav) return;
    var v = view(), bs = nav.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', v === 'right' && bs[i].getAttribute('data-k') === navSel);
  }
  function buildNav() {
    var nav = $('m-nav'); if (!nav) return false;
    if (nav.querySelector('.pp-nav')) return false;
    var box = document.createElement('div'); box.className = 'pp-nav';
    NAV.forEach(function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-k', n.k);
      b.innerHTML = '<span></span>' + n.label;
      b.querySelector('span').style.backgroundImage = 'url("' + encodeURI(n.icon) + '")';
      b.addEventListener('click', function () {
        if (n.k !== 'more' && view() === 'right' && navSel === n.k) { setView('center'); navSel = null; markNav(); return; }   // 再按一次＝回戰鬥
        navGo(n.k);
      });
      box.appendChild(b);
    });
    nav.appendChild(box);
    return true;
  }
  var more = null;
  function openMore() {
    if (!more) {
      more = document.createElement('div'); more.id = 'pp-more';
      more.innerHTML = '<div class="pp-sheet"><div class="pp-sh">更多<button type="button">✕</button></div><div class="pp-grid"></div></div>';
      more.addEventListener('click', function (e) { if (e.target === more) closeMore(); });
      more.querySelector('.pp-sh button').addEventListener('click', closeMore);
      document.body.appendChild(more);
    }
    var grid = more.querySelector('.pp-grid'); grid.textContent = '';
    MORE.forEach(function (m) {
      if (m.need && !$(m.need)) return;
      var b = document.createElement('button'); b.type = 'button'; b.textContent = m.label;
      b.addEventListener('click', function () {
        closeMore();
        if (m.tab) { viewTitle = m.title; navSel = null; setView('right'); clickTab(m.tab); var gs = $('game-screen'); if (gs) gs.scrollTop = 0; markNav(); }
        else m.go();
      });
      grid.appendChild(b);
    });
    more.classList.add('open');
  }
  function closeMore() { if (more) more.classList.remove('open'); }

  // ---- 主迴圈 ---------------------------------------------------------------
  function tick() {
    var on = document.body.classList.contains('m-mobile') && mqOn() && inGame();
    document.body.classList.toggle('pp-skin', on);
    if (!on) { closeMore(); return; }
    try {
      ensureStyle();
      buildHead(); updateHead();
      buildViewbar();
      buildChat(); renderChat(false);
      var bv = $('battle-view');
      if (chat) chat.classList.toggle('pp-off', !bv || bv.classList.contains('hidden'));   // 村莊/城鎮時收起，讓出 NPC 清單
      buildActions(); updateActions();
      if (buildNav()) { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }   // 讓 afk-mobile 重量 --m-nav-h
      if (view() === 'center' && navSel) navSel = null;
      markNav();
    } catch (e) { try { console.warn('[afk-pipiskin]', e); } catch (e2) {} }
  }

  function start() { ensureStyle(); tick(); setInterval(tick, TICK_MS); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
