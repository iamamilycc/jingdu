/* ielts-writing.js —— 雅思寫作：話題論點庫 + AI 批改
 *
 * 兩件事：
 *  1. 論點庫（本地 JSON）——考場上「組裝」用的彈藥，不是拿來背的範文。
 *     背範文會被判雷同，而且套不上真題。
 *  2. AI 批改——⚠️ **AI 給分普遍偏高 0.5–1 分**，這點必須在畫面上講明，
 *     否則使用者會以為自己已經 7 分。批改當方向參考，不當分數依據。
 *
 * key 沿用主站的 jingdu_zhipu_key（設定全站共用，換站不必重設），
 * 但學習紀錄寫在 ielts_ 空間。這個「設定共用、進度隔離」的分法
 * 鎖在 tests/ns_isolation_test.py 的檔案分類常數裡。
 */
(function () {
  'use strict';

  var ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  var KEY = 'jingdu_zhipu_key';            /* 刻意硬編主站前綴：設定共用 */
  var MODEL_KEY = 'ielts_write_model';
  var DATA = 'data/writing-topics.json';

  var cache = null;

  function load() {
    if (cache) return Promise.resolve(cache);
    return fetch(DATA).then(function (r) { return r.json(); })
      .then(function (j) { cache = j; return j; });
  }

  function getKey() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(KEY, k); } catch (e) {} }
  /* 預設用免費的 flash：批改是高頻操作，先免費跑通再談要不要花錢升級（金絲雀） */
  function getModel() { try { return localStorage.getItem(MODEL_KEY) || 'glm-4-flash'; } catch (e) { return 'glm-4-flash'; } }
  function setModel(m) { try { localStorage.setItem(MODEL_KEY, m); } catch (e) {} }

  function wordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  /* ---------- 交卷前的本地體檢：不花一毛錢就能抓到的問題，先抓掉 ---------- */
  function lint(text, question) {
    var out = [], n = wordCount(text);
    if (n < 250) out.push({ level: 'bad', msg: '字數 ' + n + '，未達 250 字下限——字數不足直接扣分，先補足再送批改。' });
    else if (n > 330) out.push({ level: 'warn', msg: '字數 ' + n + '，偏長。考場 40 分鐘寫這麼多容易犧牲檢查時間。' });
    else out.push({ level: 'ok', msg: '字數 ' + n + '，符合要求。' });

    var paras = String(text || '').split(/\n\s*\n/).filter(function (p) { return p.trim(); });
    if (paras.length < 4) out.push({ level: 'warn', msg: '只有 ' + paras.length + ' 段。Task 2 建議四段：引言／主體一／主體二／結論。' });

    if (question) {
      var qWords = question.toLowerCase().match(/[a-z]{5,}/g) || [];
      var body = String(text).toLowerCase();
      var copied = qWords.filter(function (w) { return body.indexOf(w) >= 0; });
      var firstPara = (paras[0] || '').toLowerCase();
      var copiedInIntro = qWords.filter(function (w) { return firstPara.indexOf(w) >= 0; });
      if (copiedInIntro.length >= qWords.length * 0.7 && qWords.length >= 5) {
        out.push({ level: 'bad', msg: '引言幾乎照抄題目——照抄的部分不計入字數且扣分，必須改寫。' });
      }
    }

    var t = String(text || '');
    if (!/\b(However|Nevertheless|On the other hand|That said|While|Although|Admittedly)\b/i.test(t)) {
      out.push({ level: 'warn', msg: '看不到轉折／讓步的痕跡。6.5 需要展現能處理對立觀點。' });
    }
    if (/\b(I think|I believe)\b/gi.test(t) && (t.match(/\b(I think|I believe)\b/gi) || []).length > 2) {
      out.push({ level: 'warn', msg: '「I think / I believe」重複太多次，換成 In my view / It seems to me that…' });
    }
    if (/\b(Firstly|Secondly|Finally)\b/gi.test(t) && (t.match(/\b(Firstly|Secondly|Finally)\b/gi) || []).length >= 3) {
      out.push({ level: 'warn', msg: '連接詞太機械（Firstly/Secondly/Finally 全上）——考官視為堆砌，挑 1-2 個就好。' });
    }
    var sents = t.split(/[.!?]+/).filter(function (s) { return s.trim().split(/\s+/).length > 2; });
    if (sents.length) {
      var avg = sents.reduce(function (a, s) { return a + s.trim().split(/\s+/).length; }, 0) / sents.length;
      if (avg < 12) out.push({ level: 'warn', msg: '平均句長 ' + Math.round(avg) + ' 詞，偏短。6.5 需要句式有變化，適度用複合句。' });
    }
    return out;
  }

  /* ---------- AI 批改 ---------- */
  function prompt(question, essay) {
    return '你是資深雅思寫作考官。以下是 Task 2 題目與考生作文。\n'
      + '請嚴格按官方四項評分標準給分（每項 0-9，可含 .5）：\n'
      + 'TR 任務回應／CC 連貫銜接／LR 詞彙／GRA 語法。\n'
      + '要求：\n'
      + '1. 給分從嚴。中國考生 Task 2 平均約 5.5-6.0，不要輕易給 7 以上。\n'
      + '2. 每項各列 1-2 個「具體到句子」的問題，指出原句並給改寫版。\n'
      + '3. 最後給三條「下一篇最該改進的事」，按優先序。\n'
      + '4. 用繁體中文回覆，改寫的英文句子保留英文。\n'
      + '嚴格輸出 JSON：{"tr":數字,"cc":數字,"lr":數字,"gra":數字,"overall":數字,'
      + '"issues":[{"band":"TR","quote":"原句","problem":"問題","fix":"改寫"}],'
      + '"next":["建議1","建議2","建議3"]}\n\n'
      + '【題目】' + question + '\n\n【作文】\n' + essay;
  }

  function grade(question, essay) {
    var key = getKey();
    if (!key) return Promise.reject(new Error('NOKEY'));
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: getModel(),
        messages: [{ role: 'user', content: prompt(question, essay) }],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP' + r.status);
      return r.json();
    }).then(function (j) {
      var txt = j && j.choices && j.choices[0] && j.choices[0].message
        && j.choices[0].message.content;
      if (!txt) throw new Error('EMPTY');
      var parsed;
      try {
        parsed = JSON.parse(txt);
      } catch (e) {
        var m = txt.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('BADJSON');
        parsed = JSON.parse(m[0]);
      }
      /* 別信任模型輸出格式——收到就強制校驗，缺欄位或超出範圍就當失敗，
         不留半成品給使用者（本專案方法論 A 條）。 */
      ['tr', 'cc', 'lr', 'gra'].forEach(function (k) {
        var v = Number(parsed[k]);
        if (!(v >= 0 && v <= 9)) throw new Error('BADSCORE');
        parsed[k] = v;
      });
      if (!(Number(parsed.overall) >= 0 && Number(parsed.overall) <= 9)) {
        parsed.overall = roundBand((parsed.tr + parsed.cc + parsed.lr + parsed.gra) / 4);
      }
      parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      parsed.next = Array.isArray(parsed.next) ? parsed.next : [];
      return parsed;
    });
  }

  /* 雅思進位：.25 進 .5、.75 進 1.0（不是四捨五入——這是外行最常搞錯的口徑） */
  function roundBand(x) {
    var f = Math.floor(x), d = x - f;
    if (d < 0.25) return f;
    if (d < 0.75) return f + 0.5;
    return f + 1;
  }

  /* ---------- 作文紀錄（存在 ielts_ 空間）---------- */
  function saveEssay(topicId, question, essay, result) {
    var all = JD.load('essays', []);
    all.unshift({
      at: Date.now(), topicId: topicId, question: question,
      words: wordCount(essay), essay: essay,
      scores: result ? { tr: result.tr, cc: result.cc, lr: result.lr,
                         gra: result.gra, overall: result.overall } : null
    });
    JD.save('essays', all.slice(0, 50));
    JD.touchSync && JD.touchSync();
  }
  function listEssays() { return JD.load('essays', []); }
  function removeEssay(at) {
    JD.save('essays', listEssays().filter(function (e) { return e.at !== at; }));
  }

  window.WRITE = {
    load: load, lint: lint, grade: grade, roundBand: roundBand, wordCount: wordCount,
    getKey: getKey, setKey: setKey, getModel: getModel, setModel: setModel,
    saveEssay: saveEssay, listEssays: listEssays, removeEssay: removeEssay,
    _prompt: prompt
  };
})();
