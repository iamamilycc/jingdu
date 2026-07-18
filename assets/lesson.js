/* 精讀 jingdu — 課文頁渲染引擎（讀全局 LESSON 對象；未來每課只需準備數據） */
(function(){
  'use strict';
  const L = window.LESSON;
  if(!L){ return; }
  const $ = s=>document.querySelector(s), $$ = s=>Array.from(document.querySelectorAll(s));

  document.title = L.id.toUpperCase()+' · '+L.title+' · 精讀';
  $('#hTitle').textContent = L.badge+' · '+L.title;

  /* ========== Tab 切換 ========== */
  window.switchTab = function(name){
    $$('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.t===name));
    $$('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='p-'+name));
    window.scrollTo({top:0});
    /* 分頁條在手機放不下：把當前分頁滾到可見（置中），用戶永遠看得到自己在哪 */
    const act=document.querySelector('.tab-btn.active');
    if(act && act.scrollIntoView) act.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
    if(name==='done') renderDone();
    else resumeScroll(name);
  };
  /* 卡片式環節(逐句/生詞)續做：滾到第一個還沒做的卡片 */
  function resumeScroll(name){
    if(name==='read'){ const el=$$('#readList .sent')[resume('read', L.sentences.length)]; if(el) setTimeout(()=>el.scrollIntoView({block:'center'}),60); }
    if(name==='vocab'){ const el=$$('#vocabGrid .vcard')[resume('vocab', (L.vocab||[]).length)]; if(el) setTimeout(()=>el.scrollIntoView({block:'center'}),60); }
  }

  function refreshDots(){
    const p = JD.getProgress(L.id);
    $$('.tab-btn .dot').forEach(d=>d.classList.toggle('done', !!p[d.dataset.s]));
  }
  function done(sec){ JD.markDone(L.id, sec); refreshDots(); }
  /* 細粒度進度：已完成項數/總項數(+可選答對數) → 打卡進度條/得分 + 續做定位 */
  function pos(sec, doneCnt, n, score){ JD.setSecPos(L.id, sec, doneCnt, n, score); }
  function resume(sec, n){ return JD.resumeIdx(L.id, sec, n); }

  /* ========== 0 聽全文（連播 + 高亮 + 盲聽 + 循環） ========== */
  const lt = { playing:false, idx:-1, slow:false, blind:false, loop:false };
  const ltBox = $('#ltText');
  if(ltBox){
    ltBox.innerHTML = L.sentences.map((s,i)=>'<span class="lt-sent" id="lt'+i+'">'+(s.speaker?'<b class="spk">'+JD.esc(s.speaker)+':</b> ':'')+JD.esc(s.en)+'</span>').join(' ');
    insertZhCard(ltBox, L.sentences);
  }
  function ltHighlight(i){
    $$('.lt-sent').forEach((el,k)=>el.classList.toggle('now', k===i));
    $$('.lt-zh').forEach((el,k)=>el.classList.toggle('now', k===i));
    const el = document.getElementById('lt'+i);
    if(el) el.scrollIntoView({block:'center', behavior:'smooth'});
  }
  function ltPlayFrom(i){
    if(!lt.playing) return;
    if(i >= L.sentences.length){
      done('listen');
      if(lt.loop){ ltPlayFrom(0); return; }
      ltStopUI(); return;
    }
    lt.idx = i; ltHighlight(i);
    const text = L.sentences[i].en;
    const u = new SpeechSynthesisUtterance(text);
    u.lang='en-US'; u.rate = lt.slow ? 0.6 : 0.9;
    const v = JD.pickVoice('en-US'); if(v) u.voice = v; /* 不指定聲音時系統可能用預設/中文聲讀英文 */
    let advanced=false;
    const go=()=>{ if(advanced) return; advanced=true; clearTimeout(watchdog); setTimeout(()=>ltPlayFrom(i+1),300); };
    /* onend/onerror 都推進：單句出錯不中斷整篇（iOS 上 onerror 常誤觸發） */
    u.onend=go; u.onerror=go;
    /* 看門狗：iOS Safari 的 speechSynthesis 會靜默卡死不觸發 onend，逾時強制推進保證讀完整篇 */
    const est = text.length * (lt.slow?90:65) + 4000;
    const watchdog=setTimeout(()=>{ try{ speechSynthesis.cancel(); }catch(e){} go(); }, est);
    try{ speechSynthesis.speak(u); }catch(e){ go(); }
  }
  function ltStopUI(){
    lt.playing=false; speechSynthesis.cancel();
    $$('.lt-sent').forEach(el=>el.classList.remove('now'));
    const b=$('#ltPlayBtn'); if(b){ b.textContent='▶️ 播放全文'; b.classList.remove('rec'); b.classList.add('teal'); }
  }
  window.ltPlay = function(){
    if(lt.playing){ ltStopUI(); return; }
    lt.playing=true; speechSynthesis.cancel();
    const b=$('#ltPlayBtn'); b.textContent='⏹️ 停止'; b.classList.remove('teal'); b.classList.add('rec');
    ltPlayFrom(0);
  };
  function ltBtnState(btn,on){ btn.classList.toggle('mango',on); btn.classList.toggle('ghost',!on); }
  /* 全文中文翻譯卡：插在全文下方，播放時對應句一起高亮；小朋友看不懂英文可對照 */
  function insertZhCard(box, sentences){
    const card=document.createElement('div'); card.className='card'; card.id='ltZhCard';
    card.innerHTML='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
      '<b style="font-family:var(--font-head);color:var(--teal-deep)">🀄 全文中文翻譯</b>'+
      '<button class="big-btn ghost" style="padding:5px 12px;font-size:.82rem;margin:0 0 0 auto" onclick="ltToggleZh(this)">隱藏</button></div>'+
      '<div id="ltZhBody">'+sentences.map((s,i)=>'<div class="lt-zh" id="ltzh'+i+'"><span class="lt-zh-idx">'+(i+1)+'</span><span>'+JD.esc(s.zh||'')+'</span></div>').join('')+'</div>';
    box.parentNode.insertBefore(card, box.nextSibling);
  }
  window.ltToggleZh=function(btn){ const body=$('#ltZhBody'); const hide=body.style.display!=='none'; body.style.display=hide?'none':'block'; btn.textContent=hide?'顯示':'隱藏'; };
  window.ltToggleSpeed = function(btn){ lt.slow=!lt.slow; btn.textContent='🐢 慢速：'+(lt.slow?'開':'關'); ltBtnState(btn,lt.slow); };
  window.ltToggleBlind = function(btn){
    lt.blind=!lt.blind; btn.textContent='🙈 盲聽：'+(lt.blind?'開':'關'); ltBtnState(btn,lt.blind);
    if(ltBox) ltBox.classList.toggle('blind', lt.blind);
  };
  window.ltToggleLoop = function(btn){ lt.loop=!lt.loop; btn.textContent='🔁 循環：'+(lt.loop?'開':'關'); ltBtnState(btn,lt.loop); };

  /* ========== 1 逐句精讀 ========== */
  const readBox = $('#readList');
  L.sentences.forEach((s,i)=>{
    const div = document.createElement('div');
    div.className='card sent';
    div.innerHTML =
      '<div class="en"><span class="idx">'+(i+1)+'</span><span style="flex:1">'+(s.speaker?'<b class="spk">'+JD.esc(s.speaker)+':</b> ':'')+JD.esc(s.en)+'</span>'+
      '<button class="btn-voice" aria-label="播放">🔊</button>'+
      '<button class="btn-voice slow" aria-label="慢速">慢</button></div>'+
      '<div class="body"><div class="zh">🀄 '+JD.esc(s.zh)+'</div>'+
      '<div class="ana">'+s.ana+'</div></div>';
    div.querySelector('.btn-voice').onclick = e=>{ e.stopPropagation(); JD.speak(s.en,false); };
    div.querySelector('.btn-voice.slow').onclick = e=>{ e.stopPropagation(); JD.speak(s.en,true); };
    div.onclick = ()=>{ div.classList.toggle('open'); checkReadDone(); };
    readBox.appendChild(div);
  });
  let opened = new Set();
  function checkReadDone(){
    $$('#readList .sent').forEach((d,i)=>{ if(d.classList.contains('open')) opened.add(i); });
    pos('read', opened.size, L.sentences.length);
    if(opened.size >= L.sentences.length) done('read');
  }

  /* ========== 2 生詞卡（look-cover-write-check：正面看單詞 → 翻面拼寫 → 對✓錯入錯題本） ========== */
  const vg = $('#vocabGrid');
  const judged = new Set();
  const vright = new Set();   /* 拼對的卡片，供打卡得分 */
  function maskWord(text, w){
    /* 例句裡把單詞挖空，避免洩露拼寫（含首字母大寫變形） */
    return text.replace(new RegExp('\\b'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','gi'), '____');
  }
  L.vocab.forEach((v,i)=>{
    const c = document.createElement('div');
    c.className='vcard';
    c.innerHTML='<div class="inner"><div class="vface front"><div class="w">'+JD.esc(v.w)+'</div>'+
      '<div class="ipa">'+JD.esc(v.ipa)+'</div><div style="margin-top:8px"><button class="btn-voice">🔊</button></div>'+
      '<div class="hint" style="margin:8px 0 0;font-size:.72rem">記住拼寫，翻面默寫！</div></div>'+
      '<div class="vface back"><div class="pos">'+JD.esc(v.pos)+' · '+JD.esc(v.zh)+'</div>'+
      '<div class="eg">'+JD.esc(maskWord(v.eg, v.w))+'</div>'+
      '<div class="vspell"><input type="text" placeholder="拼出這個單詞" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">'+
      '<button class="vbtn yes">檢查</button></div>'+
      '<div class="vfb"></div></div></div>';
    c.querySelector('.btn-voice').onclick = e=>{ e.stopPropagation(); JD.speak(v.w,false); };
    const input = c.querySelector('.vspell input');
    const fb = c.querySelector('.vfb');
    function judge(){
      const typed = (input.value||'').trim().toLowerCase().replace(/\s+/g,'');
      if(!typed){ input.focus(); return; }
      const ok = typed === v.w.toLowerCase().replace(/\s+/g,'');
      judged.add(i);
      if(ok) vright.add(i);   /* 取最好：拼對過就算會，重做拼錯不抹掉 */
      pos('vocab', judged.size, L.vocab.length, vright.size);
      c.classList.remove('known','unknown');
      c.classList.add(ok?'known':'unknown');
      if(ok){
        fb.innerHTML='<span class="vok">✓ 拼對了！</span>';
        JD.speak(v.w,false);
        setTimeout(()=>c.classList.remove('flip'), 900);
        JD.celebrate('good');
      }else{
        fb.innerHTML='<span class="vbad">✗ 正確拼寫：<b>'+JD.esc(v.w)+'</b></span>';
        JD.addError({id:'w:'+L.id+'#'+v.w, lessonId:L.id, en:v.w, zh:v.zh, type:'word', pos:v.pos});
        JD.celebrate('try');
      }
      if(judged.size >= L.vocab.length) done('vocab');
    }
    c.querySelector('.vbtn.yes').onclick = e=>{ e.stopPropagation(); judge(); };
    input.addEventListener('click', e=>e.stopPropagation());
    input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); judge(); } });
    c.onclick = ()=>{ c.classList.toggle('flip'); if(c.classList.contains('flip')) setTimeout(()=>input.focus(),450); };
    vg.appendChild(c);
  });

  /* ========== 3 語法點 ========== */
  const gb = $('#grammarBox');
  L.grammar.forEach(g=>{
    const d=document.createElement('div');
    d.className='card gcard stitch';
    d.innerHTML='<h3>'+JD.esc(g.t)+'</h3>'+g.body;
    gb.appendChild(d);
  });
  $('#grammarDoneBtn').onclick = ()=>{ done('grammar'); $('#grammarDoneBtn').textContent='✓ 已讀完'; };

  /* ========== 3.5 連詞成句（把打亂的單詞排成正確句子） ========== */
  function bdTokens(s){
    return s.replace(/[“”‘’]/g,"'").replace(/^['"\s]+/,'').replace(/[.!?,'"\s]+$/,'').trim().split(/\s+/).filter(Boolean);
  }
  const bdItems=[];
  L.sentences.forEach((s,i)=>{ const w=bdTokens(s.en); if(w.length>=3 && w.length<=8) bdItems.push({idx:i, en:s.en, zh:s.zh, words:w}); });
  while(bdItems.length>8) bdItems.pop();
  const bd={ i:0, placed:[], pool:[], results:[] };
  function bdShuffle(a){ a=a.slice(); for(let k=a.length-1;k>0;k--){ const j=Math.floor(Math.random()*(k+1)), t=a[k]; a[k]=a[j]; a[j]=t; } return a; }
  function bdPills(){
    const el=$('#bdPills'); if(!el) return;
    el.innerHTML=bdItems.map((_,k)=>{ const st=bd.results[k]==null?'':(bd.results[k]?'ok':'bad'); return '<span class="pill '+(k===bd.i?'now':'')+' '+st+'"></span>'; }).join('');
  }
  function bdLoad(){
    if(!bdItems.length) return;
    const it=bdItems[bd.i]; bd.placed=[];
    let sh=bdShuffle(it.words);
    if(sh.join(' ')===it.words.join(' ') && it.words.length>1){ sh.push(sh.shift()); }
    bd.pool=sh.map((w,k)=>({w:w,cid:k}));
    bdRender();
  }
  function bdChip(c, where){ return '<button class="bd-chip" onclick="'+(where==='pool'?'bdPlace':'bdUnplace')+'('+c.cid+')">'+JD.esc(c.w)+'</button>'; }
  function bdRender(fb){
    bdPills();
    pos('build', bd.results.filter(x=>x!=null).length, bdItems.length, bd.results.filter(Boolean).length);
    const box=$('#buildBox'); if(!box) return;
    if(bd.i>=bdItems.length){
      const right=bd.results.filter(Boolean).length;
      box.innerHTML='<div class="stage"><div style="font-size:2.4rem">🧩</div>'+
        '<div class="acc-badge '+(right>=bdItems.length*0.8?'good':'bad')+'">排對 '+right+' / '+bdItems.length+' 句</div>'+
        '<div style="margin-top:10px"><button class="big-btn ghost" onclick="bdNav(-1)">← 上一句</button>'+
        '<button class="big-btn ghost" onclick="bdRestart()">再玩一遍</button></div></div>';
      return;
    }
    const it=bdItems[bd.i];
    box.innerHTML='<div class="stage">'+
      '<div class="hint" style="margin:0 0 10px">🀄 '+JD.esc(it.zh)+'</div>'+
      '<div class="bd-answer" id="bdAnswer">'+(bd.placed.length?bd.placed.map(c=>bdChip(c,'ans')).join(''):'<span class="bd-ph">點下面的單詞，按正確順序排到這裡</span>')+'</div>'+
      '<div class="bd-pool">'+bd.pool.map(c=>bdChip(c,'pool')).join('')+'</div>'+
      '<div style="margin-top:14px">'+
        '<button class="big-btn teal" onclick="bdPlay()">🔊 聽一遍</button>'+
        '<button class="big-btn mango" onclick="bdCheck()">✓ 檢查</button>'+
        '<button class="big-btn ghost" onclick="bdReset()">↺ 清空</button>'+
        '<button class="big-btn ghost" onclick="bdReveal()">看答案</button></div>'+
      '<div id="bdFb" style="margin-top:12px">'+(fb||'')+'</div>'+
      '<div style="margin-top:8px">'+
        (bd.i>0?'<button class="big-btn ghost" onclick="bdNav(-1)">← 上一句</button>':'')+
        '<button class="big-btn ghost" onclick="bdNav(1)">下一句 →</button></div></div>';
  }
  window.bdPlace=function(cid){ const k=bd.pool.findIndex(c=>c.cid===cid); if(k<0)return; bd.placed.push(bd.pool[k]); bd.pool.splice(k,1); bdRender(); };
  window.bdUnplace=function(cid){ const k=bd.placed.findIndex(c=>c.cid===cid); if(k<0)return; bd.pool.push(bd.placed[k]); bd.placed.splice(k,1); bdRender(); };
  window.bdReset=function(){ bd.pool=bd.pool.concat(bd.placed); bd.placed=[]; bdRender(); };
  window.bdPlay=function(){ JD.speak(bdItems[bd.i].en,false); };
  window.bdCheck=function(){
    const it=bdItems[bd.i];
    if(bd.placed.length<it.words.length){ bdRender('<div class="acc-badge bad">還有單詞沒排上去哦</div>'); return; }
    const got=bd.placed.map(c=>c.w).join(' ').toLowerCase(), want=it.words.join(' ').toLowerCase();
    if(got===want){
      bd.results[bd.i]=true; JD.speak(it.en,false);
      bdRender('<div class="acc-badge good">🎉 排對了！<br>'+JD.esc(it.en)+'</div>'); bdMaybeDone(); JD.celebrate('good');
    }else{
      bdRender('<div class="acc-badge bad">順序還不對，再試試～（點已排的單詞可移回去）</div>'); JD.celebrate('try');
    }
  };
  window.bdReveal=function(){
    const it=bdItems[bd.i]; if(bd.results[bd.i]!==true) bd.results[bd.i]=false;  /* 解對過就保留對，看答案不覆蓋已對 */
    JD.addError({id:L.id+'#'+it.idx, lessonId:L.id, en:it.en, zh:it.zh});
    bdRender('<div class="acc-badge bad">正確順序是：<br>'+JD.esc(it.en)+'<br><span style="font-size:.8rem">（已放進錯題本，之後復盤）</span></div>'); bdMaybeDone();
  };
  window.bdNav=function(d){ bd.i=Math.min(Math.max(bd.i+(d||1),0), bdItems.length); if(bd.i>=bdItems.length) bdRender(); else bdLoad(); };
  window.bdRestart=function(){ bd.i=0; bd.results=[]; bdLoad(); };
  function bdMaybeDone(){ if(bd.results.filter(x=>x!=null).length>=bdItems.length) done('build'); }
  if(bdItems.length){ bd.i = resume('build', bdItems.length); bdLoad(); }
  else { const bb=$('#buildBox'); if(bb) bb.innerHTML='<p class="empty">本課句子較長，這一課沒有連詞成句練習～</p>'; done('build'); }

  /* ========== 4 口語跟讀 ========== */
  const spk = { i:0, results:[] };
  function spkRender(){
    const s = L.sentences[spk.i];
    $('#spkPills').innerHTML = L.sentences.map((_,k)=>
      '<span class="pill '+(k===spk.i?'now':(spk.results[k]==null?'':(spk.results[k]>=JD.PASS?'ok':'bad')))+'"></span>').join('');
    $('#spkTarget').innerHTML = JD.esc(s.en);
    $('#spkResult').innerHTML='';
    $('#spkHeard').textContent='';
  }
  window.spkPlay = ()=>JD.speak(L.sentences[spk.i].en,false);
  window.spkPlaySlow = ()=>JD.speak(L.sentences[spk.i].en,true);
  window.spkRec = function(){
    const i = spk.i, s = L.sentences[i];
    startRec($('#spkRecBtn'), s, '#spkResult', '#spkHeard', acc=>{
      spk.results[i]=Math.max(spk.results[i]||0, acc); spkRender0nly();  /* 取最高準確率 */
      pos('speak', spk.results.filter(x=>x!=null).length, L.sentences.length, spk.results.filter(x=>x!=null&&x>=JD.PASS).length);
      JD.celebrate(JD.praiseKind({acc:acc}));
      /* 跟讀不達標也進錯題本（與背句同 id，自動合併） */
      if(acc < JD.PASS) JD.addError({id:L.id+'#'+i, lessonId:L.id, en:s.en, zh:s.zh});
    });
  };
  function spkRender0nly(){ /* 只刷 pills，保留結果展示 */
    $('#spkPills').innerHTML = L.sentences.map((_,k)=>
      '<span class="pill '+(k===spk.i?'now':'')+' '+(spk.results[k]==null?'':(spk.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
  }
  window.spkNext = function(d){
    spk.i = Math.min(Math.max(spk.i+d,0), L.sentences.length-1);
    spkRender();
    if(spk.results.filter(x=>x!=null).length >= L.sentences.length) done('speak');
  };
  JD.injectMicTip('#p-speak');
  spk.i = resume('speak', L.sentences.length);
  spkRender();

  /* ========== 4.5 聽力題（盲聽：句子先模糊，聽3次才能「看一眼」；看過再答對＝算錯不計分） ========== */
  const qz = { i:0, score:0, answeredCnt:0, listens:0, revealed:false };
  function qzPlaySeq(idxs, k){
    k = k||0; if(k>=idxs.length) return;
    const u = new SpeechSynthesisUtterance(L.sentences[idxs[k]].en);
    u.lang='en-US'; u.rate=0.9;
    const v = JD.pickVoice('en-US'); if(v) u.voice = v;
    u.onend = ()=>setTimeout(()=>qzPlaySeq(idxs,k+1), 300);
    if(k===0) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  function qzBlindText(it){ return it.play.map(i=>(L.sentences[i]||{}).en||'').join(' '); }
  function qzRender(autoplay){
    const box = $('#quizBox'); if(!box) return;
    if(qz.i >= L.listening.length){
      box.innerHTML='<div class="stage"><div style="font-size:2.6rem">'+(qz.score===L.listening.length?'🏆':'🎯')+'</div>'+
        '<div class="acc-badge '+(qz.score>=L.listening.length*0.8?'good':'bad')+'">答對 '+qz.score+' / '+L.listening.length+' 題</div>'+
        '<div style="margin-top:10px"><button class="big-btn ghost" onclick="qzRestart()">再做一遍</button></div></div>';
      done('quiz'); return;
    }
    qz.listens=0; qz.revealed=false;   /* 新題重置盲聽狀態 */
    const it = L.listening[qz.i];
    box.innerHTML='<div class="stage">'+
      '<div style="font-family:var(--font-head);color:var(--muted);font-size:.9rem;margin-bottom:8px">第 '+(qz.i+1)+' / '+L.listening.length+' 題</div>'+
      '<div id="qzBlind" class="qz-blind">'+JD.esc(qzBlindText(it))+'</div>'+
      '<button class="big-btn teal" onclick="qzPlay()">🔊 播放錄音</button>'+
      '<div id="qzRevealWrap" style="display:none;margin-top:6px"><button class="big-btn ghost" onclick="qzReveal()">😳 聽不懂，看一眼（這題會算錯）</button></div>'+
      '<div style="font-weight:700;font-size:1.05rem;margin:14px 0 10px">'+JD.esc(it.q)+'</div>'+
      '<div id="qzOpts">'+it.opts.map((o,k)=>'<button class="qz-opt" data-k="'+k+'">'+String.fromCharCode(65+k)+'. '+JD.esc(String(o).replace(/^[A-DＡ-Ｄ][.、．)）]\s*/,''))+'</button>').join('')+'</div>'+
      '<div id="qzFb" style="margin-top:10px"></div></div>';
    $$('#qzOpts .qz-opt').forEach(b=>b.onclick=()=>qzAnswer(parseInt(b.dataset.k)));
    /* 頁面載入時不自動播音（默認頁是聽全文，且無用戶手勢會被瀏覽器攔截）；
       點「下一題/再做一遍」屬用戶操作，此時自動連播 */
    if(autoplay){ qz.listens++; qzPlaySeq(it.play); }
  }
  window.qzPlay = function(){
    qz.listens++;
    qzPlaySeq(L.listening[qz.i].play);
    if(qz.listens>=3 && !qz.revealed){ const w=$('#qzRevealWrap'); if(w) w.style.display='block'; }
  };
  window.qzReveal = function(){
    qz.revealed=true;
    const el=$('#qzBlind'); if(el) el.classList.remove('qz-blind');
    const w=$('#qzRevealWrap'); if(w) w.style.display='none';
  };
  function qzAnswer(k){
    const it = L.listening[qz.i];
    $$('#qzOpts .qz-opt').forEach((b,j)=>{
      b.disabled=true;
      if(j===it.ans) b.classList.add('right');
      else if(j===k) b.classList.add('wrong');
    });
    const correct = (k===it.ans);
    const s = L.sentences[it.srcIdx];
    if(correct && !qz.revealed){
      qz.score++; $('#qzFb').innerHTML='<div class="acc-badge good">🎉 答對了！</div>'; JD.celebrate('great');
    }else if(correct && qz.revealed){
      /* 看過答案才對 → 算錯，不計分，進錯題本 */
      JD.addError({id:L.id+'#'+it.srcIdx, lessonId:L.id, en:s.en, zh:s.zh});
      $('#qzFb').innerHTML='<div class="acc-badge bad">答對了，但看過答案這題算錯——多聽幾次，下次不看就能懂 💪</div>'; JD.celebrate('try');
    }else{
      JD.addError({id:L.id+'#'+it.srcIdx, lessonId:L.id, en:s.en, zh:s.zh});
      $('#qzFb').innerHTML='<div class="acc-badge bad">再聽聽～正確答案是 '+String.fromCharCode(65+it.ans)+'</div>'; JD.celebrate('try');
    }
    const el=$('#qzBlind'); if(el) el.classList.remove('qz-blind');   /* 答完顯示原句讓孩子核對 */
    $('#qzFb').innerHTML += '<div style="margin-top:8px"><button class="big-btn teal" onclick="qzNext()">下一題 →</button></div>';
  }
  window.qzNext = function(){ qz.i++; pos('quiz', qz.i, L.listening.length, qz.score); qzRender(true); };
  window.qzRestart = function(){ qz.i=0; qz.score=0; qzRender(true); };
  if(L.listening){ qz.i = resume('quiz', L.listening.length); qzRender(false); }

  /* ========== 5 背句挑戰 ========== */
  const rc = { i:0, timer:null, results:[] };
  /* 看題秒數（5/10/15，記在本機，英日共用）*/
  function rcSec(){ const v=parseInt(localStorage.getItem('jingdu_recite_sec'),10); return (v===5||v===10||v===15)?v:10; }
  window.rcSetSec = function(v){ localStorage.setItem('jingdu_recite_sec', String(v)); rcRender('idle'); };
  function rcRender(stage){ /* stage: idle|show|masked|result */
    const s = L.sentences[rc.i];
    $('#rcPills').innerHTML = L.sentences.map((_,k)=>
      '<span class="pill '+(k===rc.i?'now':'')+' '+(rc.results[k]==null?'':(rc.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
    const tgt = $('#rcTarget'), ring=$('#rcRing'), btns=$('#rcBtns');
    if(stage==='idle'){
      ring.style.display='none';
      const sec=rcSec();
      tgt.innerHTML='<div class="mask-box">第 '+(rc.i+1)+' 句 · 準備好了就開始<br>先看幾秒，句子會蓋住，開口把它背出來！</div>';
      const seg='<div class="rc-secsel">看幾秒：'+[5,10,15].map(n=>'<button class="rc-secbtn'+(n===sec?' on':'')+'" onclick="rcSetSec('+n+')">'+n+'秒</button>').join('')+'</div>';
      btns.innerHTML=seg+
        '<button class="big-btn mango" onclick="rcStart()">👀 開始看題（'+sec+' 秒）</button>'+
        '<button class="big-btn ghost" onclick="rcMask()">🎤 不看，直接背</button>'+
        '<div><button class="big-btn ghost" onclick="rcNav(-1)">上一句</button>'+
        '<button class="big-btn ghost" onclick="rcNav(1)">下一句</button></div>';
      $('#rcResult').innerHTML=''; $('#rcHeard').textContent='';
    }
  }
  window.rcNav = function(d){
    clearInterval(rc.timer);
    rc.i = Math.min(Math.max(rc.i+d,0), L.sentences.length-1);
    rcRender('idle');
  };
  window.rcStart = function(){
    const s = L.sentences[rc.i];
    const tgt=$('#rcTarget'), ring=$('#rcRing'), btns=$('#rcBtns');
    tgt.innerHTML = JD.esc(s.en);
    JD.speak(s.en,false);
    ring.style.display='flex';
    btns.innerHTML='<button class="big-btn ghost" onclick="rcSkipPeek()">看夠了，開始背 →</button>';
    const total=rcSec(); let left=total;
    const C = 2*Math.PI*30;
    ring.innerHTML='<svg width="66" height="66"><circle class="bg" cx="33" cy="33" r="30"/>'+
      '<circle class="fg" cx="33" cy="33" r="30" stroke-dasharray="'+C+'" stroke-dashoffset="0"/></svg><span id="rcSec">'+total+'</span>';
    const fg = ring.querySelector('.fg');
    rc.timer = setInterval(()=>{
      left--;
      $('#rcSec').textContent=left;
      fg.style.strokeDashoffset = C*(total-left)/total;
      if(left<=0){ clearInterval(rc.timer); rcMask(); }
    },1000);
  };
  window.rcSkipPeek = function(){ clearInterval(rc.timer); rcMask(); };
  window.rcMask = rcMask;
  function rcMask(){
    $('#rcRing').style.display='none';
    $('#rcTarget').innerHTML='<div class="mask-box">🙈 句子蓋住了！<br>按下麥克風，大聲把它背出來<br><small style="color:var(--muted)">背完停一下會自動打分，不用再按</small></div>';
    $('#rcBtns').innerHTML='<button id="rcRecBtn" class="big-btn rec" onclick="rcRec()">🎙️ 開始背</button>'+
      '<button class="big-btn ghost" onclick="rcPeek()">😳 忘了，看一眼</button>';
  }
  window.rcPeek = function(){ /* 看答案 = 本句計 0 分進錯題本 */
    const s = L.sentences[rc.i];
    $('#rcTarget').innerHTML = JD.esc(s.en);
    rcFinish(0, null);
  };
  window.rcRec = function(){
    startRec($('#rcRecBtn'), L.sentences[rc.i], '#rcResult', '#rcHeard', acc=>rcFinish(acc,true));
  };
  function rcFinish(acc, showedResult){
    const s = L.sentences[rc.i];
    rc.results[rc.i]=Math.max(rc.results[rc.i]||0, acc);  /* 取最高準確率；看答案的0分不會抹掉已有好分 */
    pos('recite', rc.results.filter(x=>x!=null).length, L.sentences.length, rc.results.filter(x=>x!=null&&x>=JD.PASS).length);
    if(showedResult) JD.celebrate(JD.praiseKind({acc:acc}));  /* 只在真背(非看答案)時給鼓勵 */
    if(acc < JD.PASS){
      JD.addError({id:L.id+'#'+rc.i, lessonId:L.id, en:s.en, zh:s.zh});
    }
    if(!showedResult){
      $('#rcResult').innerHTML='<div class="acc-badge bad">進錯題本，等會再戰 💪</div>';
    }
    $('#rcTarget').innerHTML = JD.esc(s.en);
    $('#rcBtns').innerHTML='<button class="big-btn teal" onclick="rcNav(1)">下一句 →</button>'+
      '<div style="margin-top:8px"><button class="big-btn mango" onclick="rcStart()">🔁 再看一遍</button>'+
      '<button class="big-btn ghost" onclick="rcMask()">🎤 直接背，不看</button></div>';
    $('#rcPills').innerHTML = L.sentences.map((_,k)=>
      '<span class="pill '+(k===rc.i?'now':'')+' '+(rc.results[k]==null?'':(rc.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
    if(rc.results.filter(x=>x!=null).length>=L.sentences.length) done('recite');
  }
  window.rcRender2 = ()=>rcRender('idle');
  rc.i = resume('recite', L.sentences.length);
  rcRender('idle');

  /* ========== 共用：錄音 + 比對展示 ========== */
  let recBusy = false; /* 聆聽中鎖住，防止連按產生 aborted */
  function startRec(btn, sent, resultSel, heardSel, onAcc){
    if(recBusy){ return; }
    if(!JD.recSupported()){
      /* 降級：自評 */
      $(resultSel).innerHTML =
        '<p style="margin-bottom:8px">此設備不支援語音識別（iPad 需 iOS 14.5+ 並在設定開啟 Siri 與聽寫）。改用自評：</p>'+
        '<button class="big-btn teal" onclick="this.parentNode._ok(100)">✅ 我背對了</button>'+
        '<button class="big-btn ghost" onclick="this.parentNode._ok(0)">❌ 沒背對</button>';
      $(resultSel)._ok = onAcc;
      return;
    }
    recBusy = true;
    if(btn){ btn.disabled=true; btn.classList.add('listening'); btn.textContent='👂 正在聽…'; }
    const rec = JD.listen((text, err)=>{
      recBusy = false;
      if(btn){ btn.disabled=false; btn.classList.remove('listening'); btn.textContent='🎙️ 再試一次'; }
      if(err && !text){
        const msg = err==='not-allowed' ? '麥克風權限被拒絕：請在 設定→Safari→麥克風 允許'
                  : err==='silence' ? '沒聽到聲音，再大聲一點試試'
                  : err==='timeout' ? '等了好久沒聽清，再按一次試試'
                  : err==='aborted' ? '剛剛還在聽呢～說完停頓一下會自動結束，不用重複按'
                  : '識別出錯（'+err+'），再試一次';
        $(resultSel).innerHTML='<div class="acc-badge bad">'+msg+'</div>';
        return;
      }
      const r = JD.compare(sent.en, text);
      $(resultSel).innerHTML =
        '<div class="result-words">'+r.tokens.map(t=>'<span class="rw '+({ok:'ok',miss:'miss',bad:'bad'}[t.st])+'">'+JD.esc(t.w)+'</span>').join('')+'</div>'+
        '<div class="acc-badge '+(r.accuracy>=JD.PASS?'good':'bad')+'">'+(r.accuracy>=JD.PASS?'🎉':'💪')+' 準確率 '+r.accuracy+'%</div>';
      $(heardSel).textContent = '你說的是：'+text;
      onAcc(r.accuracy);
    });
    /* 說完主動點「我說完了」立即打分，不必等軟件盲目檢測靜音（那才是慢幾秒的根源） */
    $(resultSel).innerHTML='<div class="acc-badge">👂 開始讀吧！讀完就點「我說完了」馬上打分</div>'+
      '<div style="margin-top:8px"><button class="big-btn teal recdone">✅ 我說完了</button></div>';
    const _db=$(resultSel).querySelector('.recdone');
    if(_db) _db.onclick=()=>{ _db.disabled=true; _db.textContent='⏳ 打分中…'; try{ rec && rec.stop(); }catch(e){} };
  }

  /* ========== 5.6 造句挑戰（用本課生詞說自己的話；AI 老師判，無 key/出錯走自評兜底） ========== */
  /* 用上本課全部生詞（判分成本極低），一次做不完可續做 */
  const mkWords = (L.vocab||[]).slice();
  const mk = { i:0, results:[] };
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
      '<div class="target" style="margin-top:6px"><b>'+JD.esc(v.w)+'</b><span style="color:var(--muted);font-size:.92rem;margin-left:10px">'+JD.esc(v.zh||'')+'</span>'+
      ' <button class="btn-voice" onclick="JD.speak('+JSON.stringify(v.w)+',false)">🔊</button></div>'+
      '<div style="margin:12px 0"><textarea id="mkInput" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="用這個詞造一句你自己的話…" '+
      'style="width:100%;min-height:72px;border:2px solid var(--line);border-radius:12px;padding:10px 12px;font-size:1rem;font-family:var(--font-en)"></textarea></div>'+
      '<div><button id="mkMicBtn" class="big-btn rec" onclick="mkMic()">🎤 用說的</button>'+
      '<button class="big-btn teal" onclick="mkCheck()">✨ 檢查我的句子</button></div>'+
      '<div id="mkFb" style="margin-top:12px"></div>';
  }
  window.mkRestart=function(){ mk.i=0; mk.results=[]; mkRender(); };
  window.mkMic=function(){
    const btn=$('#mkMicBtn');
    if(!JD.recSupported()){ $('#mkFb').innerHTML='<div class="acc-badge bad">此設備不支援語音輸入，用打字吧</div>'; return; }
    btn.classList.add('listening'); btn.textContent='👂 正在聽…'; btn.disabled=true;
    $('#mkFb').innerHTML='<div class="acc-badge">👂 說完就點「我說完了」，或停一下自動結束</div>'+
      '<div style="margin-top:6px"><button class="big-btn teal" id="mkDoneBtn">✅ 我說完了</button></div>';
    const rec = JD.listen((text, err)=>{
      btn.classList.remove('listening'); btn.textContent='🎤 用說的'; btn.disabled=false;
      if(text){ const t=$('#mkInput'); t.value=(t.value?t.value+' ':'')+text; $('#mkFb').innerHTML=''; }
      else {
        const msg = err==='not-allowed' ? '麥克風權限被拒絕：請在 設定→Safari→麥克風 允許'
                  : err==='silence' ? '沒聽到聲音，再說一次（或直接打字）'
                  : err==='unsupported' ? '此設備不支援語音輸入，用打字吧'
                  : '沒聽清，再試一次（或直接打字）';
        $('#mkFb').innerHTML='<div class="acc-badge bad">'+msg+'</div>';
      }
    }, null, 'en-US');
    const db=$('#mkDoneBtn');
    if(db) db.onclick=()=>{ db.disabled=true; db.textContent='⏳ …'; try{ rec && rec.stop(); }catch(e){} };
  };
  function mkAfter(ok, fix, tip){
    mk.results[mk.i] = mk.results[mk.i] || ok; mkPills();  /* 取最好：造對過就算對 */
    JD.celebrate(ok?'good':'try');
    $('#mkFb').innerHTML=
      '<div class="acc-badge '+(ok?'good':'bad')+'">'+(ok?'🎉 ':'💪 ')+JD.esc(tip||(ok?'好句子！':'再看看'))+'</div>'+
      (ok||!fix?'':'<div class="eg" style="margin-top:8px">可以這樣說：'+JD.esc(fix)+'</div>')+
      '<div style="margin-top:10px">'+(ok?'':'<span class="hint" style="display:block;margin-bottom:6px">改一改上面的句子，再按「檢查」試試！</span>')+
      '<button class="big-btn teal" onclick="mkNext()">下一個詞 →</button></div>';
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
    if(!window.JDGen || !JDGen.getKey()){ mkSelfCheck('沒設定 AI Key，這關改用自評'); return; }
    $('#mkFb').innerHTML='<div class="acc-badge">⏳ AI 老師看句子中…</div>';
    try{
      const r=await JDGen.judgeSentence('en', v.w, s);
      mkAfter(r.ok, r.fix, r.tip);
    }catch(e){ mkSelfCheck('AI 檢查沒成功（'+(e.message||e)+'），改用自評'); }
  };
  window.mkNext=function(){ if(mk.results[mk.i]==null) mk.results[mk.i]=false; mk.i++; pos('make', mk.results.filter(x=>x!=null).length, mkWords.length, mk.results.filter(Boolean).length); mkRender(); };  /* 跳過沒檢查=不算造對 */
  mk.i = resume('make', mkWords.length);
  mkRender();

  /* ========== 5.7 課後彩蛋：AI 用學過的詞寫小故事（泛讀甜點；快取進 localStorage 不重複花錢） ========== */
  function storyShow(box, s){
    box.innerHTML='<div class="card" style="text-align:left">'+
      '<b style="font-family:var(--font-head)">🎁 '+JD.esc(s.title)+'</b>'+
      '<button class="btn-voice" style="margin-left:8px" onclick="storySpeak()">🔊</button>'+
      '<p style="margin-top:8px;line-height:1.7">'+JD.esc(s.text)+'</p>'+
      '<p style="color:var(--muted);margin-top:6px;font-size:.9rem">'+JD.esc(s.zh)+'</p>'+
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
    try{ const s=JSON.parse(localStorage.getItem('jingdu_story_'+L.id)||'{}'); if(s.text) JD.speak(s.text,false); }catch(e){}
  };
  window.storyGen=async function(){
    const box=document.getElementById('storyBox'); if(!box) return;
    if(!window.JDGen || !JDGen.getKey()){
      box.innerHTML='<div class="acc-badge bad">要先在「➕ 新增課文」頁設定智譜 API Key，才能生成小故事</div>'; return;
    }
    box.innerHTML='<div class="acc-badge">⏳ AI 正在寫小故事…</div>';
    try{
      const words=Array.from(new Set((L.vocab||[]).map(v=>v.w).concat(JDGen.knownWords('en')))).slice(0,40);
      const s=await JDGen.storyFromWords('en', words, null);
      localStorage.setItem('jingdu_story_'+L.id, JSON.stringify(s));
      localStorage.setItem('jingdu_updatedAt', String(Date.now()));
      if(window.JDSYNC) window.JDSYNC.schedule();
      storyShow(box, s);
    }catch(e){
      box.innerHTML='<div class="acc-badge bad">生成沒成功（'+JD.esc(e.message||String(e))+'）</div>'+
        '<button class="big-btn ghost" onclick="storyGen()" style="margin-top:8px">再試一次</button>';
    }
  };

  /* ========== 6 打卡 ========== */
  const SEC_LABEL = {listen:'🎧 聽全文',read:'📖 逐句精讀',vocab:'🃏 生詞卡',grammar:'📝 語法點',build:'🧩 連詞成句',speak:'🗣️ 口語跟讀',quiz:'🎯 聽力題',recite:'🧠 背句挑戰',make:'🖊️ 造句挑戰'};
  function renderDone(){
    const p = JD.getProgress(L.id);
    const sp = JD.getSecPos(L.id);
    const keys = Object.keys(SEC_LABEL);
    const doneCnt = keys.filter(k=>p[k]).length;
    const pct = Math.round(doneCnt/keys.length*100);
    /* 每節完成比例：整節做完=100%，否則 已完成項/總項 */
    function frac(k){ if(p[k]) return 1; const s=sp[k]; return (s&&s.n)? Math.max(0,Math.min(1,(s.done||0)/s.n)) : 0; }
    /* 可打分的環節：顯示「答對幾題」當學習成果；聽全文/逐句/語法只算讀過，無分 */
    const SCORE_VERB = {vocab:'拼對', build:'排對', speak:'讀對', quiz:'答對', recite:'背對', make:'造對'};
    /* 本課總評分：完成度(做了幾成) + 正確率(做過的裡對了幾成)，只算 6 個計分環節 */
    const sc = JD.lessonScore(L.id);
    const scoreLine = sc.n
      ? '<li class="done-summary" style="flex-direction:column;align-items:stretch;gap:6px">'+
        '<div style="display:flex;justify-content:space-between;align-items:baseline">'+
        '<span>📊 本課總評分</span>'+
        '<span style="font-size:.85rem;color:var(--muted)">計分環節：生詞/連詞/跟讀/聽力/背句/造句</span></div>'+
        '<div style="display:flex;gap:18px">'+
        '<span>完成度 <b style="font-size:1.3rem">'+sc.completion+'%</b> <small style="color:var(--muted)">('+sc.done+'/'+sc.n+' 題)</small></span>'+
        '<span>正確率 <b style="font-size:1.3rem;color:'+(sc.accuracy>=85?'var(--teal-deep)':sc.accuracy>=60?'var(--mango)':'var(--coral)')+'">'+sc.accuracy+'%</b> <small style="color:var(--muted)">(答對 '+sc.score+'/'+sc.done+')</small></span>'+
        '</div></li>'
      : '';
    $('#doneList').innerHTML =
      scoreLine +
      '<li class="done-summary"><span>本課完成 <b>'+doneCnt+'</b> / '+keys.length+'</span>'+
      '<div class="done-bar big"><i style="width:'+pct+'%"></i></div></li>'+
      keys.map(k=>{
        const s=sp[k]||{}; const f=frac(k); const w=Math.round(f*100);
        const verb = SCORE_VERB[k];
        let tag;
        if(!(s.done||0) && !p[k]) tag='未開始';
        else if(verb) tag = verb+' '+(s.score||0)+'/'+(s.n||s.done||0);   /* 答對 4/6 */
        else tag = p[k] ? '完成' : (s.done+'/'+s.n);                       /* 讀完型只顯示進度 */
        return '<li class="done-item"><button class="done-row" onclick="switchTab(\''+k+'\')">'+
          '<span class="ck '+(p[k]?'done':'')+'">'+(p[k]?'✓':'')+'</span>'+
          '<span class="done-label">'+SEC_LABEL[k]+'</span>'+
          '<span class="done-frac">'+tag+'</span>'+
          '<div class="done-bar'+(p[k]?' on':'')+'"><i style="width:'+w+'%"></i></div>'+
          '<span class="done-go">›</span></button></li>';
      }).join('');
    const all = keys.every(k=>p[k]);
    if(all && !p.done){ JD.markDone(L.id,'done'); }
    $('#celebrate').classList.toggle('show', all);
    if(all) storyUI();
    refreshDots();
    renderLessonNav();
  }
  refreshDots();

  /* ========== 7 上一課／下一課：內建課文(依註冊表順序)接自建課文(依建立時間)，
     不必每次回目錄選課。課文頁在 lessons/ 目錄下，註冊表 href 是站根相對路徑，
     故一律補 '../' 前綴才能從課文頁正確連到另一課。 ========== */
  function lessonSequence(){
    const reg = (window.JD_LESSONS_EN||[]).map(l=>({id:l.id, title:l.en, href:l.href}));
    const own = Object.values((window.JDGen && JDGen.allUserLessons()) || {})
      .filter(x=>x.lang==='en')
      .sort((a,b)=>(a._meta?a._meta.created:0)-(b._meta?b._meta.created:0))
      .map(x=>({id:x.id, title:x.title||'未命名', href:'lessons/view.html?id='+encodeURIComponent(x.id)}));
    return reg.concat(own);
  }
  function renderLessonNav(){
    const box = $('#lessonNav'); if(!box) return;
    const seq = lessonSequence();
    const idx = seq.findIndex(x=>x.id===L.id);
    if(idx<0){ box.innerHTML=''; return; }
    const prev = idx>0 ? seq[idx-1] : null;
    const next = idx<seq.length-1 ? seq[idx+1] : null;
    box.innerHTML =
      (prev ? '<a class="big-btn ghost" style="flex:1;text-align:center" href="../'+prev.href+'">← '+JD.esc(prev.title)+'</a>' : '')+
      (next ? '<a class="big-btn teal" style="flex:1;text-align:center" href="../'+next.href+'">下一課：'+JD.esc(next.title)+' →</a>'
             : '<span class="hint" style="margin:0">🎉 已經是最後一課，回目錄看看有沒有新課吧</span>');
  }
  renderLessonNav();

  /* ?tab= 深連結：今日學習流可直達某環節 */
  const t0 = new URLSearchParams(location.search).get('tab');
  if(t0 && document.getElementById('p-'+t0)) switchTab(t0);
})();
