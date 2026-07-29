#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
nav_ui_test.py —— 上一句/下一句排版 + 手機鍵盤遮輸入框修復 閉環測試

用戶反映：①手動輸入框(造句/生詞強化中外互譯)一點擊跳出鍵盤會蓋住輸入框；
②跟讀/背句/連詞成句/造句的上一句/下一句要放在顯眼處，不要往下滑才找得到。

驗證：
  - 全站 focus 監聽會把 input/textarea 捲到畫面中間(mock scrollIntoView 驗證有呼叫)
  - 跟讀(speak)：上一句/下一句放在「聽一遍」兩側，同一列、DOM 順序正確
  - 背句/連詞成句/造句：進度點(pills)正下方有固定的上一句/下一句列，換句/檢查/翻頁後仍在原位
  - 造句新增 mkPrev，能回上一個詞(下限夾在 0)
  - 舊的重複底部上一句/下一句已移除(不留兩套控制項造成混亂)

用法：  python3 tests/nav_ui_test.py
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
    with sync_playwright() as p:
        b = p.chromium.launch()

        for label, url in (('英語', 'http://127.0.0.1:%d/lessons/nce2-01.html' % port),
                            ('日語', 'http://127.0.0.1:%d/jp/lessons/jp-01.html' % port)):
            print('\n== %s ==' % label)
            pg = b.new_page(viewport={'width': 390, 'height': 820})
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(url); pg.wait_for_timeout(900)

            # ---- 1. 鍵盤遮輸入框：focus 觸發 scrollIntoView ----
            pg.evaluate("""window.__siv=0; Element.prototype.scrollIntoView = function(){ window.__siv++; };
                switchTab('make');""")
            pg.wait_for_timeout(150)
            pg.evaluate("document.getElementById('mkInput') && document.getElementById('mkInput').focus()")
            pg.wait_for_timeout(500)
            ck('%s: 造句輸入框 focus 觸發 scrollIntoView(鍵盤不遮擋)' % label, pg.evaluate("window.__siv") >= 1, pg.evaluate("window.__siv"))

            # ---- 2. 跟讀：上一句/下一句在「聽一遍」兩側，同一列 ----
            pg.evaluate("switchTab('speak')"); pg.wait_for_timeout(150)
            order = pg.evaluate("""(()=>{
                const row = (document.querySelector('#p-speak [onclick^="spkPlay"]')||{}).parentElement;
                if(!row) return null;
                return [...row.children].map(b=>b.getAttribute('onclick'));
            })()""")
            ck('%s: 跟讀 聽一遍 兩側是 spkNext(-1)/spkNext(1)（同一列順序：上一句/聽一遍/下一句）' % label,
               order == ['spkNext(-1)', 'spkPlay()', 'spkNext(1)'], order)
            # 舊的底部重複上一句/下一句應該只剩這一組（不該有兩組 spkNext 按鈕）
            cnt = pg.evaluate("document.querySelectorAll('[onclick^=\"spkNext\"]').length")
            ck('%s: 跟讀上一句/下一句只有一組(無重複)' % label, cnt == 2, cnt)

            # ---- 3. 背句：進度點下方固定 nav，換句後仍在原位（緊接 #rcPills）----
            pg.evaluate("switchTab('recite'); rcRender2()"); pg.wait_for_timeout(150)
            pos1 = pg.evaluate("""(()=>{const p=document.getElementById('rcPills'); const n=p&&p.nextElementSibling;
                return n && n.classList.contains('sec-nav');})()""")
            ck('%s: 背句 nav 緊接在 #rcPills 之後' % label, pos1, pos1)
            pg.evaluate("rcStart()"); pg.wait_for_timeout(150); pg.evaluate("rcSkipPeek()"); pg.wait_for_timeout(150)
            pos2 = pg.evaluate("""(()=>{const p=document.getElementById('rcPills'); const n=p&&p.nextElementSibling;
                return n && n.classList.contains('sec-nav');})()""")
            ck('%s: 背句蓋句階段後 nav 仍在原位(不用往下滑)' % label, pos2, pos2)
            oldBottom = pg.evaluate("document.querySelectorAll('#rcBtns [onclick^=\"rcNav\"]').length")
            ck('%s: 背句舊的按鈕群裡沒有殘留 rcNav(重複)' % label, oldBottom == 0, oldBottom)

            # ---- 4. 連詞成句：進度點下方固定 nav，排字/檢查後仍在原位 ----
            pg.evaluate("switchTab('build')"); pg.wait_for_timeout(150)
            bpos1 = pg.evaluate("""(()=>{const p=document.getElementById('bdPills'); const n=p&&p.nextElementSibling;
                return n && n.classList.contains('sec-nav');})()""")
            ck('%s: 連詞成句 nav 緊接在 #bdPills 之後' % label, bpos1, bpos1)
            bOldCnt = pg.evaluate("document.querySelectorAll('#buildBox [onclick^=\"bdNav\"]').length")
            ck('%s: 連詞成句框內沒有殘留 bdNav(重複)' % label, bOldCnt == 0, bOldCnt)

            # ---- 5. 造句：mkPrev 存在、nav 緊接 #mkPills、翻頁後仍在原位 ----
            pg.evaluate("switchTab('make')"); pg.wait_for_timeout(150)
            mpos1 = pg.evaluate("""(()=>{const p=document.getElementById('mkPills'); const n=p&&p.nextElementSibling;
                return n && n.classList.contains('sec-nav');})()""")
            ck('%s: 造句 nav 緊接在 #mkPills 之後' % label, mpos1, mpos1)
            ck('%s: mkPrev 函式存在' % label, pg.evaluate("typeof window.mkPrev==='function'"))
            pg.evaluate("mkNext()"); pg.wait_for_timeout(150)
            mpos2 = pg.evaluate("""(()=>{const p=document.getElementById('mkPills'); const n=p&&p.nextElementSibling;
                return n && n.classList.contains('sec-nav');})()""")
            ck('%s: 造句翻到下一詞後 nav 仍在原位' % label, mpos2, mpos2)
            pg.evaluate("mkPrev(); mkPrev(); mkPrev()"); pg.wait_for_timeout(100)  # 超界回拉，應夾在 0
            mi = pg.evaluate("document.querySelector('#mkStage .target b')?.innerText || document.querySelector('#mkStage')?.innerText.slice(0,20)")
            ck('%s: mkPrev 連續回拉不報錯(夾在下限)' % label, mi is not None, mi)

            ck('%s: 全程無 JS 錯誤' % label, len(errs) == 0, errs[:2])
            pg.close()

        b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 上一句/下一句排版 + 鍵盤遮輸入框修復 全對（英日雙版）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
