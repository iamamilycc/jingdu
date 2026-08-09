#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_chip_test.py —— 首頁同步入口「導覽列小圓片」行為閉環測試

使用者回饋：整寬同步設定卡佔首頁直向空間，且切換使用者/設定設一次就很少動。
改成導覽列一個小圓片：
  - 未設定 → 醒目 CTA「☁️ 開啟備份」（家長 CTA 不能藏太深，否則沒人設→資料會丟）
  - 已設定 → 「👤 名字 ☁️」，點一下才彈小選單給「切換使用者／同步設定」
  - 首頁不再有整寬 #syncCard 大卡

英日兩個首頁都要一致（舉一反三）。用法： python3 tests/sync_chip_test.py
"""
import os, sys, time, socket, http.server, threading, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_KEY = 'jingdu_sync'   # NS('jingdu_')+'sync'，與 sync.js 生產鍵一致（造數據必用生產鍵）

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
        pg = b.new_page(viewport={'width': 390, 'height': 760})
        for base in ('index.html', 'jp/index.html'):
            print('-- %s' % base)
            pg.goto('http://127.0.0.1:%d/%s' % (port, base)); pg.wait_for_timeout(700)
            # 首頁不再有整寬大卡
            ck('%s 首頁已無整寬 #syncCard 大卡' % base, not pg.evaluate("!!document.getElementById('syncCard')"))
            # 小圓片存在且在 header 導覽列內
            in_header = pg.evaluate("(()=>{const c=document.getElementById('syncChip');return !!c && !!c.closest('header.site');})()")
            ck('%s 小圓片 #syncChip 在導覽列內' % base, in_header)
            # 未設定 → CTA
            txt = pg.evaluate("document.getElementById('syncChip').innerText")
            cls = pg.evaluate("document.getElementById('syncChip').className")
            ck('%s 未設定→顯示「開啟備份」且是 cta 樣式' % base, ('開啟備份' in txt) and ('cta' in cls), '%r / %s' % (txt, cls))
            # 設定後（正確生產鍵）→ 已設定態
            pg.evaluate("localStorage.setItem('%s', JSON.stringify({provider:'gitee',user:'小明',token:'x',owner:'o',repo:'jingdu-data'}))" % CFG_KEY)
            pg.reload(); pg.wait_for_timeout(700)
            txt2 = pg.evaluate("document.getElementById('syncChip').innerText")
            cls2 = pg.evaluate("document.getElementById('syncChip').className")
            ck('%s 已設定→顯示「👤 小明」、非 cta' % base, ('小明' in txt2) and ('cta' not in cls2), '%r / %s' % (txt2, cls2))
            # 點圓片 → 彈選單含兩個管理動作
            pg.click('#syncChip'); pg.wait_for_timeout(300)
            mtxt = pg.evaluate("(document.querySelector('.jd-modal')||{}).innerText||''")
            ck('%s 點片彈選單含「切換使用者」' % base, '切換使用者' in mtxt, mtxt[:60])
            ck('%s 點片彈選單含「同步設定」' % base, '同步設定' in mtxt, mtxt[:60])
            # 關閉並清掉造的數據
            pg.evaluate("(document.querySelector('.jd-modal-mask')||{}).remove && document.querySelector('.jd-modal-mask').remove()")
            pg.evaluate("localStorage.removeItem('%s')" % CFG_KEY)
        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 同步小圓片行為全對（英日雙版：未設定 CTA／已設定彈選單／首頁無大卡）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
