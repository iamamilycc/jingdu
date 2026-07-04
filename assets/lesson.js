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
    if(name==='done') renderDone();
  };

  function refreshDots(){
    const p = JD.getProgress(L.id);
    $$('.tab-btn .dot').forEach(d=>d.classList.toggle('done', !!p[d.dataset.s]));
  }
  function done(sec){ JD.markDone(L.id, sec); refreshDots(); }

  /* ========== 0 聽全文（連播 + 高亮 + 盲聽 + 循環） ========== */
  const lt = { playing:false, idx:-1, slow:false, blind:false, loop:false };
  const ltBox = $('#ltText');
  if(ltBox){
    ltBox.innerHTML = L.sentences.map((s,i)=>'<span class="lt-sent" id="lt'+i+'">'+JD.esc(s.en)+'</span>').join(' ');
  }
  function ltHighlight(i){
    $$('.lt-sent').forEach((el,k)=>el.classList.toggle('now', k===i));
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
      '<div class="en"><span class="idx">'+(i+1)+'</span><span style="flex:1">'+JD.esc(s.en)+'</span>'+
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
    if(opened.size >= L.sentences.length) done('read');
  }

  /* ========== 2 生詞卡（look-cover-write-check：正面看單詞 → 翻面拼寫 → 對✓錯入錯題本） ========== */
  const vg = $('#vocabGrid');
  const judged = new Set();
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
      c.classList.remove('known','unknown');
      c.classList.add(ok?'known':'unknown');
      if(ok){
        fb.innerHTML='<span class="vok">✓ 拼對了！</span>';
        JD.speak(v.w,false);
        setTimeout(()=>c.classList.remove('flip'), 900);
      }else{
        fb.innerHTML='<span class="vbad">✗ 正確拼寫：<b>'+JD.esc(v.w)+'</b></span>';
        JD.addError({id:'w:'+L.id+'#'+v.w, lessonId:L.id, en:v.w, zh:v.zh, type:'word', pos:v.pos});
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
      bdRender('<div class="acc-badge good">🎉 排對了！<br>'+JD.esc(it.en)+'</div>'); bdMaybeDone();
    }else{
      bdRender('<div class="acc-badge bad">順序還不對，再試試～（點已排的單詞可移回去）</div>');
    }
  };
  window.bdReveal=function(){
    const it=bdItems[bd.i]; bd.results[bd.i]=false;
    JD.addError({id:L.id+'#'+it.idx, lessonId:L.id, en:it.en, zh:it.zh});
    bdRender('<div class="acc-badge bad">正確順序是：<br>'+JD.esc(it.en)+'<br><span style="font-size:.8rem">（已放進錯題本，之後復盤）</span></div>'); bdMaybeDone();
  };
  window.bdNav=function(d){ bd.i=Math.min(Math.max(bd.i+(d||1),0), bdItems.length); if(bd.i>=bdItems.length) bdRender(); else bdLoad(); };
  window.bdRestart=function(){ bd.i=0; bd.results=[]; bdLoad(); };
  function bdMaybeDone(){ if(bd.results.filter(x=>x!=null).length>=bdItems.length) done('build'); }
  if(bdItems.length) bdLoad();
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
      spk.results[i]=acc; spkRender0nly();
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
  spkRender();

  /* ========== 4.5 聽力題（純聽音答題，答錯的句子進錯題本） ========== */
  const qz = { i:0, score:0, answeredCnt:0 };
  function qzPlaySeq(idxs, k){
    k = k||0; if(k>=idxs.length) return;
    const u = new SpeechSynthesisUtterance(L.sentences[idxs[k]].en);
    u.lang='en-US'; u.rate=0.9;
    u.onend = ()=>setTimeout(()=>qzPlaySeq(idxs,k+1), 300);
    if(k===0) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  function qzRender(autoplay){
    const box = $('#quizBox'); if(!box) return;
    if(qz.i >= L.listening.length){
      box.innerHTML='<div class="stage"><div style="font-size:2.6rem">'+(qz.score===L.listening.length?'🏆':'🎯')+'</div>'+
        '<div class="acc-badge '+(qz.score>=L.listening.length*0.8?'good':'bad')+'">答對 '+qz.score+' / '+L.listening.length+' 題</div>'+
        '<div style="margin-top:10px"><button class="big-btn ghost" onclick="qzRestart()">再做一遍</button></div></div>';
      done('quiz'); return;
    }
    const it = L.listening[qz.i];
    box.innerHTML='<div class="stage">'+
      '<div style="font-family:var(--font-head);color:var(--muted);font-size:.9rem;margin-bottom:8px">第 '+(qz.i+1)+' / '+L.listening.length+' 題</div>'+
      '<button class="big-btn teal" onclick="qzPlay()">🔊 播放錄音</button>'+
      '<div style="font-weight:700;font-size:1.05rem;margin:14px 0 10px">'+JD.esc(it.q)+'</div>'+
      '<div id="qzOpts">'+it.opts.map((o,k)=>'<button class="qz-opt" data-k="'+k+'">'+String.fromCharCode(65+k)+'. '+JD.esc(o)+'</button>').join('')+'</div>'+
      '<div id="qzFb" style="margin-top:10px"></div></div>';
    $$('#qzOpts .qz-opt').forEach(b=>b.onclick=()=>qzAnswer(parseInt(b.dataset.k)));
    /* 頁面載入時不自動播音（默認頁是聽全文，且無用戶手勢會被瀏覽器攔截）；
       點「下一題/再做一遍」屬用戶操作，此時自動連播 */
    if(autoplay) qzPlaySeq(it.play);
  }
  window.qzPlay = ()=>qzPlaySeq(L.listening[qz.i].play);
  function qzAnswer(k){
    const it = L.listening[qz.i];
    $$('#qzOpts .qz-opt').forEach((b,j)=>{
      b.disabled=true;
      if(j===it.ans) b.classList.add('right');
      else if(j===k) b.classList.add('wrong');
    });
    if(k===it.ans){ qz.score++; $('#qzFb').innerHTML='<div class="acc-badge good">🎉 答對了！</div>'; }
    else{
      $('#qzFb').innerHTML='<div class="acc-badge bad">再聽聽～正確答案是 '+String.fromCharCode(65+it.ans)+'</div>';
      const s = L.sentences[it.srcIdx];
      JD.addError({id:L.id+'#'+it.srcIdx, lessonId:L.id, en:s.en, zh:s.zh});
    }
    $('#qzFb').innerHTML += '<div style="margin-top:8px"><button class="big-btn teal" onclick="qzNext()">下一題 →</button></div>';
  }
  window.qzNext = function(){ qz.i++; qzRender(true); };
  window.qzRestart = function(){ qz.i=0; qz.score=0; qzRender(true); };
  if(L.listening) qzRender(false);

  /* ========== 5 背句挑戰 ========== */
  const rc = { i:0, timer:null, results:[] };
  function rcRender(stage){ /* stage: idle|show|masked|result */
    const s = L.sentences[rc.i];
    $('#rcPills').innerHTML = L.sentences.map((_,k)=>
      '<span class="pill '+(k===rc.i?'now':'')+' '+(rc.results[k]==null?'':(rc.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
    const tgt = $('#rcTarget'), ring=$('#rcRing'), btns=$('#rcBtns');
    if(stage==='idle'){
      ring.style.display='none';
      tgt.innerHTML='<div class="mask-box">第 '+(rc.i+1)+' 句 · 準備好了就開始<br>先看 10 秒，然後句子會蓋住，開口把它背出來！</div>';
      btns.innerHTML='<button class="big-btn mango" onclick="rcStart()">👀 開始看題（10 秒）</button>'+
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
    btns.innerHTML='';
    let left=10;
    const C = 2*Math.PI*30;
    ring.innerHTML='<svg width="66" height="66"><circle class="bg" cx="33" cy="33" r="30"/>'+
      '<circle class="fg" cx="33" cy="33" r="30" stroke-dasharray="'+C+'" stroke-dashoffset="0"/></svg><span id="rcSec">10</span>';
    const fg = ring.querySelector('.fg');
    rc.timer = setInterval(()=>{
      left--;
      $('#rcSec').textContent=left;
      fg.style.strokeDashoffset = C*(10-left)/10;
      if(left<=0){ clearInterval(rc.timer); rcMask(); }
    },1000);
  };
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
    rc.results[rc.i]=acc;
    if(acc < JD.PASS){
      JD.addError({id:L.id+'#'+rc.i, lessonId:L.id, en:s.en, zh:s.zh});
    }
    if(!showedResult){
      $('#rcResult').innerHTML='<div class="acc-badge bad">進錯題本，等會再戰 💪</div>';
    }
    $('#rcTarget').innerHTML = JD.esc(s.en);
    $('#rcBtns').innerHTML='<button class="big-btn teal" onclick="rcNav(1)">下一句 →</button>'+
      '<button class="big-btn ghost" onclick="rcRender2()">再背一次</button>';
    $('#rcPills').innerHTML = L.sentences.map((_,k)=>
      '<span class="pill '+(k===rc.i?'now':'')+' '+(rc.results[k]==null?'':(rc.results[k]>=JD.PASS?'ok':'bad'))+'"></span>').join('');
    if(rc.results.filter(x=>x!=null).length>=L.sentences.length) done('recite');
  }
  window.rcRender2 = ()=>rcRender('idle');
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
    $(resultSel).innerHTML='<div class="acc-badge">👂 開始讀吧！讀完停一下，會自動結束打分，不用再按</div>';
    JD.listen((text, err)=>{
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
  }

  /* ========== 6 打卡 ========== */
  const SEC_LABEL = {listen:'🎧 聽全文',read:'📖 逐句精讀',vocab:'🃏 生詞卡',grammar:'📝 語法點',build:'🧩 連詞成句',speak:'🗣️ 口語跟讀',quiz:'🎯 聽力題',recite:'🧠 背句挑戰'};
  function renderDone(){
    const p = JD.getProgress(L.id);
    $('#doneList').innerHTML = Object.keys(SEC_LABEL).map(k=>
      '<li><span class="ck '+(p[k]?'done':'')+'">'+(p[k]?'✓':'')+'</span>'+SEC_LABEL[k]+'</li>').join('');
    const all = Object.keys(SEC_LABEL).every(k=>p[k]);
    if(all && !p.done){ JD.markDone(L.id,'done'); }
    $('#celebrate').classList.toggle('show', all);
    refreshDots();
  }
  refreshDots();
})();
