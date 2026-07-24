/* 精讀 jingdu — 雲端神經語音（可切換供應商）
   目的：系統合成聲不夠像真人。優先用雲端神經 TTS（語調自然）。
   供應商：
   - 'azure'：微軟 Azure 神經語音（母語又自然，最佳）。個人國際號 East Asia 區在國內實測不翻牆可用、iOS 能播。
     兩步：issueToken（Ocp-Apim-Subscription-Key）→ 合成（Bearer token + SSML）。token 快取 9 分鐘。回 mp3。
   - 'zhipu'（國內免申請）：智譜 GLM-TTS，復用「做課那把智譜 key」。⚠英文偏中式腔。回 wav。
   - 'google'：Google Cloud TTS（母語自然，但國內要翻牆+外幣卡）。回 base64 mp3。
   共通：
   - 快取：每句音檔（Blob）存 IndexedDB，同句重播不再呼叫 API（省錢、離線、秒播）。
   - 安全退回：任何失敗一律回 false，core.js speak() 據此退回系統合成聲——絕不會沒聲音。
   - iOS 音訊解鎖：HTMLAudio 在 iOS 需用戶手勢後才能播；首次觸控用靜音 WAV 解鎖同一個複用元素。 */
(function(){
  'use strict';
  const NS='jingdu_';
  const ZHIPU_EP='https://open.bigmodel.cn/api/paas/v4/audio/speech';
  const GOOGLE_EP='https://texttospeech.googleapis.com/v1/text:synthesize';
  const azTokenEP=(r)=>'https://'+r+'.api.cognitive.microsoft.com/sts/v1.0/issueToken';
  const azTtsEP=(r)=>'https://'+r+'.tts.speech.microsoft.com/cognitiveservices/v1';

  /* Azure 母語神經語音（發音準又自然） */
  const AZURE_VOICES={
    en:[
      {name:'en-US-AriaNeural',  label:'美式女聲 Aria（自然·推薦）'},
      {name:'en-US-JennyNeural', label:'美式女聲 Jenny（溫暖）'},
      {name:'en-US-GuyNeural',   label:'美式男聲 Guy'},
      {name:'en-GB-SoniaNeural', label:'英式女聲 Sonia'}
    ],
    ja:[
      {name:'ja-JP-NanamiNeural', label:'女聲 Nanami（自然·推薦）'},
      {name:'ja-JP-KeitaNeural',  label:'男聲 Keita'}
    ]
  };
  const AZURE_DEFAULT={ en:'en-US-AriaNeural', ja:'ja-JP-NanamiNeural' };
  /* 智譜系統音色（語言無關）；Google 分語言選。 */
  const ZHIPU_VOICES=[
    {name:'tongtong', label:'彤彤（女聲·預設）'},
    {name:'xiaochen', label:'小陳（男聲）'},
    {name:'chuichui', label:'錘錘'},
    {name:'jam',label:'Jam'},{name:'kazi',label:'Kazi'},{name:'douji',label:'Douji'},{name:'luodo',label:'Luodo'}
  ];
  const GOOGLE_VOICES={
    en:[{name:'en-US-Neural2-F',label:'美式女聲·自然（推薦）'},{name:'en-US-Neural2-J',label:'美式男聲·自然'},
        {name:'en-US-Chirp3-HD-Aoede',label:'美式女聲·最自然（Chirp3 HD）'},{name:'en-GB-Neural2-A',label:'英式女聲·自然'}],
    ja:[{name:'ja-JP-Neural2-B',label:'女聲·自然（推薦）'},{name:'ja-JP-Neural2-C',label:'男聲·自然'},
        {name:'ja-JP-Chirp3-HD-Aoede',label:'女聲·最自然（Chirp3 HD）'}]
  };
  const GOOGLE_DEFAULT={ en:'en-US-Neural2-F', ja:'ja-JP-Neural2-B' };

  function ls(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lset(k,v){ try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} }

  function getProvider(){ const p=ls(NS+'gtts_provider'); return (p==='google'||p==='azure')?p:'zhipu'; }
  function setProvider(p){ lset(NS+'gtts_provider', (p==='google'||p==='azure')?p:'zhipu'); }
  function enabled(){
    if(ls(NS+'gtts_on')!=='1') return false;
    const p=getProvider();
    if(p==='azure') return !!azureKey() && !!azureRegion();
    return !!providerKey();
  }
  function setEnabled(on){ lset(NS+'gtts_on', on?'1':'0'); }

  /* 各家 key */
  function zhipuKey(){ return ls(NS+'zhipu_key')||''; }
  function googleKey(){ return ls(NS+'gtts_key')||''; }
  function setGoogleKey(k){ lset(NS+'gtts_key', k?k.trim():null); }
  function azureKey(){ return ls(NS+'az_key')||''; }
  function setAzureKey(k){ lset(NS+'az_key', k?k.trim():null); }
  function azureRegion(){ return ls(NS+'az_region')||''; }
  function setAzureRegion(r){ lset(NS+'az_region', r?r.trim().toLowerCase():null); }
  function providerKey(){ const p=getProvider(); return p==='google'?googleKey():p==='azure'?azureKey():zhipuKey(); }

  function getZVoice(){ return ls(NS+'gtts_zvoice')||'tongtong'; }
  function setZVoice(v){ lset(NS+'gtts_zvoice', v); }
  function getGVoice(prefix){ return ls(NS+'gtts_voice_'+prefix)||GOOGLE_DEFAULT[prefix]||''; }
  function setGVoice(prefix,v){ lset(NS+'gtts_voice_'+prefix, v); }
  function getAzVoice(prefix){ return ls(NS+'az_voice_'+prefix)||AZURE_DEFAULT[prefix]||''; }
  function setAzVoice(prefix,v){ lset(NS+'az_voice_'+prefix, v); }

  /* ---------- IndexedDB 音檔快取（存 Blob） ---------- */
  let _db=null;
  function db(){ return new Promise((res)=>{ if(_db) return res(_db);
    try{ const r=indexedDB.open(NS+'tts',1);
      r.onupgradeneeded=()=>{ try{ r.result.createObjectStore('a'); }catch(e){} };
      r.onsuccess=()=>{ _db=r.result; res(_db); }; r.onerror=()=>res(null);
    }catch(e){ res(null); } }); }
  function cacheGet(k){ return new Promise((res)=>{ db().then(d=>{ if(!d) return res(null);
    try{ const t=d.transaction('a').objectStore('a').get(k); t.onsuccess=()=>res(t.result||null); t.onerror=()=>res(null); }
    catch(e){ res(null); } }); }); }
  function cachePut(k,v){ db().then(d=>{ if(!d) return; try{ d.transaction('a','readwrite').objectStore('a').put(v,k); }catch(e){} }); }

  /* ---------- iOS 音訊解鎖 + 複用單一 Audio 元素 ---------- */
  const SILENT='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  let _audio=null, _unlocked=false, _url=null;
  function el(){ if(!_audio){ _audio=new Audio(); _audio.preload='auto'; } return _audio; }
  function unlock(){ if(_unlocked) return; const a=el();
    try{ a.src=SILENT; const p=a.play(); if(p&&p.then) p.then(()=>{ try{a.pause();}catch(e){} _unlocked=true; }).catch(()=>{}); else _unlocked=true; }catch(e){} }
  try{ document.addEventListener('touchend', unlock, {passive:true}); document.addEventListener('click', unlock, {passive:true}); }catch(e){}
  function stop(){ try{ if(_audio) _audio.pause(); }catch(e){} }

  function b64ToBlob(b64, mime){
    const bin=atob(b64); const len=bin.length; const u8=new Uint8Array(len);
    for(let i=0;i<len;i++) u8[i]=bin.charCodeAt(i);
    return new Blob([u8], {type:mime});
  }
  function ssmlEsc(s){ return String(s).replace(/[<&>"]/g,c=>({'<':'&lt;','&':'&amp;','>':'&gt;','"':'&quot;'}[c])); }

  /* Azure token 快取（有效 ~10 分鐘，這裡存 9 分鐘） */
  let _azTok=null, _azTokT=0, _azTokR=null;
  async function azureToken(){
    const region=azureRegion(), key=azureKey();
    if(!region||!key) throw new Error('沒有 Azure key 或區域');
    if(_azTok && _azTokR===region && (Date.now()-_azTokT)<9*60000) return _azTok;
    const r=await fetch(azTokenEP(region),{ method:'POST', headers:{'Ocp-Apim-Subscription-Key':key} });
    if(!r.ok) throw new Error('Azure token '+r.status+(r.status===401?'（密鑰或區域不對）':''));
    _azTok=await r.text(); _azTokT=Date.now(); _azTokR=region; return _azTok;
  }

  /* ---------- 合成（回 audio Blob，失敗 throw） ---------- */
  async function synthBlob(text, prefix, slow){
    const prov=getProvider();
    if(prov==='azure'){
      const region=azureRegion(); if(!region||!azureKey()) throw new Error('沒有 Azure key/區域');
      const voice=getAzVoice(prefix), lang=voice.split('-').slice(0,2).join('-');
      const inner = slow ? '<prosody rate="-15%">'+ssmlEsc(text)+'</prosody>' : ssmlEsc(text);
      const ssml='<speak version="1.0" xml:lang="'+lang+'"><voice name="'+voice+'">'+inner+'</voice></speak>';
      const doSynth=(tok)=>fetch(azTtsEP(region),{ method:'POST',
        headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'audio-24khz-48kbitrate-mono-mp3'},
        body:ssml });
      let resp=await doSynth(await azureToken());
      if(resp.status===401){ _azTok=null; resp=await doSynth(await azureToken()); }  /* token 過期→刷新重試一次 */
      if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('Azure TTS '+resp.status+' '+t.slice(0,120)); }
      const blob=await resp.blob(); if(!blob||blob.size<200) throw new Error('Azure 返回音檔為空');
      return blob;
    }
    if(prov==='google'){
      const key=googleKey(); if(!key) throw new Error('沒有 Google key');
      const voice=getGVoice(prefix), lc=voice.split('-').slice(0,2).join('-');
      const resp=await fetch(GOOGLE_EP+'?key='+encodeURIComponent(key),{ method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({input:{text:text}, voice:{languageCode:lc, name:voice}, audioConfig:{audioEncoding:'MP3', speakingRate:slow?0.7:0.95}}) });
      if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('Google TTS '+resp.status+' '+t.slice(0,160)); }
      const j=await resp.json(); if(!j.audioContent) throw new Error('Google 沒返回音檔');
      return b64ToBlob(j.audioContent, 'audio/mp3');
    }
    /* zhipu */
    const key=zhipuKey(); if(!key) throw new Error('還沒設定智譜 key（在「加課」頁設一次）');
    const resp=await fetch(ZHIPU_EP,{ method:'POST',
      headers:{'Authorization':'Bearer '+key, 'Content-Type':'application/json'},
      body:JSON.stringify({model:'glm-tts', input:text, voice:getZVoice(), response_format:'wav', speed: slow?0.8:1.0}) });
    if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('智譜 TTS '+resp.status+' '+t.slice(0,160)); }
    const blob=await resp.blob();
    if(!blob || blob.size<200) throw new Error('智譜返回的音檔為空');
    return blob;
  }

  async function playBlob(blob){
    const a=el(); stop();
    try{ if(_url){ URL.revokeObjectURL(_url); _url=null; } }catch(e){}
    _url=URL.createObjectURL(blob); a.src=_url;
    await a.play();
  }

  function voiceKeyFor(prefix){
    const p=getProvider();
    return p==='google'?getGVoice(prefix) : p==='azure'?getAzVoice(prefix) : ('z:'+getZVoice());
  }

  /* 主入口：成功回 true，失敗回 false（呼叫端退回系統聲） */
  async function play(text, prefix, slow){
    if(!enabled()) return false;
    text=(text||'').trim(); if(!text) return false;
    prefix=(prefix==='ja')?'ja':'en';
    const ck=getProvider()+'|'+voiceKeyFor(prefix)+'|'+(slow?'s':'n')+'|'+text;
    try{
      let blob=await cacheGet(ck);
      if(!blob){ blob=await synthBlob(text, prefix, slow); cachePut(ck, blob); }
      await playBlob(blob);
      return true;
    }catch(e){ return false; }
  }

  /* 連續朗讀用：播放並在「這句放完(ended)」才 resolve；成功回 true、失敗回 false。
     供「聽全文」逐句串播（走快取、用同一個已解鎖的 Audio 元素）。可被 stop() 中斷。 */
  async function playUntilEnd(text, prefix, slow){
    if(!enabled()) return false;
    text=(text||'').trim(); if(!text) return false;
    prefix=(prefix==='ja')?'ja':'en';
    const ck=getProvider()+'|'+voiceKeyFor(prefix)+'|'+(slow?'s':'n')+'|'+text;
    try{
      let blob=await cacheGet(ck);
      if(!blob){ blob=await synthBlob(text, prefix, slow); cachePut(ck, blob); }
      const a=el(); stop();
      try{ if(_url){ URL.revokeObjectURL(_url); _url=null; } }catch(e){}
      _url=URL.createObjectURL(blob); a.src=_url;
      await new Promise((res,rej)=>{
        const clean=()=>{ a.onended=null; a.onerror=null; };
        a.onended=()=>{ clean(); res(); };
        a.onerror=()=>{ clean(); rej(new Error('audio error')); };
        const p=a.play(); if(p&&p.catch) p.catch(e=>{ clean(); rej(e); });
      });
      return true;
    }catch(e){ return false; }
  }

  /* 試聽 / 測 key：不吃 enabled 開關，供設定頁按語言試聽發音 */
  async function test(prefix){
    prefix=(prefix==='ja')?'ja':'en';
    const s = prefix==='ja' ? 'こんにちは、いっしょに にほんごを べんきょうしましょう。'
                            : 'Hello! Let us read this sentence together.';
    try{ const blob=await synthBlob(s, prefix, false); try{ await playBlob(blob); }catch(e){} return {ok:true}; }
    catch(e){ return {ok:false, err:e.message||String(e)}; }
  }

  window.JDTTS={ getProvider,setProvider, enabled,setEnabled, providerKey,
                 zhipuKey, googleKey,setGoogleKey, azureKey,setAzureKey, azureRegion,setAzureRegion,
                 getZVoice,setZVoice, getGVoice,setGVoice, getAzVoice,setAzVoice,
                 play, playUntilEnd, stop, test, synthBlob,
                 ZHIPU_VOICES, GOOGLE_VOICES, AZURE_VOICES };
})();
