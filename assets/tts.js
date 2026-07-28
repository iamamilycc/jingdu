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

  /* 聽全文句間停頓(ms)。兩種模式：
     - auto(預設)：每課依內容自動判斷(對話短/敘事長)，由 lesson.js 載課時 setAutoGap() 告知
     - manual：用戶在聲音頁拖滑桿或點預設鍵→固定一個值，永久蓋過自動
     一旦手動設值就切 manual；點「自動」鍵可切回。 */
  var _autoGap = 260;   /* 當前課的自動建議值；非課文頁時為預設 260 */
  function gapMode(){ return ls(NS+'lt_gap_mode')==='manual' ? 'manual' : 'auto'; }
  function setGapAuto(){ lset(NS+'lt_gap_mode','auto'); }
  function setAutoGap(v){ v=parseInt(v,10); if(v>=0&&v<=800) _autoGap=v; }
  function autoGap(){ return _autoGap; }
  function ltGap(){
    if(gapMode()==='manual'){ const v=parseInt(ls(NS+'lt_gap'),10); return (v>=0&&v<=800)?v:260; }
    return _autoGap;
  }
  function setLtGap(v){ lset(NS+'lt_gap', String(v)); lset(NS+'lt_gap_mode','manual'); }  /* 手動設值即切 manual */

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
  /* 首次觸控解鎖音訊；⚠️正在播放時直接視為已解鎖、絕不插靜音打斷（否則用戶滑動頁面會中斷朗讀） */
  function unlock(){ if(_unlocked) return; const a=el();
    if(a.src && a.src.indexOf('data:audio/wav')!==0 && !a.paused){ _unlocked=true; return; }
    try{ a.src=SILENT; const p=a.play(); if(p&&p.then) p.then(()=>{ try{a.pause();}catch(e){} _unlocked=true; }).catch(()=>{ _unlocked=true; }); else _unlocked=true; }catch(e){} }
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
      /* 多句用 \x01 分隔：去句末標點、句間插短 break（縮短停頓、更連貫）；單句照舊 */
      let core;
      if(text.indexOf('\x01')>=0){
        core = text.split('\x01').map(s=>ssmlEsc(s.replace(/[.!?。！？…、,，]+\s*$/,''))).join('<break time="'+ltGap()+'ms"/>');
      } else { core = ssmlEsc(text); }
      const inner = slow ? '<prosody rate="-15%">'+core+'</prosody>' : core;
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
    const plain = text.replace(/\x01/g,' ');  /* 非 azure 供應商拿純文字（把句間分隔符還原成空格） */
    if(prov==='google'){
      const key=googleKey(); if(!key) throw new Error('沒有 Google key');
      const voice=getGVoice(prefix), lc=voice.split('-').slice(0,2).join('-');
      const resp=await fetch(GOOGLE_EP+'?key='+encodeURIComponent(key),{ method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({input:{text:plain}, voice:{languageCode:lc, name:voice}, audioConfig:{audioEncoding:'MP3', speakingRate:slow?0.7:0.95}}) });
      if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('Google TTS '+resp.status+' '+t.slice(0,160)); }
      const j=await resp.json(); if(!j.audioContent) throw new Error('Google 沒返回音檔');
      return b64ToBlob(j.audioContent, 'audio/mp3');
    }
    /* zhipu */
    const key=zhipuKey(); if(!key) throw new Error('還沒設定智譜 key（在「加課」頁設一次）');
    const resp=await fetch(ZHIPU_EP,{ method:'POST',
      headers:{'Authorization':'Bearer '+key, 'Content-Type':'application/json'},
      body:JSON.stringify({model:'glm-tts', input:plain, voice:getZVoice(), response_format:'wav', speed: slow?0.8:1.0}) });
    if(!resp.ok){ const t=await resp.text().catch(()=>''); throw new Error('智譜 TTS '+resp.status+' '+t.slice(0,160)); }
    const blob=await resp.blob();
    if(!blob || blob.size<200) throw new Error('智譜返回的音檔為空');
    return blob;
  }

  /* iOS 16.4+：宣告這是「純播放」→ 強制走喇叭外放，不會因為之前用過麥克風被卡在聽筒小聲 */
  function toPlaybackRoute(){ try{ if(navigator.audioSession) navigator.audioSession.type='playback'; }catch(e){} }

  async function playBlob(blob){
    const a=el(); stop(); toPlaybackRoute();
    try{ if(_url){ URL.revokeObjectURL(_url); _url=null; } }catch(e){}
    _url=URL.createObjectURL(blob); a.src=_url;
    await a.play();
    _unlocked=true;   /* 真播過音檔＝已解鎖，之後 unlock() 直接短路、永不再插靜音打斷 */
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
    const ck=getProvider()+'|'+voiceKeyFor(prefix)+'|'+(slow?'s':'n')+'|'+(text.indexOf('')>=0?'g'+ltGap():'')+'|'+text;
    try{
      let blob=await cacheGet(ck);
      if(!blob){ blob=await synthBlob(text, prefix, slow); cachePut(ck, blob); }
      await playBlob(blob);
      return true;
    }catch(e){ return false; }
  }

  /* 連續朗讀用：播放並在「這句放完(ended)」才 resolve；成功回 true、失敗回 false。
     供「聽全文」逐句串播（走快取、用同一個已解鎖的 Audio 元素）。可被 stop() 中斷。 */
  async function playUntilEnd(text, prefix, slow, onProgress){
    if(!enabled()) return false;
    text=(text||'').trim(); if(!text) return false;
    prefix=(prefix==='ja')?'ja':'en';
    const ck=getProvider()+'|'+voiceKeyFor(prefix)+'|'+(slow?'s':'n')+'|'+(text.indexOf('')>=0?'g'+ltGap():'')+'|'+text;
    try{
      let blob=await cacheGet(ck);
      if(!blob){ blob=await synthBlob(text, prefix, slow); cachePut(ck, blob); }
      const a=el(); stop(); toPlaybackRoute();
      try{ if(_url){ URL.revokeObjectURL(_url); _url=null; } }catch(e){}
      _url=URL.createObjectURL(blob); a.src=_url;
      await new Promise((res,rej)=>{
        const clean=()=>{ a.onended=null; a.onerror=null; a.ontimeupdate=null; };
        if(onProgress) a.ontimeupdate=()=>{ try{ onProgress(a.currentTime, a.duration||0); }catch(e){} };
        a.onended=()=>{ clean(); res(); };
        a.onerror=()=>{ clean(); rej(new Error('audio error')); };
        const p=a.play(); _unlocked=true; if(p&&p.catch) p.catch(e=>{ clean(); rej(e); });
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
                 play, playUntilEnd, stop, test, synthBlob, ltGap, setLtGap,
                 gapMode, setGapAuto, setAutoGap, autoGap,
                 ZHIPU_VOICES, GOOGLE_VOICES, AZURE_VOICES };
})();

/* ========== JDPron：Azure 發音評估（四維打分：準確度/流利度/完整度/語調） ==========
   純前端 REST，複用 TTS 那把 Azure key+region（jingdu_az_key / jingdu_az_region）。
   流程：錄一小段音（WAV 16k mono 16-bit）→ POST 到 Azure 語音轉文字端點 + Pronunciation-Assessment
        標頭 → 回四維分數。opt-in（預設關）；沒開/沒 key/失敗 → 呼叫端自動退回原本 Web Speech 單分比對。
   計費：走「語音轉文字」，F0 免費層每月 5 小時（家用估 1 小時出頭用不完，每月刷新）。首次真跑須對帳。
   ⚠️ 參考文字由呼叫端傳「乾淨自然文」（英文=句子；日語=去振假名的漢字文 R.toPlain），JDPron 不碰 ruby。 */
(function(){
  'use strict';
  const NS='jingdu_';
  function ls(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lset(k,v){ try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} }
  function azKey(){ return (ls(NS+'az_key')||'').trim(); }
  function azRegion(){ return (ls(NS+'az_region')||'').trim().toLowerCase(); }
  function configured(){ return !!azKey() && !!azRegion(); }
  function isOn(){ return ls(NS+'pron_on')==='1'; }
  function setOn(v){ lset(NS+'pron_on', v?'1':'0'); try{ if(window.JD && JD.touchSync) JD.touchSync(); }catch(e){} }
  function enabled(){ return configured() && isOn(); }
  function supported(){ return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext||window.webkitAudioContext)); }

  /* Float32 PCM（任意採樣率）→ 16k mono 平均降採樣 */
  function downsample(buf, inRate, outRate){
    if(!buf.length || outRate>=inRate) return buf;
    const ratio=inRate/outRate, outLen=Math.round(buf.length/ratio), out=new Float32Array(outLen);
    let oi=0, ii=0;
    while(oi<outLen){ const next=Math.round((oi+1)*ratio); let s=0,c=0; for(let i=ii;i<next&&i<buf.length;i++){ s+=buf[i]; c++; } out[oi]=c?s/c:0; oi++; ii=next; }
    return out;
  }
  /* Float32 → 16-bit PCM WAV Blob */
  function encodeWav(f32, rate){
    const len=f32.length, ab=new ArrayBuffer(44+len*2), v=new DataView(ab);
    const wr=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i, s.charCodeAt(i)); };
    wr(0,'RIFF'); v.setUint32(4,36+len*2,true); wr(8,'WAVE'); wr(12,'fmt '); v.setUint32(16,16,true);
    v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,rate,true); v.setUint32(28,rate*2,true);
    v.setUint16(32,2,true); v.setUint16(34,16,true); wr(36,'data'); v.setUint32(40,len*2,true);
    let o=44; for(let i=0;i<len;i++){ let x=Math.max(-1,Math.min(1,f32[i])); v.setInt16(o, x<0?x*0x8000:x*0x7FFF, true); o+=2; }
    return new Blob([ab], {type:'audio/wav'});
  }
  /* UTF-8 安全 base64（參考文字含日文，btoa 不能直接吃）*/
  function b64utf8(str){ return btoa(unescape(encodeURIComponent(String(str)))); }

  /* 把錄好的 WAV 送 Azure 評分。回 {accuracy,fluency,completeness,prosody,pron,text}（分數 0-100）。 */
  async function assessBlob(wavBlob, referenceText, lang){
    const region=azRegion(), key=azKey();
    if(!region||!key) throw new Error('no-key');
    const locale = (lang && String(lang).indexOf('ja')===0) || lang==='jp' ? 'ja-JP' : 'en-US';
    const cfg = { ReferenceText:String(referenceText||''), GradingSystem:'HundredMark', Granularity:'FullText', Dimension:'Comprehensive', EnableProsodyAssessment:true };
    const ep='https://'+region+'.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language='+locale;
    const resp=await fetch(ep, { method:'POST', headers:{
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      'Pronunciation-Assessment': b64utf8(JSON.stringify(cfg)),
      'Accept': 'application/json'
    }, body: wavBlob });
    if(!resp.ok) throw new Error('azure-'+resp.status);
    const j = await resp.json();
    const nb = j && j.NBest && j.NBest[0];
    const pa = nb && nb.PronunciationAssessment;
    if(!pa) throw new Error('no-speech');   /* RecognitionStatus 非 Success / 沒說話 */
    const R0 = x => Math.max(0, Math.min(100, Math.round(x||0)));
    return {
      accuracy: R0(pa.AccuracyScore), fluency: R0(pa.FluencyScore),
      completeness: R0(pa.CompletenessScore), prosody: R0(pa.ProsodyScore),
      pron: R0(pa.PronScore!=null?pa.PronScore:pa.PronunciationScore),
      text: (j.DisplayText || nb.Display || nb.Lexical || '')
    };
  }

  /* 開始錄音。回 { stop:()=>Promise<scores>, cancel:()=>void }。呼叫端在「我說完了」時 await stop()。 */
  async function start(referenceText, lang){
    if(!supported()) throw new Error('no-capture');
    try{ if(navigator.audioSession) navigator.audioSession.type='play-and-record'; }catch(e){}  /* iOS：開麥克風路由 */
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const AC = window.AudioContext||window.webkitAudioContext; const ctx = new AC();
    try{ await ctx.resume(); }catch(e){}
    const srcNode = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096,1,1);
    const mute = ctx.createGain(); mute.gain.value=0;   /* 靜音出口，避免把麥克風回放到喇叭 */
    const chunks=[]; let stopped=false;
    proc.onaudioprocess = e=>{ if(!stopped) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    srcNode.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    const inRate = ctx.sampleRate;
    const cleanup=()=>{ stopped=true; try{proc.disconnect();}catch(e){} try{srcNode.disconnect();}catch(e){} try{stream.getTracks().forEach(t=>t.stop());}catch(e){} try{ctx.close();}catch(e){} };
    async function stop(){
      cleanup();
      let total=0; chunks.forEach(c=>total+=c.length);
      const merged=new Float32Array(total); let off=0; chunks.forEach(c=>{ merged.set(c,off); off+=c.length; });
      const wav = encodeWav(downsample(merged, inRate, 16000), 16000);
      return assessBlob(wav, referenceText, lang);
    }
    return { stop, cancel: cleanup };
  }

  window.JDPron = { configured, enabled, on:isOn, setOn, supported, start, assessBlob, _wav:encodeWav };
})();
