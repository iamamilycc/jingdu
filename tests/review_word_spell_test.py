#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_word_spell_test.py —— 錯題本「單字類」複習改用打字拼寫（與生詞卡一致）閉環測試

問題：生詞卡用打字拼寫學，但錯題本單字複習卻用語音唸；單字語音常辨識失敗(aloud→allowed)，
會拼卻晉級不掉→一直卡在錯題本。修法：單字複習改成打字拼寫(look-cover-write-check)＝確定性判斷，
會拼就晉級離開，且與生詞卡學法一致。英日兩版。用法： python3 tests/review_word_spell_test.py
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

def one(pg, port, base, label, en, zh):
    print('-- %s' % label)
    pg.goto('http://127.0.0.1:%d/%s' % (port, base)); pg.wait_for_timeout(700)
    pg.evaluate("localStorage.removeItem('jingdu_errbook'); JD.addError({id:'w:t#%s',lessonId:'t',en:%r,zh:%r,type:'word',pos:'n.'})" % (en, en, zh))
    lvl0 = pg.evaluate("Object.values(JD.getBook())[0].level")
    pg.evaluate("cur=Object.values(JD.getBook())[0]; startQuiz(cur)"); pg.wait_for_timeout(200)
    has_spell = pg.evaluate("!!document.getElementById('qSpell')")
    has_mic = pg.evaluate("!!document.getElementById('qRecBtn')")
    ck('%s 單字複習=打字框(非麥克風)' % label, has_spell and not has_mic, 'spell=%s mic=%s' % (has_spell, has_mic))
    # 拼對→晉級
    pg.evaluate("document.getElementById('qSpell').value=%r; qSpellCheck()" % en); pg.wait_for_timeout(200)
    btns = pg.evaluate("(document.getElementById('qBtns')||{}).innerText||''")
    lvl1 = pg.evaluate("(Object.values(JD.getBook())[0]||{}).level")
    ck('%s 拼對→顯示晉級' % label, '晉級成功' in btns, btns[:40])
    ck('%s 拼對→level 上升(%s→%s)' % (label, lvl0, lvl1), (lvl1 is None) or (lvl1 > lvl0), 'lvl %s→%s' % (lvl0, lvl1))
    # 拼錯→打回第一級 + 顯示正解
    pg.evaluate("localStorage.removeItem('jingdu_errbook'); JD.addError({id:'w:t#%s',lessonId:'t',en:%r,zh:%r,type:'word',pos:'n.'}); cur=Object.values(JD.getBook())[0]; startQuiz(cur)" % (en, en, zh))
    pg.wait_for_timeout(150)
    pg.evaluate("document.getElementById('qSpell').value='zzzwrong'; qSpellCheck()"); pg.wait_for_timeout(200)
    res2 = pg.evaluate("(document.getElementById('qResult')||{}).innerText||''")
    btns2 = pg.evaluate("(document.getElementById('qBtns')||{}).innerText||''")
    ck('%s 拼錯→顯示正解' % label, en in res2, res2[:40])
    ck('%s 拼錯→打回第一級' % label, ('第一級' in btns2) or ('30 分鐘' in btns2), btns2[:40])

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        one(pg, port, 'review.html', '英語單字複習', 'seat', '座位')
        one(pg, port, 'jp/review.html', '日語單字複習', 'ぎんこう', '銀行')
        pg.close(); b.close()
    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 單字複習打字拼寫全對（英日雙版·拼對晉級/拼錯打回，與生詞卡一致）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
