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
    const u = new SpeechSynthesisUtterance(L.sentences[i].en);
    u.lang='en-US'; u.rate = lt.slow ? 0.6 : 0.9;
    u.onend = ()=>setTimeout(()=>ltPlayFrom(i+1), 350);
    u.onerror = ()=>ltStopUI();
    speechSynthesis.speak(u);
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

  /* ========== 2 生詞卡（翻面後自評：認識 / 不認識 → 不認識進錯題本） ========== */
  const vg = $('#vocabGrid');
  const judged = new Set();
  L.vocab.forEach((v,i)=>{
    const c = document.createElement('div');
    c.className='vcard';
    c.innerHTML='<div class="inner"><div class="vface front"><div class="w">'+JD.esc(v.w)+'</div>'+
      '<div class="ipa">'+JD.esc(v.ipa)+'</div><div style="margin-top:8px"><button class="btn-voice">🔊</button></div></div>'+
      '<div class="vface back"><div class="pos">'+JD.esc(v.pos)+'</div><div class="zh">'+JD.esc(v.zh)+'</div>'+
      '<div class="eg">'+JD.esc(v.eg)+'</div>'+
      '<div class="vjudge"><button class="vbtn no">😵 不認識</button><button class="vbtn yes">😊 認識</button></div></div></div>';
    c.querySelector('.btn-voice').onclick = e=>{ e.stopPropagation(); JD.speak(v.w,false); };
    function judge(ok){
      judged.add(i);
      c.classList.remove('known','unknown');
      c.classList.add(ok?'known':'unknown');
      if(!ok) JD.addError({id:'w:'+L.id+'#'+v.w, lessonId:L.id, en:v.w, zh:v.zh, type:'word', pos:v.pos});
      c.classList.remove('flip');
      if(judged.size >= L.vocab.length) done('vocab');
    }
    c.querySelector('.vbtn.no').onclick = e=>{ e.stopPropagation(); judge(false); };
    c.querySelector('.vbtn.yes').onclick = e=>{ e.stopPropagation(); judge(true); };
    c.onclick = ()=>{ c.classList.toggle('flip'); };
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
    $('#rcTarget').innerHTML='<div class="mask-box">🙈 句子蓋住了！<br>按下麥克風，大聲把它背出來</div>';
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
  function startRec(btn, sent, resultSel, heardSel, onAcc){
    if(!JD.recSupported()){
      /* 降級：自評 */
      $(resultSel).innerHTML =
        '<p style="margin-bottom:8px">此設備不支援語音識別（iPad 需 iOS 14.5+ 並在設定開啟 Siri 與聽寫）。改用自評：</p>'+
        '<button class="big-btn teal" onclick="this.parentNode._ok(100)">✅ 我背對了</button>'+
        '<button class="big-btn ghost" onclick="this.parentNode._ok(0)">❌ 沒背對</button>';
      $(resultSel)._ok = onAcc;
      return;
    }
    if(btn){ btn.classList.add('listening'); btn.textContent='👂 正在聽…'; }
    JD.listen((text, err)=>{
      if(btn){ btn.classList.remove('listening'); btn.textContent='🎙️ 再試一次'; }
      if(err && !text){
        const msg = err==='not-allowed' ? '麥克風權限被拒絕：請在 設定→Safari→麥克風 允許'
                  : err==='silence' ? '沒聽到聲音，再大聲一點試試'
                  : err==='timeout' ? '等了好久沒聽清，再按一次試試'
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
  const SEC_LABEL = {listen:'🎧 聽全文',read:'📖 逐句精讀',vocab:'🃏 生詞卡',grammar:'📝 語法點',speak:'🗣️ 口語跟讀',quiz:'🎯 聽力題',recite:'🧠 背句挑戰'};
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
