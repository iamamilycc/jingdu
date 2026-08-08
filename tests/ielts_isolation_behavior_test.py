#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ielts_isolation_behavior_test.py —— 命名空間隔離的「真行為」測試（不是只讀碼）

ns_isolation_test.py 是靜態檢查：證明**代碼寫對了**。
這支是行為測試：起真瀏覽器、真寫 localStorage、真呼叫 JD API，證明**運行時真的隔離**。
兩支缺一不可——過去本專案就吃過「靜態看起來對、真機行為錯」的虧（振假名兩套正則）。

核心要證明的三件事：
  A. 雅思站寫入的資料，英語精讀讀不到（反之亦然）
  B. **英語精讀原有的進度，在雅思站一通操作之後仍然完好**（本輪最該防的事）
  C. 雲備份路徑跨站不同（否則三站互相覆蓋雲端資料）

用法：  python3 tests/ielts_isolation_behavior_test.py
成功：  印「全部通過 ✅」且退出碼 0。
注意：  使用 playwright 獨立 context（等同無痕），不碰你日常瀏覽器裡的真實學習資料。
"""
import os, sys, socket, http.server, threading, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []


def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)))
    if not cond:
        FAILS.append(name)


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def serve(port):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def run():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('  --  未安裝 playwright，跳過行為測試（靜態檢查仍由 ns_isolation_test.py 守著）')
        return 0

    port = free_port()
    httpd = serve(port)
    base = 'http://127.0.0.1:%d' % port

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context()          # 獨立 context：不碰使用者真實資料
        pg = ctx.new_page()

        # ---------- 前置：在「英語精讀」放一份假進度，當作使用者原有的資料 ----------
        print('-- 前置：在英語精讀寫入一份進度（模擬使用者原有資料）')
        pg.goto(base + '/index.html')
        pg.evaluate("""() => {
            JD.addError({id:'en-1', lessonId:'nce2-01', en:'hello', zh:'你好'});
            JD.addError({id:'en-2', lessonId:'nce2-01', en:'world', zh:'世界'});
            localStorage.setItem('jingdu_mymark', 'english-progress');
        }""")
        en_ns = pg.evaluate("() => window.JD_NS || 'jingdu_'")
        en_before = pg.evaluate("() => Object.keys(JD.getBook()).sort()")
        ck('主站 NS 為 jingdu_（未宣告即拿預設）', en_ns == 'jingdu_', en_ns)
        ck('主站寫入 2 筆', en_before == ['en-1', 'en-2'], en_before)

        # ---------- A. 雅思站是另一個空間 ----------
        print('-- A：雅思站寫入的資料，英語精讀讀不到')
        pg.goto(base + '/ielts/index.html')
        ielts_ns = pg.evaluate("() => window.JD_NS")
        ck('雅思站 NS 為 ielts_', ielts_ns == 'ielts_', ielts_ns)

        seen_from_ielts = pg.evaluate("() => Object.keys(JD.getBook()).sort()")
        ck('雅思站看不到英語精讀的資料', seen_from_ielts == [], seen_from_ielts)

        pg.evaluate("""() => {
            JD.addError({id:'ielts-abandon', lessonId:'ielts-L1-01', en:'abandon', zh:'放棄'});
            JD.addError({id:'ielts-ability',  lessonId:'ielts-L1-01', en:'ability',  zh:'能力'});
            JD.addError({id:'ielts-abolish',  lessonId:'ielts-L1-01', en:'abolish',  zh:'廢除'});
        }""")
        ielts_book = pg.evaluate("() => Object.keys(JD.getBook()).sort()")
        ck('雅思站寫入 3 筆且只有自己的', ielts_book == ['ielts-abandon', 'ielts-ability', 'ielts-abolish'],
           ielts_book)

        # 底層鍵名確實分開
        keys = pg.evaluate("""() => {
            const out = {j:[], i:[]};
            for (let k=0; k<localStorage.length; k++){
                const key = localStorage.key(k);
                if (key.indexOf('jingdu_')===0) out.j.push(key);
                if (key.indexOf('ielts_')===0)  out.i.push(key);
            }
            return {j: out.j.sort(), i: out.i.sort()};
        }""")
        ck('底層存在 ielts_errbook', 'ielts_errbook' in keys['i'], keys['i'])
        ck('jingdu_errbook 未被雅思動到', 'jingdu_errbook' in keys['j'], keys['j'])

        # ---------- B. 最關鍵：英語精讀原有進度完好 ----------
        print('-- B：回到英語精讀，原有進度必須一筆不少（本輪最該防的事）')
        pg.goto(base + '/index.html')
        en_after = pg.evaluate("() => Object.keys(JD.getBook()).sort()")
        mark = pg.evaluate("() => localStorage.getItem('jingdu_mymark')")
        ck('英語精讀進度一筆不少', en_after == en_before, '%s → %s' % (en_before, en_after))
        ck('英語精讀看不到雅思的詞', all(not k.startswith('ielts-') for k in en_after), en_after)
        ck('英語精讀其他 key 未被動', mark == 'english-progress', mark)

        # 雅思站再寫一輪，英語精讀仍不受影響
        pg.goto(base + '/ielts/index.html')
        pg.evaluate("() => { JD.reviewPass('ielts-abandon'); JD.reviewFail('ielts-ability'); }")
        pg.goto(base + '/index.html')
        en_final = pg.evaluate("() => Object.keys(JD.getBook()).sort()")
        ck('雅思複習操作後，英語精讀仍完好', en_final == en_before, en_final)

        # ---------- 復習引擎在雅思空間內正常運作（復用而非另寫一套）----------
        print('-- 復用的艾賓浩斯引擎在雅思空間內正常運作')
        pg.goto(base + '/ielts/index.html')
        lv = pg.evaluate("""() => {
            const b = JD.getBook();
            return { pass: b['ielts-abandon'].level, fail: b['ielts-ability'].level,
                     fails: b['ielts-ability'].fails };
        }""")
        ck('答對 → level 升到 1', lv['pass'] == 1, lv)
        ck('答錯 → level 打回 0', lv['fail'] == 0, lv)
        ck('答錯次數有累計', lv['fails'] >= 1, lv)

        lang = pg.evaluate("() => JD.langOf('ielts-L1-01')")
        ck('langOf 認得雅思 lessonId（打卡才會動）', lang == 'en', lang)

        # ---------- C. 雲備份路徑跨站不同 ----------
        print('-- C：雲備份路徑跨站不同（否則後備份的站會洗掉前一站的雲端資料）')
        pg.goto(base + '/index.html')
        p_main = pg.evaluate("""() => {
            localStorage.setItem('jingdu_sync', JSON.stringify({user:'amily', provider:'gitee', token:'x'}));
            return window.JDSYNC && JDSYNC._userPath ? JDSYNC._userPath() : null;
        }""")
        pg.goto(base + '/ielts/index.html')
        p_ielts = pg.evaluate("""() => {
            localStorage.setItem('ielts_sync', JSON.stringify({user:'amily', provider:'gitee', token:'x'}));
            return window.JDSYNC && JDSYNC._userPath ? JDSYNC._userPath() : null;
        }""")
        if p_main is None or p_ielts is None:
            ck('sync.js 有匯出 _userPath 供驗證', False, '%s / %s' % (p_main, p_ielts))
        else:
            ck('主站備份路徑不變（舊雲備份仍讀得到）', p_main == 'users/amily.json', p_main)
            ck('雅思備份路徑不同（不會互相覆蓋）', p_ielts == 'users/amily.ielts.json', p_ielts)

        ctx.close(); br.close()
    httpd.shutdown()
    return 0


def main():
    print('== 命名空間隔離·真行為測試（真瀏覽器 / 真 localStorage）==')
    rc = run()
    print()
    if FAILS:
        print('❌ %d 條未通過：' % len(FAILS))
        for f in FAILS:
            print('   · ' + f)
        return 1
    print('全部通過 ✅')
    return rc


if __name__ == '__main__':
    sys.exit(main())
