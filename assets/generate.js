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

  /* 文字模型預設 glm-4-plus：出閱讀理解題/講解質量明顯優於免費的 flash，一課約幾分錢（付費，需智譜帳戶有餘額）。
     想省錢可在「新增課文→進階」改回 glm-4-flash（免費，但聽力題多走程序化保底）。 */
  function getTextModel(){ return localStorage.getItem(MODEL_TEXT_KEY) || 'glm-4-plus'; }
  function getVisionModel(){ return localStorage.getItem(MODEL_VISION_KEY) || 'glm-4v-flash'; }
  function setModels(t, v){ if(t) localStorage.setItem(MODEL_TEXT_KEY,t); if(v) localStorage.setItem(MODEL_VISION_KEY,v); }

  const SCHEMA_EN = `{
  "title": "課名（英文原題 + 中文，如 A Private Conversation 私人談話）",
  "level": 難度星級整數1-5（按生詞率和語法複雜度估：1=很簡單 5=很難）,
  "sentences": [
    {"en": "英文句子（保持原文，逐句拆開；**不要**把說話者名字寫進這裡）", "zh": "繁體中文翻譯", "ana": "給小學生看的講解，白話、標出重點語法，可用 <b>標籤</b>；重點前加 ⭐",
     "speaker": "若原文是對話（如 Jack: ... / A: ...），這句是誰說的就填名字；不是對話則省略此欄"}
  ],
  "vocab": [
    {"w": "單詞", "ipa": "/音標/", "pos": "n. 名詞 / v. 動詞 等", "zh": "中文意思", "eg": "含這個單詞的例句（用課文裡的句子）"}
  ],
  "listening": [
    {"play": [句子索引], "srcIdx": 對應句子索引, "q": "英文提問（如 What did the boy buy?，仿真實英語聽力考試格式）", "ans": 正確選項下標(從0), "opts": ["英文選項1","英文選項2","英文選項3","英文選項4"]}
  ],
  "grammar": [
    {"t": "語法點標題", "body": "<p>白話講解</p><div class=\\"eg\\">例句</div>"}
  ]
}`;

  const SCHEMA_JP = `{
  "title": "課名（如 初めまして 第X課）",
  "level": 難度星級整數1-5（按生詞率和語法複雜度估：1=很簡單 5=很難）,
  "sentences": [
    {"jp": "日文句子，漢字必須標振假名，格式為 漢字[かな]，如 私[わたし]は 学生[がくせい]です。（只在漢字後面用方括號標讀音，假名/片假名/數字不要標）",
     "romaji": "羅馬音", "zh": "繁體中文翻譯",
     "ana": "給小學生看的講解，白話，標出助詞/句型，可用 <b>標籤</b>，重點前加 ⭐",
     "chunks": ["把句子按文節切分的陣列（2-7塊），如 [\\"私[わたし]は\\",\\"学生[がくせい]です\\"]；句子太長或太短可省略此欄"],
     "speaker": "若原文是對話，這句是誰說的就填名字（不用標振假名）；不是對話則省略此欄"}
  ],
  "vocab": [
    {"w": "單詞（漢字標振假名 漢字[かな]）", "romaji": "羅馬音", "pos": "名詞/動詞/形容詞 等", "zh": "中文意思", "eg": "含這個詞的例句（同樣標振假名）"}
  ],
  "listening": [
    {"play": [句子索引], "srcIdx": 對應句子索引, "q": "日文提問（漢字標振假名 漢字[かな]，仿真實日語聽力考試格式）", "ans": 正確選項下標(從0), "opts": ["日文選項1（同樣標振假名）","日文選項2","日文選項3","日文選項4"]}
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
5. listening 出 4-6 題，**q（提問）和 opts（選項）都必須用${langName}原文，不可用中文**——比照中國大陸英語/日語聽力考試的真實格式（考卷上問題和選項都是外語，不是翻成中文），四選一考查聽力理解。**ans 必須是能從 srcIdx 那句話直接驗證的唯一正確選項的下標（從0開始）**，寫完每題後自己核對一遍 ans 是否指向正確選項；opts 內容不要帶「A. 」等字母前綴。
${lang==='jp' ? '6. 日文漢字必須標振假名 漢字[かな]（只標漢字，假名/片假名/數字不標）；romaji 提供羅馬音；chunks 用文節切分。' : '6. 每個 vocab 給準確音標。'}
7. **若課文是對話**（人物名 + 冒號開頭，如「Jack: I want a coffee.」「A：おはよう。」）：把說話者名字拆進獨立的 speaker 欄位，${lang==='jp'?'jp':'en'} 欄位裡只留**這句話本身**、不要把名字或冒號寫進去（這句話之後會被拿去跟讀、背誦、連詞成句，混進名字會讓孩子跟著把名字也讀出來，不自然）。speaker 照樣是這篇故事的一部分，人名本身不用刪，只是換個欄位放。listening 的 q 需要點出是誰說的時候，可以直接在 q 裡寫「Jack said...」這樣的自然問法。不是對話的課文，每句都省略 speaker 欄位。

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
    let d;
    try{ d = JSON.parse(t); }
    catch(e){
      /* 二次容錯：去掉物件/陣列的尾逗號（模型常見瑕疵）再試一次 */
      try{ d = JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); }
      catch(e2){ throw new Error('AI 輸出的內容格式有誤（多半是課文太長被截斷）。試試：①把課文分成短一點的幾段分別生成 ②或在「進階」把文字模型換成 glm-4-plus（比 flash 更穩）。'); }
    }
    if(!d.sentences || !d.sentences.length) throw new Error('生成結果沒有句子');
    d.vocab = d.vocab || []; d.listening = d.listening || []; d.grammar = d.grammar || [];
    d.level = (Number.isInteger(d.level) && d.level>=1 && d.level<=5) ? d.level : 0; /* 0=未知,不顯示 */
    sanitizeListening(d);
    return d;
  }

  /* 聽力題數據清洗：模型輸出的下標不可信，先過一遍合法性 */
  function sanitizeListening(d){
    const n = d.sentences.length;
    let qs = (d.listening||[]).filter(it=>it && it.q && Array.isArray(it.opts) && it.opts.length>=2);
    /* 1-based 偵測：所有句子下標最小值≥1 且最大值正好==句數 → 整體減 1 */
    const idxs=[];
    qs.forEach(it=>{ (Array.isArray(it.play)?it.play:[]).concat([it.srcIdx]).forEach(x=>{ if(typeof x==='number') idxs.push(x); }); });
    if(idxs.length && Math.min.apply(null,idxs)>=1 && Math.max.apply(null,idxs)===n){
      qs.forEach(it=>{ if(Array.isArray(it.play)) it.play=it.play.map(x=>x-1); if(typeof it.srcIdx==='number') it.srcIdx-=1; });
    }
    qs = qs.filter(it=>{
      it.play = (Array.isArray(it.play)?it.play:[it.srcIdx]).filter(x=>Number.isInteger(x)&&x>=0&&x<n);
      if(!Number.isInteger(it.srcIdx)||it.srcIdx<0||it.srcIdx>=n) it.srcIdx = it.play.length?it.play[0]:-1;
      if(!it.play.length && it.srcIdx>=0) it.play=[it.srcIdx];
      /* 模型常在選項裡自帶「A. 」前綴，頁面會再加一遍字母，剝掉 */
      it.opts = it.opts.map(o=>String(o).replace(/^[A-DＡ-Ｄ][.、．)）]\s*/,'').trim());
      return it.play.length && it.srcIdx>=0 && Number.isInteger(it.ans) && it.ans>=0 && it.ans<it.opts.length;
    });
    d.listening = qs;
    return d;
  }

  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

  /* 程序化保底聽力題「聽音辨句」：播一句 → 從四句外語原句裡選出剛剛聽到的那句。
     選項全部是外語原文（不用中文翻譯），比照真實聽力考試格式；
     正確答案＝該句原文，干擾項從其他句原文隨機取——答案 100% 正確，不依賴模型判斷。
     用途：AI 理解題經核對後靠譜的不足時，用它兜底，保證有題且答案對。 */
  function buildFallbackListening(d, lang){
    const field = lang==='jp' ? 'jp' : 'en';
    const idx = d.sentences.map((s,i)=>i).filter(i=>d.sentences[i][field]);
    if(idx.length < 4) return [];   /* 少於4句湊不齊四選一 */
    const allTxt = Array.from(new Set(idx.map(i=>d.sentences[i][field])));
    if(allTxt.length < 4) return [];
    const qWord = lang==='jp' ? '🔊 今聞[きこ]えたのはどれ？' : '🔊 Which sentence did you just hear?';
    const out = [];
    shuffle(idx.slice()).slice(0, 6).forEach(i=>{
      const txt = d.sentences[i][field];
      const distract = shuffle(allTxt.filter(z=>z!==txt)).slice(0,3);
      if(distract.length < 3) return;
      const opts = shuffle([txt, ...distract]);
      out.push({ play:[i], srcIdx:i, q:qWord, ans:opts.indexOf(txt), opts:opts });
    });
    return out;
  }

  /* 聽力題答案把關：一次生成整課時弱模型常標錯 ans，甚至題目與依據句錯位、選項全不沾邊。
     策略：①二次核對只保留能確認正確的理解題（-1/非法/核對失敗一律丟棄，不保留未驗證的坏題）
           ②若靠譜理解題 < 3，整段改用程序化「聽句選意」保底，保證答案 100% 正確。 */
  async function verifyListening(lang, d, onProgress){
    const field = lang==='jp' ? 'jp' : 'en';
    if(d.listening.length){
      if(onProgress) onProgress('正在逐題核對聽力題答案…');
      const qtext = d.listening.map((it,i)=>{
        const s = d.sentences[it.srcIdx]||{};
        const spk = s.speaker ? s.speaker+': ' : '';   /* 對話句附上說話者，核對「XX說了什麼」這類問題時才有依據 */
        return '第'+i+'題\n依據句子：'+spk+(s[field]||'')+
          '\n問題：'+it.q+'\n選項：'+it.opts.map((o,j)=>j+'. '+o).join('　');
      }).join('\n\n');
      let verified = null;
      try{
        const content = await callApi(getTextModel(), [
          { role:'user', content:
            '下面是若干道聽力理解題，每題附「依據句子」。請嚴格逐題判斷：\n'+
            '· 只根據「依據句子」本身能不能答出這題？\n'+
            '· 四個選項裡有沒有**唯一一個**明確正確的？\n'+
            '答得出且有唯一正確選項 → 給該選項下標（從0開始）；'+
            '只要題目與依據句無關、選項沒有明確正確的、或正確答案不唯一 → 一律給 -1。\n'+
            '只輸出 JSON 陣列（長度必須等於題數），如 [1,-1,2,-1]，不要任何解釋。\n\n'+qtext }
        ]);
        let t = stripFences(content);
        const a=t.indexOf('['), b=t.lastIndexOf(']');
        if(a>=0 && b>a) t=t.slice(a,b+1);
        const arr = JSON.parse(t);
        if(Array.isArray(arr) && arr.length===d.listening.length) verified = arr;
      }catch(e){ /* 核對失敗 → verified 保持 null，下面整段丟棄後走保底 */ }
      if(verified){
        d.listening = d.listening.filter((it,i)=>{
          const v = verified[i];
          if(Number.isInteger(v) && v>=0 && v<it.opts.length){ it.ans=v; return true; }
          return false;
        });
      }else{
        d.listening = []; /* 沒核對成功 = 全部未驗證，不留坏題，交給保底 */
      }
    }
    /* 保留通過核對的理解題；不足 4 題時用「聽句選意」保底**補足缺口**——
       好理解題留著，只補不夠的，不再整段換成保底(避免明明有靠譜理解題卻全變翻譯題)。 */
    if(d.listening.length < 4){
      const used = {}; d.listening.forEach(it=>{ used[it.srcIdx]=1; });
      const fb = buildFallbackListening(d, lang).filter(q=>!used[q.srcIdx]);
      d.listening = d.listening.concat(fb.slice(0, 4 - d.listening.length));
    }
    return d;
  }

  async function callApi(model, messages, onProgress, opts){
    opts = opts || {};
    const key = getKey();
    if(!key) throw new Error('還沒設定智譜 API Key');
    if(onProgress) onProgress('正在請求智譜 AI…');
    const body = { model, messages, temperature:0.3 };
    /* 生成整課的 JSON 很長，不設上限會被截斷成半截 JSON → 解析失敗。給足額度。 */
    if(opts.max_tokens) body.max_tokens = opts.max_tokens;
    /* 智譜 GLM-4 支援強制輸出合法 JSON，杜絕「多一句解釋 / 尾逗號」導致 parse 失敗 */
    if(opts.json) body.response_format = { type:'json_object' };
    const resp = await fetch(ENDPOINT, {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    if(resp.status===401) throw new Error('API Key 無效或已過期');
    if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('智譜回應錯誤 '+resp.status+' '+t.slice(0,120)); }
    const j = await resp.json();
    const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if(!content) throw new Error('智譜沒有返回內容');
    return content;
  }

  /* 跨課詞彙複現：收集之前學過的詞（自建課生詞 + 錯題本單詞），
     生成新課時讓 AI 在例句/選項裡自然複用——一個詞要在不同語境遇到 7-12 次才算習得 */
  function knownWords(lang){
    try{
      const out=[];
      Object.values(allUserLessons()).forEach(l=>{
        if(l.lang===lang) (l.vocab||[]).forEach(v=>{ if(v.w) out.push(String(v.w).replace(/\[[^\]]+\]/g,'')); });
      });
      const eb=JSON.parse(localStorage.getItem('jingdu_errbook')||'{}');
      Object.values(eb).forEach(it=>{ if(it.type==='word' && it.en) out.push(it.en); });
      return Array.from(new Set(out)).slice(-30);
    }catch(e){ return []; }
  }
  function reuseHint(lang){
    const ws=knownWords(lang);
    return ws.length ? '\n\n（這位學生之前學過這些詞：'+ws.join(', ')+
      '。寫 vocab 例句和 listening 選項時，合適的地方自然複用其中幾個幫助複習；課文原文一字不可改。）' : '';
  }

  async function fromText(lang, text, onProgress){
    const content = await callApi(getTextModel(), [
      { role:'system', content: systemPrompt(lang) },
      { role:'user', content: '課文如下：\n\n'+text+reuseHint(lang) }
    ], onProgress, { json:true, max_tokens:4096 });
    if(onProgress) onProgress('正在整理課文…');
    const d = parseLesson(content);
    return verifyListening(lang, d, onProgress);
  }

  async function fromImage(lang, dataUrl, onProgress){
    const content = await callApi(getVisionModel(), [
      { role:'user', content: [
        { type:'text', text: systemPrompt(lang)+'\n\n請先一字不漏地讀出圖片裡的課文（不要漏詞、不要改寫），再按上面規則輸出 JSON。'+reuseHint(lang) },
        { type:'image_url', image_url:{ url: dataUrl } }
      ]}
    ], onProgress, { max_tokens:4096 });
    if(onProgress) onProgress('正在整理課文…');
    const d = parseLesson(content);
    return verifyListening(lang, d, onProgress);
  }

  /* ---- 造句判分（造句挑戰環節用；返回結構經校驗，格式不對直接拋錯讓 UI 走自評兜底） ---- */
  async function judgeSentence(lang, word, sentence){
    const langName = lang==='jp' ? '日語' : '英語';
    const content = await callApi(getTextModel(), [
      { role:'user', content:
        '你是親切的小學'+langName+'老師。孩子用指定單詞造了一個句子，請判斷：\n'+
        '1. 是否用上了指定單詞（複數、過去式、活用等詞形變化都算用上）\n'+
        '2. 句子語法是否基本正確（輕微拼寫、大小寫、標點問題不扣）\n'+
        '只輸出 JSON，不要任何解釋：{"ok":true或false,"fix":"若不對，給一句修正後的句子；對則留空","tip":"一句繁體中文的鼓勵或提示，30字內"}\n\n'+
        '指定單詞：'+word+'\n孩子的句子：'+sentence }
    ], null, { json:true, max_tokens:512 });
    let t = stripFences(content);
    const a=t.indexOf('{'), b=t.lastIndexOf('}');
    if(a>=0 && b>a) t=t.slice(a,b+1);
    const r = JSON.parse(t);
    if(typeof r.ok!=='boolean') throw new Error('AI 返回格式不對');
    return { ok:r.ok, fix:String(r.fix||''), tip:String(r.tip||'') };
  }

  /* ---- 課後小故事：只用學過的詞寫超短故事（泛讀甜點，AI 生成零版權）；結構校驗，失敗拋錯由 UI 兜底 ---- */
  async function storyFromWords(lang, words, onProgress){
    const langName = lang==='jp' ? '日語' : '英語';
    if(onProgress) onProgress('AI 正在寫小故事…');
    const jpRule = lang==='jp' ? '，漢字標振假名 漢字[かな]（只標漢字）' : '';
    const content = await callApi(getTextModel(), [
      { role:'user', content:
        '請為小學生寫一個非常短的'+langName+'小故事（4-6 句，'+(lang==='jp'?'60 字':'60 詞')+'以內），'+
        '**只能用下面這些學過的詞**，加上最基礎的功能詞（'+(lang==='jp'?'助詞、です/ます等':'冠詞、代詞、be 動詞、介詞等')+'）'+jpRule+'。故事要有趣、完整。\n'+
        '只輸出 JSON，不要任何解釋：{"title":"故事標題（'+langName+'）","text":"故事全文","zh":"繁體中文翻譯"}\n\n'+
        '學過的詞：'+words.join(', ') }
    ], null, { json:true, max_tokens:1024 });
    let t = stripFences(content);
    const a=t.indexOf('{'), b=t.lastIndexOf('}');
    if(a>=0 && b>a) t=t.slice(a,b+1);
    const r = JSON.parse(t);
    if(!r.text || typeof r.text!=='string') throw new Error('AI 返回格式不對');
    return { title:String(r.title||'小故事'), text:String(r.text), zh:String(r.zh||'') };
  }

  /* ---- 復盤側詞彙遷移：給錯題單詞造一個「新語境」例句（不同於原課例句），
     讓學過的詞在新句子裡再現一次，強化遷移。結構校驗，快取進 localStorage 不重複花錢。 ---- */
  async function exampleFor(lang, word, zh){
    const langName = lang==='jp' ? '日語' : '英語';
    const jpRule = lang==='jp' ? '，漢字標振假名 漢字[かな]（只標漢字）' : '';
    const content = await callApi(getTextModel(), [
      { role:'user', content:
        '請為小學生用'+langName+'單詞「'+word+'」（中文意思：'+zh+'）造一個**新的、簡單的**例句'+
        '（8-14 個詞以內，只用最基礎的常見詞'+jpRule+'），幫助孩子在新語境裡複習這個詞。\n'+
        '只輸出 JSON，不要任何解釋：{"eg":"例句","zh":"繁體中文翻譯"}' }
    ]);
    let t = stripFences(content);
    const a=t.indexOf('{'), b=t.lastIndexOf('}');
    if(a>=0 && b>a) t=t.slice(a,b+1);
    const r = JSON.parse(t);
    if(!r.eg || typeof r.eg!=='string') throw new Error('AI 返回格式不對');
    return { eg:String(r.eg), zh:String(r.zh||'') };
  }

  /* ---- 用戶課文存儲（本機 + 隨雲同步；view.html 讀取渲染） ---- */
  function allUserLessons(){ try{ return JSON.parse(localStorage.getItem('jingdu_userlessons')||'{}'); }catch(e){ return {}; } }
  function saveLesson(lang, data){
    const id = 'u-'+Date.now().toString(36);
    const lesson = {
      id: id, lang: lang,
      badge: (lang==='jp'?'日語':'NCE') + ' · 自建',
      title: data.title || '未命名',
      level: data.level || 0,
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
    /* 連帶清掉這課的進度、錯題復盤、小故事快取，避免留孤兒數據 */
    localStorage.removeItem('jingdu_prog_'+id);
    localStorage.removeItem('jingdu_story_'+id);
    try{
      const b = JSON.parse(localStorage.getItem('jingdu_errbook')||'{}');
      let changed = false;
      for(const k in b){ if(b[k] && b[k].lessonId===id){ delete b[k]; changed=true; } }
      if(changed) localStorage.setItem('jingdu_errbook', JSON.stringify(b));
    }catch(e){}
    localStorage.setItem('jingdu_updatedAt', String(Date.now()));
    if(window.JDSYNC) window.JDSYNC.schedule();
  }

  window.JDGen = { getKey, setKey, getTextModel, getVisionModel, setModels,
                   fromText, fromImage, parseLesson, systemPrompt,
                   sanitizeListening, verifyListening, buildFallbackListening, judgeSentence, knownWords, storyFromWords, exampleFor,
                   allUserLessons, saveLesson, deleteLesson };
})();
