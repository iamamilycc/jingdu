#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_empty_guard_test.py —— 造句「內容門檻」閉環測試

Bug：造句沒輸入(或只打一個字元/單詞)點檢查，寬鬆 AI 回 ok:true → 顯示「🎉 很好/做得好」。
純空白本來就有擋，但「只打一個非空白字元」會被送去 AI 而被亂讚美。
修法：加內容門檻——英文至少 2 個詞、日文要比單詞本身更長，不成句就擋下、不送 AI、不讚美。
英日兩版。用法： python3 tests/make_empty_guard_test.py
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

def praised(pg):
    f = pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")
    return ('🎉' in f) or ('很好' in f) or ('好句子' in f), f

def setval(pg, v):
    pg.evaluate("v => document.getElementById('mkInput').value = v", v)

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    # 用寬鬆 AI(一律回 ok:true)模擬：門檻擋不住的話就會亂讚美
    MOCK = "window.JDGen=Object.assign(window.JDGen||{},{getKey:function(){return 'x'},judgeSentence:function(){return Promise.resolve({ok:true,tip:'很好',fix:'',better:'',betterZh:''})}});"
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()

        # ---- 英語 ----
        print('-- 英語造句內容門檻')
        pg.goto('http://127.0.0.1:%d/lessons/nce2-01.html' % port); pg.wait_for_timeout(900)
        pg.evaluate("JD.setMkMin(0); switchTab('make')"); pg.wait_for_timeout(150); pg.evaluate(MOCK)
        for v in ('x', '.', 'go'):
            pg.evaluate("mkRestart&&mkRestart()"); pg.wait_for_timeout(60); setval(pg, v); pg.evaluate("mkCheck()"); pg.wait_for_timeout(200)
            pr, f = praised(pg); ck('英語 只打 %r → 不讚美(擋下)' % v, not pr, f[:36])
        pg.evaluate("mkRestart&&mkRestart()"); pg.wait_for_timeout(60); setval(pg, 'I go to school'); pg.evaluate("mkCheck()"); pg.wait_for_timeout(250)
        pr, f = praised(pg); ck('英語 正常句 → 正常讚美(不誤擋)', pr, f[:30])

        # ---- 日語 ----
        print('-- 日語造句內容門檻')
        pg.goto('http://127.0.0.1:%d/jp/lessons/jp-01.html' % port); pg.wait_for_timeout(900)
        pg.evaluate("JD.setMkMin(0); switchTab('make')"); pg.wait_for_timeout(150); pg.evaluate(MOCK)
        for v in ('あ', 'x'):
            pg.evaluate("mkRestart&&mkRestart()"); pg.wait_for_timeout(60); setval(pg, v); pg.evaluate("mkCheck()"); pg.wait_for_timeout(200)
            pr, f = praised(pg); ck('日語 只打 %r → 不讚美(擋下)' % v, not pr, f[:36])
        word = pg.evaluate("(document.querySelector('#mkStage .target b')||{}).innerText||''")
        setval(pg, 'これは' + word + 'のぶんです'); pg.evaluate("mkCheck()"); pg.wait_for_timeout(250)
        pr, f = praised(pg); ck('日語 正常句 → 正常讚美(不誤擋)', pr, f[:30])

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 造句內容門檻全對（片段不亂讚美 / 正常句不誤擋，英日雙版）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
