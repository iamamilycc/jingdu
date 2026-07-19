/* 精讀 jingdu — 雲端神經語音（Google Cloud Text-to-Speech）
   目的：系統合成聲不夠像真人；接 Google 神經語音（Neural2 / Chirp3 HD，母語發音、語調自然）。
   設計：
   - BYOK：key 存本機 localStorage，直連 texttospeech.googleapis.com（附 ?key=），不經任何中轉。
   - 快取：每句音檔存 IndexedDB，同句重播不再呼叫 API（省錢、離線、秒播）。
   - 安全退回：任何失敗（沒 key / 網路 / CORS / iOS 擋播 / 語音名錯）一律回 false，
     呼叫端（core.js speak）據此退回系統合成聲——最壞情況＝跟現在一樣，絕不會沒聲音。
   - iOS 音訊解鎖：HTMLAudio 在 iOS 需用戶手勢後才能播；首次觸控用靜音 WAV 解鎖同一個複用元素。 */
(function(){
  'use strict';
  const NS='jingdu_';
  const EP='https://texttospeech.googleapis.com/v1/text:synthesize';

  /* 可選語音（Neural2＝穩定必可用；Chirp3 HD＝最自然最新）。預設用 Neural2 保證第一次就有聲。 */
  const VOICES = {
    en:[
      {name:'en-US-Neural2-F',       label:'美式女聲 · 自然（推薦）'},
      {name:'en-US-Neural2-J',       label:'美式男聲 · 自然'},
      {name:'en-US-Chirp3-HD-Aoede', label:'美式女聲 · 最自然（Chirp3 HD）'},
      {name:'en-US-Chirp3-HD-Charon',label:'美式男聲 · 最自然（Chirp3 HD）'},
      {name:'en-GB-Neural2-A',       label:'英式女聲 · 自然'}
    ],
    ja:[
      {name:'ja-JP-Neural2-B',       label:'女聲 · 自然（推薦）'},
      {name:'ja-JP-Neural2-C',       label:'男聲 · 自然'},
      {name:'ja-JP-Chirp3-HD-Aoede', label:'女聲 · 最自然（Chirp3 HD）'}
    ]
  };
  const DEFAULT_VOICE = { en:'en-US-Neural2-F', ja:'ja-JP-Neural2-B' };

  function getKey(){ try{ return localStorage.getItem(NS+'gtts_key')||''; }catch(e){ return ''; } }
  function setKey(k){ try{ if(k) localStorage.setItem(NS+'gtts_key', k.trim()); else localStorage.removeItem(NS+'gtts_key'); }catch(e){} }
  function enabled(){ try{ return localStorage.getItem(NS+'gtts_on')==='1' && !!getKey(); }catch(e){ return false; } }
  function setEnabled(on){ try{ localStorage.setItem(NS+'gtts_on', on?'1':'0'); }catch(e){} }
  function getVoice(prefix){ try{ return localStorage.getItem(NS+'gtts_voice_'+prefix)||DEFAULT_VOICE[prefix]||''; }catch(e){ return DEFAULT_VOICE[prefix]||''; } }
  function setVoice(prefix, name){ try{ if(name) localStorage.setItem(NS+'gtts_voice_'+prefix, name); }catch(e){} }

  /* ---------- IndexedDB 音檔快取 ---------- */
  let _db=null;
  function db(){
    return new Promise((res)=>{
      if(_db) return res(_db);
      try{
        const r=indexedDB.open(NS+'tts',1);
        r.onupgradeneeded=()=>{ try{ r.result.createObjectStore('a'); }catch(e){} };
        r.onsuccess=()=>{ _db=r.result; res(_db); };
        r.onerror=()=>res(null);
      }catch(e){ res(null); }
    });
  }
  function cacheGet(k){
    return new Promise((res)=>{ db().then(d=>{ if(!d) return res(null);
      try{ const t=d.transaction('a').objectStore('a').get(k); t.onsuccess=()=>res(t.result||null); t.onerror=()=>res(null); }
      catch(e){ res(null); } }); });
  }
  function cachePut(k,v){ db().then(d=>{ if(!d) return; try{ d.transaction('a','readwrite').objectStore('a').put(v,k); }catch(e){} }); }

  /* ---------- iOS 音訊解鎖 + 複用單一 Audio 元素 ---------- */
  const SILENT='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  let _audio=null, _unlocked=false;
  function el(){ if(!_audio){ _audio=new Audio(); _audio.preload='auto'; } return _audio; }
  function unlock(){
    if(_unlocked) return;
    const a=el();
    try{ a.src=SILENT; const p=a.play(); if(p&&p.then) p.then(()=>{ try{a.pause();}catch(e){} _unlocked=true; }).catch(()=>{}); else _unlocked=true; }catch(e){}
  }
  try{ document.addEventListener('touchend', unlock, {passive:true}); document.addEventListener('click', unlock, {passive:true}); }catch(e){}

  function stop(){ try{ if(_audio){ _audio.pause(); } }catch(e){} }

  /* ---------- 合成（回 base64 mp3，失敗 throw） ---------- */
  async function synth(text, prefix, slow){
    const key=getKey(); if(!key) throw new Error('沒有雲端語音 key');
    const voice=getVoice(prefix);
    const lc=voice.split('-').slice(0,2).join('-');   /* en-US / ja-JP / en-GB */
    const body={ input:{text:text}, voice:{languageCode:lc, name:voice},
                 audioConfig:{ audioEncoding:'MP3', speakingRate: slow?0.7:0.95 } };
    const resp=await fetch(EP+'?key='+encodeURIComponent(key), {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('Google TTS '+resp.status+' '+t.slice(0,160)); }
    const j=await resp.json();
    if(!j.audioContent) throw new Error('沒有返回音檔');
    return j.audioContent;
  }

  /* ---------- 主入口：播放 text；成功回 true，失敗回 false（呼叫端退回系統聲） ---------- */
  async function play(text, prefix, slow){
    if(!enabled()) return false;
    text=(text||'').trim(); if(!text) return false;
    prefix=(prefix==='ja')?'ja':'en';
    const voice=getVoice(prefix);
    const ck=voice+'|'+(slow?'s':'n')+'|'+text;
    try{
      let b64=await cacheGet(ck);
      if(!b64){ b64=await synth(text, prefix, slow); cachePut(ck, b64); }
      const a=el(); stop();
      a.src='data:audio/mp3;base64,'+b64;
      await a.play();      /* resolve＝開始播放；由按鈕手勢觸發＋已解鎖，iOS 可播 */
      return true;
    }catch(e){ return false; }
  }

  /* 試聽 / 測 key：合成一句短樣本；回 {ok, err} */
  async function test(prefix){
    prefix=(prefix==='ja')?'ja':'en';
    const s = prefix==='ja' ? 'こんにちは、いっしょに にほんごを べんきょうしましょう。'
                            : 'Hello! Let us read this sentence together.';
    try{
      const key=getKey(); if(!key) return {ok:false, err:'還沒填 key'};
      const b64=await synth(s, prefix, false);           /* 直接合成，不吃 enabled 開關，供設定頁試聽 */
      const a=el(); stop(); a.src='data:audio/mp3;base64,'+b64;
      try{ await a.play(); }catch(e){}
      return {ok:true};
    }catch(e){ return {ok:false, err:e.message||String(e)}; }
  }

  window.JDTTS={ getKey, setKey, enabled, setEnabled, getVoice, setVoice, play, stop, test, synth, VOICES, DEFAULT_VOICE };
})();
