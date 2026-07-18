/* 精讀 jingdu 核心引擎：存儲 / 艾賓浩斯 / TTS / 語音識別 / 逐詞比對 */
(function(){
  'use strict';
  const NS = 'jingdu_';

  /* 註冊 Service Worker（網絡優先）：裝一次後，普通刷新就能拿最新代碼，不必硬刷新；離線也能用。
     用 core.js 自身路徑推導站點根，兼容本地測試與 GitHub Pages 的 /jingdu/ 子路徑；失敗靜默不影響功能。 */
  if('serviceWorker' in navigator){
    try{
      var _sc = document.currentScript ||
        Array.prototype.slice.call(document.getElementsByTagName('script')).filter(function(s){return /assets\/core\.js/.test(s.src);})[0];
      if(_sc && _sc.src){
        var _root = _sc.src.replace(/assets\/core\.js.*$/, '');
        navigator.serviceWorker.register(_root+'sw.js', {scope:_root, updateViaCache:'none'}).catch(function(){});
      }
    }catch(e){}
  }

  /* ---------- 微信內建瀏覽器偵測：跟讀/背句要用的麥克風錄音，iOS 微信內建瀏覽器（WKWebView）
     系統性不支援（蘋果只把語音辨識權限開給獨立 Safari，不開給第三方 App 內建瀏覽器）。
     這不是能用代碼修的 bug，也沒辦法自動跳出微信（微信會攔截，實測過）——
     唯一可靠辦法是用戶自己點右上角「⋯」選「在瀏覽器打開」。這裡主動偵測+引導，
     不讓用戶像之前那樣卡在錄音沒反應才發現。聽全文/聽力題播放不受影響，不擋整站。 */
  function isWeChatBrowser(){ return /MicroMessenger/i.test(navigator.userAgent||''); }
  function wechatTipDismissed(){ try{ return sessionStorage.getItem(NS+'wx_tip_dismissed')==='1'; }catch(e){ return false; } }
  function injectWeChatTip(){
    if(!isWeChatBrowser() || wechatTipDismissed()) return;
    if(document.getElementById('jdWxTip')) return;
    const bar = document.createElement('div');
    bar.id = 'jdWxTip';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999;background:#F5A623;color:#2B2320;'+
      'padding:10px 14px;font-size:.86rem;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,.15);'+
      'display:flex;align-items:center;gap:8px;font-family:-apple-system,sans-serif';
    bar.innerHTML =
      '<span style="flex:1">↗️ 跟讀／背句要用麥克風，微信內建瀏覽器不支援。點右上角 <b>⋯</b> → 選「<b>在瀏覽器打開</b>」才能用</span>'+
      '<button type="button" style="flex:none;border:none;background:none;font-size:1.1rem;cursor:pointer;color:#2B2320;padding:0 4px" aria-label="關閉">✕</button>';
    document.documentElement.style.setProperty('--jd-wx-tip-h','0px');
    function place(){ document.body.style.paddingTop = bar.offsetHeight+'px'; }
    bar.querySelector('button').onclick = ()=>{
      try{ sessionStorage.setItem(NS+'wx_tip_dismissed','1'); }catch(e){}
      bar.remove(); document.body.style.paddingTop='';
    };
    if(document.body){ document.body.appendChild(bar); place(); }
    else document.addEventListener('DOMContentLoaded', ()=>{ document.body.appendChild(bar); place(); });
  }
  injectWeChatTip();

  /* ---------- 存儲 ---------- */
  function load(key, def){ try{ const v = localStorage.getItem(NS+key); return v ? JSON.parse(v) : def; }catch(e){ return def; } }
  function save(key, val){
    try{
      localStorage.setItem(NS+key, JSON.stringify(val));
      localStorage.setItem(NS+'updatedAt', String(Date.now()));
      if(window.JDSYNC) window.JDSYNC.schedule(); /* 有開雲端備份就自動同步 */
    }catch(e){}
  }

  /* 課程進度：{lessonId:{sec1:true,...}} */
  function getProgress(lessonId){ return load('prog_'+lessonId, {}); }
  function markDone(lessonId, sec){
    const p = getProgress(lessonId); if(p[sec]) return p;
    p[sec] = true; save('prog_'+lessonId, p);
    touchDay();
    return p;
  }

  /* 每個環節的細粒度進度/續做位置：secpos_<lessonId> = { sec:{done, n} }
     done=已完成的項數(只增不減，回看不倒退)，n=總項數；續做位置=第一個沒做的項=min(done,n-1)。 */
  function getSecPos(lessonId){ return load('secpos_'+lessonId, {}); }
  /* done=已完成項數, n=總項數, score=答對數(可選,取歷來最好)；都只增不減 */
  function setSecPos(lessonId, sec, done, n, score){
    const m = getSecPos(lessonId); const cur = m[sec]||{};
    const nd = Math.max(done|0, cur.done||0);
    const ns = (score==null) ? (cur.score||0) : Math.max(score|0, cur.score||0);
    if(cur.done===nd && cur.n===(n|0) && (cur.score||0)===ns) return;  /* 沒變化就不寫，省同步 */
    m[sec] = { done: nd, n: n|0, score: ns };
    save('secpos_'+lessonId, m);
  }
  /* 續做索引：第一個還沒做的項（夾在 0..n-1） */
  function resumeIdx(lessonId, sec, n){
    const sp = getSecPos(lessonId)[sec]; const d = sp? (sp.done||0) : 0;
    return Math.max(0, Math.min(d, Math.max(0,(n|0)-1)));
  }

  /* ---------- 總評分：只有「有對錯」的 6 個環節計入 ----------
     聽全文/逐句/語法只是讀過沒對錯，不計分。盲聽揭曉後才答對的聽力題已在計分時排除(quiz score 不含揭曉題)。
     completion=完成度(做了幾成)，accuracy=正確率(做過的裡對了幾成)。 */
  const SCORED_SECS = ['vocab','build','speak','quiz','recite','make'];
  function lessonScore(lessonId){
    const sp = getSecPos(lessonId);
    let done=0, n=0, score=0;
    SCORED_SECS.forEach(k=>{ const s=sp[k]; if(s && s.n){
      const d=Math.min(s.done||0, s.n), sc=Math.min(s.score||0, d);
      done+=d; n+=s.n; score+=sc;
    }});
    return { done, n, score,
      completion: n? Math.round(done/n*100) : 0,
      accuracy: done? Math.round(score/done*100) : 0 };
  }

  /* ---------- 爬山：累計全站答對題數 → 海拔（每答對1題=20米）→ 對應山峰 ---------- */
  const METERS_PER_CORRECT = 20;
  const MOUNTAINS = [
    {name:'海平面', m:0, emoji:'🌊'},
    {name:'泰山', m:1545, emoji:'⛰️'},
    {name:'黃山', m:1864, emoji:'⛰️'},
    {name:'華山', m:2154, emoji:'⛰️'},
    {name:'峨眉山', m:3099, emoji:'🏔️'},
    {name:'富士山', m:3776, emoji:'🗻'},
    {name:'玉山', m:3952, emoji:'🏔️'},
    {name:'勃朗峰', m:4808, emoji:'🏔️'},
    {name:'乞力馬扎羅', m:5895, emoji:'🏔️'},
    {name:'阿空加瓜', m:6961, emoji:'🏔️'},
    {name:'珠穆朗瑪峰', m:8848, emoji:'🏔️'}
  ];
  function totalCorrect(){
    let total=0;
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(k && k.indexOf(NS+'secpos_')===0){
          const m=JSON.parse(localStorage.getItem(k))||{};
          SCORED_SECS.forEach(sec=>{ const s=m[sec]; if(s) total+=Math.min(s.score||0, s.done||0); });
        }
      }
    }catch(e){}
    return total;
  }
  function altitude(){ return totalCorrect()*METERS_PER_CORRECT; }
  /* 依海拔算出「當前達到的最高一座」與「下一座目標」，及爬向下一座的進度 0-1 */
  function mountainState(alt){
    if(alt==null) alt=altitude();
    let cur=MOUNTAINS[0], next=MOUNTAINS[1]||null;
    for(let i=0;i<MOUNTAINS.length;i++){
      if(alt>=MOUNTAINS[i].m){ cur=MOUNTAINS[i]; next=MOUNTAINS[i+1]||null; }
    }
    const frac = next ? Math.max(0,Math.min(1,(alt-cur.m)/(next.m-cur.m))) : 1;
    return { alt, cur, next, frac, atTop: !next };
  }

  /* ---------- 學習日曆 + 連續天數（streak）----------
     days: {'2026-07-14': 動作次數,...}；任何學習動作(完成環節/復盤/錯題)都記一筆 */
  function dstr(d){ const x=d||new Date(); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); }
  function touchDay(){
    const m = load('days', {});
    m[dstr()] = (m[dstr()]||0)+1;
    const keys = Object.keys(m).sort();
    while(keys.length>400) delete m[keys.shift()];
    save('days', m);
  }
  function daysMap(){ return load('days', {}); }
  function streak(){
    const m = daysMap();
    const todayDone = !!m[dstr()];
    let n=0; const d=new Date();
    if(!todayDone) d.setDate(d.getDate()-1);
    while(m[dstr(d)]){ n++; d.setDate(d.getDate()-1); }
    return { n:n, todayDone:todayDone };
  }

  /* ---------- 錯題本 + 艾賓浩斯 ----------
     item: {id, lessonId, en, zh, level, due, fails, ts}
     level 0..5 → 通過後 due = now + INTERVALS[level]；level 到 6 = 牢固 */
  const INTERVALS = [30*60e3, 24*3600e3, 2*24*3600e3, 4*24*3600e3, 7*24*3600e3, 15*24*3600e3];
  const LEVEL_NAMES = ['新錯題','30分鐘','1天','2天','4天','7天','15天‧牢固'];

  function getBook(){ return load('errbook', {}); }
  function setBook(b){ save('errbook', b); }
  function addError(item){
    touchDay();
    const b = getBook();
    const old = b[item.id];
    b[item.id] = {
      id:item.id, lessonId:item.lessonId, en:item.en, zh:item.zh||'',
      type:item.type||'sent', pos:item.pos||'',
      kmap:item.kmap||undefined, /* 日語課專用：漢字→讀音對照，供 review 頁把識別結果的漢字換成讀音再比對 */
      level:0, due:Date.now()+INTERVALS[0],
      fails:(old?old.fails:0)+1, ts:Date.now()
    };
    setBook(b);
  }
  function reviewPass(id){
    touchDay();
    const b = getBook(); const it = b[id]; if(!it) return;
    it.level += 1;
    if(it.level >= 6){ it.due = Number.MAX_SAFE_INTEGER; it.solid = true; }
    else{ it.due = Date.now()+INTERVALS[it.level]; }
    setBook(b);
  }
  function reviewFail(id){
    touchDay();
    const b = getBook(); const it = b[id]; if(!it) return;
    it.level = 0; it.due = Date.now()+INTERVALS[0]; it.fails += 1; delete it.solid;
    setBook(b);
  }
  function dueItems(){
    const now = Date.now();
    return Object.values(getBook()).filter(it=>!it.solid && it.due<=now).sort((a,b)=>a.due-b.due);
  }
  function allItems(){ return Object.values(getBook()).sort((a,b)=>a.due-b.due); }

  /* ---------- TTS（lang 預設 en-US，日語頁傳 'ja-JP'） ----------
     選聲優先序：①用戶在「聲音設定」頁選的偏好 ②高質量聲音（增強/Siri/neural 等關鍵詞）
     ③已知較自然的具名聲音 ④該語言任一。壓縮版系統聲最機械，盡量避開。 */
  /* 排除清單:①macOS 玩笑/音效聲(Jester/Organ/Trinoids/Whisper/Wobble/Zarvox/Good News/Bells…本就不是讀正常句子用的)
     ②Eloquence 機械聲(Sandy/Reed/Rocko/Flo… 英日都會冒出來,音質差)。名字比對,英日通吃。 */
  const BAD_VOICE = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Eddy|Flo|Good News|Grandma|Grandpa|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Princess|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;
  function voicesFor(prefix){
    if(!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter(v=>
      new RegExp('^'+prefix+'(-|_)','i').test(v.lang)
      && !BAD_VOICE.test(v.name)
      && !/google/i.test(v.name)   /* Google 是網絡聲,首次播放要連網很慢,排除 */
    );
  }
  /* 高質量關鍵詞（各家 neural/增強版聲音常見命名）；壓縮版通常無這些詞 */
  const HIQ = /(enhanced|premium|neural|siri|natural|eloquence|\(enhanced\)|超清|增强|自然)/i;
  const NICE = /Ava|Samantha|Allison|Evan|Joelle|Nathan|Serena|Kyoko|O-ren|Hattori|Kyui|Nanami|Sayaka/i;
  function getVoicePref(prefix){ try{ return localStorage.getItem(NS+'voice_'+prefix)||''; }catch(e){ return ''; } }
  function setVoicePref(prefix, uri){ try{ if(uri) localStorage.setItem(NS+'voice_'+prefix, uri); else localStorage.removeItem(NS+'voice_'+prefix); }catch(e){} }
  function pickVoice(lang){
    const prefix = lang.split('-')[0];
    const vs = voicesFor(prefix);
    if(!vs.length) return null;
    const pref = getVoicePref(prefix);
    if(pref){ const pv = vs.find(v=>v.voiceURI===pref); if(pv) return pv; }
    return vs.find(v=>HIQ.test(v.name)) || vs.find(v=>NICE.test(v.name)) || vs[0];
  }
  /* 供「聲音設定」頁列出可選聲音（去重、把高質量的排前面） */
  function listVoices(lang){
    const prefix = lang.split('-')[0];
    const seen = {};
    return voicesFor(prefix).filter(v=>{ if(seen[v.voiceURI]) return false; seen[v.voiceURI]=1; return true; })
      .map(v=>({ name:v.name, voiceURI:v.voiceURI, local:v.localService, hiq:HIQ.test(v.name) }))
      .sort((a,b)=> (b.hiq?1:0)-(a.hiq?1:0) || a.name.localeCompare(b.name));
  }
  function speak(text, slow, lang){
    if(!('speechSynthesis' in window)) return;
    lang = lang || 'en-US';
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang=lang;
    /* rate 0.92 比 0.9 略慢更清晰；慢速 0.6。pitch 稍降一點點更沉穩自然，別亂調免得怪 */
    u.rate = slow?0.6:0.92; u.pitch = 1.0;
    const v = pickVoice(lang); if(v) u.voice=v;
    speechSynthesis.speak(u);
  }
  /* 試聽指定聲音（聲音設定頁用）；voiceURI 為空則用當前偏好/優選 */
  function previewVoice(lang, voiceURI){
    if(!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const prefix = lang.split('-')[0];
    const sample = prefix==='ja' ? 'こんにちは、いっしょに べんきょうしましょう。' : 'Hello! Let us read this together.';
    const u = new SpeechSynthesisUtterance(sample);
    u.lang=lang; u.rate=0.92;
    const v = voicesFor(prefix).find(x=>x.voiceURI===voiceURI); if(v) u.voice=v;
    speechSynthesis.speak(u);
  }

  /* ---------- 首次用麥克風的教程提示（跟讀/背句等，看過一次就不再顯示） ---------- */
  function micTipSeen(){ try{ return localStorage.getItem(NS+'mic_tip_seen')==='1'; }catch(e){ return false; } }
  function markMicTip(){ try{ localStorage.setItem(NS+'mic_tip_seen','1'); }catch(e){} }
  /* 在 panelSel 頂部插入麥克風權限教程卡；看過就不插 */
  function injectMicTip(panelSel){
    if(micTipSeen()) return;
    const panel = document.querySelector(panelSel);
    if(!panel || panel.querySelector('.mic-tip')) return;
    const div = document.createElement('div');
    div.className = 'card mic-tip';
    div.innerHTML =
      '<b style="font-family:var(--font-head)">🎙️ 這一關要用麥克風</b>'+
      '<p style="margin-top:6px;line-height:1.6">第一次按「跟讀 / 開始說」時，瀏覽器會問要不要用麥克風——請點 <b>「允許」</b>。'+
      '每次重新打開網頁會再問一次，這是瀏覽器的規定，不是壞掉了。</p>'+
      '<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--teal-deep);font-family:var(--font-head)">👉 想以後不再每次問？點這裡看設置方法</summary>'+
      '<div style="margin-top:8px;line-height:1.8;font-size:.9rem">'+
      '<b>📱 iPhone / iPad</b>：設定 → 通用 → 鍵盤 → 打開「<b>啟用聽寫</b>」（沒開語音識別會用不了）；再 設定 → Safari → 麥克風 → 改「允許」；建議把網站「<b>加入主畫面</b>」，權限記得更牢。<br>'+
      '<b>💻 Mac Safari</b>：Safari 選單 → 設定 → 網站 → 麥克風 → 把本站設為「允許」。<br>'+
      '<b>💻 Mac Chrome</b>：點網址列左邊的 🔒 → 麥克風 → 「允許」（設一次基本不再問）。'+
      '</div></details>'+
      '<div style="margin-top:10px;text-align:right"><button class="big-btn teal mic-tip-ok" style="padding:8px 18px">知道了，不再提示</button></div>';
    panel.insertBefore(div, panel.firstChild);
    div.querySelector('.mic-tip-ok').onclick = ()=>{ markMicTip(); div.remove(); };
  }

  /* ---------- 語音識別（iPad Safari: webkitSpeechRecognition，需開啟 Siri 與聽寫） ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  function recSupported(){ return !!SR; }
  /* 單句模式：開始→說完自動停；cb(transcript or null, errMsg)；lang 預設 en-US */
  function listen(cb, onstate, lang){
    if(!SR){ cb(null,'unsupported'); return null; }
    const r = new SR();
    /* interimResults=true：邊說邊出臨時結果，說完不必再等引擎確認「最終結果」（那步常拖幾秒），
       一拿到 final 立即返回；若引擎先觸發 onend 還沒 final，就用累積的臨時結果立即返回——省掉尾部等待。 */
    r.lang=lang||'en-US'; r.interimResults=true; r.maxAlternatives=3; r.continuous=false;
    let got=false, interim='', silenceT=null, hardT=null;
    function clearT(){ clearTimeout(silenceT); clearTimeout(hardT); }
    /* 統一收尾：只要聽到過任何內容（哪怕只是臨時結果）就用它打分，
       絕不因為引擎沒吐「最終結果」就把用戶說的話丟掉。 */
    function done(){
      if(got) return; got=true; clearT();
      try{ r.stop(); }catch(e){}
      const t=interim.trim();
      if(t) cb(t, null); else cb(null, 'silence');
    }
    /* 自己做靜音偵測：說完約 3 秒沒有新內容就當結束。
       引擎的 onend 在背景有雜音時常常不觸發（會一直以為你還在說），
       只靠它就會撐到硬上限才動 → 用戶感覺「等了好久」，而且內容還被丟掉。 */
    function armSilence(){ clearTimeout(silenceT); silenceT=setTimeout(()=>{ if(interim.trim()) done(); }, 3000); }
    /* 硬上限 18 秒兜底：噪音環境下引擎可能永遠不結束。到點也是「有內容就用，沒有才報 timeout」 */
    hardT = setTimeout(()=>{ if(got) return; got=true; clearT(); try{ r.stop(); r.abort(); }catch(e){}
      const t=interim.trim(); cb(t? t : null, t? null : 'timeout'); }, 18000);
    r.onresult = e=>{
      let fin='', intr='';
      for(let i=0;i<e.results.length;i++){
        const res=e.results[i];
        if(res.isFinal){ let best=''; for(const alt of res){ if(alt.transcript.length>best.length) best=alt.transcript; } fin+=best; }
        else intr+=res[0].transcript;
      }
      if(fin){ interim=fin; got=true; clearT(); cb(fin.trim(), null); return; }  /* 有最終結果立即返回 */
      if(intr){ interim=intr; armSilence(); }  /* 有新語音就重置靜音計時，別在用戶還在說時掐斷 */
    };
    r.onerror = e=>{ if(got) return; got=true; clearT(); cb(null, e.error||'error'); };
    r.onend = ()=>{ if(onstate) onstate('end'); if(got) return;
      got=true; clearT(); const t=interim.trim(); cb(t? t : null, t? null : 'silence'); };  /* 引擎自己結束時也優先用臨時結果 */
    try{ r.start(); if(onstate) onstate('start'); }catch(err){ clearT(); if(!got){ got=true; cb(null,'start-failed'); } }
    return r;
  }

  /* ---------- 逐詞比對（LCS 對齊） ----------
     返回 {accuracy, tokens:[{w,st}]} st: ok|miss|bad（bad=多說/說錯的詞插在對應位置） */
  function norm(s){
    return s.toLowerCase()
      .replace(/[’']/g,"'")
      .replace(/\bcan't\b/g,'cannot').replace(/\bwon't\b/g,'will not')
      .replace(/n't\b/g,' not').replace(/\bcan not\b/g,'cannot')
      .replace(/\bit's\b/g,'it is').replace(/\bi'm\b/g,'i am')
      /* 英式↔美式拼寫歸一（識別引擎輸出美式） */
      .replace(/\btheatre\b/g,'theater').replace(/\bcolour\b/g,'color')
      .replace(/\bfavourite\b/g,'favorite').replace(/\bneighbour\b/g,'neighbor')
      .replace(/\bcentre\b/g,'center').replace(/\btravelled\b/g,'traveled')
      .replace(/[^a-z0-9\s']/g,' ')
      /* 詞首尾的撇號是引號（'I can't hear!' 的單引號對話），剝掉；詞中間的（can't）保留 */
      .split(/\s+/).map(w=>w.replace(/^'+|'+$/g,'')).filter(Boolean);
  }
  function compare(target, spoken){
    const T = norm(target), S = norm(spoken||'');
    const n=T.length, m=S.length;
    const dp = Array.from({length:n+1},()=>new Array(m+1).fill(0));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
      dp[i][j] = T[i]===S[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
    const tokens=[]; let i=0,j=0,match=0;
    /* 按規範化後的 T 渲染（縮寫展開後與原句詞數可能不同，簡化處理） */
    while(i<n && j<m){
      if(T[i]===S[j]){ tokens.push({w:T[i],st:'ok'}); match++; i++; j++; }
      else if(dp[i+1][j] >= dp[i][j+1]){ tokens.push({w:T[i],st:'miss'}); i++; }
      else { tokens.push({w:S[j],st:'bad'}); j++; } /* 多說/說錯的詞標紅，不計分 */
    }
    while(i<n){ tokens.push({w:T[i],st:'miss'}); i++; }
    while(j<m){ tokens.push({w:S[j],st:'bad'}); j++; }
    const accuracy = n ? Math.round(match/n*100) : 0;
    return {accuracy, tokens};
  }

  /* ---------- 日語逐字比對（無空格分詞，按字符 LCS；比對對象為平假名讀音） ----------
     kk2hh：片假名→平假名（碼位平移），去掉空白／標點／長音符差異影響 */
  function kk2hh(s){
    return s.replace(/[ァ-ヶ]/g, c=>String.fromCharCode(c.charCodeAt(0)-0x60));
  }
  function normJP(s){
    return kk2hh(s||'')
      .replace(/[\s　、。！？「」『』・~〜ー]/g,'')
      .normalize('NFKC');
  }
  function compareJP(targetKana, spoken){
    const T = Array.from(normJP(targetKana)), S = Array.from(normJP(spoken));
    const n=T.length, m=S.length;
    const dp = Array.from({length:n+1},()=>new Array(m+1).fill(0));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
      dp[i][j] = T[i]===S[j] ? dp[i+1][j+1]+1 : Math.max(dp[i+1][j], dp[i][j+1]);
    const tokens=[]; let i=0,j=0,match=0;
    while(i<n && j<m){
      if(T[i]===S[j]){ tokens.push({w:T[i],st:'ok'}); match++; i++; j++; }
      else if(dp[i+1][j] >= dp[i][j+1]){ tokens.push({w:T[i],st:'miss'}); i++; }
      else { tokens.push({w:S[j],st:'bad'}); j++; }
    }
    while(i<n){ tokens.push({w:T[i],st:'miss'}); i++; }
    while(j<m){ tokens.push({w:S[j],st:'bad'}); j++; }
    const accuracy = n ? Math.round(match/n*100) : 0;
    return {accuracy, tokens};
  }

  /* ---------- 小工具 ---------- */
  function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
  function fmtDue(ts){
    if(ts===Number.MAX_SAFE_INTEGER) return '已牢固';
    const diff = ts - Date.now();
    if(diff<=0) return '現在';
    if(diff<3600e3) return Math.ceil(diff/60e3)+' 分鐘後';
    if(diff<24*3600e3) return Math.ceil(diff/3600e3)+' 小時後';
    return Math.ceil(diff/(24*3600e3))+' 天後';
  }

  window.JD = { getProgress, markDone, getSecPos, setSecPos, resumeIdx, getBook, addError, reviewPass, reviewFail,
                dueItems, allItems, streak, daysMap, touchDay, speak, pickVoice, listVoices, previewVoice, getVoicePref, setVoicePref,
                listen, recSupported, injectMicTip, compare, compareJP, kk2hh, esc, fmtDue,
                lessonScore, altitude, totalCorrect, mountainState, MOUNTAINS, METERS_PER_CORRECT,
                LEVEL_NAMES, PASS:85 };
})();
