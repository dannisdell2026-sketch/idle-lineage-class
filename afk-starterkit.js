/* ============================================================================
 * afk-starterkit.js — 新角色起始禮包（使用者自訂）
 *
 * 創角(startGame)跑完後，每個「新建」的角色額外拿到：
 *   ・骷髏套裝(骷髏頭盔／骷髏盔甲／骷髏盾牌)，強化值＝各自的安定值
 *   ・大馬士革刀、十字弓、瑪那魔杖，強化值＝各自的安定值
 *   ・金幣設為 5,000,000
 * 並自動穿上該職業能穿的：骷髏三件；騎士→大馬士革刀、妖精→十字弓、法師→瑪那魔杖。
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

  function grant() {
    if (!player || !player.cls || player.lv !== 1 || player._afkStarterKit) return;
    player._afkStarterKit = true;
    var got = {};
    ARMOR.concat(WEAPONS).forEach(function (id) { got[id] = give(id); });
    player.gold = GOLD;
    try {
      ARMOR.forEach(function (id) { if (got[id] && canWear(id)) equipItem(got[id]); });
      var w = EQUIP_WPN[player.cls];
      if (w && got[w] && canWear(w)) equipItem(got[w]);
    } catch (e) { console.warn('[afk-starterkit] 自動穿裝失敗', e); }
    try { calcStats(); player.hp = player.mhp; player.mp = player.mmp; } catch (e) {}
    try { if (typeof renderTabs === 'function') renderTabs(true); } catch (e) {}
    try { if (typeof updateUI === 'function') updateUI(); } catch (e) {}
    try { if (player && player.cls) saveGame(); } catch (e) { console.warn('[afk-starterkit] 存檔失敗', e); }
    try { if (typeof logSys === 'function') logSys('🎁 起始禮包已發放：骷髏套裝、大馬士革刀、十字弓、瑪那魔杖、金幣 5,000,000'); } catch (e) {}
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
