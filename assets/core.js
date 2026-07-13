/* 精讀 jingdu 核心引擎：存儲 / 艾賓浩斯 / TTS / 語音識別 / 逐詞比對 */
(function(){
  'use strict';
  const NS = 'jingdu_';

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
    p[sec] = true; save('prog_'+lessonId, p); return p;
  }

  /* ---------- 錯題本 + 艾賓浩斯 ----------
     item: {id, lessonId, en, zh, level, due, fails, ts}
     level 0..5 → 通過後 due = now + INTERVALS[level]；level 到 6 = 牢固 */
  const INTERVALS = [30*60e3, 24*3600e3, 2*24*3600e3, 4*24*3600e3, 7*24*3600e3, 15*24*3600e3];
  const LEVEL_NAMES = ['新錯題','30分鐘','1天','2天','4天','7天','15天‧牢固'];

  function getBook(){ return load('errbook', {}); }
  function setBook(b){ save('errbook', b); }
  function addError(item){
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
    const b = getBook(); const it = b[id]; if(!it) return;
    it.level += 1;
    if(it.level >= 6){ it.due = Number.MAX_SAFE_INTEGER; it.solid = true; }
    else{ it.due = Date.now()+INTERVALS[it.level]; }
    setBook(b);
  }
  function reviewFail(id){
    const b = getBook(); const it = b[id]; if(!it) return;
    it.level = 0; it.due = Date.now()+INTERVALS[0]; it.fails += 1; delete it.solid;
    setBook(b);
  }
  function dueItems(){
    const now = Date.now();
    return Object.values(getBook()).filter(it=>!it.solid && it.due<=now).sort((a,b)=>a.due-b.due);
  }
  function allItems(){ return Object.values(getBook()).sort((a,b)=>a.due-b.due); }

  /* ---------- TTS（lang 預設 en-US，日語頁傳 'ja-JP'） ---------- */
  const voiceCache = {};
  function pickVoice(lang){
    if(voiceCache[lang]) return voiceCache[lang];
    const prefix = lang.split('-')[0];
    const vs = speechSynthesis.getVoices().filter(v=>new RegExp('^'+prefix+'(-|_)','i').test(v.lang));
    const v = vs.find(v=>/Samantha|Ava|Allison|Kyoko|O-ren/i.test(v.name)) || vs[0] || null;
    voiceCache[lang]=v; return v;
  }
  if('speechSynthesis' in window){ speechSynthesis.onvoiceschanged = ()=>{ for(const k in voiceCache) delete voiceCache[k]; }; }
  function speak(text, slow, lang){
    if(!('speechSynthesis' in window)) return;
    lang = lang || 'en-US';
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang=lang; u.rate = slow?0.55:0.9;
    const v = pickVoice(lang); if(v) u.voice=v;
    speechSynthesis.speak(u);
  }

  /* ---------- 語音識別（iPad Safari: webkitSpeechRecognition，需開啟 Siri 與聽寫） ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  function recSupported(){ return !!SR; }
  /* 單句模式：開始→說完自動停；cb(transcript or null, errMsg)；lang 預設 en-US */
  function listen(cb, onstate, lang){
    if(!SR){ cb(null,'unsupported'); return null; }
    const r = new SR();
    r.lang=lang||'en-US'; r.interimResults=false; r.maxAlternatives=3; r.continuous=false;
    let got=false;
    /* 安全超時：12 秒沒有任何結果就強制結束，避免卡在「正在聽」 */
    const guard = setTimeout(()=>{ if(!got){ try{ r.stop(); r.abort(); }catch(e){} if(!got){ got=true; cb(null,'timeout'); } } }, 12000);
    r.onresult = e=>{
      got=true; clearTimeout(guard);
      let best='';
      for(const alt of e.results[0]){ if(alt.transcript.length>best.length) best=alt.transcript; }
      cb(best.trim(), null);
    };
    r.onerror = e=>{ clearTimeout(guard); if(!got){ got=true; cb(null, e.error||'error'); } };
    r.onend = ()=>{ clearTimeout(guard); if(onstate) onstate('end'); if(!got){ got=true; cb(null,'silence'); } };
    try{ r.start(); if(onstate) onstate('start'); }catch(err){ clearTimeout(guard); if(!got){ got=true; cb(null,'start-failed'); } }
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

  window.JD = { getProgress, markDone, getBook, addError, reviewPass, reviewFail,
                dueItems, allItems, speak, pickVoice, listen, recSupported, compare, compareJP, kk2hh, esc, fmtDue,
                LEVEL_NAMES, PASS:85 };
})();
