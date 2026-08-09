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
    {"en": "英文句子（保持原文，逐句拆開；**不要**把說話者名字寫進這裡）", "zh": "繁體中文翻譯", "ana": "給小學生看的詳細講解，3-5句：①整句在說什麼 ②句子結構怎麼搭（主謂賓/時態/從句）③關鍵詞的詞性和用法 ④為什麼這樣用、換個說法行不行 ⑤容易錯的地方。白話、可用 <b>標籤</b>，重點前加 ⭐；不要只寫一行",
     "speaker": "若原文是對話（如 Jack: ... / A: ...），這句是誰說的就填名字；不是對話則省略此欄"}
  ],
  "vocab": [
    {"w": "單詞", "ipa": "/音標/", "pos": "n. 名詞 / v. 動詞 等", "zh": "中文意思", "eg": "含這個單詞的例句（用課文裡的句子）"}
  ],
  "listening": [
    {"play": [句子索引], "srcIdx": 對應句子索引, "q": "英文提問（如 What did the boy buy?，仿真實英語聽力考試格式）", "ans": 正確選項下標(從0), "opts": ["英文選項1","英文選項2","英文選項3","英文選項4"]}
  ],
  "grammar": [
    {"t": "語法點標題", "body": "<p>白話講解，分2-3段：先講規則，再講怎麼用、什麼時候用、注意點/易錯點</p><div class=\\"eg\\">例句1（附中文）<br>例句2（附中文）<br>例句3（附中文）</div><p>可再補一句小提醒或對比</p>"}
  ]
}`;

  const SCHEMA_JP = `{
  "title": "課名（如 初めまして 第X課）",
  "level": 難度星級整數1-5（按生詞率和語法複雜度估：1=很簡單 5=很難）,
  "sentences": [
    {"jp": "日文句子，漢字必須標振假名，格式為 漢字[かな]，如 私[わたし]は 学生[がくせい]です。（只在漢字後面用方括號標讀音，假名/片假名/數字不要標）",
     "romaji": "羅馬音", "zh": "繁體中文翻譯",
     "ana": "給小學生看的詳細講解，3-5句：①整句意思 ②每個助詞(は/が/を/に…)的作用 ③句型/活用怎麼變 ④為什麼這樣用 ⑤容易錯的地方。白話、可用 <b>標籤</b>，重點前加 ⭐；不要只寫一行",
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
    {"t": "語法點標題", "body": "<p>白話講解，分2-3段：先講規則，再講用法/什麼時候用/注意點</p><div class=\\"eg\\">例句1（標振假名，附中文）<br>例句2（標振假名，附中文）<br>例句3（標振假名，附中文）</div><p>可再補一句小提醒或對比</p>"}
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
4. vocab 挑本課 6-12 個重點詞；grammar 挑 3-5 個語法點，每點講解要**詳細**（分段講規則＋用法＋易錯），並**至少配 3 個例句、每句附中文翻譯**。每句的 ana 也要**細緻（3-5句）**，不要只寫一行。
4.1 **只做真正的${langName}課文正文**：如果圖片/文檔裡夾雜了練習題、思考題、中文題目、選擇填空、單元說明、頁碼、答案等**非課文內容，一律忽略**，絕不把題目或中文句子當成 sentences 拆進精讀；只抽取課文本身那段${langName}文字。若整份材料找不到成段的${langName}課文（例如全是中文題目），寧可少做也不要硬湊。
5. listening 出 4-6 題，**q（提問）和 opts（選項）都必須用${langName}原文，不可用中文**——比照中國大陸英語/日語聽力考試的真實格式（考卷上問題和選項都是外語，不是翻成中文），四選一考查聽力理解。**ans 必須是能從 srcIdx 那句話直接驗證的唯一正確選項的下標（從0開始）**，寫完每題後自己核對一遍 ans 是否指向正確選項；opts 內容不要帶「A. 」等字母前綴。
${lang==='jp' ? '6. 日文漢字必須標振假名 漢字[かな]（只標漢字，假名/片假名/數字不標）；romaji 提供羅馬音；chunks 用文節切分。' : '6. 每個 vocab 給準確音標。'}
7. **若課文是對話**（人物名 + 冒號開頭，如「Jack: I want a coffee.」「A：おはよう。」）：把說話者名字拆進獨立的 speaker 欄位，${lang==='jp'?'jp':'en'} 欄位裡只留**這句話本身**、不要把名字或冒號寫進去（這句話之後會被拿去跟讀、背誦、連詞成句，混進名字會讓孩子跟著把名字也讀出來，不自然）。speaker 照樣是這篇故事的一部分，人名本身不用刪，只是換個欄位放。listening 的 q 需要點出是誰說的時候，可以直接在 q 裡寫「Jack said...」這樣的自然問法。不是對話的課文，每句都省略 speaker 欄位。

JSON 結構：
${schema}`;
  }

  /* 偵測「輸入是一組單詞（詞表）」而非成段課文：多行或逗號/頓號分隔、每條都是短詞、無句末標點。
     保守判斷（明確列表才 true），避免把漏標點的句子誤判成詞表；漏判的靠 fromText 生成失敗兜底。 */
  function isWordList(text){
    const t = String(text||'').trim();
    if(!t) return false;
    let items = t.split(/[\n;；]+/).map(s=>s.trim()).filter(Boolean);
    if(items.length < 2) items = t.split(/[,，、]+/).map(s=>s.trim()).filter(Boolean);
    /* 單行無分隔（如 "apple banana cat" 或 "The boy runs fast"）：自動偵測無法可靠區分「一串詞」
       和「漏標點的句子」，強判任一邊都會誤傷。故單行不自動判——由用戶在 new.html 明確選「🔤 一組單詞」
       強制走單詞課（forceMode='words'），零誤判。多行/逗號分隔才自動判詞表。 */
    if(items.length < 2) return false;
    let wordish=0;
    items.forEach(it=>{
      const hasSent = /[.。!！?？]/.test(it);
      const enWords = (it.match(/[A-Za-z]+/g)||[]).length;  /* 一條詞目：英文詞≤3（允許 word+中文注釋） */
      if(!hasSent && enWords<=3) wordish++;
    });
    return wordish >= Math.ceil(items.length*0.8);
  }
  /* 單詞課 prompt：把一組單詞做成「每詞一例句」的迷你精讀課。例句成為 sentences、
     單詞成為 vocab——完全複用現有 9 環節（聽全文/逐句/生詞卡/生詞強化/連詞/跟讀/聽力/背句/造句），零環節改動。 */
  function wordsSystemPrompt(lang){
    const schema = lang==='jp' ? SCHEMA_JP : SCHEMA_EN;
    const langName = lang==='jp' ? '日語' : '英語';
    return `你是一位耐心的${langName}老師，為小學生做「單詞精讀課」。
用戶會給你一組${langName}單詞（可能每個詞後面帶中文意思）。請把這組單詞做成精讀數據，嚴格按下面 JSON 結構輸出。

規則：
1. **只輸出 JSON**，不要任何解釋、不要 markdown 代碼框。
2. 講解（ana / grammar）一律用**繁體中文**，語氣親切，重點前加 ⭐。
3. **為每個單詞造一個例句放進 sentences**：句子要**簡單、常用、小學生水平、地道**，能幫孩子學會這個詞怎麼用。每個 sentences 對象：${lang==='jp'?'jp=例句（漢字標振假名 漢字[かな]）、romaji、zh=翻譯、ana=用 2-3 句講這個詞怎麼用':'en=例句、zh=翻譯、ana=用 2-3 句講這個詞怎麼用'}。sentences 的順序與 vocab 一一對應。
4. **vocab = 用戶給的這組單詞**，每個給${lang==='jp'?'振假名 漢字[かな]/romaji':'準確音標'}、詞性、中文意思、eg（就用你在 sentences 造的那句）。用戶已給中文意思的，尊重它。
5. grammar 挑 1-3 個這些單詞涉及的小語法點或常見用法（沒有明顯語法點就少給或不給）。
6. listening 出 3-5 題，基於你造的例句，q 和 opts 都用${langName}原文（不可中文），四選一，ans 指向正確選項下標（從0開始），寫完自己核對一遍。
7. title 起個貼切課名，如「日常水果單詞 Fruits」「動作動詞小課」。
${lang==='jp'?'8. 日文漢字必須標振假名 漢字[かな]（只標漢字）。':''}

JSON 結構：
${schema}`;
  }

  function stripFences(s){
    return s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim();
  }

  function parseLesson(raw, lang){
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
    sanitizeSpeakers(d, lang);
    return d;
  }

  /* 對話人名清洗：提示詞要求 AI 把「Jack: I want a coffee.」的人名拆進獨立 speaker 欄位，
     但 LLM 對格式指令遵從率不是100%——常常人名還是黏在 en/jp 正文裡，導致跟讀/背句/連詞成句
     這些只讀 sentences[i].en 的環節，孩子被迫連名字一起讀/排/背。這裡不管 AI 有沒有聽話，
     一律強制掃一遍：正文開頭是「XX: 」或「XX：」就拆出來，蓋掉/補上 speaker，正文只留說話內容。
     name 只認短的字母/CJK 開頭片段，避免誤傷正常句子（如 "Note: ..." 極罕見，可接受）。 */
  function sanitizeSpeakers(d, lang){
    const field = lang==='jp' ? 'jp' : 'en';
    /* CJK 名字要包含振假名括號 [] 和 々（日語對話人名常寫成「田中[たなか]：」，舊正則卡在括號前，名字沒被拆出來→跟讀/背句被迫連名字一起讀，準確率暴跌） */
    const RE = /^([A-Za-z][A-Za-z .'’-]{0,24}|[一-鿿぀-ヿＡ-Ｚ\[\]々]{1,24})\s*[：:]\s*/;
    (d.sentences||[]).forEach(s=>{
      const raw = s && s[field];
      if(typeof raw!=='string') return;
      const m = raw.match(RE);
      if(m){
        s.speaker = m[1].trim();
        s[field] = raw.slice(m[0].length).trim();
      }
    });
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
        /* 這裡曾漏加 {json:true}，AI 核對回應格式不穩時 JSON.parse 就失敗，
           一失敗整批理解題全丟棄變成清一色保底題——跟其他呼叫一樣強制合法 JSON。 */
        const content = await callApi(getTextModel(), [
          { role:'user', content:
            '下面是若干道聽力理解題，每題附「依據句子」。請嚴格逐題判斷：\n'+
            '· 只根據「依據句子」本身能不能答出這題？\n'+
            '· 四個選項裡有沒有**唯一一個**明確正確的？\n'+
            '答得出且有唯一正確選項 → 給該選項下標（從0開始）；'+
            '只要題目與依據句無關、選項沒有明確正確的、或正確答案不唯一 → 一律給 -1。\n'+
            '只輸出 JSON 物件 {"ans":[數字陣列]}，長度必須等於題數，如 {"ans":[1,-1,2,-1]}，不要任何解釋。\n\n'+qtext }
        ], null, { json:true, max_tokens:512 });
        let t = stripFences(content);
        let parsed;
        try{ parsed = JSON.parse(t); }
        catch(e2){
          /* 容錯：json_object 模式偶爾仍會夾帶前後文字，退一步截取花括號範圍重試 */
          const a=t.indexOf('{'), b=t.lastIndexOf('}');
          if(a>=0 && b>a) parsed = JSON.parse(t.slice(a,b+1));
        }
        const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.ans) ? parsed.ans : null);
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
    const payload = JSON.stringify(body);
    /* fetch 在網路層失敗(如圖太大被瀏覽器丟掉、連線中斷)會 throw TypeError「Load failed」，
       不是 HTTP 錯誤碼。自動重試一次；仍失敗給看得懂的提示。 */
    async function doFetch(){
      return fetch(ENDPOINT, {
        method:'POST',
        headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json' },
        body: payload
      });
    }
    let resp;
    try{ resp = await doFetch(); }
    catch(e1){
      if(onProgress) onProgress('網路不穩，重試一次…');
      await new Promise(r=>setTimeout(r, 900));
      try{ resp = await doFetch(); }
      catch(e2){ throw new Error('連不上智譜（網路中斷或圖片太大）。請確認網路，或換一張更清楚、檔案小一點的照片再試。'); }
    }
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

  async function fromText(lang, text, onProgress, forceMode){
    /* forceMode: 'words'=強制單詞課 / 'text'=強制課文 / 其他=自動偵測。讓用戶在 new.html 明確指定，避免偵測誤判。 */
    const wordMode = forceMode==='words' ? true : forceMode==='text' ? false : isWordList(text);
    async function gen(useWords){
      const content = await callApi(getTextModel(), [
        { role:'system', content: useWords ? wordsSystemPrompt(lang) : systemPrompt(lang) },
        { role:'user', content: useWords ? ('單詞如下：\n\n'+text) : ('課文如下：\n\n'+text+reuseHint(lang)) }
      ], onProgress, { json:true, max_tokens:4096 });
      return parseLesson(content, lang);
    }
    let d;
    if(wordMode){
      if(onProgress) onProgress('看起來是一組單詞，正在做成「單詞＋造句」精讀課…');
      d = await gen(true);
    }else{
      try{ d = await gen(false); }
      catch(e){
        /* 兜底：正常生成沒有句子（很可能是沒被偵測到的詞表）→ 自動改走單詞課重試一次 */
        if(/沒有句子|没有句子|格式有誤|太長被截斷|截斷/.test(String(e.message||e))){
          if(onProgress) onProgress('沒有成段課文，改用「單詞＋造句」精讀課試試…');
          d = await gen(true);
        }else throw e;
      }
    }
    if(onProgress) onProgress('正在整理課文…');
    return verifyListening(lang, d, onProgress);
  }

  /* 圖片建課分兩步：①視覺模型只做「照抄圖片文字」（輸出短，遠低於視覺模型 1024 token 硬上限）
     ②抄出的原文交給 fromText 走文字模型（glm-4-plus，4096 上限）生成完整精讀 JSON。
     不能一次叫視覺模型「讀圖+輸出整課JSON」——整課JSON很長，視覺模型 max_tokens 硬上限只有
     1024（實測 API 400：「max_tokens参数非法：限制数值范围[1,1024]」），會被截斷。 */
  /* 支援多張圖片（一篇課文跨好幾頁）：dataUrl 可傳單張字串或多張陣列，按順序拼成一篇課文 */
  async function fromImage(lang, dataUrl, onProgress, forceMode){
    const urls = Array.isArray(dataUrl) ? dataUrl.filter(Boolean) : [dataUrl];
    if(!urls.length) throw new Error('沒有圖片');
    if(onProgress) onProgress(urls.length>1 ? ('正在看圖識字…（共 '+urls.length+' 張，按順序拼成一篇）') : '正在看圖識字…');
    const langName = lang==='jp' ? '日文' : '英文';
    const many = urls.length>1;
    const content = [
      { type:'text', text: '這裡是同一篇'+langName+'課文的 '+urls.length+' '+(many?'張圖片（按先後順序就是課文的閱讀順序）':'張圖片')+'。請把'+(many?'所有圖片裡的':'圖片裡的')+langName+'課文一字不漏地照抄出來，'+(many?'按圖片順序連成一篇完整課文，':'')+'不要漏詞、不要改寫、不要翻譯、不要加任何說明。只輸出課文原文本身。' }
    ];
    urls.forEach(u=>content.push({ type:'image_url', image_url:{ url: u } }));
    /* ⚠️ 視覺模型 max_tokens 硬上限 1024（見上方註釋，超過報 400「限制数值范围[1,1024]」）——絕不能設 2048 */
    const ocr = await callApi(getVisionModel(), [{ role:'user', content }], onProgress, { max_tokens:1024 });
    const text = stripFences(ocr).trim();
    if(!text) throw new Error('沒能從圖片讀出文字，換張更清楚的照片試試');
    return fromText(lang, text, onProgress, forceMode);
  }

  /* ---- 造句判分（造句挑戰環節用；返回結構經校驗，格式不對直接拋錯讓 UI 走自評兜底） ---- */
  async function judgeSentence(lang, word, sentence){
    const langName = lang==='jp' ? '日語' : '英語';
    const content = await callApi(getTextModel(), [
      { role:'user', content:
        '你是親切但**嚴謹**的小學'+langName+'老師。孩子用指定單詞造了一個句子，請判斷：\n'+
        '1. 是否用上了指定單詞（複數、過去式、活用等詞形變化都算用上）\n'+
        '2. 句子是否**完全正確**——只要有下列任一錯誤，就判 ok:false：時態錯、單複數錯、用詞不當/搭配錯、詞形錯（例如助動詞後沒用原形、第三人稱單數漏 s、'+(lang==='jp'?'助詞用錯、活用形錯':'冠詞漏用')+'）、語序或語法錯。\n'+
        '   只有**輕微拼寫、大小寫、標點**這種小毛病可以不扣、判 ok:true。\n'+
        'ok:true 必須同時滿足「用上了指定單詞」+「沒有上面任何一種錯誤」。\n'+
        '若 ok:false，fix 給一句改正後的完整句子，tip 用繁體中文**具體說出錯在哪**（例如「should 後面要用動詞原形 go，不是 went」），30字內。\n'+
        '最後，不管對不對，都用「同一個單詞」示範一句**更自然、更像'+langName+'母語者平常會說**的地道句子（和孩子的句子同類、難度相近，別太難）。\n'+
        (lang==='jp' ? 'better 句的漢字要標振假名 漢字[かな]（只標漢字）。\n' : '')+
        '只輸出 JSON，不要任何解釋：{"ok":true或false,"fix":"若不對，給一句修正後的句子；對則留空","tip":"一句繁體中文的鼓勵或提示，30字內","better":"用同一個單詞、更地道的一句示範","betterZh":"better 那句的繁體中文翻譯"}\n\n'+
        '指定單詞：'+word+'\n孩子的句子：'+sentence }
    ], null, { json:true, max_tokens:512 });
    let t = stripFences(content);
    const a=t.indexOf('{'), b=t.lastIndexOf('}');
    if(a>=0 && b>a) t=t.slice(a,b+1);
    const r = JSON.parse(t);
    if(typeof r.ok!=='boolean') throw new Error('AI 返回格式不對');
    return { ok:r.ok, fix:String(r.fix||''), tip:String(r.tip||''), better:String(r.better||''), betterZh:String(r.betterZh||'') };
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
    /* 連帶清掉這課的進度、續做位置/計分、錯題復盤、小故事快取，避免留孤兒數據
       ⚠️ secpos_ 一定要清：登山海拔(totalCorrect)讀 secpos_，漏清會讓刪掉的課還在灌海拔 */
    localStorage.removeItem('jingdu_prog_'+id);
    localStorage.removeItem('jingdu_secpos_'+id);
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
                   fromText, fromImage, parseLesson, systemPrompt, isWordList, wordsSystemPrompt,
                   sanitizeListening, verifyListening, buildFallbackListening, judgeSentence, knownWords, storyFromWords, exampleFor,
                   allUserLessons, saveLesson, deleteLesson };
})();
