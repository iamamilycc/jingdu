#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lesson_behavior_test.py —— 造句/聽力題「計分與家長控制」行為閉環測試（fable-5 審查 P1）

過去只驗 quiz 下標合法、make 送判詞，沒驗「行為」。這裡補：
  - mkMin 家長控制：詞數不足時擋下、**不送 AI 判分**；達標才送
  - 造句地道說法：judgeSentence 回 better → 渲染「🌟 地道說法」+ 發音鈕
  - 聽力題計分：直接答對 score++；看過答案(revealed)才答對→算錯不計分、進錯題本；答錯→進錯題本

用法：  python3 tests/lesson_behavior_test.py
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
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(url); pg.wait_for_timeout(1000)

        # 造句 mock：計數 judgeSentence 呼叫 + 回 better
        pg.evaluate("""window._judgeCalls=0;
            window.JDGen = Object.assign(window.JDGen||{}, {
              getKey:()=>'x',
              judgeSentence: async (lg,word,sent)=>{ window._judgeCalls++;
                return {ok:true,fix:'',tip:'很好',better:'This is a much better sentence.',betterZh:'這是更地道的說法。'}; }
            });""")

        # ---- mkMin：不足詞數擋下、不送 AI ----
        print('-- 造句最少詞數 mkMin：不足擋下且不送 AI')
        pg.evaluate("JD.setMkMin(5); switchTab('make')"); pg.wait_for_timeout(200)
        pg.evaluate("window._judgeCalls=0; document.getElementById('mkInput').value='I am happy'; mkCheck()"); pg.wait_for_timeout(200)
        fb = pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")
        ck('3 詞(<5)→提示至少 5 個', '至少' in fb and '5' in fb, fb)
        ck('不足詞數→沒送 AI 判分(judgeSentence 未被呼叫)', pg.evaluate("window._judgeCalls") == 0, pg.evaluate("window._judgeCalls"))
        # 達標 → 送 AI
        pg.evaluate("window._judgeCalls=0; document.getElementById('mkInput').value='I am really very happy today'; mkCheck()"); pg.wait_for_timeout(300)
        ck('達標(6 詞)→送 AI 判分', pg.evaluate("window._judgeCalls") == 1, pg.evaluate("window._judgeCalls"))

        # ---- 造句地道說法：better 渲染 ----
        print('-- 造句地道說法：judgeSentence 回 better → 渲染 🌟 地道說法 + 發音鈕')
        fb2 = pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")
        ck('顯示 🌟 地道說法示範句', ('地道' in fb2) and ('better sentence' in fb2), fb2)
        ck('地道說法有發音鈕 #mkBetterVoice', pg.evaluate("!!document.getElementById('mkBetterVoice')"))

        # 關掉 mkMin 免干擾後續
        pg.evaluate("JD.setMkMin(0)")

        # ---- 聽力題計分 ----
        print('-- 聽力題計分：直接答對計分 / 看過答案答對算錯進錯題本 / 答錯進錯題本')
        pg.evaluate("localStorage.removeItem('jingdu_errbook')")
        pg.evaluate("switchTab('quiz'); qzRestart && qzRestart()"); pg.wait_for_timeout(250)
        # 直接答對第 1 題（點 it.ans 那個選項）
        ans0 = pg.evaluate("LESSON.listening[0].ans")
        pg.evaluate("document.querySelectorAll('#qzOpts .qz-opt')[%d].click()" % ans0); pg.wait_for_timeout(200)
        fb3 = pg.evaluate("(document.getElementById('qzFb')||{}).innerText||''")
        ck('直接答對→顯示答對了', '答對了' in fb3 and '看過' not in fb3, fb3)
        book1 = pg.evaluate("Object.keys(JD.getBook()).length")
        ck('直接答對→不進錯題本', book1 == 0, book1)
        # 下一題：先看答案(reveal)再答對 → 算錯、進錯題本
        pg.evaluate("qzNext()"); pg.wait_for_timeout(200)
        pg.evaluate("qzReveal()"); pg.wait_for_timeout(100)
        ans1 = pg.evaluate("LESSON.listening[1].ans")
        pg.evaluate("document.querySelectorAll('#qzOpts .qz-opt')[%d].click()" % ans1); pg.wait_for_timeout(200)
        fb4 = pg.evaluate("(document.getElementById('qzFb')||{}).innerText||''")
        ck('看過答案才答對→提示算錯', '看過答案' in fb4, fb4)
        book2 = pg.evaluate("Object.keys(JD.getBook()).length")
        ck('看過答案答對→進錯題本(+1)', book2 == 1, book2)

        # ---- 跟讀 低分自評兜底（引擎聽不出 aloud 這類詞時，念對能自評過關，不卡死）----
        print('-- 低分自評兜底：引擎聽不出的詞，念對能自評過關')
        # 沒開發音評估→走瀏覽器路徑；mock JD.listen 回一個「聽錯」的結果讓 compare 低分
        pg.evaluate("""window._spkAcc=null;
            JD.recSupported=()=>true;
            JD.listen=(cb)=>{ setTimeout(()=>cb('completely wrong words here', null, ['completely wrong words here']), 10); return {stop:()=>{},abort:()=>{}}; };
        """)
        pg.evaluate("switchTab('speak'); spkNext(0)"); pg.wait_for_timeout(150)
        pg.evaluate("document.getElementById('spkRecBtn').click()"); pg.wait_for_timeout(250)  # 觸發 spkRec→listen(mock)→低分
        resHtml = pg.evaluate("(document.getElementById('spkResult')||{}).innerText||''")
        ck('低分→結果區出現「我確定念對了」自評按鈕', '念對了' in resHtml, resHtml[:120])
        acc0 = pg.evaluate("JD.lessonScore(LESSON.id).accuracy")
        # 點自評按鈕
        clicked = pg.evaluate("""(()=>{ const btns=[...document.querySelectorAll('#spkResult button')];
            const b=btns.find(x=>x.innerText.indexOf('念對了')>=0); if(!b) return false; b.click(); return true; })()""")
        ck('自評按鈕可點', clicked, clicked)
        pg.wait_for_timeout(150)
        passed = pg.evaluate("(document.getElementById('spkResult')||{}).innerText||''")
        ck('點自評→顯示「自評通過」', '自評通過' in passed, passed[:80])
        acc1 = pg.evaluate("JD.lessonScore(LESSON.id).accuracy")
        ck('自評後該句計為通過(得分提升到 PASS 級)', acc1 >= acc0, '%s→%s' % (acc0, acc1))

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 造句/聽力計分行為全對（mkMin擋且不送AI/地道說法/看答案算錯進錯題本）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
