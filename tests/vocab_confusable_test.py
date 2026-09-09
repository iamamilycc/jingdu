#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vocab_confusable_test.py —— 生詞卡「不算拼錯的兩種情況」真點擊閉環測試

⭐ 為什麼要有：static_checks 只 grep 到 `confusableNote` 就算過，那只證明**寫了**，
   不證明**接上了、跑得起來、看得到**。這支真的翻卡片、真的打字、真的點檢查，
   斷言孩子眼前確實出現該出現的說明。

兩種情況（規則和測驗站共用同一個引擎，見 assets/grammar-en.js）：
  ① 寫成美式拼法（colour → color）：他沒拼錯 → 要算**對**，並說清英式/美式口徑
  ② 寫成同音／形近的另一個真詞（hear → here）：不是拼錯，是兩個詞記混了
     → 判**錯**，但要講兩個詞的區別，**不能**只丟一句「正確拼寫是 hear」

用法： python3 tests/vocab_confusable_test.py
"""
import functools
import http.server
import os
import socket
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []


def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)[:220]))
    if not cond:
        FAILS.append(name)


def run():
    from playwright.sync_api import sync_playwright
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        # 用「自建課」路徑測（view.html 從 localStorage 讀）——這是使用者真的會走的一條路，
        # 也讓測試能自己準備要考的詞，不必依賴某一課剛好收了 hear / colour。
        LESSON = {
            "id": "t-confuse", "num": "T1", "en": "Test Lesson", "zh": "測試課",
            "sentences": [{"en": "I can hear you clearly now.", "zh": "我現在聽得很清楚。", "ana": "測試用"}],
            "vocab": [
                {"w": "colour", "ipa": "/ˈkʌlə/", "pos": "n. 名詞", "zh": "顏色",
                 "eg": "What colour is your bag?",
                 "egs": ["What colour is your bag?", "I like the colour of this coat.", "The colour looks nice."]},
                {"w": "hear", "ipa": "/hɪə/", "pos": "v. 動詞", "zh": "聽見",
                 "eg": "I can hear you clearly now.",
                 "egs": ["I can hear you clearly now.", "Did you hear the news?", "I hear a bird singing."]},
            ],
            "listening": [], "grammar": [],
        }
        pg.goto('http://127.0.0.1:%d/' % port); pg.wait_for_timeout(200)
        pg.evaluate("d => localStorage.setItem('jingdu_userlessons', JSON.stringify({'t-confuse': d}))", LESSON)
        pg.goto('http://127.0.0.1:%d/lessons/view.html?id=t-confuse' % port); pg.wait_for_timeout(1200)
        ck('引擎載入了', pg.evaluate("!!(window.GrammarEN && window.GrammarEN.confusableNote)"))

        def try_word(idx, typed):
            """翻開第 idx 張生詞卡、輸入、點檢查，回傳孩子看到的那張卡的文字。"""
            pg.evaluate("switchTab('vocab')"); pg.wait_for_timeout(250)
            card = pg.locator('#vocabGrid .vcard').nth(idx)
            card.click(); pg.wait_for_timeout(450)
            card.locator('input').first.fill(typed)
            card.locator('.vbtn.yes').first.click(); pg.wait_for_timeout(350)
            return card.inner_text()

        print('-- ① 寫成美式拼法：要算對，並說清英式/美式')
        t1 = try_word(0, 'color')
        ck('美式拼法算對', '拼對' in t1, t1[:150])
        ck('說明這是美式拼法', '美式' in t1 and '英式' in t1, t1[:220])

        print('-- ② 寫成同音詞：判錯，但要講兩個詞的區別')
        t2 = try_word(1, 'here')
        ck('同音詞判錯（他寫的確實不是要的詞）', '正確拼寫' in t2, t2[:150])
        ck('講清楚兩個詞的區別，不是只說「拼錯了」',
           ('讀音' in t2 or '读音' in t2) and ('這裡' in t2 or '这里' in t2), t2[:250])

        print('-- ③ 真拼錯的照常走普通提示（別把所有錯都當成記混）')
        t3 = try_word(1, 'heer')
        ck('真拼錯不給「兩個詞記混」的說明',
           ('讀音一模一樣' not in t3 and '读音一模一样' not in t3) and '正確拼寫' in t3, t3[:200])

        ck('全程無 JS 錯誤', not errs, errs[:2])
        pg.close(); b.close()
    httpd.shutdown()
    print()
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS:
            print('   - ' + f)
        return 1
    print('✅ 生詞卡「美式拼法算對／同音詞講區別」真點擊全對')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
