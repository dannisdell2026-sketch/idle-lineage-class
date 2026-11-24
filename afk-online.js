/* ============================================================================
 * afk-online.js — 線上功能：帳號登入、在線名單、世界聊天、面對面交易、交易所（Firebase Realtime Database）
 *
 * 設定：網站根目錄的 firebase-config.json（Firebase 主控台「網頁應用程式」那段 firebaseConfig）。
 *       讀不到（例如本機 file:// 直接開）→ 整個線上功能不出現，遊戲照常單機玩。
 * 帳號：玩家輸入「帳號＋密碼」；帳號轉成 <hex>@players.idle-lineage.game 給 Firebase 的電子郵件登入用（玩家看不到）。
 *       登入狀態只存在這個分頁（SESSION），所以同一台電腦開兩個分頁可以登兩個帳號。
 * 遊戲存檔仍在玩家自己的瀏覽器；交易時的道具／金幣用「託管」保護：
 *   ・面對面交易：按「鎖定」當下就把道具／金幣從存檔拿出來放進交易紀錄；雙方都確認→各自領對方的；任一方取消→各自拿回自己的。
 *   ・交易所：上架當下道具離開存檔；買家用交易(transaction)搶到才扣金幣拿貨；賣家上線時自動領貨款；下架拿回道具。
 *   每次登入都會掃一遍「該領沒領／該退沒退」的紀錄補發，避免中途關網頁造成遺失。
 *   ⚠️ 存檔在玩家端，有心人可以改存檔；這只能擋「正常操作」下的遺失與重複，擋不了作弊。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'online', name: '線上聊天與交易', group: '其他', def: true,
      desc: '帳號登入後可和其他玩家聊天、面對面交易、使用交易所'
    });
    if (!AFK_TOGGLES.enabled('online')) return;
  }

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var EMAIL_DOMAIN = '@players.idle-lineage.game';
  var CHAT_LIMIT = 60, CHAT_MAX_LEN = 100, CHAT_GAP_MS = 1500;

  var cfg = null, fb = null, auth = null, db = null, me = null, myName = '';
  var ui = null, tab = 'chat', curTrade = null, offs = [];
  var lastSend = 0, presenceRef = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inGame() { var gs = $('game-screen'); return !!(gs && !gs.classList.contains('hidden') && typeof player !== 'undefined' && player && player.cls); }
  function toHex(s) { return Array.prototype.map.call(new TextEncoder().encode(s), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function nameKey(n) { return toHex(String(n).trim().toLowerCase()); }
  function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
  function itemName(it) {
    try { var h = getItemFullName(it); var d = document.createElement('div'); d.innerHTML = h; return d.textContent; } catch (e) {}
    try { var dd = DB.items[it.id]; return (it.en ? '+' + it.en + ' ' : '') + (dd ? dd.n : it.id); } catch (e) { return it.id; }
  }
  function itemLabel(it) { return itemName(it) + ((it.cnt || 1) > 1 ? ' ×' + it.cnt : ''); }
  function fmt(n) { return (Number(n) || 0).toLocaleString(); }
  // Realtime Database transaction：第一次呼叫可能拿到本機快取的 null（還沒讀到伺服器）→ 回傳 null 讓 SDK 拿真資料重跑；
  //   fn 回傳 undefined＝放棄。committed 只在「節點真的存在且被我們改到」時才算數。
  function txn(ref, fn) {
    return ref.transaction(function (x) { if (x === null) return null; return fn(x); })
      .then(function (r) { return { committed: !!(r.committed && r.snapshot && r.snapshot.exists()), snap: r.snapshot }; });
  }

  // ---- 存檔操作（只在角色已載入時做；做完立刻存檔） -------------------------------
  function canTouchSave() { return inGame() && typeof saveGame === 'function'; }
  function save() { try { if (player && player.cls) saveGame(); } catch (e) { console.warn('[afk-online] save', e); } }
  function refreshUI() { try { if (typeof renderTabs === 'function') renderTabs(true); } catch (e) {} try { if (typeof updateUI === 'function') updateUI(); } catch (e) {} }
  function tradeable(it) { return it && !it.lock && !it.gw; }
  function cleanItem(it, cnt) {
    var o = {}; for (var k in it) if (Object.prototype.hasOwnProperty.call(it, k)) o[k] = it[k];
    delete o.uid; delete o.lock; delete o.junk; o.cnt = cnt;
    return JSON.parse(JSON.stringify(o));
  }
  // 從背包拿出（依 uid）；回傳拿出的物品複本，失敗回 null
  function takeItem(uidv, cnt) {
    var i = player.inv.findIndex(function (x) { return x.uid === uidv; });
    if (i < 0) return null;
    var it = player.inv[i]; if (!tradeable(it)) return null;
    var have = it.cnt || 1; cnt = Math.max(1, Math.min(have, Math.floor(cnt) || 1));
    var out = cleanItem(it, cnt);
    if (cnt >= have) player.inv.splice(i, 1); else it.cnt = have - cnt;
    return out;
  }
  // 放回背包（同簽章併成一疊，符合核心「同簽章只有一格」的規則）
  function putItem(obj) {
    if (!obj || !obj.id) return;
    var it = JSON.parse(JSON.stringify(obj)); it.cnt = Math.max(1, Math.floor(it.cnt) || 1);
    try { if (typeof registerEquipObtained === 'function') registerEquipObtained(it.id); } catch (e) {}
    try { if (typeof registerMiscObtained === 'function') registerMiscObtained(it.id); } catch (e) {}
    try { if (typeof registerRelicObtained === 'function') registerRelicObtained(it.id); } catch (e) {}
    var ex = null;
    try { ex = player.inv.find(function (x) { return !x.gw && !x.lock && sameItemSig(x, it); }); } catch (e) {}
    if (ex) ex.cnt = (ex.cnt || 1) + it.cnt;
    else { it.uid = (typeof uid === 'function') ? uid() : Math.random().toString(36).slice(2, 11); it.lock = false; it.junk = false; player.inv.push(it); }
  }

  // ---- 啟動 -------------------------------------------------------------------
  function boot() {
    if (location.protocol === 'file:') return;
    fetch('firebase-config.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { if (!c || !c.apiKey || !c.databaseURL) return; cfg = c; injectButton(); titleBox(); setInterval(titleBox, 800); })
      .catch(function () {});
  }
  var sdkP = null;
  function sdk() {
    if (sdkP) return sdkP;
    sdkP = loadScript(SDK + 'firebase-app-compat.js')
      .then(function () { return Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-database-compat.js')]); })
      .then(function () {
        fb = window.firebase;
        var app = fb.apps.length ? fb.app() : fb.initializeApp(cfg);
        auth = fb.auth(app); db = fb.database(app);
        return auth.setPersistence(fb.auth.Auth.Persistence.SESSION).catch(function () {});
      })
      .then(function () {
        auth.onAuthStateChanged(function (u) {
          offAll(); me = u || null; myName = '';
          if (me) {
            db.ref('users/' + me.uid + '/name').once('value').then(function (s) { myName = s.val() || '玩家'; onLogin(); });
          } else render();
        });
      });
    return sdkP;
  }

  // ---- 入口按鈕與面板 ----------------------------------------------------------
  var CSS = [
    '#afk-on-btn{position:fixed;left:8px;bottom:calc(var(--m-nav-h,0px) + 10px);z-index:9650;padding:7px 12px;border-radius:18px;border:1px solid #d6b46a;background:#2a2218;color:#f5d27a;font-weight:700;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.6);display:none;}',
    '#afk-on-btn .dot{display:none;width:8px;height:8px;border-radius:50%;background:#ef4444;margin-left:6px;vertical-align:1px;}',
    '#afk-on-btn.has .dot{display:inline-block;}',
    '#afk-on{position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,.55);display:none;align-items:flex-end;justify-content:center;padding:8px 8px calc(var(--m-nav-h,0px) + 8px);}',
    '#afk-on.open{display:flex;}',
    '#afk-on .box{width:100%;max-width:520px;height:min(78vh,640px);display:flex;flex-direction:column;background:linear-gradient(180deg,#1d1812,#0f0d0a);border:1px solid #8a6a35;border-radius:8px;color:#ecdfbf;font-size:14px;overflow:hidden;}',
    '#afk-on .hd{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(138,106,53,.5);}',
    '#afk-on .hd b{color:#d6b46a;font-size:17px;}',
    '#afk-on .hd .who{margin-left:auto;font-size:12px;color:#a8996f;}',
    '#afk-on .hd button{background:none;border:0;color:#ecdfbf;font-size:18px;}',
    '#afk-on .hd .lo{font-size:12px;border:1px solid #4b3a1d;border-radius:4px;padding:1px 6px;}',
    '#afk-on .tabs{display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid rgba(138,106,53,.35);}',
    '#afk-on .tabs button,#afk-on .bt{padding:4px 10px;border-radius:5px;border:1px solid #8a6a35;background:linear-gradient(180deg,#2a2218,#15110c);color:#ecdfbf;font-size:13px;}',
    '#afk-on .tabs button.on{border-color:#d6b46a;color:#fff3cf;background:linear-gradient(180deg,#4a3a1e,#251c0f);}',
    '#afk-on .bt.pri{background:linear-gradient(180deg,#2f6db0,#173a66);border-color:#7fb0e8;color:#fff;}',
    '#afk-on .bt.red{background:linear-gradient(180deg,#9b2a22,#561510);border-color:#e07a6d;color:#fff;}',
    '#afk-on .bt[disabled]{opacity:.45;}',
    '#afk-on .bd{flex:1;overflow-y:auto;padding:8px 10px;}',
    '#afk-on .ft{display:flex;gap:6px;padding:6px 8px;border-top:1px solid rgba(138,106,53,.4);}',
    '#afk-on input,#afk-on select{background:#0a0907;border:1px solid #4b3a1d;color:#ecdfbf;border-radius:4px;padding:5px 7px;font-size:14px;min-width:0;}',
    '#afk-on .ft input{flex:1;}',
    '#afk-on .msg{padding:2px 0;line-height:1.45;word-break:break-all;}',
    '#afk-on .msg .n{color:#7cc4ff;font-weight:700;margin-right:4px;}',
    '#afk-on .msg.me .n{color:#f5d27a;}',
    '#afk-on .row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(75,58,29,.5);}',
    '#afk-on .row .grow{flex:1;min-width:0;}',
    '#afk-on .sub{font-size:12px;color:#a8996f;}',
    '#afk-on .form{display:grid;gap:8px;max-width:300px;margin:20px auto;}',
    '#afk-on .err{color:#f87171;font-size:12.5px;min-height:1em;}',
    '#afk-on .ok{color:#a7f3d0;font-size:12.5px;min-height:1em;}',
    '#afk-on .tw{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
    '#afk-on .tw .side{border:1px solid #4b3a1d;border-radius:6px;padding:6px;min-height:140px;}',
    '#afk-on .tw .side h4{margin:0 0 4px;font-size:13px;color:#d6b46a;}',
    '#afk-on .tag{font-size:11px;border-radius:3px;padding:0 4px;margin-left:4px;}',
    '#afk-on .tag.l{background:#4a3a1e;color:#f5d27a;}',
    '#afk-on .tag.c{background:#173a66;color:#bfdbfe;}',
    '#afk-pick{position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;padding:12px;}',
    '#afk-pick.open{display:flex;}',
    '#afk-pick .box{width:100%;max-width:420px;max-height:80vh;display:flex;flex-direction:column;background:#15110c;border:1px solid #8a6a35;border-radius:8px;color:#ecdfbf;}',
    '#afk-pick .list{flex:1;overflow-y:auto;padding:6px 10px;}',
    '#afk-pick .it{padding:6px 4px;border-bottom:1px solid rgba(75,58,29,.5);cursor:pointer;}',
    '#afk-pick .it.sel{background:rgba(214,180,106,.18);}',
    '#afk-pick .ft{display:flex;gap:6px;align-items:center;padding:8px 10px;border-top:1px solid #4b3a1d;flex-wrap:wrap;}',
    '#afk-pick input{background:#0a0907;border:1px solid #4b3a1d;color:#ecdfbf;border-radius:4px;padding:5px;width:90px;}',
    '#afk-pick .bt{padding:5px 12px;border-radius:5px;border:1px solid #8a6a35;background:#2a2218;color:#ecdfbf;}',
    '#afk-inv{position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:9900;background:#1d1812;border:1px solid #d6b46a;border-radius:8px;padding:12px 14px;color:#ecdfbf;box-shadow:0 6px 20px rgba(0,0,0,.7);font-size:14px;}',
    '#afk-inv .bt{margin:8px 6px 0 0;padding:5px 12px;border-radius:5px;border:1px solid #8a6a35;background:#2a2218;color:#ecdfbf;}'
  ].join('\n');

  function injectButton() {
    if ($('afk-on-btn')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var b = document.createElement('button'); b.id = 'afk-on-btn'; b.type = 'button'; b.innerHTML = '💬 線上<span class="dot"></span>';
    b.addEventListener('click', openPanel);
    document.body.appendChild(b);
    setInterval(function () { b.style.display = inGame() ? 'block' : 'none'; }, 1000);
    // 曾登入過的分頁（SESSION 還在）→ 預先連線，邀請／貨款才收得到
    try { if (sessionStorage.getItem('afk_on_auto')) sdk(); } catch (e) {}
  }
  function openPanel() {
    $('afk-on-btn').classList.remove('has');
    if (!ui) buildPanel();
    ui.classList.add('open');
    render();
    sdk().then(render).catch(function () { setBody('<div class="err">連不上線上服務，請稍後再試。</div>'); });
  }
  function buildPanel() {
    ui = document.createElement('div'); ui.id = 'afk-on';
    ui.innerHTML = '<div class="box"><div class="hd"><b>線上</b><span class="who"></span><button type="button" class="lo" style="display:none">登出</button><button type="button" data-x>✕</button></div>' +
      '<div class="tabs"></div><div class="bd"></div><div class="ft" style="display:none"></div></div>';
    document.body.appendChild(ui);
    ui.addEventListener('click', function (e) { if (e.target === ui || e.target.hasAttribute('data-x')) ui.classList.remove('open'); });
    ui.querySelector('.lo').addEventListener('click', function () { try { sessionStorage.removeItem('afk_on_auto'); } catch (e) {} if (presenceRef) presenceRef.remove(); auth.signOut(); });
  }
  function setBody(h) { if (ui) ui.querySelector('.bd').innerHTML = h; }
  function setFoot(h) { var f = ui.querySelector('.ft'); f.style.display = h ? '' : 'none'; f.innerHTML = h || ''; }

  function render() {
    if (!ui) return;
    var who = ui.querySelector('.who'), lo = ui.querySelector('.lo'), tabs = ui.querySelector('.tabs');
    if (!auth) { who.textContent = ''; lo.style.display = 'none'; tabs.innerHTML = ''; setFoot(''); setBody('<div class="sub" style="padding:20px;text-align:center">連線中…</div>'); return; }
    if (!me) { who.textContent = ''; lo.style.display = 'none'; tabs.innerHTML = ''; setFoot(''); renderLogin(); return; }
    who.textContent = myName; lo.style.display = '';
    tabs.innerHTML = [['chat', '聊天'], ['who', '在線'], ['market', '交易所'], ['trade', '交易' + (curTrade ? ' •' : '')]]
      .map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('');
    tabs.querySelectorAll('button').forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-t'); render(); }; });
    if (tab === 'chat') renderChat(); else if (tab === 'who') renderWho(); else if (tab === 'market') renderMarket(); else renderTrade();
  }

  // ---- 登入／註冊 --------------------------------------------------------------
  function renderLogin() {
    setBody('<div class="form"><input data-u placeholder="帳號（2～12 字）" maxlength="12" autocomplete="username">' +
      '<input data-p type="password" placeholder="密碼（至少 6 個字元）" autocomplete="current-password">' +
      '<button type="button" class="bt pri" data-a="in">登入</button><button type="button" class="bt" data-a="up">註冊新帳號</button><div class="err"></div></div>');
    var bd = ui.querySelector('.bd'), err = bd.querySelector('.err');
    function vals() { return { u: bd.querySelector('[data-u]').value.trim(), p: bd.querySelector('[data-p]').value }; }
    function bad(m) { err.textContent = m; }
    bd.querySelector('[data-a="in"]').onclick = function () { var v = vals(); bad(''); doLogin(v.u, v.p).catch(bad); };
    bd.querySelector('[data-a="up"]').onclick = function () { var v = vals(); bad('註冊中…'); doRegister(v.u, v.p).then(function () { bad(''); }, bad); };
  }

  // ---- 帳號：登入／註冊（面板與標題畫面共用）-------------------------------------
  // email＝帳號 UTF-8 的十六進位＋網域；Firebase email 前段上限 64 字 → 超過 60 字（約 10 個中文字以上）取前 60 字。
  function emailOf(u) { var h = toHex(String(u).trim().toLowerCase()); return (h.length > 60 ? h.slice(0, 60) : h) + EMAIL_DOMAIN; }
  function authErr(e, def) {
    if (typeof e === 'string') return e;
    var c = (e && e.code) || '';
    if (c === 'taken' || c === 'auth/email-already-in-use') return '這個帳號已經有人用了。';
    if (c === 'auth/weak-password') return '密碼至少 6 個字元。';
    if (c === 'auth/too-many-requests') return '嘗試太多次，請稍後再試。';
    if (c === 'auth/network-request-failed') return '網路連不上，請檢查網路。';
    if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') return '帳號或密碼錯誤。';
    return def + '（' + (c || (e && e.message) || e) + '）';
  }
  function doLogin(u, p) {
    u = String(u || '').trim(); if (!u || !p) return Promise.reject('請輸入帳號和密碼。');
    return sdk().then(function () { return auth.signInWithEmailAndPassword(emailOf(u), p); })
      .then(function () { try { sessionStorage.setItem('afk_on_auto', '1'); } catch (e) {} })
      .catch(function (e) { throw authErr(e, '登入失敗'); });
  }
  function doRegister(u, p) {
    u = String(u || '').trim();
    if (u.length < 2 || u.length > 12 || /[\s<>.#$\[\]\/]/.test(u)) return Promise.reject('帳號要 2～12 字，不能有空白或 < > . # $ [ ] /。');
    if (!p || p.length < 6) return Promise.reject('密碼至少 6 個字元。');
    var key = nameKey(u);
    return sdk().then(function () { return db.ref('names/' + key).once('value'); })
      .then(function (s) { if (s.exists()) throw { code: 'taken' }; return auth.createUserWithEmailAndPassword(emailOf(u), p); })
      .then(function (cred) {
        return db.ref('names/' + key).set(cred.user.uid)
          .then(function () { return db.ref('users/' + cred.user.uid).set({ name: u, created: fb.database.ServerValue.TIMESTAMP }); })
          .then(function () { myName = u; try { sessionStorage.setItem('afk_on_auto', '1'); } catch (e) {} offAll(); onLogin(); });
      })
      .catch(function (e) { throw authErr(e, '註冊失敗'); });
  }
  // 標題畫面「開始遊戲」上方的登入框（不登入＝單機玩）
  var TITLE_CSS = '#afk-on-title{width:18rem;max-width:90vw;margin:0 auto 10px;padding:9px 11px;border:1px solid #7a5d2a;border-radius:8px;background:linear-gradient(#22180b,#120c05);color:#e8d6a8;font:13px/1.5 "Noto Serif TC","PMingLiU",serif;text-align:left}' +
    '#afk-on-title .t{color:#e2c27a;font-weight:700;margin-bottom:4px}#afk-on-title input{width:100%;box-sizing:border-box;margin:3px 0;padding:6px 8px;background:#0a0806;border:1px solid #5a4520;border-radius:4px;color:#f0e2bd;font-size:14px}' +
    '#afk-on-title .r{display:flex;gap:6px;margin-top:5px}#afk-on-title button{flex:1;padding:7px 0;border:1px solid #8a6a2a;border-radius:5px;background:#1c140a;color:#cdb47a;font:700 14px/1 inherit;cursor:pointer}' +
    '#afk-on-title button.pri{background:linear-gradient(#4a3514,#241808);color:#ffe3a0}#afk-on-title .err{color:#ff8f7a;font-size:12px;min-height:16px;margin-top:3px}#afk-on-title .n{font-size:11.5px;color:#a8946a;margin-top:4px}#afk-on-title b{color:#ffd77a}';
  function titleBox() {
    var sb = $('btn-start-menu'), box = $('afk-on-title');
    if (!sb || !sb.offsetParent) { if (box) box.style.display = 'none'; return; }
    if (!$('afk-on-title-css')) { var st = document.createElement('style'); st.id = 'afk-on-title-css'; st.textContent = TITLE_CSS; document.head.appendChild(st); }
    if (!box) { box = document.createElement('div'); box.id = 'afk-on-title'; }
    if (box.nextSibling !== sb) sb.parentNode.insertBefore(box, sb);
    box.style.display = '';
    var state = me ? 'in:' + myName : 'out';
    if (box.getAttribute('data-s') === state) return; box.setAttribute('data-s', state);
    box.innerHTML = me
      ? '<div class="t">🌐 已登入：<b>' + esc(myName || '…') + '</b></div><div class="n">按「開始遊戲」進去就能和其他玩家聊天、交易、決鬥。</div><div class="r"><button type="button" data-a="out">登出</button></div><div class="err"></div>'
      : '<div class="t">🌐 線上帳號（不登入＝單機玩）</div><input data-u placeholder="帳號（2～12 字，中英文都可）" maxlength="12" autocomplete="username"><input data-p type="password" placeholder="密碼（至少 6 個字元）" autocomplete="current-password">' +
        '<div class="r"><button type="button" class="pri" data-a="in">登入</button><button type="button" data-a="up">註冊新帳號</button></div><div class="err"></div>';
    box.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var err = box.querySelector('.err');
      if (b.dataset.a === 'out') { try { sessionStorage.removeItem('afk_on_auto'); } catch (e2) {} if (auth) auth.signOut(); return; }
      var u = box.querySelector('[data-u]').value, p = box.querySelector('[data-p]').value;
      err.textContent = b.dataset.a === 'in' ? '登入中…' : '註冊中…'; b.disabled = true;
      (b.dataset.a === 'in' ? doLogin(u, p) : doRegister(u, p)).then(function () { err.textContent = ''; b.disabled = false; box.removeAttribute('data-s'); }, function (m) { err.textContent = m; b.disabled = false; });
    };
    box.querySelector('[data-p]') && box.querySelector('[data-p]').addEventListener('keydown', function (e) { if (e.key === 'Enter') box.querySelector('[data-a="in"]').click(); });
  }

  // ---- 登入後：在線、聊天、邀請、補發 -------------------------------------------
  var chatMsgs = [], online = {}, market = {}, myTrades = {};
  function on(ref, ev, fn) { ref.on(ev, fn); offs.push(function () { ref.off(ev, fn); }); }
  function offAll() { offs.forEach(function (f) { try { f(); } catch (e) {} }); offs = []; chatMsgs = []; online = {}; market = {}; myTrades = {}; curTrade = null; }
  function onLogin() {
    if (!me) return;
    // 在線（關網頁自動移除）
    presenceRef = db.ref('presence/' + me.uid);
    on(db.ref('.info/connected'), 'value', function (s) {
      if (!s.val()) return;
      presenceRef.onDisconnect().remove();
      updatePresence();
    });
    var pT = setInterval(updatePresence, 30000); offs.push(function () { clearInterval(pT); });
    on(db.ref('presence'), 'value', function (s) { online = s.val() || {}; if (tab === 'who') render(); });
    // 聊天
    on(db.ref('chat').orderByChild('t').limitToLast(CHAT_LIMIT), 'child_added', function (s) {
      chatMsgs.push(s.val()); if (chatMsgs.length > CHAT_LIMIT) chatMsgs.shift();
      if (ui && ui.classList.contains('open') && tab === 'chat') appendChat(s.val());
      else { var b = $('afk-on-btn'); if (b && s.val().uid !== me.uid) b.classList.add('has'); }
    });
    // 邀請
    on(db.ref('invites/' + me.uid), 'child_added', function (s) { showInvite(s.key, s.val()); });
    // 交易所
    on(db.ref('market').orderByChild('status').equalTo('open'), 'value', function (s) { market = s.val() || {}; if (tab === 'market') render(); });
    // 我的交易（a 或 b 是我）
    ['a', 'b'].forEach(function (k) {
      on(db.ref('trades').orderByChild(k).equalTo(me.uid), 'value', function (s) {
        var v = s.val() || {};
        Object.keys(myTrades).forEach(function (id) { if (myTrades[id]._k === k && !v[id]) delete myTrades[id]; });
        Object.keys(v).forEach(function (id) { v[id]._k = k; myTrades[id] = v[id]; });
        settleTrades();
        if (tab === 'trade') render();
      });
    });
    // 交易所：賣出的貨款、買到沒領的貨
    on(db.ref('market').orderByChild('seller').equalTo(me.uid), 'value', function (s) { settleSeller(s.val() || {}); if (tab === 'market') render(); });
    on(db.ref('market').orderByChild('buyer').equalTo(me.uid), 'value', function (s) { settleBuyer(s.val() || {}); });
    render();
  }
  function updatePresence() {
    if (!me || !presenceRef) return;
    var o = { name: myName, t: fb.database.ServerValue.TIMESTAMP };
    try { if (inGame()) { o.lv = player.lv; o.cls = (document.getElementById('st-classname') || {}).textContent || ''; } } catch (e) {}
    presenceRef.set(o).catch(function () {});
  }

  function renderChat() {
    setBody('<div data-c></div>');
    var c = ui.querySelector('[data-c]'); chatMsgs.forEach(function (m) { c.appendChild(msgEl(m)); });
    setFoot('<input data-m maxlength="' + CHAT_MAX_LEN + '" placeholder="說點什麼…"><button type="button" class="bt pri" data-a="send">送出</button>');
    var inp = ui.querySelector('[data-m]');
    function send() {
      var t = inp.value.trim(); if (!t) return;
      if (Date.now() - lastSend < CHAT_GAP_MS) return;
      lastSend = Date.now(); inp.value = '';
      try { var pr = db.ref('chat').push({ uid: me.uid, name: myName, text: t.slice(0, CHAT_MAX_LEN), t: fb.database.ServerValue.TIMESTAMP }); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    }
    ui.querySelector('[data-a="send"]').onclick = send;
    inp.onkeydown = function (e) { if (e.key === 'Enter') send(); };
    scrollBottom();
  }
  function msgEl(m) { var d = document.createElement('div'); d.className = 'msg' + (m.uid === (me && me.uid) ? ' me' : ''); d.innerHTML = '<span class="n">' + esc(m.name) + '</span>' + esc(m.text); return d; }
  function appendChat(m) { var c = ui.querySelector('[data-c]'); if (!c) return; c.appendChild(msgEl(m)); while (c.children.length > CHAT_LIMIT) c.removeChild(c.firstChild); scrollBottom(); }
  function scrollBottom() { var b = ui.querySelector('.bd'); b.scrollTop = b.scrollHeight; }

  function renderWho() {
    setFoot('');
    var ids = Object.keys(online);
    if (!ids.length) return setBody('<div class="sub">目前沒有其他人在線。</div>');
    setBody(ids.map(function (id) {
      var p = online[id] || {};
      return '<div class="row"><div class="grow">' + esc(p.name) + ' <span class="sub">' + (p.lv ? 'Lv.' + p.lv + ' ' : '') + esc(p.cls || '') + '</span></div>' +
        (id === me.uid ? '<span class="sub">你</span>' : '<button type="button" class="bt" data-inv="' + id + '">交易</button>') + '</div>';
    }).join(''));
    ui.querySelectorAll('[data-inv]').forEach(function (b) { b.onclick = function () { invite(b.getAttribute('data-inv')); }; });
  }

  // ---- 面對面交易 ----------------------------------------------------------------
  function activeTrade() {
    var best = null;
    Object.keys(myTrades).forEach(function (id) { var t = myTrades[id]; if (t && t.state === 'open' && (!best || t.t > best.t)) best = Object.assign({ id: id }, t); });
    return best;
  }
  function invite(to) {
    if (!canTouchSave()) return alert('請先進入遊戲再交易。');
    if (activeTrade()) { tab = 'trade'; return render(); }
    var p = online[to] || {};
    var ref = db.ref('trades').push();
    var side = {}; side[me.uid] = { items: [], gold: 0, locked: false, confirmed: false }; side[to] = { items: [], gold: 0, locked: false, confirmed: false };
    ref.set({ a: me.uid, b: to, aName: myName, bName: p.name || '?', state: 'invite', t: fb.database.ServerValue.TIMESTAMP, side: side })
      .then(function () { return db.ref('invites/' + to + '/' + me.uid).set({ name: myName, tid: ref.key, t: fb.database.ServerValue.TIMESTAMP }); })
      .then(function () { tab = 'trade'; render(); })
      .catch(function () { alert('邀請失敗，請稍後再試。'); });
  }
  function showInvite(from, inv) {
    if (!inv || Date.now() - (inv.t || 0) > 120000) { db.ref('invites/' + me.uid + '/' + from).remove(); return; }
    var old = $('afk-inv'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'afk-inv';
    d.innerHTML = '<div><b>' + esc(inv.name) + '</b> 想跟你交易</div><button type="button" class="bt" data-y>接受</button><button type="button" class="bt" data-n>拒絕</button>';
    document.body.appendChild(d);
    var tref = db.ref('trades/' + inv.tid);
    d.querySelector('[data-y]').onclick = function () {
      d.remove(); db.ref('invites/' + me.uid + '/' + from).remove();
      if (!canTouchSave()) { tref.child('state').set('cancel'); return alert('請先進入遊戲再交易。'); }
      txn(tref, function (t) { if (t && t.state === 'invite' && t.b === me.uid) { t.state = 'open'; return t; } return; })
        .then(function (r) { if (r.committed) { if (!ui) buildPanel(); ui.classList.add('open'); tab = 'trade'; render(); } });
    };
    d.querySelector('[data-n]').onclick = function () { d.remove(); db.ref('invites/' + me.uid + '/' + from).remove(); txn(tref, function (t) { if (t && t.state === 'invite') { t.state = 'cancel'; return t; } return; }); };
    setTimeout(function () { if (d.parentNode) d.remove(); }, 60000);
  }
  function renderTrade() {
    var t = activeTrade() || pendingInvite();
    curTrade = t;
    if (!t) { setFoot(''); return setBody('<div class="sub">到「在線」分頁按玩家旁的「交易」開始。</div>'); }
    var other = t.a === me.uid ? t.b : t.a, oName = t.a === me.uid ? t.bName : t.aName;
    if (t.state === 'invite') { setFoot('<button type="button" class="bt red" data-a="cancel">取消邀請</button>'); bindCancel(t); return setBody('<div class="sub">等待 ' + esc(oName) + ' 接受…</div>'); }
    var mine = (t.side && t.side[me.uid]) || {}, his = (t.side && t.side[other]) || {};
    function col(s, title) {
      return '<div class="side"><h4>' + esc(title) + (s.locked ? '<span class="tag l">已鎖定</span>' : '') + (s.confirmed ? '<span class="tag c">已確認</span>' : '') + '</h4>' +
        (s.items || []).map(function (it) { return '<div>' + esc(itemLabel(it)) + '</div>'; }).join('') +
        '<div class="sub">金幣：' + fmt(s.gold) + '</div></div>';
    }
    setBody('<div class="tw">' + col(mine, '我') + col(his, oName) + '</div>' +
      (mine.locked ? '' : '<div class="sub" style="margin-top:8px">放好道具和金幣後按「鎖定」，東西會先從背包收起來；取消交易會退回。</div>'));
    var btns = '';
    if (!mine.locked) btns += '<button type="button" class="bt" data-a="add">放道具</button><button type="button" class="bt" data-a="gold">放金幣</button><button type="button" class="bt pri" data-a="lock">鎖定</button>';
    else if (!mine.confirmed) btns += '<button type="button" class="bt pri" data-a="ok"' + (his.locked ? '' : ' disabled') + '>確認交易</button>';
    btns += '<button type="button" class="bt red" data-a="cancel">取消交易</button>';
    setFoot(btns);
    var f = ui.querySelector('.ft');
    var add = f.querySelector('[data-a="add"]'); if (add) add.onclick = function () {
      pickItem('放道具', false, function (it, cnt) {
        var c = cleanItem(it, cnt); c._src = it.uid;
        var list = (mine.items || []).filter(function (x) { return x._src !== it.uid; }); list.push(c);
        db.ref('trades/' + t.id + '/side/' + me.uid + '/items').set(list);
      });
    };
    var g = f.querySelector('[data-a="gold"]'); if (g) g.onclick = function () {
      var v = Math.floor(Number(prompt('放多少金幣？（你有 ' + fmt(player.gold) + '）', mine.gold || 0)) || 0);
      if (v < 0 || v > player.gold) return alert('金幣不夠。');
      db.ref('trades/' + t.id + '/side/' + me.uid + '/gold').set(v);
    };
    var lk = f.querySelector('[data-a="lock"]'); if (lk) lk.onclick = function () { lockTrade(t); };
    var okb = f.querySelector('[data-a="ok"]'); if (okb) okb.onclick = function () { confirmTrade(t); };
    bindCancel(t);
  }
  function pendingInvite() {
    var best = null;
    Object.keys(myTrades).forEach(function (id) { var t = myTrades[id]; if (t && t.state === 'invite' && t.a === me.uid && Date.now() - (t.t || 0) < 120000) best = Object.assign({ id: id }, t); });
    return best;
  }
  function bindCancel(t) { var c = ui.querySelector('.ft [data-a="cancel"]'); if (c) c.onclick = function () { cancelTrade(t); }; }
  // 鎖定＝託管：把道具／金幣從存檔拿出，寫進交易紀錄
  function lockTrade(t) {
    if (!canTouchSave()) return alert('請先進入遊戲。');
    var mine = (myTrades[t.id].side || {})[me.uid] || {};
    var want = mine.items || [], gold = Math.floor(mine.gold || 0);
    if (gold > player.gold) return alert('金幣不夠。');
    var taken = [];
    for (var i = 0; i < want.length; i++) {
      var got = takeItem(want[i]._src, want[i].cnt);
      if (!got) { taken.forEach(putItem); refreshUI(); return alert('「' + itemName(want[i]) + '」已不在背包，請重新放。'); }
      taken.push(got);
    }
    player.gold -= gold; save(); refreshUI();
    txn(db.ref('trades/' + t.id), function (tr) {
      if (!tr || tr.state !== 'open' || !tr.side || !tr.side[me.uid] || tr.side[me.uid].locked) return;
      tr.side[me.uid].items = taken; tr.side[me.uid].gold = gold; tr.side[me.uid].locked = true; tr.side[me.uid].escrowed = true;
      return tr;
    }).then(function (r) {
      if (!r.committed) { taken.forEach(putItem); player.gold += gold; save(); refreshUI(); alert('交易已結束，東西已退回。'); }
    }).catch(function () { taken.forEach(putItem); player.gold += gold; save(); refreshUI(); alert('鎖定失敗，東西已退回。'); });
  }
  function confirmTrade(t) {
    txn(db.ref('trades/' + t.id), function (tr) {
      if (!tr || tr.state !== 'open') return;
      var o = tr.a === me.uid ? tr.b : tr.a;
      if (!tr.side[me.uid].locked || !tr.side[o].locked) return;
      tr.side[me.uid].confirmed = true;
      if (tr.side[o].confirmed) tr.state = 'done';
      return tr;
    });
  }
  function cancelTrade(t) {
    txn(db.ref('trades/' + t.id), function (tr) {
      if (!tr || (tr.state !== 'open' && tr.state !== 'invite')) return;
      var o = tr.a === me.uid ? tr.b : tr.a;
      if (tr.side && tr.side[me.uid] && tr.side[o] && tr.side[me.uid].confirmed && tr.side[o].confirmed) return;
      tr.state = 'cancel'; return tr;
    });
  }
  // 結算：完成→領對方的；取消→拿回自己的（各自只動自己那一側的旗標，交易紀錄用 transaction 防重複領）
  var settling = {};
  function settleTrades() {
    if (!canTouchSave()) return;
    Object.keys(myTrades).forEach(function (id) {
      var t = myTrades[id]; if (!t || !t.side || settling[id]) return;
      var mine = t.side[me.uid] || {}, other = t.a === me.uid ? t.b : t.a, his = t.side[other] || {};
      var need = (t.state === 'done' && !mine.claimed) ? 'claim' : ((t.state === 'cancel' && mine.escrowed && !mine.returned) ? 'return' : null);
      if (!need) return;
      settling[id] = true;
      txn(db.ref('trades/' + id + '/side/' + me.uid), function (s) {
        if (!s) return;
        if (need === 'claim') { if (s.claimed) return; s.claimed = true; }
        else { if (s.returned) return; s.returned = true; }
        return s;
      }).then(function (r) {
        if (!r.committed) return;
        var src = need === 'claim' ? his : mine;
        (src.items || []).forEach(function (it) { var c = Object.assign({}, it); delete c._src; putItem(c); });
        player.gold += Math.floor(src.gold || 0);
        save(); refreshUI();
        try { if (typeof logSys === 'function') logSys(need === 'claim' ? '🤝 交易完成，收到的東西已放進背包。' : '↩️ 交易取消，你的東西已退回背包。'); } catch (e) {}
      }).finally(function () { delete settling[id]; });
    });
  }

  // ---- 交易所 ----------------------------------------------------------------------
  function renderMarket() {
    var ids = Object.keys(market).sort(function (a, b) { return (market[b].t || 0) - (market[a].t || 0); });
    setBody(ids.length ? ids.map(function (id) {
      var l = market[id];
      var mineL = l.seller === me.uid;
      return '<div class="row"><div class="grow">' + esc(itemLabel(l.item)) + '<div class="sub">' + fmt(l.price) + ' 金幣 · ' + esc(l.sellerName) + '</div></div>' +
        (mineL ? '<button type="button" class="bt" data-un="' + id + '">下架</button>' : '<button type="button" class="bt pri" data-buy="' + id + '">購買</button>') + '</div>';
    }).join('') : '<div class="sub">目前沒有商品。</div>');
    setFoot('<button type="button" class="bt pri" data-a="sell">上架道具</button>');
    ui.querySelector('[data-a="sell"]').onclick = sell;
    ui.querySelectorAll('[data-buy]').forEach(function (b) { b.onclick = function () { buy(b.getAttribute('data-buy')); }; });
    ui.querySelectorAll('[data-un]').forEach(function (b) { b.onclick = function () { unlist(b.getAttribute('data-un')); }; });
  }
  function sell() {
    if (!canTouchSave()) return alert('請先進入遊戲。');
    pickItem('上架道具', true, function (it, cnt, price) {
      if (!(price > 0)) return alert('請輸入價格。');
      var got = takeItem(it.uid, cnt); if (!got) return alert('這個道具不能上架。');
      save(); refreshUI();
      var ref = db.ref('market').push();
      ref.set({ seller: me.uid, sellerName: myName, item: got, price: Math.floor(price), status: 'open', t: fb.database.ServerValue.TIMESTAMP })
        .catch(function () { putItem(got); save(); refreshUI(); alert('上架失敗，道具已退回。'); });
    });
  }
  function buy(id) {
    if (!canTouchSave()) return alert('請先進入遊戲。');
    var l = market[id]; if (!l) return;
    if (player.gold < l.price) return alert('金幣不夠。');
    if (!confirm('用 ' + fmt(l.price) + ' 金幣購買「' + itemLabel(l.item) + '」？')) return;
    txn(db.ref('market/' + id), function (x) {
      if (!x || x.status !== 'open' || x.seller === me.uid) return;
      x.status = 'sold'; x.buyer = me.uid; x.buyerName = myName; x.soldAt = Date.now(); return x;
    }).then(function (r) {
      if (!r.committed) return alert('已經被別人買走了。');
      // 交付交給 settleBuyer（同一套補發流程，關網頁也不會掉）
    }).catch(function () { alert('購買失敗，請稍後再試。'); });
  }
  function unlist(id) {
    txn(db.ref('market/' + id), function (x) {
      if (!x || x.status !== 'open' || x.seller !== me.uid) return;
      x.status = 'cancel'; return x;
    }).catch(function () {});
  }
  var marketBusy = {};
  function settleBuyer(list) {
    if (!canTouchSave()) return;
    Object.keys(list).forEach(function (id) {
      var x = list[id]; if (!x || x.status !== 'sold' || x.buyer !== me.uid || x.delivered || marketBusy['b' + id]) return;
      if (player.gold < x.price) { try { logSys('⚠️ 交易所：金幣不夠，「' + itemLabel(x.item) + '」暫時無法領取。'); } catch (e) {} return; }
      marketBusy['b' + id] = true;
      txn(db.ref('market/' + id), function (y) { if (!y || y.buyer !== me.uid || y.delivered) return; y.delivered = true; return y; })
        .then(function (r) {
          if (!r.committed) return;
          player.gold -= x.price; putItem(x.item); save(); refreshUI();
          try { logSys('🛒 交易所：買到「' + esc(itemLabel(x.item)) + '」，花了 ' + fmt(x.price) + ' 金幣。'); } catch (e) {}
        }).finally(function () { delete marketBusy['b' + id]; });
    });
  }
  function settleSeller(list) {
    if (!canTouchSave()) return;
    Object.keys(list).forEach(function (id) {
      var x = list[id]; if (!x || x.seller !== me.uid || marketBusy['s' + id]) return;
      var need = (x.status === 'sold' && !x.paid) ? 'pay' : ((x.status === 'cancel' && !x.returned) ? 'ret' : null);
      if (!need) return;
      marketBusy['s' + id] = true;
      txn(db.ref('market/' + id), function (y) {
        if (!y || y.seller !== me.uid) return;
        if (need === 'pay') { if (y.paid) return; y.paid = true; } else { if (y.returned) return; y.returned = true; }
        return y;
      }).then(function (r) {
        if (!r.committed) return;
        if (need === 'pay') { player.gold += Math.floor(x.price); try { logSys('💰 交易所：「' + esc(itemLabel(x.item)) + '」賣出，收到 ' + fmt(x.price) + ' 金幣。'); } catch (e) {} }
        else { putItem(x.item); try { logSys('↩️ 交易所：「' + esc(itemLabel(x.item)) + '」已下架退回背包。'); } catch (e) {} }
        save(); refreshUI();
      }).finally(function () { delete marketBusy['s' + id]; });
    });
  }

  // ---- 選道具 ----------------------------------------------------------------------
  function pickItem(title, withPrice, done) {
    var old = $('afk-pick'); if (old) old.remove();
    var items = (player.inv || []).filter(tradeable);
    var d = document.createElement('div'); d.id = 'afk-pick'; d.className = 'open';
    d.innerHTML = '<div class="box"><div style="padding:8px 10px;color:#d6b46a;font-weight:700">' + esc(title) + '</div><div class="list">' +
      (items.length ? items.map(function (it, i) { return '<div class="it" data-i="' + i + '">' + esc(itemLabel(it)) + '</div>'; }).join('') : '<div class="sub">背包裡沒有可交易的道具（上鎖的不能交易）。</div>') +
      '</div><div class="ft">數量 <input type="number" min="1" value="1" data-c>' + (withPrice ? ' 價格 <input type="number" min="1" placeholder="金幣" data-p>' : '') +
      '<button type="button" class="bt" data-ok>確定</button><button type="button" class="bt" data-no>取消</button></div></div>';
    document.body.appendChild(d);
    var sel = -1;
    d.querySelectorAll('.it').forEach(function (el) { el.onclick = function () { d.querySelectorAll('.it').forEach(function (x) { x.classList.remove('sel'); }); el.classList.add('sel'); sel = +el.getAttribute('data-i'); d.querySelector('[data-c]').value = items[sel].cnt || 1; }; });
    d.querySelector('[data-no]').onclick = function () { d.remove(); };
    d.querySelector('[data-ok]').onclick = function () {
      if (sel < 0) return;
      var it = items[sel], cnt = Math.max(1, Math.min(it.cnt || 1, Math.floor(+d.querySelector('[data-c]').value) || 1));
      var price = withPrice ? Math.floor(+d.querySelector('[data-p]').value) : 0;
      d.remove(); done(it, cnt, price);
    };
  }

  // 進遊戲（換角色）時重跑補發：託管退回／貨款／買到的貨都要等角色載入才能放進存檔
  var wasIn = false;
  setInterval(function () {
    var now = inGame();
    if (now && !wasIn && me && db) {
      settleTrades();
      db.ref('market').orderByChild('seller').equalTo(me.uid).once('value').then(function (s) { settleSeller(s.val() || {}); });
      db.ref('market').orderByChild('buyer').equalTo(me.uid).once('value').then(function (s) { settleBuyer(s.val() || {}); });
      updatePresence();
    }
    wasIn = now;
  }, 2000);

  // 給 afk-mp.js 用：點地圖上的玩家／聊天名字 →「交易」＝打開面板並發起託管交易
  window.__afkOnlineInvite = function (to) { try { openPanel(); sdk().then(function () { if (me) invite(to); }); } catch (e) {} };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
