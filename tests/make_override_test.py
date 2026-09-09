#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_override_test.py —— 造句「AI 判錯不由孩子裁決」閉環測試

2026-09-09 用戶定規則：**兒童向產品不准把校驗推給人**，要用
「程序清洗＋聚焦二次核對＋程序化保底」三層擋住。

原本的設計是：AI 判錯 → 顯示「🙋 我覺得這句沒問題」，孩子一按就當對。
出發點是防 AI 誤判，但那等於把最後的判斷交給一個沒有判斷能力的孩子——
他要是能判斷這句對不對，就不用練了。這支測試現在鎖的是新行為：

  ① 判分以**規則引擎**（assets/grammar-en.js，兩站共用）為準，不是 AI
  ② 規則能百分之百確定時（文法錯／中式說法／意思說不通）根本不調 AI
  ③ AI 說「意思怪」只降級成一條參考提醒：不阻斷、不進錯題本、不要孩子裁決

用法： python3 tests/make_override_test.py
"""
import os, sys, time, socket, http.server, threading, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def serve(port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)[:200]))
    if not cond:
        FAILS.append(name)


# AI 一律唱反調：它說錯、還想塞一句沒用上生詞的示範句
MOCK_WRONG = ("window._judgeCalls=0;"
              "window.JDGen=Object.assign(window.JDGen||{},{getKey:function(){return 'x'},"
              "judgeSentence:function(){window._judgeCalls++;return Promise.resolve("
              "{ok:false,fix:'AI FIX WITHOUT THE WORD',tip:'語序怪',"
              "better:'AI BETTER WITHOUT THE WORD',betterZh:''})}});")

# 文法完全正確的一句（規則層會判通過，AI 卻說錯）
SEND_GOOD = ("""(()=>{const w=(document.querySelector('#mkStage .target b')||{}).innerText||'thing';
  document.getElementById('mkInput').value='I really like this new '+w+' today.'; mkCheck();})()""")
# 三單漏 s：規則層自己就抓得到
SEND_BAD = ("""(()=>{const w=(document.querySelector('#mkStage .target b')||{}).innerText||'thing';
  document.getElementById('mkInput').value='He like this new '+w+' very much.'; mkCheck();})()""")


def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto('http://127.0.0.1:%d/lessons/nce2-01.html' % port); pg.wait_for_timeout(900)
        ck('規則引擎載入了', pg.evaluate("!!(window.GrammarEN && window.GrammarEN.checkGrammar)"),
           '沒載入＝對錯又回到 AI 手上')
        pg.evaluate("JD.setMkMin(0); localStorage.removeItem('jingdu_errbook'); switchTab('make')"); pg.wait_for_timeout(200)

        print('-- ① 規則層自己判得出的錯：不調 AI，直接給改法')
        pg.evaluate(MOCK_WRONG)
        pg.evaluate("mkRestart&&mkRestart()"); pg.wait_for_timeout(120)
        pg.evaluate(SEND_BAD); pg.wait_for_timeout(400)
        fb = pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")
        ck('文法錯被規則層抓到', '要改一改' in fb and '少了 s' in fb, fb[:200])
        ck('規則能確定 → 一次都沒調 AI', pg.evaluate("window._judgeCalls") == 0, pg.evaluate("window._judgeCalls"))
        ck('直接給改好的整句', '改好應該是這樣' in fb, fb[:250])
        ck('判錯 → 那個詞進錯題本', pg.evaluate("Object.keys(JD.getBook()).length") == 1,
           pg.evaluate("Object.keys(JD.getBook())"))
        ck('沒有「我覺得這句沒問題」裁決鈕', not pg.evaluate("!!document.querySelector('#mkFb .jd-mkok')"))

        print('-- ①b 文法錯 + 中式說法同時命中：只能給「一個」改好的句子')
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); mkRestart&&mkRestart()"); pg.wait_for_timeout(120)
        pg.evaluate("""(()=>{const w=(document.querySelector('#mkStage .target b')||{}).innerText||'thing';
          document.getElementById('mkInput').value='I very like this '+w+' today.'; mkCheck();})()""")
        pg.wait_for_timeout(400)
        fb1b = pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")
        ck('中式說法也被指出來', '歐美人不這麼說' in fb1b, fb1b[:200])
        ck('只給一個「改好應該是這樣」（兩個會互相矛盾，孩子不知照哪個抄）',
           fb1b.count('改好應該是這樣') == 1, '出現 %d 次' % fb1b.count('改好應該是這樣'))

        print('-- ② 規則層判通過、AI 卻說錯：AI 只當參考，不阻斷也不進錯題本')
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); mkRestart&&mkRestart()"); pg.wait_for_timeout(120)
        pg.evaluate(MOCK_WRONG)
        pg.evaluate(SEND_GOOD); pg.wait_for_timeout(500)
        fb2 = pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")
        ck('規則層先判通過', '規則檢查通過' in fb2, fb2[:200])
        ck('AI 的話降級成「另外提了一句」', 'AI 老師另外提了一句' in fb2, fb2[:300])
        ck('明講「你這句是通過的」', '你這句是通過的' in fb2, fb2[:300])
        ck('不要孩子裁決 AI', ('我覺得這句沒問題' not in fb2) and
           (not pg.evaluate("!!document.querySelector('#mkFb .jd-mkok')")), fb2[:200])
        ck('AI 判錯不進錯題本', pg.evaluate("Object.keys(JD.getBook()).length") == 0,
           pg.evaluate("Object.keys(JD.getBook())"))
        ck('AI 給的示範句沒用上生詞 → 被丟掉不顯示',
           'AI BETTER WITHOUT THE WORD' not in fb2 and 'AI FIX WITHOUT THE WORD' not in fb2, fb2[:300])

        print('-- ③ 沒有 AI Key 也照樣判得出對錯（規則層不依賴 AI）')
        pg.evaluate("window.JDGen=Object.assign(window.JDGen||{},{getKey:function(){return ''}});")
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); mkRestart&&mkRestart()"); pg.wait_for_timeout(120)
        pg.evaluate(SEND_GOOD); pg.wait_for_timeout(400)
        fb3 = pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")
        ck('沒 Key 也給得出通過的結論', '檢查通過' in fb3, fb3[:200])
        ck('沒 Key 時說清楚查過哪些', '系統能確定的都查過了' in fb3, fb3[:250])
        ck('沒有自評按鈕', '都核對過' not in fb3 and '用對了' not in fb3, fb3[:250])

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS:
            print('   - ' + f)
        return 1
    print('✅ 造句判分不把校驗推給孩子（規則層判分／AI 只當參考／沒 Key 照樣判）')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
