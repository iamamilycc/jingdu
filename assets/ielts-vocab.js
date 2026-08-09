/* ielts-vocab.js —— 雅思詞彙卡邏輯
 *
 * 設計要點（對應立項報告 Phase 1）：
 *  · 靜態詞料（音標/釋義/層級）只在 data/L*.json，**不複製進錯題本**。
 *    錯題本只存學習狀態 {id, level, due, fails}，顯示時用 id 回查詞料。
 *    ——複製一份就是兩份真相，日後改詞表會對不上。
 *  · 間隔重複**完全復用 core.js 的引擎**（INTERVALS 30分→1天→…→90天），
 *    絕不另寫一套（本專案吃過「同一邏輯兩套實作慢慢長歪」的虧）。
 *  · 所有讀寫走 JD.load/save，自動落在本站的 ielts_ 空間，不碰英語精讀。
 */
(function () {
  'use strict';

  var DATA = 'data/';
  var ID_PREFIX = 'iw-';                 /* 詞卡 id，避免與精讀課的句子 id 撞 */
  var LESSON_OF = function (L) { return 'ielts-L' + L; };   /* langOf 靠 ielts- 前綴認出是英語 */

  var cache = {};                        /* 層 → 詞陣列 */
  var meta = null;

  function idOf(w) { return ID_PREFIX + w; }

  /* ---------- 設定（每日新詞量、當前層）---------- */
  function cfg() {
    /* autoSay 預設開：背單字時「看到就聽到」對記憶有幫助。
       但圖書館/會議時很尷尬，所以卡片頁給開關，偏好會記住
       （依 feedback_user_control_over_pacing：固定流程都要可調可跳過）。 */
    var c = JD.load('vocab_cfg', { layer: 1, dailyNew: 20, dailyMax: 60, autoSay: true });
    if (c.autoSay === undefined) c.autoSay = true;   /* 舊資料沒這欄，補上預設 */
    return c;
  }
  function setCfg(c) { JD.save('vocab_cfg', c); }

  /* ---------- 詞料載入 ---------- */
  function loadMeta() {
    if (meta) return Promise.resolve(meta);
    return fetch(DATA + 'meta.json').then(function (r) { return r.json(); })
      .then(function (m) { meta = m; return m; });
  }
  function loadLayer(L) {
    if (cache[L]) return Promise.resolve(cache[L]);
    return fetch(DATA + 'L' + L + '.json').then(function (r) { return r.json(); })
      .then(function (arr) {
        cache[L] = arr;
        arr.forEach(function (w, i) { w._i = i; w._L = L; });
        return arr;
      });
  }

  /* ---------- 今日隊列 ----------
     = 到期複習的（引擎算的）+ 尚未學過的新詞（依詞頻順序補足）
     新詞不預先全部塞進錯題本，只在真的出現在卡片上時才加入，
     否則 6000 詞會一次灌爆隊列、也讓「已學數」失真。 */
  function todayQueue() {
    var c = cfg();
    return loadLayer(c.layer).then(function (words) {
      var book = JD.getBook();
      var due = (JD.dueItems() || []).filter(function (it) {
        return it.id.indexOf(ID_PREFIX) === 0;
      });
      var fresh = [];
      for (var i = 0; i < words.length && fresh.length < c.dailyNew; i++) {
        if (!book[idOf(words[i].w)]) fresh.push(words[i]);
      }
      var dueWords = due.map(function (it) {
        return findWord(it.id.slice(ID_PREFIX.length)) || { w: it.en, tr: it.zh, ph: '', _L: c.layer };
      }).filter(Boolean);
      return {
        due: dueWords.slice(0, c.dailyMax),
        fresh: fresh,
        all: dueWords.slice(0, c.dailyMax).concat(fresh)
      };
    });
  }

  function findWord(w) {
    for (var L in cache) {
      var arr = cache[L];
      for (var i = 0; i < arr.length; i++) if (arr[i].w === w) return arr[i];
    }
    return null;
  }

  /* ---------- 作答 ----------
     認識 → 進 SRS 並升一級；不認識 → 打回 level 0（30 分鐘後再見）
     首次出現的詞先 addError 加入隊列（level 0），再依作答決定升不升。 */
  function answer(word, known) {
    var id = idOf(word.w);
    var book = JD.getBook();
    if (!book[id]) {
      JD.addError({ id: id, lessonId: LESSON_OF(word._L || cfg().layer),
                    en: word.w, zh: word.tr, type: 'word' });
    }
    if (known) JD.reviewPass(id); else JD.reviewFail(id);
    JD.touchSync && JD.touchSync();
    return JD.getBook()[id];
  }

  /* 撤銷上一張：閉環要求「標錯了能改回」。
     做法是把狀態改成相反的一次判定，而不是留下錯的資料。 */
  function undo(word, prevKnown) {
    var id = idOf(word.w);
    if (!JD.getBook()[id]) return null;
    if (prevKnown) JD.reviewFail(id); else JD.reviewPass(id);
    return JD.getBook()[id];
  }

  /* ---------- 批量：這批我都會（跳過已掌握的基礎詞，別浪費時間）---------- */
  function skipBatch(words) {
    words.forEach(function (word) {
      var id = idOf(word.w);
      if (!JD.getBook()[id]) {
        JD.addError({ id: id, lessonId: LESSON_OF(word._L || cfg().layer),
                      en: word.w, zh: word.tr, type: 'word' });
      }
      /* 連續 pass 到牢固：直接畢業，不再出現 */
      for (var i = 0; i < 9; i++) JD.reviewPass(id);
    });
    JD.touchSync && JD.touchSync();
  }

  /* ---------- 進度 ----------
     ⚠️ todayCount 是「今天要背」的**唯一計算處**：到期複習 + 今日新詞。
     首頁數字與主按鈕文字都必須讀它，不准各自算——兩處不一致是使用者最先發現的那種 bug。
     鎖在 tests/ielts_card_behavior_test.py 的 parity 斷言。 */
  function stats(todayCount) {
    var book = JD.getBook();
    var mine = Object.keys(book).filter(function (k) { return k.indexOf(ID_PREFIX) === 0; });
    var solid = mine.filter(function (k) { return book[k].solid; });
    var due = (JD.dueItems() || []).filter(function (it) { return it.id.indexOf(ID_PREFIX) === 0; });
    return {
      learning: mine.length,
      solid: solid.length,
      due: due.length,
      today: (todayCount == null ? due.length : todayCount)
    };
  }

  /* ---------- 發音：缺音標的詞照樣要能聽（用戶決定用 TTS 補）---------- */
  function say(word) {
    if (JD.speak) JD.speak(word.w, false);
  }

  /* ---------- 重置某層 ----------
     閉環要求：破壞性操作必須「操作前先留快照」，否則手滑一次就沒了。
     快照保留 24 小時，期間可一鍵還原。 */
  function resetLayer(L) {
    var book = JD.getBook(), lesson = LESSON_OF(L), killed = {};
    Object.keys(book).forEach(function (k) {
      if (k.indexOf(ID_PREFIX) === 0 && book[k].lessonId === lesson) {
        killed[k] = book[k];
        delete book[k];
      }
    });
    JD.save('errbook', book);
    JD.save('vocab_undo', { at: Date.now(), layer: L, items: killed });
    JD.touchSync && JD.touchSync();
    return Object.keys(killed).length;
  }

  function undoSnapshot() {
    return JD.load('vocab_undo', null);
  }

  function restoreSnapshot() {
    var snap = undoSnapshot();
    if (!snap || !snap.items) return 0;
    var book = JD.getBook();
    Object.keys(snap.items).forEach(function (k) { book[k] = snap.items[k]; });
    JD.save('errbook', book);
    JD.save('vocab_undo', null);
    JD.touchSync && JD.touchSync();
    return Object.keys(snap.items).length;
  }

  /* ---------- 匯出：帶得走的資料才是你的（可丟進 Anki）---------- */
  function exportCsv() {
    var book = JD.getBook();
    var rows = [['word', 'meaning', 'level', 'fails', 'due', 'status']];
    Object.keys(book).forEach(function (k) {
      if (k.indexOf(ID_PREFIX) !== 0) return;
      var it = book[k];
      rows.push([it.en, (it.zh || '').replace(/"/g, '""'), it.level, it.fails,
                 it.solid ? '' : new Date(it.due).toISOString().slice(0, 10),
                 it.solid ? '已牢固' : '學習中']);
    });
    return rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c) + '"'; }).join(',');
    }).join('\n');
  }

  window.IELTS = {
    cfg: cfg, setCfg: setCfg,
    loadMeta: loadMeta, loadLayer: loadLayer,
    todayQueue: todayQueue, answer: answer, undo: undo,
    skipBatch: skipBatch, stats: stats, say: say,
    resetLayer: resetLayer, undoSnapshot: undoSnapshot, restoreSnapshot: restoreSnapshot,
    exportCsv: exportCsv,
    idOf: idOf, _findWord: findWord
  };
})();
