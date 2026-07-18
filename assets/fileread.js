/* 精讀 jingdu — 檔案讀取：圖片 / 純文字(.txt) / Word(.docx)
   .docx 用瀏覽器原生 DecompressionStream 解壓（需 iOS 16.4+ / 新版 Safari），不依賴外部庫。
   回傳 { kind:'image', dataUrl } 或 { kind:'text', text }。 */
(function(){
  'use strict';

  function readAsDataURL(file){
    return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('讀取失敗')); r.readAsDataURL(file); });
  }
  function readAsText(file){
    return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('讀取失敗')); r.readAsText(file); });
  }
  function readAsArrayBuffer(file){
    return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('讀取失敗')); r.readAsArrayBuffer(file); });
  }

  /* 縮圖壓縮：手機拍照原圖常 3~5MB，base64 塞進 API 請求體會被 Safari 直接丟掉（fetch 報「Load failed」）。
     長邊壓到 <=1800px、輸出 JPEG(質量 .85)，文字仍清晰可 OCR，體積降到 ~200-400KB，杜絕上傳失敗。
     讀不了(如某些 HEIC)就回原圖不擋流程。 */
  function downscaleImage(dataUrl, maxDim, quality){
    return new Promise((res)=>{
      const img=new Image();
      img.onload=()=>{
        const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
        if(!w || !h){ res(dataUrl); return; }
        const scale=Math.min(1, maxDim/Math.max(w,h));
        const nw=Math.max(1,Math.round(w*scale)), nh=Math.max(1,Math.round(h*scale));
        try{
          const cv=document.createElement('canvas'); cv.width=nw; cv.height=nh;
          cv.getContext('2d').drawImage(img,0,0,nw,nh);
          const out=cv.toDataURL('image/jpeg', quality);
          res(out && out.length < dataUrl.length ? out : dataUrl);  /* 壓不小就用原圖 */
        }catch(e){ res(dataUrl); }
      };
      img.onerror=()=>res(dataUrl);
      img.src=dataUrl;
    });
  }

  function decodeEntities(s){
    return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
            .replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n))
            .replace(/&#x([0-9a-f]+);/gi,(m,n)=>String.fromCharCode(parseInt(n,16)));
  }

  async function docxToText(buf){
    if(typeof DecompressionStream==='undefined')
      throw new Error('這台設備的瀏覽器太舊，無法直接讀 Word 檔；請另存為 .txt 或直接複製課文貼上');
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    /* 找 EOCD（結束中央目錄）簽名 0x06054b50 */
    let eocd=-1;
    for(let i=u8.length-22; i>=0; i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
    if(eocd<0) throw new Error('不是有效的 Word(.docx) 檔');
    const cdOff=dv.getUint32(eocd+16,true), cdCnt=dv.getUint16(eocd+10,true);
    let p=cdOff, target=null;
    for(let n=0;n<cdCnt;n++){
      if(dv.getUint32(p,true)!==0x02014b50) break;
      const method=dv.getUint16(p+10,true), compSize=dv.getUint32(p+20,true);
      const nameLen=dv.getUint16(p+28,true), extraLen=dv.getUint16(p+30,true), commentLen=dv.getUint16(p+32,true);
      const localOff=dv.getUint32(p+42,true);
      const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nameLen));
      if(name==='word/document.xml'){ target={method,compSize,localOff}; break; }
      p+=46+nameLen+extraLen+commentLen;
    }
    if(!target) throw new Error('Word 檔裡找不到正文');
    const lo=target.localOff;
    if(dv.getUint32(lo,true)!==0x04034b50) throw new Error('Word 檔格式異常');
    const lnameLen=dv.getUint16(lo+26,true), lextraLen=dv.getUint16(lo+28,true);
    const dataStart=lo+30+lnameLen+lextraLen;
    const comp=u8.subarray(dataStart, dataStart+target.compSize);
    let xmlBytes;
    if(target.method===0){ xmlBytes=comp; }
    else if(target.method===8){
      const ds=new DecompressionStream('deflate-raw');
      const stream=new Blob([comp]).stream().pipeThrough(ds);
      xmlBytes=new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('不支援的壓縮方式');
    const xml=new TextDecoder().decode(xmlBytes);
    /* 按段落(</w:p>)分行，抽每段的 <w:t> 文字 */
    const text = xml.split(/<\/w:p>/).map(par=>{
      let s=''; par.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g,(m,t)=>{ s+=t; return m; });
      return decodeEntities(s);
    }).join('\n').replace(/\n{3,}/g,'\n\n').trim();
    if(!text) throw new Error('Word 檔裡沒讀到文字');
    return text;
  }

  async function read(file){
    const name=(file.name||'').toLowerCase();
    if(file.type && file.type.indexOf('image/')===0){
      const raw = await readAsDataURL(file);
      return { kind:'image', dataUrl: await downscaleImage(raw, 1800, 0.85) };
    }
    if(name.endsWith('.docx')){
      return { kind:'text', text: await docxToText(await readAsArrayBuffer(file)) };
    }
    if(name.endsWith('.txt') || (file.type||'').indexOf('text/')===0){
      return { kind:'text', text: await readAsText(file) };
    }
    if(name.endsWith('.doc')){
      throw new Error('舊版 .doc 讀不了，請在 Word 另存為 .docx 或 .txt');
    }
    /* 兜底：當純文字試 */
    return { kind:'text', text: await readAsText(file) };
  }

  window.JDFile = { read };
})();
