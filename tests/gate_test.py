#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gate_test.py —— 虫虫精讀「家長復習鎖」行為閉環測試

驗證 strict 模式 + 有到期複習沒清完時，「加新課」這個動作真的被擋住（不是只在
首頁改連結——那樣走說明頁/書籤/直接輸網址就能繞過）。同時驗證 free 模式或沒到期
複習時不會誤擋。

用法：  python3 tests/gate_test.py
成功：  印「門禁行為正確 ✅」且退出碼 0。
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
    port = free_port(); serve(port); time.sleep(0.5)
    url = 'http://127.0.0.1:%d/new.html' % port
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 820})
        pg.goto(url); pg.wait_for_timeout(900)

        # 攔截真正的 AI 生成：若流程越過門禁走到生成，丟一個哨兵錯誤，讓我們知道「沒被擋」
        pg.evaluate("""
          window.JDGen = Object.assign(window.JDGen||{}, {
            setKey:()=>{}, setModels:()=>{},
            fromText: async ()=>{ throw new Error('__REACHED_GEN__'); },
            fromImage: async ()=>{ throw new Error('__REACHED_GEN__'); }
          });
        """)

        def attempt(gate, due_lang, sel_lang):
            # 佈置：設 gate、清錯題本、按需塞一筆到期(due 在過去)的錯題
            pg.evaluate("""(([gate,dueLang])=>{
              JD.setGate(gate);
              const book = dueLang ? {x:{solid:false, due:1, lang:dueLang, lessonId:'nce2-01', zh:'x', en:'x'}} : {};
              localStorage.setItem('jingdu_errbook', JSON.stringify(book));
            })(%s)""" % ([gate, due_lang].__repr__().replace("'", '"').replace('None', 'null')))
            pg.evaluate("setLang('%s')" % sel_lang)
            pg.evaluate("document.querySelector('#apiKey').value='dummy-key-123'")
            pg.evaluate("document.querySelector('#pasteText').value='Hello world. This is a test.'")
            pg.evaluate("window.__gen = doGenerate()")  # 觸發，回傳 promise
            pg.wait_for_timeout(500)
            return pg.evaluate("(document.querySelector('#genFb')||{}).innerText||''")

        # 1) strict + 英語有到期 + 選英語 → 必須被擋（不到生成）
        fb1 = attempt('strict', 'en', 'en')
        ck('strict+英到期+選英 → 被復習鎖擋', ('復習鎖' in fb1) or ('先複習' in fb1) or ('去複習' in fb1), fb1)
        ck('strict+英到期 → 沒越過門禁去生成', '__REACHED_GEN__' not in fb1, fb1)

        # 2) strict + 只有英語到期 + 選日語 → 日語不該被英語的到期擋（gate 分語言）
        fb2 = attempt('strict', 'en', 'jp')
        ck('strict+只英到期+選日 → 日語不被誤擋(越過門禁到生成)', '__REACHED_GEN__' in fb2, fb2)

        # 3) free 模式 + 英語有到期 + 選英語 → free 不鎖，應越過門禁
        fb3 = attempt('free', 'en', 'en')
        ck('free 模式 → 不鎖，越過門禁到生成', '__REACHED_GEN__' in fb3, fb3)

        # 4) strict + 沒有任何到期 + 選英語 → 沒到期就不該擋
        fb4 = attempt('strict', None, 'en')
        ck('strict+無到期 → 不擋，越過門禁到生成', '__REACHED_GEN__' in fb4, fb4)

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項門禁行為錯誤：' % len(FAILS))
        for f in FAILS:
            print('   - ' + f)
        return 1
    print('✅ 門禁行為正確（strict 擋、分語言、free 放行、無到期放行）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
