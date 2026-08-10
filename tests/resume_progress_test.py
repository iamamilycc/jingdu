#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
resume_progress_test.py —— 「環節做一半→退出→再進來續做」進度閉環測試

歷史 bug：各環節的結果容器(judged Set / results 陣列)每次進頁面都是空的，
pos() 算出的完成數從 0 重來，配 setSecPos 的 Math.max(只增不減) →
打卡進度條卡在舊值不動、且該環節永遠湊不滿無法完成。
修法：resume 時把「前 done 項當已完成、前 score 項當答對」回填進容器(seedResults/seedSet)。

這裡用 vocab(Set 型) + make(陣列型) 實測「續做能繼續推進進度」，並鎖死五個環節都有回填。
用法： python3 tests/resume_progress_test.py
"""
import os, sys, time, socket, http.server, threading, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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
    port = free_port(); serve(port); time.sleep(0.4)
    url = 'http://127.0.0.1:%d/lessons/nce2-01.html' % port
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto(url); pg.wait_for_timeout(900)
        lid = pg.evaluate("LESSON.id")

        # ---- 靜態 parity：五個可續做的計分環節都有回填 ----
        print('-- 五環節續做回填 parity（漏一個就會卡住）')
        src = pg.evaluate("(async()=>{const r=await fetch('/assets/lesson.js');return await r.text();})()")
        ck("vocab 有 seedSet 回填", "seedSet(judged" in src)
        ck("build 有 seedResults 回填", "seedResults('build'" in src)
        ck("speak 有 seedResults 回填", "seedResults('speak'" in src)
        ck("recite 有 seedResults 回填", "seedResults('recite'" in src)
        ck("make 有 seedResults 回填", "seedResults('make'" in src)

        # ---- vocab（Set 型）續做能推進 ----
        print('-- vocab 續做：done=3 → 重載 → 拼對第4張 → done 應到 4')
        n = pg.evaluate("LESSON.vocab.length")
        pg.evaluate("JD.setSecPos(LESSON.id,'vocab',3,%d,3)" % n)
        pg.reload(); pg.wait_for_timeout(800)
        pg.evaluate("switchTab('vocab')"); pg.wait_for_timeout(200)
        pg.evaluate("""(()=>{const c=document.querySelectorAll('#vocabGrid .vcard')[3];c.classList.add('flip');
            const inp=c.querySelector('.vspell input');inp.value=LESSON.vocab[3].w;c.querySelector('.vbtn.yes').click();})()""")
        pg.wait_for_timeout(300)
        done_v = pg.evaluate("(JD.getSecPos(LESSON.id).vocab||{}).done")
        ck('vocab 續做後 done 從 3 前進到 4（不再卡住）', done_v == 4, 'done=%s' % done_v)

        # ---- make（陣列型）續做能推進 ----
        print('-- make 續做：done=2 → 重載 → 造對第3個 → done 應到 3')
        pg.evaluate("localStorage.setItem('jingdu_mkmin','0')")
        mn = pg.evaluate("(function(){return (window.LESSON.vocab||[]).length})()")
        pg.evaluate("JD.setSecPos(LESSON.id,'make',2,%d,2)" % mn)
        # mock judgeSentence 回造對
        pg.reload(); pg.wait_for_timeout(800)
        pg.evaluate("""window.JDGen=Object.assign(window.JDGen||{},{getKey:()=>'x',
            judgeSentence: async ()=>({ok:true,fix:'',tip:'好',better:'',betterZh:''})});
            JD.setMkMin(0);""")
        pg.evaluate("switchTab('make')"); pg.wait_for_timeout(200)
        done_m0 = pg.evaluate("(JD.getSecPos(LESSON.id).make||{}).done")
        pg.evaluate("document.getElementById('mkInput').value='a fine correct sentence'; mkCheck()"); pg.wait_for_timeout(300)
        pg.evaluate("mkNext()"); pg.wait_for_timeout(200)   # make 的進度在「下一個詞」才寫入
        done_m = pg.evaluate("(JD.getSecPos(LESSON.id).make||{}).done")
        ck('make 續做前 done 顯示為累積值 2（回填生效，非 0）', done_m0 == 2, 'done0=%s' % done_m0)
        ck('make 續做後 done 從 2 前進到 3（不再卡住）', done_m == 3, 'done=%s' % done_m)

        # ---- 生詞強化練習：答錯進錯題本 + 有可見「已進錯題本」提示 ----
        print('-- 生詞強化練習：答錯進錯題本且有明確提示')
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); switchTab('vocab')"); pg.wait_for_timeout(150)
        pg.evaluate("vdStart('en2cn')"); pg.wait_for_timeout(150)
        pills = pg.evaluate("document.querySelectorAll('#vdPills .pill').length")
        ck('強化練習開始一輪→進度條(pills)有顯示', pills > 0, 'pills=%d' % pills)
        # 開練→上方生詞卡要收起(防偷看答案)+顯示提示
        ck('開練→生詞卡收起(display:none)', pg.evaluate("getComputedStyle(document.getElementById('vocabGrid')).display") == 'none')
        ck('開練→顯示「已收起免偷看」提示', pg.evaluate("(document.getElementById('vdFoldNote')||{}).style?document.getElementById('vdFoldNote').style.display:'' ") == 'block')
        before = pg.evaluate("Object.keys(JD.getBook()).length")
        pg.evaluate("vdReveal()"); pg.wait_for_timeout(200)
        after = pg.evaluate("Object.keys(JD.getBook()).length")
        fb = pg.evaluate("(document.getElementById('vdFb')||{}).innerText||''")
        ck('強化練習(英→中方向)答錯→錯題本 +1', after == before + 1, '%d→%d' % (before, after))
        ck('強化練習(英→中方向)答錯→有「已放進錯題本」可見提示', '錯題本' in fb, fb[:60])
        # 另一方向：中→英「看中文默寫」，打錯字也要有進度條+進錯題本
        print('-- 強化練習另一方向：中→英 默寫打錯')
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); vdStart('cn2en')"); pg.wait_for_timeout(200)
        pills2 = pg.evaluate("document.querySelectorAll('#vdPills .pill').length")
        ck('強化練習(中→英方向)有進度條(pills)', pills2 > 0, 'pills=%d' % pills2)
        b2 = pg.evaluate("Object.keys(JD.getBook()).length")
        pg.evaluate("var i=document.getElementById('vdIn'); if(i) i.value='zzzzwrong'; vdCheckCn2En()"); pg.wait_for_timeout(200)
        a2 = pg.evaluate("Object.keys(JD.getBook()).length")
        fb2 = pg.evaluate("(document.getElementById('vdFb')||{}).innerText||''")
        ck('強化練習(中→英方向)默寫打錯→錯題本 +1', a2 == b2 + 1, '%d→%d' % (b2, a2))
        ck('強化練習(中→英方向)打錯→有「已放進錯題本」提示', '錯題本' in fb2, fb2[:60])
        # 回到選單也要有(淡)進度條
        menu_pills = pg.evaluate("(function(){ for(var k=0;k<50;k++){ if(typeof vdNext==='function') vdNext(); } return document.querySelectorAll('#vdPills .pill').length; })()")
        ck('強化練習練完回選單→仍顯示(淡)進度條', menu_pills > 0, 'menu pills=%d' % menu_pills)
        ck('練完回選單→生詞卡放回(display 非 none)', pg.evaluate("getComputedStyle(document.getElementById('vocabGrid')).display") != 'none')

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 續做進度不卡住 + 強化練習進度條/錯題本提示 全對')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
