/* 精讀 jingdu — 雲端同步層（可選 Gitee 碼雲[國內] / GitHub；私有倉庫 jingdu-data，每使用者一檔 users/<暱稱>.json）
   設計：離線優先。沒設定同步照常可用；設定後進度/錯題自動備份，清瀏覽器/換設備可還原。
   供應商：
   - 'gitee'（推薦，國內不翻牆）：gitee.com/api/v5，令牌走 access_token 參數；建檔用 POST、改檔用 PUT。CORS 已實測放行。
   - 'github'：api.github.com，令牌走 Bearer；建改都用 PUT。
   倉庫擁有者(owner)在設定時用令牌調 /user 自動推導 → 每人存到「自己帳號的 jingdu-data」，通用不衝突。
   安全：令牌僅存本機 localStorage，絕不寫入任何代碼倉庫。 */
(function(){
  'use strict';
  const NS='jingdu_', CFG_KEY=NS+'sync', UPD_KEY=NS+'updatedAt';
  let sha=null, timer=null, busy=false;

  function cfg(){ try{ return JSON.parse(localStorage.getItem(CFG_KEY))||null; }catch(e){ return null; } }
  function setCfg(c){ if(c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); sha=null; }
  function b64e(s){ return btoa(unescape(encodeURIComponent(s))); }
  function b64d(s){ return decodeURIComponent(escape(atob(String(s).replace(/\n/g,'')))); }
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

  /* ---------- 供應商抽象 ---------- */
  function isGitee(c){ return (c&&c.provider)==='gitee'; }
  function repoOwner(c){ return (c && c.owner) || 'iamamilycc'; }   /* 舊 github 設定無 owner → 作者自己的倉 */
  function repoName(c){ return (c && c.repo) || 'jingdu-data'; }     /* 可自訂倉庫名，舊設定預設 jingdu-data */
  function contentsUrl(c, path){
    const base = isGitee(c) ? 'https://gitee.com/api/v5' : 'https://api.github.com';
    return base+'/repos/'+repoOwner(c)+'/'+repoName(c)+'/contents/'+path;
  }
  /* 用令牌問「我是誰」→ 拿到 owner 帳號名，同時驗證令牌有效 */
  async function whoami(provider, token){
    if(provider==='gitee'){
      const r=await fetch('https://gitee.com/api/v5/user?access_token='+encodeURIComponent(token));
      if(!r.ok) throw 'auth'; const j=await r.json(); return j.login;
    }
    const r=await fetch('https://api.github.com/user', {headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}});
    if(!r.ok) throw 'auth'; const j=await r.json(); return j.login;
  }
  /* 讀檔：回 {content(base64), sha} 或 null(404) */
  async function getFile(c, path){
    let url=contentsUrl(c, path)+'?t='+Date.now(), opt={};
    if(isGitee(c)) url+='&access_token='+encodeURIComponent(c.token);
    else opt.headers={'Authorization':'Bearer '+c.token,'Accept':'application/vnd.github+json'};
    const r=await fetch(url, opt);
    if(r.status===404) return null;
    if(r.status===401||r.status===403) throw 'auth';
    if(!r.ok) throw 'http'+r.status;
    const j=await r.json();
    return { content:j.content, sha:j.sha };
  }
  /* 寫檔：回新 sha。Gitee 建檔 POST / 改檔 PUT；GitHub 一律 PUT。衝突自動重取 sha 再寫一次 */
  async function writeFile(c, path, contentB64, message, curSha){
    if(isGitee(c)){
      const doWrite=async(sh)=>{
        const body={ access_token:c.token, content:contentB64, message:message };
        let method='POST'; if(sh){ body.sha=sh; method='PUT'; }
        return fetch(contentsUrl(c,path), {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      };
      let r=await doWrite(curSha);
      if(r.status===401||r.status===403) throw 'auth';
      if(!r.ok){ const cur=await getFile(c,path).catch(()=>null); if(!cur) throw 'http'+r.status; r=await doWrite(cur.sha); if(!r.ok) throw 'http'+r.status; }
      const j=await r.json(); return j.content && j.content.sha;
    }
    const doWrite=async(sh)=>{
      const body={ message:message, content:contentB64 }; if(sh) body.sha=sh;
      return fetch(contentsUrl(c,path), {method:'PUT', headers:{'Authorization':'Bearer '+c.token,'Accept':'application/vnd.github+json'}, body:JSON.stringify(body)});
    };
    let r=await doWrite(curSha);
    if(r.status===401||r.status===403) throw 'auth';
    if(r.status===409||r.status===422){ const cur=await getFile(c,path).catch(()=>null); r=await doWrite(cur?cur.sha:null); }
    if(!r.ok) throw 'http'+r.status;
    const j=await r.json(); return j.content && j.content.sha;
  }

  function userPath(){ const c=cfg(); return 'users/'+encodeURIComponent(c.user)+'.json'; }

  function pull(){
    const c=cfg(); if(!c) return Promise.reject('nocfg');
    return getFile(c, userPath()).then(f=>{ if(!f){ sha=null; return null; } sha=f.sha; return JSON.parse(b64d(f.content)); });
  }
  async function push(){
    if(busy){ schedule(8000); return; }
    const c=cfg(); if(!c) return;
    busy=true;
    try{
      const content=b64e(JSON.stringify(snapshot()));
      const newSha=await writeFile(c, userPath(), content, 'sync '+c.user+' '+new Date().toISOString(), sha);
      if(newSha) sha=newSha;
      setStatus('☁️ 已備份 '+new Date().toLocaleTimeString('zh',{hour:'2-digit',minute:'2-digit'}), true);
      busy=false;
    }catch(e){
      busy=false;
      if(e==='auth'){ setStatus('⚠️ 同步碼失效，請重新設定', false); return; }
      setStatus('📴 離線，聯網後自動備份', false); schedule(30000);
    }
  }
  function schedule(delay){ if(!cfg()) return; clearTimeout(timer); timer=setTimeout(push, delay||4000); }

  /* 首次載入：雲端較新 → 還原到本機；本機較新 → 推上雲端 */
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
    const provName = isGitee(c) ? 'Gitee' : 'GitHub';
    box.innerHTML='<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span style="font-family:var(--font-head);font-weight:600">👤 '+c.user+'</span>'+
      '<span id="syncStatus" class="hint" style="margin:0">☁️</span>'+
      '<span class="hint" style="margin:0">· '+provName+'</span>'+
      '<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">'+
      '<button class="big-btn ghost" style="padding:8px 14px;font-size:.85rem" onclick="JDSYNC.switchUser()">切換使用者</button>'+
      '<button class="big-btn ghost" style="padding:8px 14px;font-size:.85rem" onclick="JDSYNC.setup()">設定</button></span></div>';
  }

  /* 通用彈窗：取代原生 prompt()（手機貼長字串會撐爆版面）。支援 text / textarea / select。 */
  function esc(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function openModal(opts){
    return new Promise(resolve=>{
      const mask=document.createElement('div'); mask.className='jd-modal-mask';
      const box=document.createElement('div'); box.className='jd-modal';
      box.innerHTML = '<h3>'+esc(opts.title)+'</h3>'+
        opts.fields.map(f=>'<div class="jd-field"><label>'+esc(f.label)+'</label>'+
          (f.type==='textarea'
            ? '<textarea data-k="'+f.key+'" placeholder="'+esc(f.placeholder||'')+'">'+esc(f.value||'')+'</textarea>'
            : f.type==='select'
              ? '<select data-k="'+f.key+'">'+f.options.map(o=>'<option value="'+esc(o.value)+'"'+(o.value===(f.value||'')?' selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select>'
              : '<input type="text" data-k="'+f.key+'" placeholder="'+esc(f.placeholder||'')+'" value="'+esc(f.value||'')+'">')+
          '</div>').join('') +
        (opts.hint ? '<div class="jd-hint">'+esc(opts.hint)+'</div>' : '') +
        '<div class="jd-btns"><button type="button" class="big-btn ghost" data-act="cancel">取消</button>'+
        '<button type="button" class="big-btn teal" data-act="ok">確定</button></div>';
      mask.appendChild(box); document.body.appendChild(mask);
      function close(v){ mask.remove(); resolve(v); }
      box.querySelector('[data-act=cancel]').onclick=()=>close(null);
      mask.addEventListener('click', e=>{ if(e.target===mask) close(null); });
      box.querySelector('[data-act=ok]').onclick=()=>{
        const vals={};
        opts.fields.forEach(f=>{ vals[f.key]=box.querySelector('[data-k="'+f.key+'"]').value.trim(); });
        close(vals);
      };
      const firstInput=box.querySelector('input,textarea,select');
      if(firstInput) setTimeout(()=>firstInput.focus(), 50);
    });
  }

  async function setup(){
    const c=cfg()||{};
    const vals = await openModal({
      title:'☁️ 設定雲端備份',
      fields:[
        {key:'user', label:'這台設備上是誰在學？', type:'text', placeholder:'暱稱（同一暱稱=同一份進度）', value:c.user||''},
        {key:'provider', label:'雲端服務', type:'select', value:c.provider||'gitee', options:[
          {value:'gitee', label:'Gitee 碼雲（國內·不翻牆·推薦）'},
          {value:'github', label:'GitHub（需海外網絡）'} ]},
        {key:'repo', label:'倉庫名稱', type:'text', placeholder:'你建的私有倉庫名', value:c.repo||'jingdu-data'},
        {key:'token', label:'同步碼（私人令牌）', type:'textarea', placeholder:'貼上令牌（之前設過可留空不改）'}
      ],
      hint:'令牌只存這台設備、不外傳。先在雲端建一個「私有」倉庫，把倉庫名填上面。Gitee：設置→私人令牌，勾「projects」生成。'
    });
    if(!vals || !vals.user) return;
    const token=vals.token||c.token||'';
    if(!token){ alert('沒有同步碼，先不開啟雲端備份。'); return; }
    const provider = vals.provider==='github' ? 'github' : 'gitee';
    const repo = (vals.repo||'').trim() || 'jingdu-data';
    setStatus('☁️ 驗證令牌中…');
    let owner;
    try{ owner = await whoami(provider, token); }
    catch(e){ alert('令牌驗證失敗：可能令牌不對、或連不上雲端。請檢查後重試。'); renderCard(); return; }
    setCfg({ user:vals.user, token:token, provider:provider, owner:owner, repo:repo }); sha=null;
    init();
  }
  async function switchUser(){
    const c=cfg(); if(!c) return setup();
    push(); /* 先把當前使用者推上雲 */
    const vals = await openModal({
      title:'切換使用者',
      fields:[{key:'user', label:'切換到哪位使用者？', type:'text', placeholder:'輸入暱稱'}]
    });
    if(!vals || !vals.user || vals.user===c.user) return;
    setCfg({user:vals.user, token:c.token, provider:c.provider, owner:c.owner, repo:c.repo}); sha=null;
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
