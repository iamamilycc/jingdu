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

  /* ---------- 錄音 ----------
     ⚠️ iOS 硬限制：getUserMedia **必須在使用者手勢的呼叫堆疊裡**。
     Part 2 是「1 分鐘準備 → 才開始說」，如果等倒數結束才要麥克風，
     那時早就脫離手勢上下文，iOS 必定拒絕（實測回報「錄音啟動失敗」的根因）。
     正解：**點「開始」的當下就把麥克風要到手**，準備階段先握著，
     倒數結束只是 new MediaRecorder(已有的 stream).start()——不再碰 getUserMedia。 */
  var rec = null, chunks = [], startAt = 0, stream = null, lastError = null;

  /* 在使用者手勢裡呼叫這個（點「開始」時），先取得並保留麥克風 */
  function acquireMic() {
    if (stream && stream.active) return Promise.resolve(stream);
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      lastError = { name: 'NoGetUserMedia', message: '這個瀏覽器沒有 getUserMedia' };
      return Promise.reject(lastError);
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s; lastError = null; return s;
    }).catch(function (e) {
      lastError = { name: e.name || 'Error', message: e.message || String(e) };
      throw lastError;
    });
  }

  /* 真正開始錄——此時不再要權限，只用已經握著的 stream */
  function startRecording() {
    chunks = [];
    if (!stream || !stream.active) {
      lastError = { name: 'NoStream', message: '麥克風尚未取得（應在點「開始」時就取得）' };
      return Promise.reject(lastError);
    }
    try {
      /* 讓瀏覽器自己挑支援的格式：iOS 給 mp4/aac，桌面多半 webm。寫死格式會在 iOS 直接失敗。 */
      try { rec = new MediaRecorder(stream); }
      catch (e) { rec = new MediaRecorder(stream, { mimeType: 'audio/mp4' }); }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start();
      startAt = Date.now();
      lastError = null;
      return Promise.resolve(true);
    } catch (e) {
      lastError = { name: e.name || 'Error', message: e.message || String(e) };
      return Promise.reject(lastError);
    }
  }

  /* 診斷：使用者看不到 console，把該知道的全部攤在畫面上，方便回報 */
  function diagnose() {
    var d = {
      '網址協定': location.protocol + (location.protocol === 'https:' ? ' ✓' : ' ✗ 需 HTTPS'),
      '瀏覽器': /CriOS/i.test(navigator.userAgent) ? 'Chrome for iOS'
              : /MicroMessenger/i.test(navigator.userAgent) ? '微信內建 ✗'
              : /Safari/i.test(navigator.userAgent) && /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS Safari'
              : '其他',
      'getUserMedia': (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ? '有 ✓' : '無 ✗',
      'MediaRecorder': (typeof MediaRecorder !== 'undefined') ? '有 ✓' : '無 ✗',
      '麥克風已取得': (stream && stream.active) ? '是 ✓' : '否',
      '最後一次錯誤': lastError ? (lastError.name + '：' + lastError.message) : '無'
    };
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
      d['支援格式'] = ['audio/mp4', 'audio/webm', 'audio/webm;codecs=opus']
        .filter(function (m) { return MediaRecorder.isTypeSupported(m); }).join(' / ') || '（都不支援）';
    }
    return d;
  }

  /* 把常見錯誤翻成人話 + 告訴使用者怎麼辦 */
  function explain(err) {
    var n = (err && err.name) || '';
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError')
      return '麥克風權限被拒絕。iPhone：設定 → Safari → 麥克風 → 改成「詢問」或「允許」，再重新整理頁面。';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError')
      return '找不到麥克風裝置。';
    if (n === 'NotReadableError' || n === 'TrackStartError')
      return '麥克風被其他 App 佔用（例如正在通話或錄音），關掉那個 App 再試。';
    if (n === 'NoStream')
      return '麥克風還沒取得——請重新點一次「開始」（iOS 規定必須在你按下按鈕的當下要權限）。';
    if (n === 'NoGetUserMedia')
      return '這個瀏覽器不支援錄音。微信內建瀏覽器一定不行，請用 Safari 或 Chrome 開。';
    return (err && err.message) || '未知錯誤';
  }

  function stopRecording() {
    return new Promise(function (resolve) {
      if (!rec || rec.state === 'inactive') { resolve(null); return; }
      rec.onstop = function () {
        var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        var secs = (Date.now() - startAt) / 1000;
        /* 錄完就釋放麥克風，不讓錄音指示燈一直亮著（隱私也是體驗） */
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
    acquireMic: acquireMic, startRecording: startRecording, stopRecording: stopRecording,
    isRecording: isRecording, diagnose: diagnose, explain: explain,
    fluency: fluency, saveSession: saveSession, listSessions: listSessions,
    progress: progress, pick: pick
  };
})();
