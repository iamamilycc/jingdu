/* 精讀 jingdu — 日語課文頁渲染引擎（讀全局 LESSON 對象；lesson-jp 版）
   數據格式：句子用「漢字[かな]」標記振假名，見 docs/spec-jp.md */
(function(){
  'use strict';
  const L = window.LESSON;
  if(!L){ return; }
  const $ = s=>document.querySelector(s), $$ = s=>Array.from(document.querySelectorAll(s));
  const LANG = 'ja-JP';
  const R = window.JDRuby;

  document.title = (L.title||'未命名')+' · 日語精讀';
  $('#hTitle').textContent = (L.badge ? L.badge+' · ' : '') + (L.title||'未命名');

  /* 執行時防禦：舊版對話課可能把人名（含振假名「田中[たなか]：」）黏在句子開頭沒拆乾淨，
     導致人名顯示兩次、跟讀/背句目標含人名→識別準確率暴跌。這裡進頁時再掃一遍補救，不必重新生成。 */
  (function stripLeadingSpeakers(){
    const RE = /^([A-Za-z][A-Za-z .'’-]{0,24}|[一-鿿぀-ヿＡ-Ｚ\[\]々]{1,24})\s*[：:]\s*/;
    (L.sentences||[]).forEach(s=>{
      if(!s || typeof s.jp!=='string') return;
      const m = s.jp.match(RE);
      if(m){ if(!s.speaker) s.speaker = m[1].trim(); s.jp = s.jp.slice(m[0].length).trim(); }
    });
  })();

  /* ---------- 漢字→讀音對照表（從本課 sentences/vocab 的 base[かな] 標記自動收集） ----------
     用途：iPad 語音識別對日語通常輸出「標準漢字假名混寫」而非純假名，
     若直接拿純假名目標句比對會把正確發音誤判成錯誤。
     解法：收集本課出現過的「漢字→讀音」，識別結果裡若含這些漢字就換成讀音，再跟純假名目標比對。
     ⚠️ 這是「本課範圍內」的對照，不是通用日語形態分析，換句話說換了漢字寫法或未收錄的漢字無法覆蓋——
        需要用戶在 iPad 實測後回饋準確率，不準的話可切換自評按鈕。 */
  const KANJI_MAP = {};
  function collectKanjiMap(text){
    /* 用 ruby.js 的單一真源解析（只吃緊貼括號前的漢字）；別自己另寫正則，
       舊的貪婪 [^\[\]]+ 會把前面的假名吃進 key（「これからお世話」），映射就全錯了 */
    (R.kanjiReadings ? R.kanjiReadings(text) : []).forEach(([k,v])=>{ if(k) KANJI_MAP[k] = v; });
  }
  L.sentences.forEach(s=>collectKanjiMap(s.jp||''));
  (L.vocab||[]).forEach(v=>{ collectKanjiMap(v.w||''); collectKanjiMap(v.eg||''); });
  /* 漢字→假名的映射與取高分邏輯已收進 JD.compareJPReading(jp, 識別文字, KANJI_MAP)，這裡只負責建表 */

  window.switchTab = function(name){
    $$('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.t===name));
    $$('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='p-'+name));
    window.scrollTo({top:0});
    const act=document.querySelector('.tab-btn.active');
    if(act && act.scrollIntoView) act.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
    if(name==='done') renderDone();
    else resumeScroll(name);
  };
  function resumeScroll(name){
    if(name==='read'){ const el=$$('#readList .sent')[resume('read', L.sentences.length)]; if(el) setTimeout(()=>el.scrollIntoView({block:'center'}),60); }
    if(name==='vocab'){ const el=$$('#vocabGrid .vcard')[resume('vocab', (L.vocab||[]).length)]; if(el) setTimeout(()=>el.scrollIntoView({block:'center'}),60); }
  }
  function refreshDots(){
    const p = JD.getProgress(L.id);
    $$('.tab-btn .dot').forEach(d=>d.classList.toggle('done', !!p[d.dataset.s]));
  }
  function done(sec){ JD.markDone(L.id, sec); refreshDots(); }
  function pos(sec, doneCnt, n, score){ JD.setSecPos(L.id, sec, doneCnt, n, score); }
  function resume(sec, n){ return JD.resumeIdx(L.id, sec, n); }
  /* 續做回填：重進頁面時各環節結果容器是空的，pos() 完成數從 0 重來，配 setSecPos 只增不減(Math.max)
     → 打卡進度條卡住、環節湊不滿無法完成。依順序續做模型把前 done 項當已完成、前 score 項當答對回填。 */
  function seedResults(sec, n, passVal, failVal){
    const sp = JD.getSecPos(L.id)[sec] || {};
    const done = Math.min(sp.done||0, n), score = Math.min(sp.score||0, done);
    const arr = new Array(n).fill(null);
    for(let i=0;i<done;i++) arr[i] = (i<score) ? passVal : failVal;
    return arr;
  }
  function seedSet(set, sec, n, key){
    const sp = JD.getSecPos(L.id)[sec] || {};
    const cnt = Math.min((sp[key]||0), n);
    for(let i=0;i<cnt;i++) set.add(i);
  }

  /* ========== 0 聽全文 ========== */
  /* 依課文類型自動預設句間停頓：對話→180；敘事/故事→300。用戶手動設值後尊重手動。 */
  (function autoLtGap(){
    if(!(window.JDTTS && JDTTS.setAutoGap && L.sentences)) return;
    const spk = L.sentences.filter(s=>s.speaker).length;
    const isDialogue = spk >= Math.max(2, L.sentences.length*0.3);
    JDTTS.setAutoGap(isDialogue ? 180 : 300);
  })();
  const lt = { playing:false, slow:false, blind:false, loop:false };
  const ltBox = $('#ltText');
  if(ltBox){
    ltBox.classList.add('jp-text');
    ltBox.innerHTML = L.sentences.map((s,i)=>'<span class="lt-sent" id="lt'+i+'">'+(s.speaker?'<b class="spk">'+R.toRubyHTML(JD.esc(s.speaker))+':</b> ':'')+R.toRubyHTML(JD.esc(s.jp))+'</span>').join('　');
    insertZhCard(ltBox, L.sentences);
  }
  function insertZhCard(box, sentences){
    const card=document.createElement('div'); card.className='card'; card.id='ltZhCard';
    card.innerHTML='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
      '<b style="font-family:var(--font-head);color:var(--teal-deep)">🀄 全文中文翻譯</b>'+
      '<button class="big-btn ghost" style="padding:5px 12px;font-size:.82rem;margin:0 0 0 auto" onclick="ltToggleZh(this)">隱藏</button></div>'+
      '<div id="ltZhBody">'+sentences.map((s,i)=>'<div class="lt-zh" id="ltzh'+i+'"><span class="lt-zh-idx">'+(i+1)+'</span><span>'+JD.esc(s.zh||'')+'</span></div>').join('')+'</div>';
    box.parentNode.insertBefore(card, box.nextSibling);
  }
  window.ltToggleZh=function(btn){ const body=$('#ltZhBody'); const hide=body.style.display!=='none'; body.style.display=hide?'none':'block'; btn.textContent=hide?'顯示':'隱藏'; };
  /* 自動捲動避開頂部吸頂列，把當前句停在控制列正下方，手機上不被遮住 */
  function scrollBelowSticky(el){
    const hdr=document.querySelector('header.site');
    const ctrl=document.querySelector('#p-listen .ctrl-sticky');
    const off=(hdr?hdr.offsetHeight:0)+(ctrl?ctrl.offsetHeight:0)+16;
    const y=window.scrollY + el.getBoundingClientRect().top - off - 40;
    window.scrollTo({top:Math.max(0,y), behavior:'smooth'});
  }
  function ltHighlight(i){
    $$('.lt-sent').forEach((el,k)=>el.classList.toggle('now', k===i));
    $$('.lt-zh').forEach((el,k)=>el.classList.toggle('now', k===i));
    const el=document.getElementById('lt'+i); if(el) scrollBelowSticky(el);
  }
  function ltAdvance(i){ if(lt.playing) setTimeout(()=>ltPlayFrom(i+1), 0); }
  /* 系統合成聲逐句（雲端沒開/失敗時保底）：用 kana 讓系統聲讀得準；保留高亮與看門狗 */
  function ltSystemSpeak(i){
    const text = R.toKana(L.sentences[i].jp);
    const u=new SpeechSynthesisUtterance(text);
    u.lang=LANG; u.rate = lt.slow?0.6:0.85;
    const v=JD.pickVoice(LANG); if(v) u.voice=v;
    let advanced=false;
    const go=()=>{ if(advanced) return; advanced=true; clearTimeout(watchdog); ltAdvance(i); };
    u.onend=go; u.onerror=go;
    const est = text.length * (lt.slow?260:180) + 4000;
    const watchdog=setTimeout(()=>{ try{ speechSynthesis.cancel(); }catch(e){} go(); }, est);
    try{ JD.toPlaybackRoute&&JD.toPlaybackRoute(); }catch(e){}  /* iOS：剛錄過音→設回外放，免小聲/走聽筒 */
    try{ speechSynthesis.speak(u); }catch(e){ go(); }
  }
  function ltPlayFrom(i){
    if(!lt.playing) return;
    if(i>=L.sentences.length){ done('listen'); if(lt.loop){ ltPlayFrom(0); return; } ltStopUI(); return; }
    ltHighlight(i);
    ltSystemSpeak(i);
  }
  function ltCloudOn(){ try{ return localStorage.getItem('jingdu_lt_cloud')!=='0'; }catch(e){ return true; } }
  /* 雲端聽全文：整篇合成一段連續音檔一次播完(iOS穩)。
     ⚠️日語傳 R.toKana(把漢字換成注音的假名讀音)——直接傳原文會讓 Azure 把漢字+上面的假名注音都讀=讀兩遍/讀錯音；
     用注音的假名＝作者指定的正確讀音，一遍且不會挑錯漢字讀音。進度比例高亮；失敗退回系統逐句。 */
  async function ltCloudPlayAll(){
    const sents=L.sentences.map(s=>R.toKana(s.jp)), full=sents.join('\x01');   /* \x01=句間分隔，雲端插短 break */
    const lens=sents.map(s=>(s||'').length+2), total=lens.reduce((a,b)=>a+b,0)||1;
    const cum=[]; let acc=0; lens.forEach((n,i)=>{ cum[i]=acc; acc+=n; });
    lt.idx=-1; ltHighlight(0);
    const onProg=(t,dur)=>{ if(!dur||!lt.playing) return;
      const cp=(t/dur)*total; let idx=0; for(let i=0;i<cum.length;i++){ if(cp>=cum[i]) idx=i; }
      if(idx!==lt.idx){ lt.idx=idx; ltHighlight(idx); } };
    let ok=false;
    try{ ok=await JDTTS.playUntilEnd(full,'ja',lt.slow,onProg); }catch(e){ ok=false; }
    if(!lt.playing) return;
    if(!ok){ ltPlayFrom(0); return; }
    done('listen');
    if(lt.loop){ ltCloudPlayAll(); return; }
    ltStopUI();
  }
  function ltStopUI(){
    lt.playing=false; speechSynthesis.cancel(); if(window.JDTTS) JDTTS.stop();
    $$('.lt-sent').forEach(el=>el.classList.remove('now'));
    const b=$('#ltPlayBtn'); if(b){ b.textContent='▶️ 播放全文'; b.classList.remove('rec'); b.classList.add('teal'); }
  }
  window.ltPlay=function(){
    if(lt.playing){ ltStopUI(); return; }
    lt.playing=true; speechSynthesis.cancel(); if(window.JDTTS) JDTTS.stop();
    const b=$('#ltPlayBtn'); b.textContent='⏹️ 停止'; b.classList.remove('teal'); b.classList.add('rec');
    if(ltCloudOn() && window.JDTTS && JDTTS.enabled() && JDTTS.playUntilEnd) ltCloudPlayAll();
    else ltPlayFrom(0);
  };
  function ltBtnState(btn,on){ btn.classList.toggle('mango',on); btn.classList.toggle('ghost',!on); }
  /* 聽全文控制列加「☁️ 雲端聲」快速開關 */
  (function injectLtCloudBtn(){
    const pb=$('#ltPlayBtn'); if(!pb || !(window.JDTTS && JDTTS.enabled())) return;
    const btn=document.createElement('button'); btn.type='button'; btn.className='big-btn'; btn.id='ltCloudBtn';
    const upd=()=>{ const on=ltCloudOn(); btn.textContent='☁️ 雲端'; ltBtnState(btn,on); };
    btn.onclick=()=>{ localStorage.setItem('jingdu_lt_cloud', ltCloudOn()?'0':'1');
      localStorage.setItem('jingdu_updatedAt',String(Date.now())); if(window.JDSYNC) window.JDSYNC.schedule(); upd(); };
    upd(); pb.parentNode.appendChild(btn);
  })();
  /* 標籤只留「圖示+兩字」，開/關靠顏色，控制列一排排完不佔正文 */
  window.ltToggleSpeed=function(btn){ lt.slow=!lt.slow; btn.textContent='🐢 慢速'; ltBtnState(btn,lt.slow); };
  window.ltToggleBlind=function(btn){ lt.blind=!lt.blind; btn.textContent='🙈 盲聽'; ltBtnState(btn,lt.blind); if(ltBox) ltBox.classList.toggle('blind', lt.blind); };
  window.ltToggleLoop=function(btn){ lt.loop=!lt.loop; btn.textContent='🔁 循環'; ltBtnState(btn,lt.loop); };

  /* ========== 1 逐句精讀 ========== */
  const readBox=$('#readList');
  L.sentences.forEach((s,i)=>{
    const div=document.createElement('div');
    div.className='card sent';
    div.innerHTML=
      '<div class="en jp-en jp-text"><span class="idx">'+(i+1)+'</span><span style="flex:1">'+(s.speaker?'<b class="spk">'+R.toRubyHTML(JD.esc(s.speaker))+':</b> ':'')+R.toRubyHTML(JD.esc(s.jp))+'</span>'+
      '<button class="btn-voice" aria-label="播放">🔊</button>'+
      '<button class="btn-voice slow" aria-label="慢速">慢</button></div>'+
      '<div style="margin:4px 0 0 40px" class="jp-romaji">'+JD.esc(s.romaji||'')+'</div>'+
      '<div class="body"><div class="zh">🀄 '+JD.esc(s.zh)+'</div><div class="ana">'+s.ana+'</div></div>';
    div.querySelector('.btn-voice').onclick=e=>{ e.stopPropagation(); JD.speak(R.toKana(s.jp),false,LANG); };
    div.querySelector('.btn-voice.slow').onclick=e=>{ e.stopPropagation(); JD.speak(R.toKana(s.jp),true,LANG); };
    div.onclick=()=>{ div.classList.toggle('open'); checkReadDone(); };
    readBox.appendChild(div);
  });
  const opened=new Set();
  function checkReadDone(){
    $$('#readList .sent').forEach((d,i)=>{ if(d.classList.contains('open')) opened.add(i); });
    pos('read', opened.size, L.sentences.length);
    if(opened.size>=L.sentences.length) done('read');
  }

  /* ========== 2 生詞卡（look-cover-write-check：看漢字/假名記住 → 翻面輸入平假名讀音） ========== */
  const vg=$('#vocabGrid');
  const judged=new Set();
  const vright=new Set();   /* 讀對的卡片，供打卡得分 */
  seedSet(judged, 'vocab', (L.vocab||[]).length, 'done');   /* 續做回填，否則進度條卡住、環節湊不滿 */
  seedSet(vright, 'vocab', (L.vocab||[]).length, 'score');
  L.vocab.forEach((v,i)=>{
    const c=document.createElement('div');
    c.className='vcard';
    c.innerHTML='<div class="inner"><div class="vface front"><div class="w jp-w jp-text">'+R.toRubyHTML(JD.esc(v.w))+'</div>'+
      '<div class="ipa jp-romaji">'+JD.esc(v.romaji||'')+'</div><div style="margin-top:8px"><button class="btn-voice">🔊</button></div>'+
      '<div class="hint" style="margin:8px 0 0;font-size:.72rem">記住讀音，翻面拼出平假名！</div></div>'+
      '<div class="vface back"><div class="pos">'+JD.esc(v.pos)+' · '+JD.esc(v.zh)+'</div>'+
      '<div class="eg jp-text">'+R.toRubyHTML(JD.esc(v.eg||''))+'</div>'+
      '<div class="vspell"><input type="text" placeholder="輸入平假名讀音" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">'+
      '<button class="vbtn yes">檢查</button></div><div class="vfb"></div></div></div>';
    c.querySelector('.btn-voice').onclick=e=>{ e.stopPropagation(); JD.speak(R.toKana(v.w),false,LANG); };
    const input=c.querySelector('.vspell input'), fb=c.querySelector('.vfb');
    function judge(){
      const typed=(input.value||'').trim();
      if(!typed){ input.focus(); return; }
      const want = JD.kk2hh(R.toKana(v.w)).replace(/\s/g,'');
      const got = JD.kk2hh(typed).replace(/\s/g,'');
      const ok = got===want;
      judged.add(i);
      if(ok) vright.add(i);   /* 取最好：讀對過就算會，重做讀錯不抹掉 */
      pos('vocab', judged.size, L.vocab.length, vright.size);
      c.classList.remove('known','unknown'); c.classList.add(ok?'known':'unknown');
      if(ok){ fb.innerHTML='<span class="vok">✓ 讀對了！</span>'; JD.speak(R.toKana(v.w),false,LANG); setTimeout(()=>c.classList.remove('flip'),900); JD.celebrate('good'); }
      else{
        fb.innerHTML='<span class="vbad">✗ 正確讀音：<b>'+JD.esc(R.toKana(v.w))+'</b></span>';
        JD.addError({id:'w:'+L.id+'#'+v.w, lessonId:L.id, en:R.toKana(v.w), zh:v.zh, type:'word', pos:v.pos, kmap:KANJI_MAP});
        JD.celebrate('try');
      }
      if(judged.size>=L.vocab.length) done('vocab');
    }
    c.querySelector('.vbtn.yes').onclick=e=>{ e.stopPropagation(); judge(); };
    input.addEventListener('click', e=>e.stopPropagation());
    input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); judge(); } });
    c.onclick=()=>{ c.classList.toggle('flip'); if(c.classList.contains('flip')) setTimeout(()=>input.focus(),450); };
    vg.appendChild(c);
  });

  /* ========== 2.5 生詞強化練習：換方向、多輪重複（看中文默寫讀音 / 看日文選中文），加深記憶 ========== */
  (function vocabDrill(){
    const host = document.getElementById('p-vocab');
    if(!host || !L.vocab || L.vocab.length<1) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<h2 class="sec" style="margin-top:24px">🔁 生詞強化練習</h2>'+
      '<p class="hint">一遍記不牢！換方向多練幾輪——<b>看中文默寫日文讀音</b>、<b>看日文選中文</b>。答錯的詞自動進錯題本。</p>'+
      '<div class="progress-pills" id="vdPills"></div><div class="stage" id="vdStage"></div>';
    host.appendChild(wrap);
    const vd = { order:[], idx:0, mode:null, right:0, round:0 };
    const sh = a=>{ a=a.slice(); for(let k=a.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)); const t=a[k]; a[k]=a[j]; a[j]=t; } return a; };
    function pills(){ const el=$('#vdPills'); if(!el) return;
      el.innerHTML = vd.order.map((_,k)=>'<span class="pill '+(k===vd.idx?'now':(k<vd.idx?'ok':''))+'"></span>').join(''); }
    function menu(msg){
      $('#vdStage').innerHTML = (msg?'<div class="acc-badge good" style="margin-bottom:12px">'+JD.esc(msg)+'</div>':'')+
        '<div class="mask-box">選一種方向開始練（可反覆練，越練越熟）</div>'+
        '<div style="margin-top:12px"><button class="big-btn mango" onclick="vdStart(\'cn2jp\')">🀄→🇯🇵 看中文默寫讀音</button>'+
        '<button class="big-btn teal" onclick="vdStart(\'jp2cn\')">🇯🇵→🀄 看日文選中文</button></div>';
      /* 選單也顯示一整條(淡)進度條，讓「這裡有進度」一眼可見；剛練完一輪則顯示為已完成 */
      const finished = (vd.round>0 && vd.idx>=vd.order.length && vd.order.length>0);
      $('#vdPills').innerHTML = (L.vocab||[]).map(()=>'<span class="pill'+(finished?' ok':'')+'" style="opacity:'+(finished?'1':'.4')+'"></span>').join('');
    }
    window.vdStart = function(mode){ vd.mode=mode; vd.order=sh(L.vocab.map((_,i)=>i)); vd.idx=0; vd.right=0; vd.round++; render(); };
    function opts4(correctIdx){
      const others = L.vocab.map((_,i)=>i).filter(i=>i!==correctIdx && (L.vocab[i].zh||'')!==(L.vocab[correctIdx].zh||''));
      return sh(sh(others).slice(0,3).concat([correctIdx]));
    }
    function render(){
      pills();
      const stage=$('#vdStage');
      if(vd.idx>=vd.order.length){ menu('這一輪練完，答對 '+vd.right+' / '+vd.order.length+' 👏 再換方向或同方向多練一輪！'); return; }
      const vi=vd.order[vd.idx], v=L.vocab[vi];
      if(vd.mode==='cn2jp'){
        stage.innerHTML='<div class="hint" style="margin:0 0 8px">第 '+(vd.idx+1)+' / '+vd.order.length+' · 看中文，打出日文讀音（平假名）</div>'+
          '<div class="target"><b>'+JD.esc(v.zh)+'</b> <span style="color:var(--muted);font-size:.85rem">'+JD.esc(v.pos||'')+'</span></div>'+
          '<div style="margin:12px 0"><input id="vdIn" type="text" placeholder="輸入平假名讀音" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:100%;box-sizing:border-box;border:2px solid var(--line);border-radius:12px;padding:10px 12px;font-size:1.1rem"></div>'+
          '<button class="big-btn mango" onclick="vdCheckCn2Jp()">✓ 檢查</button>'+
          '<button class="big-btn ghost" onclick="vdReveal()">看答案</button>'+
          '<div id="vdFb" style="margin-top:10px"></div>';
        const inp=$('#vdIn'); if(inp){ inp.focus(); inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); window.vdCheckCn2Jp(); } }); }
      } else {
        const os=opts4(vi);
        stage.innerHTML='<div class="hint" style="margin:0 0 8px">第 '+(vd.idx+1)+' / '+vd.order.length+' · 看日文，選中文意思</div>'+
          '<div class="target jp-text"><b>'+R.toRubyHTML(JD.esc(v.w))+'</b> <button class="btn-voice" id="vdVoice">🔊</button></div>'+
          '<div id="vdOpts" style="margin-top:12px">'+os.map(i=>'<button class="qz-opt" data-i="'+i+'">'+JD.esc(L.vocab[i].zh)+'</button>').join('')+'</div>'+
          '<div id="vdFb" style="margin-top:10px"></div>';
        const vb=$('#vdVoice'); if(vb) vb.onclick=()=>JD.speak(R.toKana(v.w),false,LANG);
        $$('#vdOpts .qz-opt').forEach(btn=>btn.onclick=()=>vdPickJp2Cn(parseInt(btn.dataset.i), vi));
      }
    }
    function afterAnswer(ok, vi){
      const v=L.vocab[vi];
      if(ok){ vd.right++; JD.celebrate('good'); }
      else { JD.addError({id:'w:'+L.id+'#'+v.w, lessonId:L.id, en:R.toKana(v.w), zh:v.zh, type:'word', pos:v.pos, kmap:KANJI_MAP}); JD.celebrate('try'); }
      const fb=$('#vdFb');
      if(fb) fb.innerHTML='<div class="acc-badge '+(ok?'good':'bad')+'">'+(ok?'🎉 對了！':'💪 正解：<b>'+JD.esc(R.toKana(v.w))+'</b> = '+JD.esc(v.zh))+'</div>'+
        (ok?'':'<div class="hint" style="margin:6px 0 0">📌 這個詞已放進<b>錯題本</b>，之後復盤會再考你</div>')+
        '<div style="margin-top:8px"><button class="big-btn teal" onclick="vdNext()">下一個 →</button></div>';
      $$('#vdOpts .qz-opt').forEach(b=>b.disabled=true);
      const inp=$('#vdIn'); if(inp) inp.disabled=true;
    }
    window.vdCheckCn2Jp = function(){
      const vi=vd.order[vd.idx], v=L.vocab[vi];
      const typed=(($('#vdIn')||{}).value||'').trim();
      if(!typed){ const i=$('#vdIn'); if(i) i.focus(); return; }
      const want=JD.kk2hh(R.toKana(v.w)).replace(/\s/g,''), got=JD.kk2hh(typed).replace(/\s/g,'');
      afterAnswer(got===want, vi);
    };
    window.vdReveal = function(){ afterAnswer(false, vd.order[vd.idx]); };
    window.vdPickJp2Cn = function(pickI, vi){ afterAnswer((L.vocab[pickI].zh||'')===(L.vocab[vi].zh||''), vi); };
    window.vdNext = function(){ vd.idx++; render(); };
    menu('');
  })();

  /* ========== 3 語法點 ========== */
  const gb=$('#grammarBox');
  L.grammar.forEach(g=>{
    const d=document.createElement('div'); d.className='card gcard stitch jp-text';
    d.innerHTML='<h3>'+JD.esc(g.t)+'</h3>'+g.body;
    gb.appendChild(d);
  });
  $('#grammarDoneBtn').onclick=()=>{ done('grammar'); $('#grammarDoneBtn').textContent='✓ 已讀完'; };

  /* ========== 3.5 連詞成句（日語按「文節」重排，語序含動詞放句末等日語特色） ========== */
  const bdItems=[];
  L.sentences.forEach((s,i)=>{
    const chunks = s.chunks || null; /* 數據裡若提供 chunks（文節切分陣列）優先用 */
    if(chunks && chunks.length>=2 && chunks.length<=7) bdItems.push({idx:i, jp:R.toKana(s.jp), zh:s.zh, words:chunks});
  });
  while(bdItems.length>8) bdItems.pop();
  const bd={ i:0, placed:[], pool:[], results:[] };
  function bdShuffle(a){ a=a.slice(); for(let k=a.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)),t=a[k]; a[k]=a[j]; a[j]=t; } return a; }
  function bdPills(){ const el=$('#bdPills'); if(!el) return;
    el.innerHTML=bdItems.map((_,k)=>{ const st=bd.results[k]==null?'':(bd.results[k]?'ok':'bad'); return '<span class="pill '+(k===bd.i?'now':'')+' '+st+'"></span>'; }).join(''); }
  function bdLoad(){
    if(!bdItems.length) return;
    const it=bdItems[bd.i]; bd.placed=[];
    let sh=bdShuffle(it.words);
    if(sh.join('')===it.words.join('') && it.words.length>1){ sh.push(sh.shift()); }
    bd.pool=sh.map((w,k)=>({w:w,cid:k}));
    bdRender();
  }
  function bdChip(c,where){ return '<button class="bd-chip jp-text" onclick="'+(where==='pool'?'bdPlace':'bdUnplace')+'('+c.cid+')">'+R.toRubyHTML(JD.esc(c.w))+'</button>'; }
  function bdRender(fb){
    bdPills();
    pos('build', bd.results.filter(x=>x!=null).length, bdItems.length, bd.results.filter(Boolean).length);
    const box=$('#buildBox'); if(!box) return;
    if(bd.i>=bdItems.length){
      const right=bd.results.filter(Boolean).length;
      box.innerHTML='<div class="stage"><div style="font-size:2.4rem">🧩</div>'+
        '<div class="acc-badge '+(right>=bdItems.length*0.8?'good':'bad')+'">排對 '+right+' / '+bdItems.length+' 句</div>'+
        '<div style="margin-top:10px"><button class="big-btn ghost" onclick="bdRestart()">再玩一遍</button></div></div>';
      return;
    }
    const it=bdItems[bd.i];
    box.innerHTML='<div class="stage">'+
      '<div class="hint" style="margin:0 0 10px">🀄 '+JD.esc(it.zh)+'</div>'+
      '<div class="bd-answer jp-text" id="bdAnswer">'+(bd.placed.length?bd.placed.map(c=>bdChip(c,'ans')).join(''):'<span class="bd-ph">點下面的詞語，按正確順序排到這裡</span>')+'</div>'+
      '<div class="bd-pool">'+bd.pool.map(c=>bdChip(c,'pool')).join('')+'</div>'+
      '<div style="margin-top:14px">'+
        '<button class="big-btn teal" onclick="bdPlay()">🔊 聽一遍</button>'+
        '<button class="big-btn mango" onclick="bdCheck()">✓ 檢查</button>'+
        '<button class="big-btn ghost" onclick="bdReset()">↺ 清空</button>'+
        '<button class="big-btn ghost" onclick="bdReveal()">看答案</button></div>'+
      '<div id="bdFb" style="margin-top:12px">'+(fb||'')+'</div></div>';
  }
  window.bdPlace=function(cid){ const k=bd.pool.findIndex(c=>c.cid===cid); if(k<0)return; bd.placed.push(bd.pool[k]); bd.pool.splice(k,1); bdRender(); };
  window.bdUnplace=function(cid){ const k=bd.placed.findIndex(c=>c.cid===cid); if(k<0)return; bd.pool.push(bd.placed[k]); bd.placed.splice(k,1); bdRender(); };
  window.bdReset=function(){ bd.pool=bd.pool.concat(bd.placed); bd.placed=[]; bdRender(); };
  window.bdPlay=function(){ JD.speak(R.toKana(bdItems[bd.i].jp),false,LANG); };
  window.bdCheck=function(){
    const it=bdItems[bd.i];
    if(bd.placed.length<it.words.length){ bdRender('<div class="acc-badge bad">還有詞語沒排上去哦</div>'); return; }
    const got=bd.placed.map(c=>c.w).join(''), want=it.words.join('');
    if(got===want){ bd.results[bd.i]=true; JD.speak(R.toKana(it.jp),false,LANG); bdRender('<div class="acc-badge good">🎉 排對了！<br>'+JD.esc(it.jp)+'</div>'); bdMaybeDone(); JD.celebrate('good'); }
    else{ bdRender('<div class="acc-badge bad">順序還不對，再試試～</div>'); JD.celebrate('try'); }
  };
  window.bdReveal=function(){
    const it=bdItems[bd.i]; if(bd.results[bd.i]!==true) bd.results[bd.i]=false;  /* 解對過就保留對 */
    JD.addError({id:L.id+'#'+it.idx, lessonId:L.id, en:it.jp, zh:it.zh, kmap:KANJI_MAP});
    bdRender('<div class="acc-badge bad">正確順序是：<br>'+JD.esc(it.jp)+'<br><span style="font-size:.8rem">（已放進錯題本）</span></div>'); bdMaybeDone();
  };
  window.bdNav=function(d){ bd.i=Math.min(Math.max(bd.i+(d||1),0), bdItems.length); if(bd.i>=bdItems.length) bdRender(); else bdLoad(); };
  window.bdRestart=function(){ bd.i=0; bd.results=[]; bdLoad(); };
  function bdMaybeDone(){ if(bd.results.filter(x=>x!=null).length>=bdItems.length) done('build'); }
  if(bdItems.length){ bd.results = seedResults('build', bdItems.length, true, false); bd.i = resume('build', bdItems.length); bdLoad(); }
  else { const bb=$('#buildBox'); if(bb) bb.innerHTML='<p class="empty">本課沒有連詞成句練習～</p>'; done('build'); }

  /* ========== 4 口語跟讀 ========== */
  const spk={ i:0, results:[] };
  function spkRender(){
    const s=L.sentences[spk.i];
    $('#spkPills').innerHTML=L.sentences.map((_,k)=>'<span class="pill '+(k===spk.i?'now':(spk.results[k]==null?'':(spk.results[k]>=JD.PASS?'ok':'bad')))+'"></span>').join('');
    $('#spkTarget').innerHTML='<span class="jp-target jp-text">'+R.toRubyHTML(JD.esc(s.jp))+'</span>';
    $('#spkResult').innerHTML=''; $('#spkHeard').textContent='';
    /* 換句時把錄音鍵重置回「跟讀」＋綁回 spkRec（讀當前句）；否則合併鍵留著上一句閉包會對錯句子 */
    const rb=$('#spkRecBtn'); if(rb){ rb.textContent='🎙️ 跟讀'; rb.classList.remove('listening'); rb.disabled=false; rb.onclick=window.spkRec; }
  }
  window.spkPlay=()=>JD.speak(R.toKana(L.sentences[spk.i].jp),false,LANG);
  window.spkPlaySlow=()=>JD.speak(R.toKana(L.sentences[spk.i].jp),true,LANG);
  window.spkRec=function(){
    const i=spk.i, s=L.sentences[i];
    startRec($('#spkRecBtn'), s, '#spkResult', '#spkHeard', acc=>{
      spk.results[i]=Math.max(spk.results[i]||0, acc); spkRenderPills();  /* 取最高準確率 */
      pos('speak', spk.results.filter(x=>x!=null).length, L.sentences.length, spk.results.filter(x=>x!=null&&x>=JD.PASS).length);
      JD.celebrate(JD.praiseKind({acc:acc}));
      if(acc<JD.PASS) JD.addError({id:L.id+'#'+i, lessonId:L.id, en:R.toKana(s.jp), zh:s.zh, kmap:KANJI_MAP});
    });
  };
  function spkRenderPills(){
    $('#spkPills').innerHTML=L.sentences.map((_,k)=>'<span class="pill '+(k===spk.i?'now':'')+' '+(spk.results[k]==null?'':(spk.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
  }
  window.spkNext=function(d){
    spk.i=Math.min(Math.max(spk.i+d,0), L.sentences.length-1); spkRender();
    if(spk.results.filter(x=>x!=null).length>=L.sentences.length) done('speak');
  };
  JD.injectMicTip('#p-speak');
  spk.results = seedResults('speak', L.sentences.length, JD.PASS, 0);   /* 續做回填 */
  spk.i = resume('speak', L.sentences.length);
  spkRender();

  /* ========== 4.5 聽力題（盲聽：句子先模糊，聽3次才能「看一眼」；看過再答對＝算錯不計分） ========== */
  const qz={ i:0, score:0, listens:0, revealed:false };
  /* 聽力題也用雲端母語聲：整段連續合成一次播完。⚠️日語傳 R.toKana(假名讀音)避免漢字+注音讀兩遍 */
  function qzPlaySeq(idxs){
    try{ speechSynthesis.cancel(); }catch(e){} if(window.JDTTS) JDTTS.stop();
    if(ltCloudOn() && window.JDTTS && JDTTS.enabled() && JDTTS.playUntilEnd){
      const full = idxs.map(i=>R.toKana((L.sentences[i]||{}).jp||'')).join('\x01');
      JDTTS.playUntilEnd(full,'ja',false,null).then(ok=>{ if(!ok) qzSysSpeak(idxs,0); }).catch(()=>qzSysSpeak(idxs,0));
      return;
    }
    qzSysSpeak(idxs,0);
  }
  function qzSysSpeak(idxs,k){
    k=k||0; if(k>=idxs.length) return;
    const u=new SpeechSynthesisUtterance(R.toKana(L.sentences[idxs[k]].jp));
    u.lang=LANG; u.rate=0.85;
    const v=JD.pickVoice(LANG); if(v) u.voice=v;
    const nx=()=>setTimeout(()=>qzSysSpeak(idxs,k+1),300);
    u.onend=nx; u.onerror=nx;
    try{ JD.toPlaybackRoute&&JD.toPlaybackRoute(); }catch(e){}  /* iOS：剛錄過音→設回外放，免小聲/走聽筒 */
    speechSynthesis.speak(u);
  }
  function qzBlindHTML(it){ return it.play.map(i=>R.toRubyHTML(JD.esc((L.sentences[i]||{}).jp||''))).join(' '); }
  function qzRender(){
    const box=$('#quizBox'); if(!box) return;
    if(qz.i>=L.listening.length){
      box.innerHTML='<div class="stage"><div style="font-size:2.6rem">'+(qz.score===L.listening.length?'🏆':'🎯')+'</div>'+
        '<div class="acc-badge '+(qz.score>=L.listening.length*0.8?'good':'bad')+'">答對 '+qz.score+' / '+L.listening.length+' 題</div>'+
        '<div style="margin-top:10px"><button class="big-btn ghost" onclick="qzRestart()">再做一遍</button></div></div>';
      done('quiz'); return;
    }
    qz.listens=0; qz.revealed=false;
    const it=L.listening[qz.i];
    box.innerHTML='<div class="stage">'+
      '<div style="font-family:var(--font-head);color:var(--muted);font-size:.9rem;margin-bottom:8px">第 '+(qz.i+1)+' / '+L.listening.length+' 題</div>'+
      '<div id="qzBlind" class="qz-blind jp-text">'+qzBlindHTML(it)+'</div>'+
      '<button class="big-btn teal" onclick="qzPlay()">🔊 播放錄音</button>'+
      '<div id="qzRevealWrap" style="display:none;margin-top:6px"><button class="big-btn ghost" onclick="qzReveal()">😳 聽不懂，看一眼（這題會算錯）</button></div>'+
      '<div class="jp-text" style="font-weight:700;font-size:1.05rem;margin:14px 0 10px">'+R.toRubyHTML(JD.esc(it.q))+'</div>'+
      '<div id="qzOpts">'+it.opts.map((o,k)=>'<button class="qz-opt jp-text" data-k="'+k+'">'+String.fromCharCode(65+k)+'. '+R.toRubyHTML(JD.esc(String(o).replace(/^[A-DＡ-Ｄ][.、．)）]\s*/,'')))+'</button>').join('')+'</div>'+
      '<div id="qzFb" style="margin-top:10px"></div></div>';
    $$('#qzOpts .qz-opt').forEach(b=>b.onclick=()=>qzAnswer(parseInt(b.dataset.k)));
    qz.listens++; qzPlaySeq(it.play);
  }
  window.qzPlay=function(){
    qz.listens++;
    qzPlaySeq(L.listening[qz.i].play);
    if(qz.listens>=3 && !qz.revealed){ const w=$('#qzRevealWrap'); if(w) w.style.display='block'; }
  };
  window.qzReveal=function(){
    qz.revealed=true;
    const el=$('#qzBlind'); if(el) el.classList.remove('qz-blind');
    const w=$('#qzRevealWrap'); if(w) w.style.display='none';
  };
  function qzAnswer(k){
    const it=L.listening[qz.i];
    $$('#qzOpts .qz-opt').forEach((b,j)=>{ b.disabled=true; if(j===it.ans) b.classList.add('right'); else if(j===k) b.classList.add('wrong'); });
    const correct=(k===it.ans);
    const s=L.sentences[it.srcIdx];
    if(correct && !qz.revealed){
      qz.score++; $('#qzFb').innerHTML='<div class="acc-badge good">🎉 答對了！</div>';
    }else if(correct && qz.revealed){
      JD.addError({id:L.id+'#'+it.srcIdx, lessonId:L.id, en:R.toKana(s.jp), zh:s.zh, kmap:KANJI_MAP});
      $('#qzFb').innerHTML='<div class="acc-badge bad">答對了，但看過答案這題算錯——多聽幾次，下次不看就能懂 💪</div>';
    }else{
      JD.addError({id:L.id+'#'+it.srcIdx, lessonId:L.id, en:R.toKana(s.jp), zh:s.zh, kmap:KANJI_MAP});
      $('#qzFb').innerHTML='<div class="acc-badge bad">再聽聽～正確答案是 '+String.fromCharCode(65+it.ans)+'</div>';
    }
    const el=$('#qzBlind'); if(el) el.classList.remove('qz-blind');
    $('#qzFb').innerHTML += '<div style="margin-top:8px"><button class="big-btn teal" onclick="qzNext()">下一題 →</button></div>';
  }
  window.qzNext=function(){ qz.i++; pos('quiz', qz.i, L.listening.length, qz.score); qzRender(); };
  window.qzRestart=function(){ qz.i=0; qz.score=0; qzRender(); };
  if(L.listening){ qz.i = resume('quiz', L.listening.length); qzRender(); }

  /* ========== 5 背句挑戰 ========== */
  const rc={ i:0, timer:null, results:[] };
  /* 看題秒數：'auto'(依句長自動預設) 或手動 5/10/15，記在本機，英日共用；預設 auto */
  /* 用 sec2 新鍵：舊版純數字值會把人卡在手動；換鍵讓所有人回到「自動」預設 */
  function rcSecMode(){ const v=localStorage.getItem('jingdu_recite_sec2'); return (v==='5'||v==='10'||v==='15')?v:'auto'; }
  function rcAutoSec(s){ const n=R.toKana(((s&&s.jp)||'')).replace(/\s/g,'').length; return Math.max(4, Math.min(18, Math.round(n*0.5))); }
  function rcSec(){ const m=rcSecMode(); return m==='auto' ? rcAutoSec(L.sentences[rc.i]) : parseInt(m,10); }
  window.rcSetSec = function(v){ localStorage.setItem('jingdu_recite_sec2', String(v)); try{ JD.touchSync&&JD.touchSync(); }catch(e){} rcRender('idle'); };
  function stopSpeech(){ try{ speechSynthesis.cancel(); }catch(e){} if(window.JDTTS) JDTTS.stop(); }
  function rcRender(stage){
    const s=L.sentences[rc.i];
    $('#rcPills').innerHTML=L.sentences.map((_,k)=>'<span class="pill '+(k===rc.i?'now':'')+' '+(rc.results[k]==null?'':(rc.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
    const tgt=$('#rcTarget'), ring=$('#rcRing'), btns=$('#rcBtns');
    if(stage==='idle'){
      ring.style.display='none';
      const sec=rcSec(), mode=rcSecMode();
      tgt.innerHTML='<div class="mask-box">第 '+(rc.i+1)+' 句 · 準備好了就開始<br>先看幾秒，句子會蓋住，開口把它背出來！</div>';
      const opts=[['auto','自動'],['5','5秒'],['10','10秒'],['15','15秒']];
      const seg='<div class="rc-secsel">看幾秒：'+opts.map(o=>'<button class="rc-secbtn'+(o[0]===mode?' on':'')+'" onclick="rcSetSec(\''+o[0]+'\')">'+o[1]+'</button>').join('')+
        (mode==='auto'?'<span class="hint" style="margin:6px 0 0;display:block">自動：這句約 '+sec+' 秒（依句子長短調整）</span>':'')+'</div>';
      btns.innerHTML=seg+
        '<button class="big-btn mango" onclick="rcStart()">👀 開始看題（'+sec+' 秒）</button>'+
        '<button class="big-btn ghost" onclick="rcDirect()">🎤 不看，直接背</button>';
      $('#rcResult').innerHTML=''; $('#rcHeard').textContent='';
    }
  }
  window.rcNav=function(d){ clearInterval(rc.timer); rc.i=Math.min(Math.max(rc.i+d,0), L.sentences.length-1); rcRender('idle'); };
  window.rcStart=function(){
    const s=L.sentences[rc.i];
    const tgt=$('#rcTarget'), ring=$('#rcRing'), btns=$('#rcBtns');
    tgt.innerHTML='<span class="jp-target jp-text">'+R.toRubyHTML(JD.esc(s.jp))+'</span>';
    JD.speak(R.toKana(s.jp),false,LANG);
    ring.style.display='flex';
    btns.innerHTML='<button class="big-btn ghost" onclick="rcSkipPeek()">看夠了，開始背 →</button>';
    const total=rcSec(); let left=total; const C=2*Math.PI*30;
    ring.innerHTML='<svg width="66" height="66"><circle class="bg" cx="33" cy="33" r="30"/><circle class="fg" cx="33" cy="33" r="30" stroke-dasharray="'+C+'" stroke-dashoffset="0"/></svg><span id="rcSec">'+total+'</span>';
    const fg=ring.querySelector('.fg');
    rc.timer=setInterval(()=>{ left--; $('#rcSec').textContent=left; fg.style.strokeDashoffset=C*(total-left)/total; if(left<=0){ clearInterval(rc.timer); rcMask(); } },1000);
  };
  window.rcSkipPeek = function(){ clearInterval(rc.timer); rcMask(); };
  window.rcMask = rcMask;
  /* 蓋句＝立刻開始錄音，只有一顆按鈕(一進來就是「我說完了」)，不再「先開始背再我說完了」兩步 */
  function rcMask(){
    stopSpeech();
    $('#rcRing').style.display='none';
    const canRec = JD.recSupported();
    /* 發音評估模式要點按鈕才開麥（getUserMedia 需手勢），不能像 Web Speech 那樣自動起錄 */
    const pron = !!(window.JDPron && JDPron.enabled() && JDPron.supported());
    $('#rcTarget').innerHTML='<div class="mask-box">🙈 句子蓋住了！<br>'+(pron?'點下面「開始背」開麥克風，念完點「我說完了」':(canRec?'🎤 正在聽你背……讀完點下面「我說完了」':'開口大聲背出來'))+'<br><small style="color:var(--muted)">'+(pron?'發音評估：會上傳一小段錄音打四維分':'背完停一下也會自動打分')+'</small></div>';
    $('#rcBtns').innerHTML='<button id="rcRecBtn" class="big-btn rec" onclick="rcRec()">🎙️ 開始背</button><button class="big-btn ghost" onclick="rcPeek()">😳 忘了，看一眼</button>';
    if(!pron) rcRec();   /* 非評估模式：倒數完自動起錄；評估模式：等使用者點「開始背」 */
  }
  window.rcPeek=function(){ const s=L.sentences[rc.i]; $('#rcTarget').innerHTML='<span class="jp-target jp-text">'+R.toRubyHTML(JD.esc(s.jp))+'</span>'; rcFinish(0,null); };
  /* 不看直接背 → 蓋句＋自動錄音 */
  window.rcDirect=function(){ clearInterval(rc.timer); rcMask(); };
  window.rcRec=function(){ startRec($('#rcRecBtn'), L.sentences[rc.i], '#rcResult', '#rcHeard', acc=>rcFinish(acc,true)); };
  function rcFinish(acc, showedResult){
    const s=L.sentences[rc.i]; rc.results[rc.i]=Math.max(rc.results[rc.i]||0, acc);  /* 取最高準確率 */
    pos('recite', rc.results.filter(x=>x!=null).length, L.sentences.length, rc.results.filter(x=>x!=null&&x>=JD.PASS).length);
    if(showedResult) JD.celebrate(JD.praiseKind({acc:acc}));
    if(acc<JD.PASS) JD.addError({id:L.id+'#'+rc.i, lessonId:L.id, en:R.toKana(s.jp), zh:s.zh, kmap:KANJI_MAP});
    if(!showedResult) $('#rcResult').innerHTML='<div class="acc-badge bad">進錯題本，等會再戰 💪</div>';
    $('#rcTarget').innerHTML='<span class="jp-target jp-text">'+R.toRubyHTML(JD.esc(s.jp))+'</span>';
    $('#rcBtns').innerHTML='<button class="big-btn teal" onclick="rcNav(1)">下一句 →</button>'+
      '<div style="margin-top:8px"><button class="big-btn mango" onclick="rcStart()">🔁 再看一遍</button>'+
      '<button class="big-btn ghost" onclick="rcDirect()">🎤 直接背，不看</button></div>';
    $('#rcPills').innerHTML=L.sentences.map((_,k)=>'<span class="pill '+(k===rc.i?'now':'')+' '+(rc.results[k]==null?'':(rc.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
    if(rc.results.filter(x=>x!=null).length>=L.sentences.length) done('recite');
  }
  window.rcRender2=()=>rcRender('idle');
  rc.results = seedResults('recite', L.sentences.length, JD.PASS, 0);   /* 續做回填 */
  rc.i = resume('recite', L.sentences.length);
  rcRender('idle');

  /* ========== 發音評估（Azure 四維：準確/流利/完整/語調）——opt-in，沒開/失敗自動退回下方 Web Speech ========== */
  function renderPronScores(resultSel, heardSel, sc){
    const bar=(lb,val)=>{ const col=val>=JD.PASS?'var(--green)':val>=60?'var(--mango)':'var(--coral)';
      return '<div class="pron-row"><span class="pron-lb">'+lb+'</span><span class="pron-track"><span class="pron-fill" style="width:'+val+'%;background:'+col+'"></span></span><span class="pron-num">'+val+'</span></div>'; };
    $(resultSel).innerHTML='<div class="pron-bars">'+bar('準確度',sc.accuracy)+bar('流利度',sc.fluency)+bar('完整度',sc.completeness)+(sc.hasProsody?bar('語調',sc.prosody):'')+'</div>'+
      '<div class="acc-badge '+(sc.pron>=JD.PASS?'good':'bad')+'">'+(sc.pron>=JD.PASS?'🎉':'💪')+' 綜合發音 '+sc.pron+' 分</div>';
    if(heardSel) $(heardSel).textContent = sc.text ? ('你說的是：'+sc.text) : '';
  }
  /* 一鍵制：按下即開麥（此函式須由使用者點擊觸發，getUserMedia 要手勢）；ctl 就緒後鈕變「我說完了」，再點=停止上傳評分 */
  function startRecPron(btn, sent, resultSel, heardSel, onAcc){
    const refText = R.toPlain(sent.jp);   /* 日語參考文＝去振假名的漢字自然文 */
    $(resultSel).innerHTML='<div class="acc-badge">🎤 開麥克風中…允許後開口念，念完點「我說完了」</div>';
    if(heardSel) $(heardSel).textContent='';
    let ctl=null, ended=false;
    if(btn){ btn.disabled=true; btn.classList.add('listening'); btn.textContent='⏳ 開麥克風…'; }
    JDPron.start(refText,'ja').then(c=>{ ctl=c; if(btn){ btn.disabled=false; btn.textContent='✅ 我說完了（上傳打分）'; } })
      .catch(err=>{ if(btn){ btn.classList.remove('listening'); } startRec(btn, sent, resultSel, heardSel, onAcc, true); });
    if(btn) btn.onclick=async ()=>{
      if(ended || !ctl) return;
      ended=true; btn.disabled=true; btn.classList.remove('listening'); btn.textContent='⏳ 評分中…';
      try{
        const sc=await ctl.stop();
        renderPronScores(resultSel, heardSel, sc);
        onAcc(sc.pron);
        if(sc.pron < JD.PASS){  /* Azure 發音評估也可能對某些詞評低分→給自評兜底，念對不卡死 */
          const d=document.createElement('div'); d.style.marginTop='8px';
          d.innerHTML='<button class="big-btn ghost">🙋 我確定念對了（有些詞就是難評分）</button>';
          d.querySelector('button').onclick=()=>{ $(resultSel).innerHTML='<div class="acc-badge good">✅ 自評通過！念對就好 👍</div>'; onAcc(JD.PASS); };
          $(resultSel).appendChild(d);
        }
        btn.disabled=false; btn.textContent='🎙️ 再試一次'; btn.onclick=()=>startRecPron(btn,sent,resultSel,heardSel,onAcc);
      }catch(e){
        $(resultSel).innerHTML='<div class="acc-badge bad">發音評估暫時不可用（'+JD.esc(e.message||e)+'）。改用普通打分：</div>';
        btn.disabled=false; btn.textContent='🎙️ 再試一次'; btn.onclick=()=>startRec(btn, sent, resultSel, heardSel, onAcc, true);
      }
    };
  }
  /* ========== 共用：錄音 + 比對展示（Web Speech；skipPron=true 時強制不走 Azure，供退回用） ========== */
  function startRec(btn, sent, resultSel, heardSel, onAcc, skipPron){
    if(!skipPron && window.JDPron && JDPron.enabled() && JDPron.supported()){
      return startRecPron(btn, sent, resultSel, heardSel, onAcc);
    }
    if(!JD.recSupported()){
      $(resultSel).innerHTML='<p style="margin-bottom:8px">此設備不支援語音識別。改用自評：</p>'+
        '<button class="big-btn teal" onclick="this.parentNode._ok(100)">✅ 我背對了</button>'+
        '<button class="big-btn ghost" onclick="this.parentNode._ok(0)">❌ 沒背對</button>';
      $(resultSel)._ok = onAcc; return;
    }
    /* 一鍵制：同一顆按鈕開始錄音後就變「我說完了」，再點一次＝停止打分 */
    const restart = ()=>startRec(btn, sent, resultSel, heardSel, onAcc);
    const rec = JD.listen((text, err, alts)=>{
      if(btn){ btn.disabled=false; btn.classList.remove('listening'); btn.textContent=(err && !text)?'🎙️ 開始背':'🎙️ 再試一次'; btn.onclick=restart; }
      if(err && !text){
        /* 日語語音識別在 iPad Safari 上常不可用（未開日語聽寫 / 不支援日語），
           不論哪種錯都給「自評按鈕」讓孩子能繼續，不被卡死 */
        const msg = err==='not-allowed' ? '麥克風權限被拒絕：請在 設定→Safari→麥克風 允許'
                  : err==='silence' ? '沒聽到聲音，再大聲一點試試'
                  : err==='timeout' ? '等了好久沒聽清，再按一次試試'
                  : err==='language-not-supported' ? '這台設備的 Safari 目前不支援日語語音識別（沒開日語聽寫）'
                  : '日語語音識別出錯（'+err+'）';
        $(resultSel).innerHTML='<div class="acc-badge bad">'+msg+'</div>'+
          '<p style="margin:10px 0 6px;font-size:.88rem;color:var(--muted)">👉 <a href="../../jp-mic-test.html" style="color:var(--teal-deep)">點這裡做語音診斷</a>；聽完先自己判斷背得對不對：</p>'+
          '<button class="big-btn teal" onclick="this.parentNode._ok(100)">✅ 我背對了</button>'+
          '<button class="big-btn ghost" onclick="this.parentNode._ok(0)">❌ 沒背對</button>';
        $(resultSel)._ok = onAcc;
        return;
      }
      /* 設備沒開「日語聽寫」時，識別引擎常不報錯、卻用別的語言(英文/中文)硬聽日語→回傳一串非日文亂碼。
         此時比對必然 0 分、還顯示「你說的是：某英文」，非常誤導。偵測到「識別結果完全不含日文字」就攔下，
         不判 0，給明確指引 + 自評，讓孩子能繼續。 */
      /* 多候選：從引擎給的候選裡挑「含日文的」那些來比對（首選可能是英文/中文亂碼，正確的日文常在次選）；
         只有當所有候選都不含日文時，才判定「識別到的不是日文」→ 攔下給診斷指引。 */
      const cands = (alts && alts.length) ? alts : [text];
      const jpCands = cands.filter(c => /[぀-ヿ一-鿿]/.test(c||''));
      if(!jpCands.length){
        $(resultSel).innerHTML =
          '<div class="acc-badge bad">識別到的不是日文（聽成了「'+JD.esc(text)+'」）</div>'+
          '<p style="margin:10px 0 6px;font-size:.86rem;color:var(--muted)">多半是這台設備<b>沒開「日語聽寫」</b>，系統把日語當成別的語言聽了。開啟方法：<br>'+
          '<b>設定 → 通用 → 鍵盤 → 鍵盤 → 加入「日文」鍵盤</b>，並確認<b>「啟用聽寫」</b>已開。開好重開本頁再試。<br>'+
          '👉 <a href="../../jp-mic-test.html" style="color:var(--teal-deep)">點這裡做語音診斷</a>（看設備到底能不能聽日語）<br>暫時先自己判斷背得對不對：</p>'+
          '<button class="big-btn teal" onclick="this.parentNode._ok(100)">✅ 我背對了</button>'+
          '<button class="big-btn ghost" onclick="this.parentNode._ok(0)">❌ 沒背對</button>';
        $(resultSel)._ok = onAcc;
        $(heardSel).textContent = '';
        return;
      }
      const bc = JD.bestCompare(jpCands, c=>JD.compareJPReading(sent.jp, c, KANJI_MAP));
      const r = bc.r; text = bc.text || text;
      const hasSkip = r.tokens.some(t=>t.st==='skip');
      const low = r.accuracy < JD.PASS;
      $(resultSel).innerHTML =
        '<div class="result-words jp-text">'+r.tokens.map(t=>'<span class="rw '+({ok:'ok',miss:'miss',bad:'bad',skip:'skip'}[t.st])+'">'+JD.esc(t.w)+'</span>').join('')+'</div>'+
        '<div class="acc-badge '+(r.accuracy>=JD.PASS?'good':'bad')+'">'+(r.accuracy>=JD.PASS?'🎉':'💪')+' 準確率 '+r.accuracy+'%</div>'+
        (hasSkip?'<div class="hint" style="margin:6px 0 0">灰色是人名/專有詞，聽不出來很正常，不算你錯 👍</div>':'')+
        (low?'<div style="margin-top:8px"><button class="big-btn ghost jd-selfok">🙋 我確定念對了（有些詞語音聽不出）</button>'+
          '<div class="hint" style="margin:6px 0 0">想更準確評分：到「🔊 聲音」頁開「🎯 發音評估」，它有正確答案參照。</div></div>':'');
      if(low){ const sb=$(resultSel).querySelector('.jd-selfok'); if(sb) sb.onclick=()=>{
        $(resultSel).innerHTML='<div class="acc-badge good">✅ 自評通過！有些詞語音聽不出很正常，你念對就好 👍</div>';
        onAcc(JD.PASS); }; }
      $(heardSel).textContent = '你說的是：'+text;
      onAcc(r.accuracy);
    }, undefined, LANG);
    /* 同一顆錄音按鈕變成「我說完了」：讀完點它立即打分（不用另一顆鍵） */
    if(btn){
      btn.disabled=false; btn.classList.add('listening'); btn.textContent='✅ 我說完了（點我打分）';
      btn.onclick=()=>{ btn.disabled=true; btn.textContent='⏳ 打分中…'; try{ rec && rec.stop(); }catch(e){} };
    }
    $(resultSel).innerHTML='<div class="acc-badge">👂 開始讀吧！讀完就點上面「✅ 我說完了」馬上打分</div>';
  }

  /* ========== 5.6 造句挑戰（用本課生詞說自己的話；AI 老師判，無 key/出錯走自評兜底） ========== */
  /* 用上本課全部生詞（判分成本極低），一次做不完可續做 */
  const mkWords = (L.vocab||[]).slice();
  const mk = { i:0, results:[] };
  function mkPlain(w){ return (w||'').replace(/\[[^\]]+\]/g,''); }
  function mkPills(){
    const el=$('#mkPills'); if(!el) return;
    el.innerHTML = mkWords.map((_,k)=>'<span class="pill '+(k===mk.i?'now':'')+' '+(mk.results[k]==null?'':(mk.results[k]?'ok':'bad'))+'"></span>').join('');
  }
  function mkRender(){
    const box=$('#mkStage'); if(!box) return;
    mkPills();
    if(!mkWords.length){ box.innerHTML='<div class="mask-box">本課沒有生詞數據，這一關直接通過 ✓</div>'; done('make'); return; }
    if(mk.i>=mkWords.length){
      box.innerHTML='<div style="font-size:2.6rem">'+(mk.results.every(Boolean)?'🏆':'🖊️')+'</div>'+
        '<div class="acc-badge good">造了 '+mkWords.length+' 句自己的話，真棒！</div>'+
        '<div style="margin-top:10px"><button class="big-btn ghost" onclick="mkRestart()">再來一輪</button></div>';
      done('make'); return;
    }
    const v=mkWords[mk.i];
    box.innerHTML='<div style="font-family:var(--font-head);color:var(--muted);font-size:.9rem">第 '+(mk.i+1)+' / '+mkWords.length+' 個詞</div>'+
      '<div class="target jp-text" style="margin-top:6px"><b>'+R.toRubyHTML(JD.esc(v.w))+'</b><span style="color:var(--muted);font-size:.92rem;margin-left:10px">'+JD.esc(v.zh||'')+'</span></div>'+
      '<div style="margin-top:6px"><button class="btn-voice" id="mkVoiceBtn">🔊</button></div>'+
      ((JD.getMkMin&&JD.getMkMin()>0)?'<div class="hint" style="margin:6px 0 0;color:var(--teal-deep)">✏️ 這句要<b>至少 '+JD.getMkMin()+' 個詞</b>（家長設定）</div>':'')+
      '<div style="margin:12px 0"><textarea id="mkInput" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="用這個詞造一句你自己的話…" '+
      'style="width:100%;min-height:72px;border:2px solid var(--line);border-radius:12px;padding:10px 12px;font-size:1rem"></textarea></div>'+
      '<div><button id="mkMicBtn" class="big-btn rec" onclick="mkMic()">🎤 用說的</button>'+
      '<button class="big-btn teal" onclick="mkCheck()">✨ 檢查我的句子</button></div>'+
      '<div id="mkFb" style="margin-top:12px"></div>';
    const vb=$('#mkVoiceBtn'); if(vb) vb.onclick=()=>JD.speak(R.toKana(v.w),false,LANG);
  }
  window.mkRestart=function(){ mk.i=0; mk.results=[]; mkRender(); };
  window.mkMic=function(){
    const btn=$('#mkMicBtn');
    if(!JD.recSupported()){ $('#mkFb').innerHTML='<div class="acc-badge bad">此設備不支援語音輸入，用打字吧</div>'; return; }
    /* 一鍵制：同一顆「用說的」按鈕開始後就變「我說完了」，再點一次＝停止收音 */
    btn.classList.add('listening'); btn.textContent='✅ 我說完了（點我）'; btn.disabled=false;
    $('#mkFb').innerHTML='<div class="acc-badge">👂 說完就點上面「✅ 我說完了」（或停一下自動結束）</div>';
    const rec = JD.listen((text, err)=>{
      btn.classList.remove('listening'); btn.textContent='🎤 用說的'; btn.disabled=false; btn.onclick=window.mkMic;
      if(text){ const t=$('#mkInput'); t.value=(t.value?t.value+' ':'')+text; $('#mkFb').innerHTML=''; }
      else {
        const msg = err==='not-allowed' ? '麥克風權限被拒絕：請在 設定→Safari→麥克風 允許'
                  : err==='silence' ? '沒聽到聲音，再說一次（或直接打字）'
                  : err==='unsupported' ? '此設備不支援語音輸入，用打字吧'
                  : '沒聽清，再試一次（或直接打字）';
        $('#mkFb').innerHTML='<div class="acc-badge bad">'+msg+'</div>';
      }
    }, null, LANG);
    btn.onclick=()=>{ btn.disabled=true; btn.textContent='⏳ …'; try{ rec && rec.stop(); }catch(e){} };
  };
  function mkAfter(ok, fix, tip, better, betterZh){
    mk.results[mk.i] = mk.results[mk.i] || ok; mkPills();  /* 取最好：造對過就算對 */
    /* 造句沒造對→這個詞進錯題本複盤（和生詞卡不認識同 id）；造對就不加。日語 en 存假名讀音供複盤朗讀 */
    const mv = mkWords[mk.i];
    if(!ok && mv) JD.addError({id:'w:'+L.id+'#'+mv.w, lessonId:L.id, en:R.toKana(mv.w), zh:mv.zh, type:'word', pos:mv.pos, kmap:KANJI_MAP});
    JD.celebrate(ok?'good':'try');
    const betterHTML = better ? '<div class="eg jp-text" style="margin-top:8px">🌟 <b>地道說法</b>：'+R.toRubyHTML(JD.esc(better))+
      (betterZh?'<br><span style="color:var(--muted);font-size:.9rem">'+JD.esc(betterZh)+'</span>':'')+
      ' <button class="btn-voice" id="mkBetterVoice">🔊</button></div>' : '';
    $('#mkFb').innerHTML=
      '<div class="acc-badge '+(ok?'good':'bad')+'">'+(ok?'🎉 ':'💪 ')+JD.esc(tip||(ok?'好句子！':'再看看'))+'</div>'+
      (ok||!fix?'':'<div class="eg jp-text" style="margin-top:8px">可以這樣說：'+R.toRubyHTML(JD.esc(fix))+'</div>')+
      betterHTML+
      '<div style="margin-top:10px">'+(ok?'':'<span class="hint" style="display:block;margin-bottom:6px">改一改上面的句子，再按「檢查」試試！</span>')+
      '<button class="big-btn teal" onclick="mkNext()">下一個詞 →</button></div>';
    /* 發音鍵用 .onclick 綁定；日語示範句傳 R.toKana 避免漢字+注音讀兩遍 */
    const bv=$('#mkBetterVoice'); if(bv && better) bv.onclick=()=>JD.speak(R.toKana(better),false,LANG);
  }
  function mkSelfCheck(msg){
    $('#mkFb').innerHTML='<div class="acc-badge">'+JD.esc(msg)+'</div>'+
      '<p style="margin:10px 0 6px;font-size:.88rem;color:var(--muted)">自己讀一遍，覺得這個詞用對了嗎？</p>'+
      '<button class="big-btn teal" onclick="mkSelf(true)">✅ 用對了</button>'+
      '<button class="big-btn ghost" onclick="mkSelf(false)">🤔 沒把握</button>';
  }
  window.mkSelf=function(ok){ mkAfter(ok, '', ok?'自評通過！':'下次找大人一起看看'); };
  window.mkCheck=async function(){
    const v=mkWords[mk.i];
    const s=($('#mkInput')&&$('#mkInput').value||'').trim();
    if(!s){ $('#mkFb').innerHTML='<div class="acc-badge bad">先寫一句話（或按 🎤 用說的）</div>'; return; }
    /* 家長控制：造句最少詞數。日文沒空格，按「字數」折算（約每詞1.6字），不達標先擋下重寫 */
    const minW = JD.getMkMin ? JD.getMkMin() : 0;
    if(minW>0){ const need=Math.round(minW*1.6), got=s.replace(/\s/g,'').length;
      if(got<need){ $('#mkFb').innerHTML='<div class="acc-badge bad">句子太短了，家長設了<b>每句至少 '+minW+' 個詞</b>（約 '+need+' 字）。再多寫一點，讓句子更完整 💪</div>'; return; } }
    if(!window.JDGen || !JDGen.getKey()){ mkSelfCheck('沒設定 AI Key，這關改用自評'); return; }
    $('#mkFb').innerHTML='<div class="acc-badge">⏳ AI 老師看句子中…</div>';
    try{
      const r=await JDGen.judgeSentence('jp', mkPlain(v.w), s);
      mkAfter(r.ok, r.fix, r.tip, r.better, r.betterZh);
    }catch(e){ mkSelfCheck('AI 檢查沒成功（'+(e.message||e)+'），改用自評'); }
  };
  window.mkNext=function(){ if(mk.results[mk.i]==null) mk.results[mk.i]=false; mk.i++; pos('make', mk.results.filter(x=>x!=null).length, mkWords.length, mk.results.filter(Boolean).length); mkRender(); };  /* 跳過沒檢查=不算造對 */
  window.mkPrev=function(){ mk.i = Math.max(mk.i-1, 0); mkRender(); };
  mk.results = seedResults('make', mkWords.length, true, false);   /* 續做回填 */
  mk.i = resume('make', mkWords.length);
  mkRender();

  /* ========== 5.7 課後彩蛋：AI 用學過的詞寫小故事（泛讀甜點；快取進 localStorage 不重複花錢） ========== */
  function storyShow(box, st){
    box.innerHTML='<div class="card jp-text" style="text-align:left">'+
      '<b style="font-family:var(--font-head)">🎁 '+R.toRubyHTML(JD.esc(st.title))+'</b>'+
      '<button class="btn-voice" style="margin-left:8px" onclick="storySpeak()">🔊</button>'+
      '<p style="margin-top:8px;line-height:2">'+R.toRubyHTML(JD.esc(st.text))+'</p>'+
      '<p style="color:var(--muted);margin-top:6px;font-size:.9rem">'+JD.esc(st.zh)+'</p>'+
      '<button class="big-btn ghost" style="margin-top:8px" onclick="storyGen()">🔄 換一個故事</button></div>';
  }
  function storyUI(){
    const c=$('#celebrate'); if(!c || document.getElementById('storyBox')) return;
    const box=document.createElement('div'); box.id='storyBox'; box.style.marginTop='14px';
    const cached=localStorage.getItem('jingdu_story_'+L.id);
    let ok=false;
    if(cached){ try{ storyShow(box, JSON.parse(cached)); ok=true; }catch(e){} }
    if(!ok) box.innerHTML='<button class="big-btn mango" onclick="storyGen()">🎁 彩蛋：AI 用學過的詞寫個小故事</button>';
    c.appendChild(box);
  }
  window.storySpeak=function(){
    try{ const st=JSON.parse(localStorage.getItem('jingdu_story_'+L.id)||'{}'); if(st.text) JD.speak(R.toKana(st.text),false,LANG); }catch(e){}
  };
  window.storyGen=async function(){
    const box=document.getElementById('storyBox'); if(!box) return;
    if(!window.JDGen || !JDGen.getKey()){
      box.innerHTML='<div class="acc-badge bad">要先在「➕ 新增課文」頁設定智譜 API Key，才能生成小故事</div>'; return;
    }
    box.innerHTML='<div class="acc-badge">⏳ AI 正在寫小故事…</div>';
    try{
      const words=Array.from(new Set((L.vocab||[]).map(v=>String(v.w).replace(/\[[^\]]+\]/g,'')).concat(JDGen.knownWords('jp')))).slice(0,40);
      const st=await JDGen.storyFromWords('jp', words, null);
      localStorage.setItem('jingdu_story_'+L.id, JSON.stringify(st));
      localStorage.setItem('jingdu_updatedAt', String(Date.now()));
      if(window.JDSYNC) window.JDSYNC.schedule();
      storyShow(box, st);
    }catch(e){
      box.innerHTML='<div class="acc-badge bad">生成沒成功（'+JD.esc(e.message||String(e))+'）</div>'+
        '<button class="big-btn ghost" onclick="storyGen()" style="margin-top:8px">再試一次</button>';
    }
  };

  /* ========== 6 打卡 ========== */
  const SEC_LABEL={listen:'🎧 聽全文',read:'📖 逐句精讀',vocab:'🃏 生詞卡',grammar:'📝 語法點',build:'🧩 連詞成句',speak:'🗣️ 口語跟讀',quiz:'🎯 聽力題',recite:'🧠 背句挑戰',make:'🖊️ 造句挑戰'};
  function renderDone(){
    const p=JD.getProgress(L.id);
    const sp=JD.getSecPos(L.id);
    const keys=Object.keys(SEC_LABEL);
    const doneCnt=keys.filter(k=>p[k]).length;
    const pct=Math.round(doneCnt/keys.length*100);
    function frac(k){ if(p[k]) return 1; const s=sp[k]; return (s&&s.n)? Math.max(0,Math.min(1,(s.done||0)/s.n)) : 0; }
    const SCORE_VERB = {vocab:'讀對', build:'排對', speak:'讀對', quiz:'答對', recite:'背對', make:'造對'};
    const sc = JD.lessonScore(L.id);
    const scoreLine = sc.n
      ? '<li class="done-summary" style="flex-direction:column;align-items:stretch;gap:6px">'+
        '<div style="display:flex;justify-content:space-between;align-items:baseline">'+
        '<span>📊 本課總評分</span>'+
        '<span style="font-size:.85rem;color:var(--muted)">計分環節：生詞/連詞/跟讀/聽力/背句/造句</span></div>'+
        '<div style="display:flex;gap:18px;flex-wrap:wrap">'+
        '<span>完成度 <b style="font-size:1.3rem">'+sc.completion+'%</b> <small style="color:var(--muted)">('+sc.done+'/'+sc.n+' 題)</small></span>'+
        '<span>正確率 <b style="font-size:1.3rem;color:'+(sc.accuracy>=85?'var(--teal-deep)':sc.accuracy>=60?'var(--mango)':'var(--coral)')+'">'+sc.accuracy+'%</b> <small style="color:var(--muted)">(答對 '+sc.score+'/'+sc.done+')</small></span>'+
        '</div></li>'
      : '';
    $('#doneList').innerHTML=
      scoreLine +
      '<li class="done-summary"><span>本課完成 <b>'+doneCnt+'</b> / '+keys.length+'</span>'+
      '<div class="done-bar big"><i style="width:'+pct+'%"></i></div></li>'+
      keys.map(k=>{
        const s=sp[k]||{}; const w=Math.round(frac(k)*100);
        const verb=SCORE_VERB[k];
        let tag;
        if(!(s.done||0) && !p[k]) tag='未開始';
        else if(verb) tag = verb+' '+(s.score||0)+'/'+(s.n||s.done||0);
        else tag = p[k] ? '完成' : (s.done+'/'+s.n);
        return '<li class="done-item"><button class="done-row" onclick="switchTab(\''+k+'\')">'+
          '<span class="ck '+(p[k]?'done':'')+'">'+(p[k]?'✓':'')+'</span>'+
          '<span class="done-label">'+SEC_LABEL[k]+'</span>'+
          '<span class="done-frac">'+tag+'</span>'+
          '<div class="done-bar'+(p[k]?' on':'')+'"><i style="width:'+w+'%"></i></div>'+
          '<span class="done-go">›</span></button></li>';
      }).join('');
    const all=keys.every(k=>p[k]);
    if(all && !p.done) JD.markDone(L.id,'done');
    $('#celebrate').classList.toggle('show', all);
    if(all) storyUI();
    refreshDots();
    renderLessonNav();
  }
  refreshDots();

  /* ========== 7 上一課／下一課（同英語版邏輯，見 lesson.js 註解） ========== */
  function lessonSequence(){
    const reg = (window.JD_LESSONS_JP||[]).map(l=>({id:l.id, title:l.title, href:l.href}));
    const own = Object.values((window.JDGen && JDGen.allUserLessons()) || {})
      .filter(x=>x.lang==='jp')
      .sort((a,b)=>(a._meta?a._meta.created:0)-(b._meta?b._meta.created:0))
      .map(x=>({id:x.id, title:x.title||'未命名', href:'lessons/view.html?id='+encodeURIComponent(x.id)}));
    return reg.concat(own);
  }
  function renderLessonNav(){
    const box=$('#lessonNav'); if(!box) return;
    const seq=lessonSequence();
    const idx=seq.findIndex(x=>x.id===L.id);
    if(idx<0){ box.innerHTML=''; return; }
    const prev = idx>0 ? seq[idx-1] : null;
    const next = idx<seq.length-1 ? seq[idx+1] : null;
    box.innerHTML =
      (prev ? '<a class="big-btn ghost" style="flex:1;text-align:center" href="../'+prev.href+'">← '+JD.esc(prev.title)+'</a>' : '')+
      (next ? '<a class="big-btn teal" style="flex:1;text-align:center" href="../'+next.href+'">下一課：'+JD.esc(next.title)+' →</a>'
             : '<span class="hint" style="margin:0">🎉 已經是最後一課，回目錄看看有沒有新課吧</span>');
  }
  renderLessonNav();

  /* 上一句/下一句：固定放在各環節「進度點」正下方，不論做到哪個階段位置都不變，不用往下滑找。
     跟讀(speak)的上一句/下一句改放「聽一遍」兩側，不用這個。 */
  function injectSecNav(pillsSel, prevCall, nextCall){
    const p = $(pillsSel); if(!p || p.nextElementSibling && p.nextElementSibling.classList.contains('sec-nav')) return;
    const nav = document.createElement('div');
    nav.className = 'sec-nav';
    nav.innerHTML = '<button class="big-btn ghost" onclick="'+prevCall+'">← 上一句</button><button class="big-btn ghost" onclick="'+nextCall+'">下一句 →</button>';
    p.insertAdjacentElement('afterend', nav);
  }
  injectSecNav('#rcPills', 'rcNav(-1)', 'rcNav(1)');
  injectSecNav('#bdPills', 'bdNav(-1)', 'bdNav(1)');
  injectSecNav('#mkPills', 'mkPrev()', 'mkNext()');

  /* ?tab= 深連結：今日學習流可直達某環節 */
  const t0 = new URLSearchParams(location.search).get('tab');
  if(t0 && document.getElementById('p-'+t0)) switchTab(t0);
})();
