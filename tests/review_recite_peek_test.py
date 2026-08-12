#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_recite_peek_test.py —— 錯題集復習·背句「看幾秒」選擇閉環測試

問題：復習頁背句原本寫死看 10 秒，沒有課文頁那套「看幾秒(自動/5/10/15)+不看直接背」。
修法：復習頁沿用課文頁同一偏好鍵 jingdu_recite_sec2（單一事實源，兩處一致）。
英日兩版都要（舉一反三）。用法： python3 tests/review_recite_peek_test.py
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

def one(pg, port, base, label, sentence):
    print('-- %s' % label)
    pg.goto('http://127.0.0.1:%d/%s' % (port, base)); pg.wait_for_timeout(700)
    pg.evaluate("localStorage.removeItem('jingdu_recite_sec2')")
    pg.evaluate("window._it={id:'t#1',lessonId:'t',en:%r,zh:'測試',type:'sentence'}; startQuiz(window._it)" % sentence)
    pg.wait_for_timeout(200)
    btns = pg.evaluate("(document.getElementById('qBtns')||{}).innerText||''")
    ck('%s 有「看幾秒」選擇器(自動/5/10/15)' % label, ('看幾秒' in btns) and ('自動' in btns) and ('15' in btns), btns[:60])
    ck('%s 有「開始看題」' % label, '開始看題' in btns)
    ck('%s 有「不看，直接背」' % label, '直接背' in btns)
    # 選 5 秒 → 寫入同一偏好鍵、按鈕反映
    pg.evaluate("qSetSec('5')"); pg.wait_for_timeout(150)
    key = pg.evaluate("localStorage.getItem('jingdu_recite_sec2')")
    b5 = pg.evaluate("(document.getElementById('qBtns')||{}).innerText||''")
    ck('%s 選5秒→偏好鍵 jingdu_recite_sec2=5(與課文頁同鍵)' % label, key == '5', 'key=%s' % key)
    ck('%s 選5秒→按鈕顯示（5 秒）' % label, '5 秒' in b5, b5[:40])
    # 開始看題 → 倒數環從 5 起
    pg.evaluate("qStartPeek()"); pg.wait_for_timeout(200)
    sec0 = pg.evaluate("(document.getElementById('qSec')||{}).textContent||''")
    ck('%s 開始看題→倒數從 5 起' % label, sec0 in ('5', '4'), 'qSec=%s' % sec0)
    # 不看直接背 → 立即蓋住
    pg.evaluate("qReciteIdle(); qDirect()"); pg.wait_for_timeout(150)
    tgt = pg.evaluate("(document.getElementById('qTarget')||{}).innerText||''")
    ck('%s 不看直接背→立即蓋住' % label, '蓋住' in tgt, tgt[:30])

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        one(pg, port, 'review.html', '英語復習', 'This is a fairly long English test sentence for peek timing')
        one(pg, port, 'jp/review.html', '日語復習', 'これはテストのぶんです')
        pg.close(); b.close()
    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 復習背句「看幾秒」選擇全對（英日雙版·與課文頁共用偏好鍵）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
