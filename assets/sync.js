/* 精讀 jingdu — 雲端同步層（GitHub 私有倉庫 jingdu-data，每使用者一檔 users/<暱稱>.json）
   設計：離線優先。沒設定同步照常可用；設定後進度/錯題自動備份，清瀏覽器/換設備可還原。
   安全：同步碼（fine-grained token，只能讀寫 jingdu-data 一個私有倉庫）僅存本機 localStorage，
        絕不寫入任何代碼倉庫。 */
(function(){
  'use strict';
  const NS='jingdu_', CFG_KEY=NS+'sync', UPD_KEY=NS+'updatedAt';
  const REPO='iamamilycc/jingdu-data';
  let sha=null, timer=null, busy=false;

  function cfg(){ try{ return JSON.parse(localStorage.getItem(CFG_KEY))||null; }catch(e){ return null; } }
  function setCfg(c){ if(c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); sha=null; }
  function b64e(s){ return btoa(unescape(encodeURIComponent(s))); }
  function b64d(s){ return decodeURIComponent(escape(atob(s.replace(/\n/g,'')))); }
  function setStatus(t, ok){
    const el=document.getElementById('syncStatus');
    if(el){ el.textContent=t; el.style.color = ok===false ? 'var(--coral)' : 'var(--muted)'; }
  }

  function snapshot(){
    const data={};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k && k.indexOf(NS)===0 && k!==CFG_KEY) data[k]=localStorage.getItem(k);
    }
    return { updatedAt: parseInt(localStorage.getItem(UPD_KEY)||'0',10) || Date.now(), data:data };
  }
  function applySnapshot(snap){
    const keep=localStorage.getItem(CFG_KEY);
    const kill=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k && k.indexOf(NS)===0 && k!==CFG_KEY) kill.push(k);
    }
    kill.forEach(k=>localStorage.removeItem(k));
    for(const k in snap.data){ if(k!==CFG_KEY) localStorage.setItem(k, snap.data[k]); }
    if(keep) localStorage.setItem(CFG_KEY, keep);
  }

  function api(method, path, body){
    const c=cfg(); if(!c) return Promise.reject('nocfg');
    return fetch('https://api.github.com/repos/'+REPO+'/contents/'+path, {
      method:method,
      headers:{ 'Authorization':'Bearer '+c.token, 'Accept':'application/vnd.github+json' },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  function userPath(){ const c=cfg(); return 'users/'+encodeURIComponent(c.user)+'.json'; }

  function pull(){
    return api('GET', userPath()+'?t='+Date.now()).then(r=>{
      if(r.status===404){ sha=null; return null; }
      if(r.status===401 || r.status===403) throw 'auth';
      if(!r.ok) throw 'http'+r.status;
      return r.json().then(j=>{ sha=j.sha; return JSON.parse(b64d(j.content)); });
    });
  }
  function push(){
    if(busy) { schedule(8000); return; }
    const c=cfg(); if(!c) return;
    busy=true;
    const snap=snapshot();
    const body={ message:'sync '+c.user+' '+new Date().toISOString(), content:b64e(JSON.stringify(snap)) };
    if(sha) body.sha=sha;
    api('PUT', userPath(), body).then(r=>{
      if(r.status===409 || r.status===422){
        /* sha 過期：重取再推一次 */
        return api('GET', userPath()+'?t='+Date.now()).then(g=>g.ok?g.json():null).then(j=>{
          if(j) body.sha=j.sha; else delete body.sha;
          return api('PUT', userPath(), body);
        });
      }
      return r;
    }).then(r=>{
      busy=false;
      if(r && r.ok) return r.json().then(j=>{ sha=j.content.sha; setStatus('☁️ 已備份 '+new Date().toLocaleTimeString('zh',{hour:'2-digit',minute:'2-digit'}), true); });
      if(r && (r.status===401||r.status===403)){ setStatus('⚠️ 同步碼失效，請重新設定', false); return; }
      setStatus('⚠️ 備份未成功，稍後自動再試', false); schedule(30000);
    }).catch(()=>{ busy=false; setStatus('📴 離線，聯網後自動備份', false); schedule(30000); });
  }
  function schedule(delay){
    if(!cfg()) return;
    clearTimeout(timer);
    timer=setTimeout(push, delay||4000);
  }

  /* 首次載入：雲端較新 → 還原到本機；本機較新 → 推上雲端
     注意：renderCard() 先渲染卡片外殼，#syncStatus 節點才存在，之後 setStatus() 才寫得進去；
     pull() 結果出來後只更新狀態文字，不再重渲染整張卡（否則會把剛設好的真實狀態文字蓋掉）。 */
  function init(){
    const c=cfg(); if(!c){ setStatus(''); renderCard(); return; }
    renderCard();
    setStatus('☁️ 連線中…');
    pull().then(remote=>{
      const localUpd=parseInt(localStorage.getItem(UPD_KEY)||'0',10);
      if(remote && remote.updatedAt > localUpd){
        applySnapshot(remote.data ? remote : {data:{}});
        localStorage.setItem(UPD_KEY, String(remote.updatedAt));
        setStatus('☁️ 已從雲端還原', true);
        if(window.JDSYNC_ONRESTORE) window.JDSYNC_ONRESTORE();
      }else if(localUpd && (!remote || localUpd > remote.updatedAt)){
        push();
      }else{
        setStatus('☁️ 已同步', true);
      }
    }).catch(e=>{
      setStatus(e==='auth' ? '⚠️ 同步碼失效，請重新設定' : '📴 離線，資料先存本機', e!=='auth' ? undefined : false);
    });
  }

  /* ---------- 首頁設定卡（只在有 #syncCard 的頁面渲染） ---------- */
  function renderCard(){
    const box=document.getElementById('syncCard'); if(!box) return;
    const c=cfg();
    box.style.display='block';
    if(!c){
      box.innerHTML='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
        '<span style="font-family:var(--font-head);font-weight:600">☁️ 雲端備份未開啟</span>'+
        '<span class="hint" style="margin:0">清瀏覽器資料會丟進度，建議家長設定一次</span>'+
        '<button class="big-btn mango" style="padding:9px 18px;margin-left:auto" onclick="JDSYNC.setup()">開啟</button></div>';
      return;
    }
    box.innerHTML='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span style="font-family:var(--font-head);font-weight:600">👤 '+c.user+'</span>'+
      '<span id="syncStatus" class="hint" style="margin:0">☁️</span>'+
      '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">'+
      '<button class="big-btn ghost" style="padding:8px 14px;font-size:.85rem" onclick="JDSYNC.switchUser()">切換使用者</button>'+
      '<button class="big-btn ghost" style="padding:8px 14px;font-size:.85rem" onclick="JDSYNC.setup()">設定</button></span></div>';
  }

  function setup(){
    const c=cfg()||{};
    const user=prompt('這台設備上是誰在學？輸入暱稱（同一暱稱=同一份進度）：', c.user||'');
    if(!user) return;
    const token=prompt('貼上「同步碼」（家長保存的那串 github_pat_ 開頭代碼；之前設過可留空不改）：', '');
    const newCfg={ user:user.trim(), token:(token&&token.trim())||c.token||'' };
    if(!newCfg.token){ alert('沒有同步碼，先不開啟雲端備份。'); return; }
    setCfg(newCfg); sha=null;
    init();
  }
  function switchUser(){
    const c=cfg(); if(!c) return setup();
    push(); /* 先把當前使用者推上雲 */
    const user=prompt('切換到哪位使用者？輸入暱稱：', '');
    if(!user || user.trim()===c.user) return;
    setCfg({user:user.trim(), token:c.token}); sha=null;
    /* 清掉本機資料，改拉新使用者的 */
    applySnapshot({data:{}});
    localStorage.removeItem(UPD_KEY);
    init();
    setTimeout(()=>location.reload(), 800);
  }

  window.JDSYNC={ schedule:schedule, setup:setup, switchUser:switchUser, init:init,
                  _cfg:cfg, _pull:pull, _push:push, _snapshot:snapshot };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('online', ()=>schedule(2000));
})();
