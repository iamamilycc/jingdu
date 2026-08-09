/* ielts-speaking.js —— 雅思口語：計時 + 錄音回聽 + 流利度統計
 *
 * ⚠️ 設計取捨（很重要，看清楚再改）：
 *   核心**不是語音識別**。core.js 的 JD.listen 是單句模式（說完自動停），
 *   而 Part 2 要連續說 2 分鐘；加上 iOS Safari 的語音識別支援本來就差。
 *   所以核心是「計時 + 逼你開口 + 錄音回聽」——自己聽才知道卡在哪，這本來就是口語練習的正道。
 *   識別只是加值：可用就順便算語速，不可用就自動退回純錄音，功能照樣完整。
 *
 * 錄音一律用 MediaRecorder——本專案方法論明列：iOS 上 ScriptProcessorNode 真機靜音。
 * 錄音只留在記憶體與本機，不上傳任何伺服器。
 */
(function () {
  'use strict';

  var DATA = 'data/speaking-topics.json';
  var cache = null;

  function load() {
    if (cache) return Promise.resolve(cache);
    return fetch(DATA).then(function (r) { return r.json(); })
      .then(function (j) { cache = j; return j; });
  }

  /* ---------- 能力偵測：講清楚這台裝置能做什麼，別讓使用者猜 ---------- */
  function capabilities() {
    var isWeChat = /MicroMessenger/i.test(navigator.userAgent || '');
    var hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var hasRecorder = (typeof MediaRecorder !== 'undefined');
    return {
      record: hasMedia && hasRecorder && !isWeChat,
      recognise: !!(JD && JD.recSupported && JD.recSupported()),
      isWeChat: isWeChat,
      /* 微信內建瀏覽器完全不給麥克風，是硬限制不是 bug——直接告訴使用者換瀏覽器 */
      reason: isWeChat ? '微信內建瀏覽器不開放麥克風，請點右上角「···」用 Safari／Chrome 開啟'
            : (!hasMedia ? '這個瀏覽器不支援錄音（需要 HTTPS 或 localhost）'
            : (!hasRecorder ? '這個瀏覽器不支援 MediaRecorder' : ''))
    };
  }

  /* ---------- 錄音 ---------- */
  var rec = null, chunks = [], startAt = 0, stream = null;

  function startRecording() {
    chunks = [];
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s;
      /* 讓瀏覽器自己挑支援的格式：iOS 給 mp4/aac，桌面多半 webm。寫死格式會在 iOS 直接失敗。 */
      try { rec = new MediaRecorder(s); }
      catch (e) { rec = new MediaRecorder(s, { mimeType: 'audio/mp4' }); }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start();
      startAt = Date.now();
      return true;
    });
  }

  function stopRecording() {
    return new Promise(function (resolve) {
      if (!rec || rec.state === 'inactive') { resolve(null); return; }
      rec.onstop = function () {
        var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        var secs = (Date.now() - startAt) / 1000;
        if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
        resolve({ blob: blob, url: URL.createObjectURL(blob), seconds: secs });
      };
      try { rec.stop(); } catch (e) { resolve(null); }
    });
  }

  function isRecording() { return !!(rec && rec.state === 'recording'); }

  /* ---------- 流利度：6.5 的關鍵在說得順，不在零錯誤 ---------- */
  function fluency(seconds, transcript) {
    var words = String(transcript || '').trim().split(/\s+/).filter(Boolean).length;
    var wpm = seconds > 0 ? Math.round(words / (seconds / 60)) : 0;
    var notes = [];

    if (seconds < 100) notes.push({ level: 'bad', msg: '只說了 ' + Math.round(seconds) + ' 秒。Part 2 要說滿 2 分鐘——說不滿是最常見的失分。' });
    else if (seconds < 115) notes.push({ level: 'warn', msg: '說了 ' + Math.round(seconds) + ' 秒，接近但沒滿 2 分鐘，再多撐一點。' });
    else notes.push({ level: 'ok', msg: '說了 ' + Math.round(seconds) + ' 秒，時長達標。' });

    if (words) {
      if (wpm < 100) notes.push({ level: 'warn', msg: '語速 ' + wpm + ' 詞/分，偏慢——聽起來像在回想或背稿。目標 120-150。' });
      else if (wpm > 170) notes.push({ level: 'warn', msg: '語速 ' + wpm + ' 詞/分，偏快容易吃字、發音不清。目標 120-150。' });
      else notes.push({ level: 'ok', msg: '語速 ' + wpm + ' 詞/分，落在理想區間。' });
    } else {
      notes.push({ level: 'info', msg: '這台裝置沒有語音識別，算不出語速——但錄音可以回聽，卡在哪你自己最清楚。' });
    }
    return { seconds: seconds, words: words, wpm: wpm, notes: notes };
  }

  /* ---------- 練習紀錄（只存統計，不存錄音檔——音檔很大且沒必要留）---------- */
  function saveSession(partId, question, f) {
    var all = JD.load('speak_log', []);
    all.unshift({ at: Date.now(), part: partId, q: question,
                  seconds: Math.round(f.seconds), words: f.words, wpm: f.wpm });
    JD.save('speak_log', all.slice(0, 100));
    JD.touchSync && JD.touchSync();
  }
  function listSessions() { return JD.load('speak_log', []); }

  function progress() {
    var all = listSessions();
    var p2 = all.filter(function (s) { return s.part === 'p2'; });
    var full = p2.filter(function (s) { return s.seconds >= 115; }).length;
    var wpms = all.filter(function (s) { return s.wpm > 0; }).map(function (s) { return s.wpm; });
    return {
      total: all.length,
      p2Total: p2.length,
      p2Full: full,
      avgWpm: wpms.length ? Math.round(wpms.reduce(function (a, b) { return a + b; }, 0) / wpms.length) : 0
    };
  }

  /* 隨機抽題：練習要有不確定性，照順序背會產生虛假的流利 */
  function pick(arr, exclude) {
    var pool = arr.filter(function (x) { return x.q !== exclude; });
    if (!pool.length) pool = arr;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  window.SPEAK = {
    load: load, capabilities: capabilities,
    startRecording: startRecording, stopRecording: stopRecording, isRecording: isRecording,
    fluency: fluency, saveSession: saveSession, listSessions: listSessions,
    progress: progress, pick: pick
  };
})();
