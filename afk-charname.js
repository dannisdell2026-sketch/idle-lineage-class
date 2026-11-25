/* =====================================================================================
 * afk-charname.js — 創角時取角色名字
 *
 * 創角畫面按「開始遊戲」→ 先跳出「角色命名」視窗（輸入框＋🎲隨機＋確定／取消）。
 * 名字合格才真正進入 startGame()，進遊戲後立刻寫入 player.name 並存檔。
 *   ・2～12 字，只能用中文、英文字母、數字（名稱會以 innerHTML 顯示，不能有特殊符號）
 *   ・同一台裝置上的其他存檔不能重名（不分大小寫）
 * 之後仍可點左上名稱改名（原版功能）。
 * ===================================================================================== */
(function () {
  'use strict';
  if (window.__afkCharName) return; window.__afkCharName = true;

  var MIN = 2, MAX = 12, RE = /^[㐀-鿿A-Za-z0-9]+$/;
  var A = ['白', '黑', '赤', '蒼', '銀', '金', '月', '星', '風', '雷', '霜', '炎', '夜', '曉', '影', '龍', '狼', '鷹', '劍', '神'];
  var B = ['之', '', '', '', '翼', '刃', '心', '魂', '羽', '牙', '騎', '影', '歌', '光', '焰', '雪', '嵐', '痕', '誓', '王'];
  var C = ['騎士', '法師', '遊俠', '旅人', '守衛', '獵人', '劍士', '妖精', '王子', '公主', '浪人', '隱者', '戰神', '使徒', '行者'];

  function chars(s) { return Array.from(String(s || '')); }
  function randName() {
    for (var k = 0; k < 20; k++) {
      var n = A[Math.random() * A.length | 0] + B[Math.random() * B.length | 0] + C[Math.random() * C.length | 0];
      if (Math.random() < 0.25) n += (10 + (Math.random() * 90 | 0));
      if (!check(n)) return n;
    }
    return '冒險者' + (100 + (Math.random() * 900 | 0));
  }
  function taken(name) {
    var low = name.toLowerCase(), max = 16;
    try { if (typeof SAVE_SLOT_MAX !== 'undefined') max = SAVE_SLOT_MAX; } catch (e) {}
    for (var n = 1; n <= max; n++) {
      if (typeof currentSlot !== 'undefined' && n === currentSlot) continue;
      var s = null; try { s = slotSummary(n); } catch (e) {}
      if (s && s.name && String(s.name).toLowerCase() === low) return n;
    }
    return 0;
  }
  // 回傳錯誤訊息；合格回傳空字串
  function check(v) {
    var n = chars(v).length;
    if (!n) return '請輸入角色名字';
    if (n < MIN) return '名字至少 ' + MIN + ' 個字';
    if (n > MAX) return '名字最多 ' + MAX + ' 個字';
    if (!RE.test(v)) return '只能使用中文、英文字母或數字（不能有空白或符號）';
    var t = taken(v); if (t) return '存檔 ' + t + ' 已經有「' + v + '」這個名字了';
    return '';
  }

  // ---- 視窗 -------------------------------------------------------------------------
  var css = document.createElement('style');
  css.textContent =
    '#cn-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.66);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '#cn-box{width:min(340px,100%);background:linear-gradient(#2a2117,#17120c);border:2px solid #8a6a33;border-radius:8px;box-shadow:0 0 0 1px #000,0 10px 40px rgba(0,0,0,.8);color:#e8d9b5;font-family:inherit;padding:16px 16px 14px}' +
    '#cn-box h3{margin:0 0 4px;text-align:center;font-size:18px;color:#f3c867;letter-spacing:2px}' +
    '#cn-box .sub{text-align:center;font-size:12px;color:#b9a57e;margin-bottom:12px}' +
    '#cn-box .row{display:flex;gap:6px}' +
    '#cn-in{flex:1;min-width:0;font-size:16px;padding:8px 10px;border-radius:4px;border:1px solid #6d5428;background:#0e0b07;color:#fff;outline:none}' +
    '#cn-in:focus{border-color:#f3c867;box-shadow:0 0 0 2px rgba(243,200,103,.25)}' +
    '#cn-rand{flex:none;font-size:15px;padding:0 10px;border-radius:4px;border:1px solid #6d5428;background:#3a2e1d;color:#f3c867;cursor:pointer}' +
    '#cn-box .cnt{font-size:11px;color:#8f7d5a;text-align:right;margin-top:4px}' +
    '#cn-err{min-height:18px;font-size:12px;color:#ff7b6b;margin-top:2px}' +
    '#cn-box .btns{display:flex;gap:8px;margin-top:10px}' +
    '#cn-box .btns button{flex:1;padding:9px 0;font-size:15px;border-radius:4px;cursor:pointer;font-weight:bold}' +
    '#cn-ok{background:linear-gradient(#b8892f,#7d5a19);border:1px solid #f3c867;color:#fff8e2}' +
    '#cn-ok:disabled{opacity:.45;cursor:not-allowed}' +
    '#cn-no{background:#2b241a;border:1px solid #6d5428;color:#d9c9a3}';
  (document.head || document.documentElement).appendChild(css);

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function clsLabel() {
    try { var t = document.getElementById('creation-class-title'); if (t && t.textContent.trim()) return t.textContent.trim(); } catch (e) {}
    return '';
  }

  function ask(done) {
    var old = document.getElementById('cn-mask'); if (old) old.remove();
    var m = document.createElement('div'); m.id = 'cn-mask';
    var lb = clsLabel();
    m.innerHTML = '<div id="cn-box" role="dialog" aria-label="角色命名">' +
      '<h3>角色命名</h3><div class="sub">' + (lb ? '為你的' + esc(lb) + '取一個名字' : '為你的角色取一個名字') + '</div>' +
      '<div class="row"><input id="cn-in" type="text" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="2～12 字（中文／英數）">' +
      '<button id="cn-rand" type="button" title="隨機名字">🎲</button></div>' +
      '<div class="cnt"><span id="cn-n">0</span> / ' + MAX + '</div>' +
      '<div id="cn-err"></div>' +
      '<div class="btns"><button id="cn-no" type="button">取消</button><button id="cn-ok" type="button" disabled>確定</button></div></div>';
    document.body.appendChild(m);
    var inp = m.querySelector('#cn-in'), ok = m.querySelector('#cn-ok'), err = m.querySelector('#cn-err'), cnt = m.querySelector('#cn-n');
    var touched = false;
    function upd() {
      var v = inp.value.trim(), e = check(v);
      cnt.textContent = chars(v).length;
      ok.disabled = !!e;
      err.textContent = (touched && v) ? e : '';
    }
    function close() { m.remove(); }
    function submit() {
      touched = true; var v = inp.value.trim(), e = check(v);
      if (e) { err.textContent = e; inp.focus(); return; }
      close(); done(v);
    }
    inp.addEventListener('input', function () { touched = true; upd(); });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape') { close(); }
    });
    m.querySelector('#cn-rand').onclick = function () { inp.value = randName(); touched = true; upd(); inp.focus(); };
    m.querySelector('#cn-no').onclick = close;
    ok.onclick = submit;
    m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
    upd();
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
  }

  // ---- 掛到 startGame ----------------------------------------------------------------
  var passing = false;
  function hook() {
    var orig = window.startGame;
    if (typeof orig !== 'function' || orig._cnWrapped) return !!(orig && orig._cnWrapped);
    var w = function () {
      if (passing) return orig.apply(this, arguments);
      var self = this, args = arguments;
      try { if (!curCreate || !curCreate.cls || !curCreate.rawCls) return orig.apply(self, args); } catch (e) {}
      try { if (slotSummary(currentSlot)) return orig.apply(self, args); } catch (e) {}   // 已有角色 → 交給原版擋
      ask(function (name) {
        passing = true;
        var r;
        try { r = orig.apply(self, args); } finally { passing = false; }
        var apply = function () {
          try {
            if (!player || !player.cls) return;
            player.name = name;
            if (typeof updateUI === 'function') updateUI();
            if (typeof saveGame === 'function') saveGame();
            if (typeof logSys === 'function') logSys('<span class="text-yellow-300">歡迎，<b>' + esc(name) + '</b>！祝你冒險順利。</span>');
          } catch (e) { console.warn('[charname]', e); }
        };
        if (r && typeof r.then === 'function') r.then(apply, apply); else apply();
      });
    };
    for (var k in orig) if (k[0] === '_') w[k] = orig[k];
    w._cnWrapped = true;
    window.startGame = w;
    return true;
  }
  if (!hook()) {
    var tries = 0, t = setInterval(function () { if (hook() || ++tries > 40) clearInterval(t); }, 250);
  }
  window.AFK_CHARNAME = { ask: ask, check: check, rand: randName };
})();
