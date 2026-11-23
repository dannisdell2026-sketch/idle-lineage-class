/* ============================================================================
 * afk-starterkit.js — 新角色起始禮包（使用者自訂）
 *
 * 創角(startGame)跑完後，每個「新建」的角色拿到禮包。內容由 GM 面板設定（afk-rates 的 starter），
 * 沒設定時用預設：骷髏套裝＋大馬士革刀＋十字弓＋瑪那魔杖（皆為安定值）、金幣 5,000,000。
 * 勾了「穿上」且職業能穿的會自動裝備；武器只穿一把，職業慣用的優先。
 *
 * 只包 startGame，原函式完整照跑（含它最後的 saveGame），之後才加禮包再存一次。
 * 已拿過的角色會記 player._afkStarterKit，不會重複發；讀檔(loadGame)不會觸發。
 * 安定值一律讀 DB.items[id].safe（上游改數值會跟著變，不寫死）。
 * ========================================================================== */
(function () {
  'use strict';

  if (window.AFK_TOGGLES) {
    AFK_TOGGLES.register({
      id: 'starterkit', name: '新角色起始禮包', group: '其他', def: true,
      desc: '新建角色送安定值骷髏全套、大馬士革刀、十字弓、瑪那魔杖，金幣 500 萬'
    });
    if (!AFK_TOGGLES.enabled('starterkit')) return;
  }

  var GOLD = 5000000;
  var ARMOR = ['hlm_bone', 'amr_bone', 'shd_bone'];              // 骷髏頭盔、骷髏盔甲、骷髏盾牌
  var WEAPONS = ['wpn_damascus', 'wpn_31', 'wpn_manawand'];       // 大馬士革刀、十字弓、瑪那魔杖
  var EQUIP_WPN = { knight: 'wpn_damascus', elf: 'wpn_31', mage: 'wpn_manawand' };

  function safeOf(id) {
    try { var d = DB.items[id]; return (d && typeof d.safe === 'number') ? d.safe : 0; } catch (e) { return 0; }
  }
  function give(id) {
    try {
      if (!DB.items[id]) { console.warn('[afk-starterkit] 找不到物品', id); return null; }
      var before = player.inv.length;
      gainItem(id, 1, true, true);
      var it = null;
      for (var i = player.inv.length - 1; i >= 0; i--) { if (player.inv[i].id === id) { it = player.inv[i]; break; } }
      if (it) it.en = safeOf(id);
      return it;
    } catch (e) { console.warn('[afk-starterkit] 發放失敗', id, e); return null; }
  }
  function canWear(id) {
    try { var r = DB.items[id].req; return !r || r === 'all' || r.split(',').indexOf(player.cls) >= 0; } catch (e) { return false; }
  }

  // 預設禮包（GM 面板沒設定時用這份；GM 面板也拿它當初始內容）
  function defaultCfg() {
    var items = ARMOR.concat(WEAPONS).map(function (id) { return { id: id, en: safeOf(id), cnt: 1, equip: true }; });
    return { gold: GOLD, items: items };
  }
  window.AFK_STARTER_DEFAULT = defaultCfg;
  function cfg() {
    try { var c = window.AFK_RATES && AFK_RATES.starter && AFK_RATES.starter(); if (c && Array.isArray(c.items)) return c; } catch (e) {}
    return defaultCfg();
  }
  function give2(x) {
    try {
      if (!DB.items[x.id]) { console.warn('[afk-starterkit] 找不到物品', x.id); return null; }
      gainItem(x.id, x.cnt || 1, true, true);
      var it = null;
      for (var i = player.inv.length - 1; i >= 0; i--) { if (player.inv[i].id === x.id) { it = player.inv[i]; break; } }
      if (it && typeof x.en === 'number' && x.en !== (it.en || 0)) {
        // 指定強化值：從剛拿到的那疊拆出來單獨一格（同簽章規則：強化值不同就是不同格）
        var n = x.cnt || 1;
        if ((it.cnt || 1) > n) { it.cnt -= n; it = JSON.parse(JSON.stringify(it)); it.cnt = n; it.uid = uid(); player.inv.push(it); }
        it.en = x.en;
      }
      return it;
    } catch (e) { console.warn('[afk-starterkit] 發放失敗', x.id, e); return null; }
  }
  function grant() {
    if (!player || !player.cls || player.lv !== 1 || player._afkStarterKit) return;
    player._afkStarterKit = true;
    var c = cfg(), wpns = [];
    var got = c.items.map(function (x) { return { x: x, it: give2(x) }; });
    player.gold = Math.max(0, Math.floor(c.gold) || 0);
    try {
      got.forEach(function (g) {
        if (!g.it || !g.x.equip || !canWear(g.x.id)) return;
        var d = DB.items[g.x.id];
        if (d.type === 'wpn' && !d.isArrow) wpns.push(g); else equipItem(g.it);
      });
      // 武器只穿一把：職業慣用的優先（騎士大馬士革刀／妖精十字弓／法師瑪那魔杖），否則清單裡第一把
      var pref = EQUIP_WPN[player.cls], pick = wpns.find(function (g) { return g.x.id === pref; }) || wpns[0];
      if (pick) equipItem(pick.it);
    } catch (e) { console.warn('[afk-starterkit] 自動穿裝失敗', e); }
    try { calcStats(); player.hp = player.mhp; player.mp = player.mmp; } catch (e) {}
    try { if (typeof renderTabs === 'function') renderTabs(true); } catch (e) {}
    try { if (typeof updateUI === 'function') updateUI(); } catch (e) {}
    try { if (player && player.cls) saveGame(); } catch (e) { console.warn('[afk-starterkit] 存檔失敗', e); }
    try { if (typeof logSys === 'function') logSys('🎁 起始禮包已發放。'); } catch (e) {}
  }

  function hook() {
    if (typeof window.startGame !== 'function') return false;
    if (window.startGame._afkKit) return true;
    var orig = window.startGame;
    var wrapped = function () {
      var before = (typeof player !== 'undefined') ? player : null;
      var r = orig.apply(this, arguments);
      // 原函式會把 player 換成全新物件；沒換＝中途 return（例如存檔位已有角色）→ 不發
      try { if (player !== before && (!window.AFK_TOGGLES || AFK_TOGGLES.enabled('starterkit'))) grant(); } catch (e) { console.warn('[afk-starterkit]', e); }
      return r;
    };
    wrapped._afkKit = true;
    window.startGame = wrapped;
    return true;
  }
  if (!hook()) { var n = 0; (function retry() { if (!hook() && ++n < 40) setTimeout(retry, 250); })(); }
})();
