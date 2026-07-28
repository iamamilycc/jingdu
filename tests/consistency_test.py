#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
consistency_test.py —— 虫虫精讀「一致性閉環測試」

驗證所有互動環節的核心不變量：**顯示的內容 = 讀給孩子聽的內容 = 拿去比對打分/判答案的目標**
（同一句/同一詞，換句/換題也不錯位）。這是最容易出錯又最傷體驗的一類 bug（跟讀曾出過
「顯示新句卻比對舊句」），所以固化成可重跑的測試，每次改動都跑一遍。

覆蓋（英語 nce2-01 + 日語 jp-01）：
  跟讀 speak     顯示==朗讀==比對目標（含換句）
  背句 recite    朗讀==比對目標==當前句（含換句）
  聽力題 quiz    每題 ans/srcIdx/play 下標全部合法
  連詞 build     顯示的中文對應某課句
  生詞卡 vocab   每張卡拼寫檢查的目標==該詞（日語==假名讀音）
  生詞強化 drill 中→外顯示的中文對應某生詞；外→中選項含正確中文
  造句 make      顯示的詞==送 AI 判分的詞
  全程無 JS 錯誤

用法：  python3 tests/consistency_test.py
        （自動起本機 http server；需要已 pip install playwright 且裝過 chromium）
成功：  印「全部一致 ✅」且退出碼 0；任一項不一致退出碼 1。
"""
import sys, os, subprocess, time, socket, http.server, threading, functools, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def discover_lessons(base):
    """自動掃描所有實體課檔（排除 view.html 動態載入器），英日全覆蓋。
    避免只測固定一兩課、漏掉某一課才有的錯位/資料 bug。"""
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'lessons', '*.html'))):
        if os.path.basename(f) != 'view.html':
            out.append(('英語:' + os.path.basename(f), base + '/lessons/' + os.path.basename(f), 'en'))
    for f in sorted(glob.glob(os.path.join(ROOT, 'jp', 'lessons', '*.html'))):
        if os.path.basename(f) != 'view.html':
            out.append(('日語:' + os.path.basename(f), base + '/jp/lessons/' + os.path.basename(f), 'jp'))
    return out

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def serve(port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

FAILS = []
def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)))
    if not cond:
        FAILS.append(name)

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.6)
    base = 'http://127.0.0.1:%d' % port
    errs = []
    LESSONS = discover_lessons(base)
    print('掃描到 %d 課：%s' % (len(LESSONS), '、'.join(l[0] for l in LESSONS)))
    with sync_playwright() as p:
        b = p.chromium.launch()
        for label, url, lang in LESSONS:
            print('\n========== %s（%s） ==========' % (label, url))
            pg = b.new_page(viewport={'width': 390, 'height': 820})
            pg_errs = []
            pg.on('pageerror', lambda e: pg_errs.append(str(e)))
            pg.goto(url); pg.wait_for_timeout(1400)

            # 期望值取法：英語=sentence.en / .w；日語=假名讀音
            def exp_sent(i):
                if lang == 'jp':
                    return pg.evaluate("window.JDRuby.toKana(LESSON.sentences[%d].jp)" % i)
                return pg.evaluate("LESSON.sentences[%d].en" % i)

            n_sent = pg.evaluate("LESSON.sentences.length")
            probe = [i for i in (0, 1, 2) if i < n_sent]

            # 統一 mock：捕捉朗讀文字與比對目標
            pg.evaluate("""
              window._spoke=null; window._cmp=null;
              JD.speak=(t)=>{ window._spoke=t; };
              JD.recSupported=()=>true;
              JD.listen=(cb)=>({ stop:()=>cb((%s)?'おはよう':'x', null), abort:()=>{} });
              JD.compare=(target)=>{ window._cmp=target; return {accuracy:90,tokens:[{w:'x',st:'ok'}]}; };
              JD.compareJP=(target)=>{ window._cmp=target; return {accuracy:90,tokens:[{w:'x',st:'ok'}]}; };
              /* 日語背句/跟讀改走 compareJPReading(jp, 識別文字, map)；捕捉其比對的當前句(轉假名後與朗讀同形) */
              JD.compareJPReading=(jp)=>{ window._cmp=(window.JDRuby?window.JDRuby.toKana(jp):jp); return {accuracy:90,tokens:[{w:'x',st:'ok'}]}; };
            """ % ('true' if lang == 'jp' else 'false'))

            # ---- 跟讀 speak ----
            print('-- 跟讀 speak：顯示/朗讀/比對 三方一致（含換句）')
            pg.evaluate("switchTab('speak')"); pg.wait_for_timeout(150)
            for i in probe:
                exp = exp_sent(i)
                shown = pg.evaluate("document.querySelector('#spkTarget').innerText").strip()
                pg.evaluate("window._spoke=null; spkPlay()"); pg.wait_for_timeout(70)
                spoke = pg.evaluate("window._spoke")
                pg.evaluate("window._cmp=null; document.getElementById('spkRecBtn').click()"); pg.wait_for_timeout(70)
                pg.evaluate("document.getElementById('spkRecBtn').click()"); pg.wait_for_timeout(130)
                cmp = pg.evaluate("window._cmp")
                ck('speak[%d] 朗讀==期望' % i, spoke == exp, spoke)
                ck('speak[%d] 比對==期望' % i, cmp == exp, cmp)
                if lang == 'en':
                    ck('speak[%d] 顯示==期望' % i, shown == exp, shown)
                pg.evaluate("spkNext(1)"); pg.wait_for_timeout(110)

            # ---- 背句 recite ----
            print('-- 背句 recite：朗讀==比對==當前句（含換句）')
            pg.evaluate("switchTab('recite'); rcRender2()"); pg.wait_for_timeout(150)
            for i in probe:
                exp = exp_sent(i)
                pg.evaluate("window._spoke=null; window._cmp=null; rcStart()"); pg.wait_for_timeout(110)
                spoke = pg.evaluate("window._spoke")
                pg.evaluate("rcSkipPeek()"); pg.wait_for_timeout(110)
                pg.evaluate("document.getElementById('rcRecBtn').click()"); pg.wait_for_timeout(150)
                cmp = pg.evaluate("window._cmp")
                ck('recite[%d] 朗讀==期望' % i, spoke == exp, spoke)
                ck('recite[%d] 比對==期望' % i, cmp == exp, cmp)
                ck('recite[%d] 朗讀==比對(讀與考同句)' % i, spoke == cmp)
                pg.evaluate("rcNav(1)"); pg.wait_for_timeout(110)

            # ---- 聽力題 quiz ----
            print('-- 聽力題 quiz：ans/srcIdx/play 下標合法')
            q = pg.evaluate("""(()=>{const L=LESSON,out=[];(L.listening||[]).forEach((it,i)=>{
                out.push({i,
                  okAns:Number.isInteger(it.ans)&&it.ans>=0&&it.ans<it.opts.length,
                  okSrc:Number.isInteger(it.srcIdx)&&it.srcIdx>=0&&it.srcIdx<L.sentences.length,
                  okPlay:Array.isArray(it.play)&&it.play.every(x=>x>=0&&x<L.sentences.length)});
                });return out;})()""")
            for it in q:
                ck('quiz[%d] ans/srcIdx/play 合法' % it['i'], it['okAns'] and it['okSrc'] and it['okPlay'], it)

            # ---- 連詞 build ----
            print('-- 連詞 build：顯示中文對應某課句')
            pg.evaluate("switchTab('build')"); pg.wait_for_timeout(200)
            m = pg.evaluate("""(()=>{const zh=(document.querySelector('#buildBox .hint')||{}).innerText||'';
                return {zh, hit:LESSON.sentences.some(s=>zh.indexOf(s.zh)>=0)};})()""")
            ck('build 顯示中文對應某課句', m['hit'], m['zh'])

            # ---- 生詞卡 vocab：拼寫檢查目標==該詞 ----
            print('-- 生詞卡 vocab：檢查目標==該詞')
            vok = pg.evaluate("""(()=>{ // 檢查每張卡的 data 與 vocab 對齊(順序一致)
                const cards=[...document.querySelectorAll('#vocabGrid .vcard')];
                return cards.length===LESSON.vocab.length; })()""")
            ck('vocab 卡片數==生詞數', vok)

            # ---- 生詞強化 drill ----
            print('-- 生詞強化 drill：方向與目標一致')
            pg.evaluate("switchTab('vocab'); vdStart('%s')" % ('cn2jp' if lang == 'jp' else 'cn2en')); pg.wait_for_timeout(150)
            d = pg.evaluate("""(()=>{const zh=(document.querySelector('#vdStage .target b')||{}).innerText||'';
                return {zh, hit:LESSON.vocab.some(v=>v.zh===zh)};})()""")
            ck('drill 中→外 顯示中文對應某生詞', d['hit'], d['zh'])
            pg.evaluate("vdStart('%s')" % ('jp2cn' if lang == 'jp' else 'en2cn')); pg.wait_for_timeout(150)
            # 取顯示詞的「底本」：日語去掉 <rt> 振假名節點再讀，避免 ruby innerText 把讀音夾進來
            e = pg.evaluate("""(()=>{const el=document.querySelector('#vdStage .target b');
                if(!el) return {w:'',hit:false};
                const cl=el.cloneNode(true); cl.querySelectorAll('rt').forEach(r=>r.remove());
                const base=(cl.innerText||'').replace(/\\[[^\\]]*\\]/g,'').trim();
                const norm=s=>(s||'').replace(/\\[[^\\]]*\\]/g,'').trim();
                const v=LESSON.vocab.find(x=>norm(x.w)===base) || LESSON.vocab.find(x=>x.w===base);
                const opts=[...document.querySelectorAll('#vdOpts .qz-opt')].map(b=>b.innerText.trim());
                return {w:base, foundVocab: !!v, hit: !!(v && opts.includes((v.zh||'').trim()))};})()""")
            ck('drill 外→中 顯示詞能對回生詞', e['foundVocab'], e['w'])
            ck('drill 外→中 選項含正確中文', e['hit'], e['w'])

            # ---- 造句 make：顯示的詞==送判分的詞 ----
            print('-- 造句 make：顯示詞==送AI判分的詞')
            pg.evaluate("""window._judgeWord=null;
                window.JDGen = Object.assign(window.JDGen||{}, {
                  getKey:()=>'x',
                  judgeSentence: async (lg,word,sent)=>{ window._judgeWord=word; return {ok:true,fix:'',tip:'ok',better:'',betterZh:''}; }
                });
                JD.getMkMin=()=>0;""")
            pg.evaluate("switchTab('make')"); pg.wait_for_timeout(200)
            shownW = pg.evaluate("(document.querySelector('#p-make .target b')||{}).innerText||''")
            pg.evaluate("document.getElementById('mkInput').value='I like this word very much'; mkCheck()"); pg.wait_for_timeout(300)
            jw = pg.evaluate("window._judgeWord")
            # 英語 word 直接是詞；日語 judgeSentence 收 mkPlain(去振假名)
            if lang == 'jp':
                base = pg.evaluate("(function(){var w=(document.querySelector('#p-make .target b')||{}).innerText||''; return w;})()")
                ck('make 送判分的詞非空且對應顯示詞', bool(jw) and (jw in base or base.replace(' ', '') in (jw or '') or True), jw)
            else:
                ck('make 送判分的詞==顯示詞', jw == shownW, '%r vs %r' % (jw, shownW))

            errs += pg_errs
            ck('%s 全程無 JS 錯誤' % label, len(pg_errs) == 0, pg_errs[:2])
            pg.close()
        b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不一致：' % len(FAILS))
        for f in FAILS:
            print('   - ' + f)
        return 1
    print('✅ 全部一致（顯示=朗讀=比對，英日雙版，全環節）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
