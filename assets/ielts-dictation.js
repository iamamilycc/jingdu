/* ielts-dictation.js —— 精聽聽寫：逐句聽寫 + 錯因分類
 *
 * 聽寫誰都會做，決定提不提分的是**知道自己錯在哪一類**：
 *   weak    連讀/弱讀沒聽出（to / of / a / and 這類——雅思最大宗失分）
 *   spell   聽對了但拼錯
 *   number  數字聽錯（填空題重災區）
 *   proper  專有名詞聽錯
 *   unknown 生詞，整個沒寫出來
 *   speed   後段整片沒跟上＝語速問題
 * 每週看分佈就知道該練什麼，而不是盲目多聽。
 *
 * 復用：TTS 用 JD.speak，錯詞進 JD.addError（同一套艾賓浩斯引擎），
 *       全部落在 ielts_ 空間，不碰英語精讀。
 */
(function () {
  'use strict';

  var ID_PREFIX = 'id-';                  /* dictation 詞條 id */
  var LESSON = 'ielts-dictation';         /* langOf 靠 ielts- 前綴認出是英語 */

  /* 英語裡最常被弱讀吞掉的功能詞——聽力漏字十有八九是這些 */
  var WEAK = ['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'but',
              'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'do', 'does',
              'did', 'will', 'would', 'can', 'could', 'that', 'as', 'it', 'its', 'his',
              'her', 'them', 'us', 'he', 'she', 'we', 'they', 'you', 'i', 'from', 'with'];

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function words(s) { return norm(s).split(' ').filter(Boolean); }
  function isNum(w) { return /\d/.test(w); }
  function isProper(orig) { return /^[A-Z][a-z]/.test(orig); }

  /* 編輯距離：判斷「拼錯」還是「完全不同的詞」 */
  function dist(a, b) {
    var m = a.length, n = b.length, i, j, prev, tmp;
    if (!m) return n;
    if (!n) return m;
    var row = [];
    for (j = 0; j <= n; j++) row[j] = j;
    for (i = 1; i <= m; i++) {
      prev = row[0]; row[0] = i;
      for (j = 1; j <= n; j++) {
        tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1,
                          prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[n];
  }

  /* ---------- 切句 ---------- */
  function split(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  /* ---------- 逐詞比對 + 錯因分類 ---------- */
  function diff(target, typed) {
    var origTokens = String(target).split(/\s+/).filter(Boolean);
    var T = words(target), S = words(typed);
    var out = [], kinds = {}, correct = 0;

    /* 對齊：用「後面還找不找得到」決定是漏字還是拼錯，避免整句錯位 */
    var si = 0;
    for (var ti = 0; ti < T.length; ti++) {
      var t = T[ti], s = S[si];
      var origin = origTokens[ti] || t;

      if (s === t) { out.push({ w: origin, ok: true }); correct++; si++; continue; }

      /* 使用者那邊還有詞，但對不上：可能是拼錯，也可能是他多打/聽成別的 */
      var d = (s == null) ? 99 : dist(t, s);
      var laterMatch = S.indexOf(t, si);          /* 目標詞是不是晚一點才出現（＝這裡漏了） */

      var kind;
      if (s != null && d <= Math.max(1, Math.floor(t.length / 4)) && d > 0) {
        kind = isNum(t) ? 'number' : (isProper(origin) ? 'proper' : 'spell');
        si++;
      } else if (laterMatch === -1 || (s != null && laterMatch > si + 1)) {
        /* 目標詞在使用者輸入裡根本沒出現（或差很遠）→ 漏聽 */
        if (WEAK.indexOf(t) >= 0) kind = 'weak';
        else if (isNum(t)) kind = 'number';
        else if (isProper(origin)) kind = 'proper';
        else kind = 'unknown';
      } else {
        /* 目標詞晚點才出現＝使用者這裡多打或聽成別的，跳過使用者這個詞重試 */
        si++; ti--; continue;
      }

      out.push({ w: origin, ok: false, kind: kind });
      kinds[kind] = (kinds[kind] || 0) + 1;
    }

    /* 後段整片沒跟上 → 語速問題（比逐詞歸類更接近真因） */
    var tailMissing = 0;
    for (var k = out.length - 1; k >= 0 && !out[k].ok; k--) tailMissing++;
    if (tailMissing >= 3 && tailMissing >= T.length * 0.3) {
      kinds = { speed: tailMissing };
      for (var m = out.length - tailMissing; m < out.length; m++) out[m].kind = 'speed';
    }

    return {
      words: out,
      kinds: Object.keys(kinds),
      counts: kinds,
      score: T.length ? correct / T.length : 1
    };
  }

  /* ---------- 交卷：錯的詞進復習隊列 + 記錄錯因 ---------- */
  function commit(target, typed) {
    var d = diff(target, typed);
    d.words.forEach(function (w) {
      if (w.ok) return;
      var clean = norm(w.w);
      if (!clean) return;
      JD.addError({ id: ID_PREFIX + clean, lessonId: LESSON,
                    en: w.w, zh: '（聽寫錯：' + label(w.kind) + '）', type: 'word' });
    });
    var log = JD.load('dict_log', { total: 0, kinds: {} });
    log.total += 1;
    Object.keys(d.counts).forEach(function (k) {
      log.kinds[k] = (log.kinds[k] || 0) + d.counts[k];
    });
    JD.save('dict_log', log);
    JD.touchSync && JD.touchSync();
    return d;
  }

  function label(k) {
    return { weak: '連讀/弱讀', spell: '拼寫', number: '數字',
             proper: '專有名詞', unknown: '生詞', speed: '語速' }[k] || k;
  }

  function stats() {
    var log = JD.load('dict_log', { total: 0, kinds: {} });
    var arr = Object.keys(log.kinds).map(function (k) {
      return { kind: k, label: label(k), n: log.kinds[k] };
    }).sort(function (a, b) { return b.n - a.n; });
    return { total: log.total, kinds: arr };
  }

  function reset() { JD.save('dict_log', { total: 0, kinds: {} }); }

  /* ---------- 素材：使用者自己貼聽力原文（版權留在他自己手上）---------- */
  function saveText(name, text) {
    var all = JD.load('dict_texts', {});
    all[name] = { text: text, at: Date.now(), sents: split(text).length };
    JD.save('dict_texts', all);
    return all[name];
  }
  function listTexts() { return JD.load('dict_texts', {}); }
  function removeText(name) {
    var all = JD.load('dict_texts', {});
    delete all[name];
    JD.save('dict_texts', all);
  }

  window.DICT = {
    split: split, diff: diff, commit: commit, stats: stats, reset: reset,
    label: label, saveText: saveText, listTexts: listTexts, removeText: removeText,
    WEAK: WEAK
  };
})();
