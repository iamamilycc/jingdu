/* 精讀 jingdu — 課文生成模組（調用智譜 GLM，瀏覽器直連，CORS 已實測通過）
   密鑰只存本機 localStorage，絕不寫入任何倉庫。內容由用戶輸入（拍照/粘貼），版權由用戶負責。 */
(function(){
  'use strict';
  const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const KEY = 'jingdu_zhipu_key';
  const MODEL_TEXT_KEY = 'jingdu_zhipu_model_text';
  const MODEL_VISION_KEY = 'jingdu_zhipu_model_vision';

  function getKey(){ return localStorage.getItem(KEY) || ''; }
  function setKey(k){ if(k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); }
  function getTextModel(){ return localStorage.getItem(MODEL_TEXT_KEY) || 'glm-4-flash'; }
  function getVisionModel(){ return localStorage.getItem(MODEL_VISION_KEY) || 'glm-4v-flash'; }
  function setModels(t, v){ if(t) localStorage.setItem(MODEL_TEXT_KEY,t); if(v) localStorage.setItem(MODEL_VISION_KEY,v); }

  const SCHEMA_EN = `{
  "title": "課名（英文原題 + 中文，如 A Private Conversation 私人談話）",
  "sentences": [
    {"en": "英文句子（保持原文，逐句拆開）", "zh": "繁體中文翻譯", "ana": "給小學生看的講解，白話、標出重點語法，可用 <b>標籤</b>；重點前加 ⭐"}
  ],
  "vocab": [
    {"w": "單詞", "ipa": "/音標/", "pos": "n. 名詞 / v. 動詞 等", "zh": "中文意思", "eg": "含這個單詞的例句（用課文裡的句子）"}
  ],
  "listening": [
    {"play": [句子索引], "srcIdx": 對應句子索引, "q": "中文提問", "ans": 正確選項下標(從0), "opts": ["選項1","選項2","選項3","選項4"]}
  ],
  "grammar": [
    {"t": "語法點標題", "body": "<p>白話講解</p><div class=\\"eg\\">例句</div>"}
  ]
}`;

  const SCHEMA_JP = `{
  "title": "課名（如 初めまして 第X課）",
  "sentences": [
    {"jp": "日文句子，漢字必須標振假名，格式為 漢字[かな]，如 私[わたし]は 学生[がくせい]です。（只在漢字後面用方括號標讀音，假名/片假名/數字不要標）",
     "romaji": "羅馬音", "zh": "繁體中文翻譯",
     "ana": "給小學生看的講解，白話，標出助詞/句型，可用 <b>標籤</b>，重點前加 ⭐",
     "chunks": ["把句子按文節切分的陣列（2-7塊），如 [\\"私[わたし]は\\",\\"学生[がくせい]です\\"]；句子太長或太短可省略此欄"]}
  ],
  "vocab": [
    {"w": "單詞（漢字標振假名 漢字[かな]）", "romaji": "羅馬音", "pos": "名詞/動詞/形容詞 等", "zh": "中文意思", "eg": "含這個詞的例句（同樣標振假名）"}
  ],
  "listening": [
    {"play": [句子索引], "srcIdx": 對應句子索引, "q": "中文提問", "ans": 正確選項下標(從0), "opts": ["選項1","選項2","選項3","選項4"]}
  ],
  "grammar": [
    {"t": "語法點標題", "body": "<p>白話講解</p><div class=\\"eg\\">例句（標振假名）</div>"}
  ]
}`;

  function systemPrompt(lang){
    const schema = lang==='jp' ? SCHEMA_JP : SCHEMA_EN;
    const langName = lang==='jp' ? '日語' : '英語';
    return `你是一位耐心的${langName}精讀老師，為小學生製作精讀學習卡片。
用戶會給你一段${langName}課文（可能是圖片或文字）。請把它做成精讀數據，嚴格按下面的 JSON 結構輸出。

規則：
1. **只輸出 JSON**，不要任何解釋、不要 markdown 代碼框。
2. 講解（ana / grammar）一律用**繁體中文**，語氣親切、給小學生看，白話講清楚，重點前加 ⭐。
3. sentences 要把課文**逐句拆開**，每句一個對象；listening 的 play/srcIdx 是句子在 sentences 陣列裡的下標（從0開始），務必對應正確。
4. vocab 挑本課 6-12 個重點詞；grammar 挑 2-4 個核心語法點。
5. listening 出 4-6 題，中文提問+四選一，考查聽力理解，答案下標 ans 必須正確。
${lang==='jp' ? '6. 日文漢字必須標振假名 漢字[かな]（只標漢字，假名/片假名/數字不標）；romaji 提供羅馬音；chunks 用文節切分。' : '6. 每個 vocab 給準確音標。'}

JSON 結構：
${schema}`;
  }

  function stripFences(s){
    return s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();
  }

  function parseLesson(raw){
    let t = stripFences(raw);
    /* 容錯：截取第一個 { 到最後一個 } */
    const a=t.indexOf('{'), b=t.lastIndexOf('}');
    if(a>=0 && b>a) t=t.slice(a,b+1);
    const d = JSON.parse(t);
    if(!d.sentences || !d.sentences.length) throw new Error('生成結果沒有句子');
    d.vocab = d.vocab || []; d.listening = d.listening || []; d.grammar = d.grammar || [];
    return d;
  }

  async function callApi(model, messages, onProgress){
    const key = getKey();
    if(!key) throw new Error('還沒設定智譜 API Key');
    if(onProgress) onProgress('正在請求智譜 AI…');
    const resp = await fetch(ENDPOINT, {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json' },
      body: JSON.stringify({ model, messages, temperature:0.3 })
    });
    if(resp.status===401) throw new Error('API Key 無效或已過期');
    if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('智譜回應錯誤 '+resp.status+' '+t.slice(0,120)); }
    const j = await resp.json();
    const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(!content) throw new Error('智譜沒有返回內容');
    return content;
  }

  async function fromText(lang, text, onProgress){
    const content = await callApi(getTextModel(), [
      { role:'system', content: systemPrompt(lang) },
      { role:'user', content: '課文如下：\n\n'+text }
    ], onProgress);
    if(onProgress) onProgress('正在整理課文…');
    return parseLesson(content);
  }

  async function fromImage(lang, dataUrl, onProgress){
    const content = await callApi(getVisionModel(), [
      { role:'user', content: [
        { type:'text', text: systemPrompt(lang)+'\n\n請先讀出圖片裡的課文，再按上面規則輸出 JSON。' },
        { type:'image_url', image_url:{ url: dataUrl } }
      ]}
    ], onProgress);
    if(onProgress) onProgress('正在整理課文…');
    return parseLesson(content);
  }

  /* ---- 用戶課文存儲（本機 + 隨雲同步；view.html 讀取渲染） ---- */
  function allUserLessons(){ try{ return JSON.parse(localStorage.getItem('jingdu_userlessons')||'{}'); }catch(e){ return {}; } }
  function saveLesson(lang, data){
    const id = 'u-'+Date.now().toString(36);
    const lesson = {
      id: id, lang: lang,
      badge: (lang==='jp'?'日語':'NCE') + ' · 自建',
      title: data.title || '未命名',
      sentences: data.sentences, vocab: data.vocab, listening: data.listening, grammar: data.grammar,
      _meta: { created: Date.now(), lang: lang, title: data.title || '未命名' }
    };
    const all = allUserLessons(); all[id] = lesson;
    localStorage.setItem('jingdu_userlessons', JSON.stringify(all));
    localStorage.setItem('jingdu_updatedAt', String(Date.now()));
    if(window.JDSYNC) window.JDSYNC.schedule();
    return id;
  }
  function deleteLesson(id){
    const all = allUserLessons(); delete all[id];
    localStorage.setItem('jingdu_userlessons', JSON.stringify(all));
    localStorage.setItem('jingdu_updatedAt', String(Date.now()));
    if(window.JDSYNC) window.JDSYNC.schedule();
  }

  window.JDGen = { getKey, setKey, getTextModel, getVisionModel, setModels,
                   fromText, fromImage, parseLesson, systemPrompt,
                   allUserLessons, saveLesson, deleteLesson };
})();
