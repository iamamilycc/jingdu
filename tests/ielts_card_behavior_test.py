#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ielts_card_behavior_test.py —— 雅思詞彙卡「真操作」測試

起真瀏覽器，像使用者一樣點按鈕：開始 → 看答案 → 認識/不認識 → 撤銷 → 結束。
驗證的是「點下去真的有反應、狀態真的存對」，不是「代碼看起來對」。

重點覆蓋（對應立項報告的閉環設計）：
  · 可用性線：首頁一個主按鈕，點下去直接開始（不需要任何選擇）
  · 作答 → 復用 core.js 的艾賓浩斯引擎（認識升級／不認識打回）
  · 閉環：標錯了能撤銷改回，不留錯資料
  · 逃生口：中途結束不丟進度
  · 隔離：整輪操作後，英語精讀的資料仍然一筆不動

用法：  python3 tests/ielts_card_behavior_test.py
注意：  playwright 獨立 context，不碰你日常瀏覽器的真實學習資料。
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
        print('  --  未安裝 playwright，跳過（資料完整性仍由 ielts_vocab_test.py 守著）')
        return 0

    port = free_port(); httpd = serve(port)
    base = 'http://127.0.0.1:%d' % port

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 390, 'height': 844})   # iPhone 尺寸：主力裝置
        pg = ctx.new_page()

        # 先在英語精讀留一筆資料，最後要驗它沒被動到
        pg.goto(base + '/index.html')
        pg.evaluate("() => JD.addError({id:'en-keep', lessonId:'nce2-01', en:'keep', zh:'保留'})")

        print('-- 首頁：一個主按鈕就能開始（可用性線）')
        pg.goto(base + '/ielts/index.html')
        pg.wait_for_function("() => !document.getElementById('btnStart').disabled", timeout=15000)
        btn = pg.inner_text('#btnStart')
        ck('主按鈕顯示今天要背幾張', '開始今天的' in btn and '張卡' in btn, btn)
        ck('隔離自檢顯示已分家', '已分家' in pg.inner_text('#nsState'), pg.inner_text('#nsState'))
        ck('四個層級都列出來', pg.locator('.layer').count() == 4)

        # ⭐parity：同一個數字兩處顯示必須相等（首頁「今天要背」vs 主按鈕文字）
        #   這條是真的抓過 bug：首頁顯示 0、按鈕寫 20，因為兩處各自算。
        import re as _re
        n_btn = int(_re.search(r'(\d+)', btn).group(1))
        n_stat = int(pg.inner_text('#sDue'))
        ck('parity：首頁「今天要背」= 主按鈕張數', n_stat == n_btn,
           '首頁=%d 按鈕=%d' % (n_stat, n_btn))

        pg.click('#btnStart')
        ck('點下去直接進入背誦（不需要其他選擇）', pg.is_visible('#study'))

        print('-- 卡片：先看詞 → 翻面才給答案（避免直接看答案沒效果）')
        w1 = pg.inner_text('#cWord')
        ck('顯示單詞', len(w1) > 0, w1)
        ck('未翻面時不顯示釋義', not pg.is_visible('#cTr'))
        ck('未翻面時只有「看答案」', pg.is_visible('#rowFlip') and not pg.is_visible('#rowJudge'))
        ck('新詞標示為「新詞」', pg.inner_text('#kind') == '新詞', pg.inner_text('#kind'))

        pg.click('#btnFlip')
        ck('翻面後顯示釋義', pg.is_visible('#cTr') and len(pg.inner_text('#cTr')) > 0)
        ck('翻面後才出現判定按鈕', pg.is_visible('#rowJudge'))

        print('-- 作答走 core.js 的艾賓浩斯引擎（沒有另寫一套）')
        pg.click('#btnYes')
        st = pg.evaluate("(w) => { const b = JD.getBook()[IELTS.idOf(w)]; return b && {level:b.level, en:b.en}; }", w1)
        ck('認識 → 進錯題本且 level 升到 1', st and st['level'] == 1, st)
        ck('錯題本只存學習狀態，英文詞用來回查', st and st['en'] == w1, st)

        w2 = pg.inner_text('#cWord')
        pg.click('#btnFlip'); pg.click('#btnNo')
        st2 = pg.evaluate("(w) => { const b = JD.getBook()[IELTS.idOf(w)]; return b && {level:b.level, fails:b.fails}; }", w2)
        ck('不認識 → level 0（30 分後再見）', st2 and st2['level'] == 0, st2)

        print('-- 閉環：標錯了能撤銷改回，不留錯資料')
        pg.click('#btnUndo')
        st3 = pg.evaluate("(w) => { const b = JD.getBook()[IELTS.idOf(w)]; return b && b.level; }", w2)
        ck('撤銷後 level 被改回（1）', st3 == 1, st3)
        ck('撤銷後回到那張卡', pg.inner_text('#cWord') == w2, pg.inner_text('#cWord'))

        print('-- 批量跳過：L1 前段是 be/the/of，逐張點是浪費時間')
        pg.on('dialog', lambda d: d.accept())
        before_solid = pg.evaluate("() => IELTS.stats().solid")
        remain = int(pg.inner_text('#pos').split('/')[1]) - int(pg.inner_text('#pos').split('/')[0]) + 1
        pg.click('#btnSkip')
        pg.wait_for_timeout(300)
        after_solid = pg.evaluate("() => IELTS.stats().solid")
        ck('一鍵把剩下的標為已掌握', after_solid >= before_solid + remain - 1,
           '%d → %d（剩 %d 張）' % (before_solid, after_solid, remain))
        ck('跳過後進入完成畫面', pg.is_visible('#done'))
        pg.click('#btnHome')
        pg.wait_for_function("() => !document.getElementById('btnStart').disabled", timeout=15000)

        print('-- 逃生口：中途結束不丟進度')
        pg.click('#btnStart')
        pg.click('#btnFlip'); pg.click('#btnYes')
        before = pg.evaluate("() => Object.keys(JD.getBook()).length")
        pg.click('#btnQuit')
        ck('回到首頁', pg.is_visible('#home'))
        after = pg.evaluate("() => Object.keys(JD.getBook()).length")
        ck('已作答的進度沒丟', after == before, '%s → %s' % (before, after))
        pg.reload()
        pg.wait_for_function("() => !document.getElementById('btnStart').disabled", timeout=15000)
        reloaded = pg.evaluate("() => Object.keys(JD.getBook()).length")
        ck('重新整理後進度仍在', reloaded == before, '%s → %s' % (before, reloaded))
        ck('學習中數字有更新', int(pg.inner_text('#sLearn')) == before, pg.inner_text('#sLearn'))

        print('-- 換層：切到 L3 後今日隊列跟著換')
        pg.click('.layer >> nth=2')
        pg.wait_for_function("() => !document.getElementById('btnStart').disabled", timeout=15000)
        cur = pg.evaluate("() => IELTS.cfg().layer")
        ck('層級切到 L3 並記住', cur == 3, cur)
        ck('L3 標為選中', 'on' in (pg.get_attribute('.layer >> nth=2', 'class') or ''))

        print('-- 複習頁：真資料 + 重置閉環（破壞性操作必須能還原）')
        pg.goto(base + '/ielts/review.html')
        s_learn = int(pg.inner_text('#sLearn'))
        ck('複習頁讀到學習中詞數', s_learn > 0, s_learn)
        ck('各層進度列出 4 層', pg.locator('.rowline').count() == 4)
        ck('尚無快照時不顯示還原提示', not pg.is_visible('#undoBox'))

        # 重置 L1 → 應清空該層並留下快照
        pg.click('.rowline button >> nth=0')
        pg.wait_for_timeout(300)
        after_reset = int(pg.inner_text('#sLearn'))
        ck('重置後學習中歸零', after_reset == 0, after_reset)
        ck('重置後出現還原提示（24h 內可救）', pg.is_visible('#undoBox'))

        pg.click('#btnRestore')
        pg.wait_for_timeout(300)
        restored = int(pg.inner_text('#sLearn'))
        ck('⭐還原後進度完整回來', restored == s_learn, '%d → %d' % (s_learn, restored))
        ck('還原後提示消失', not pg.is_visible('#undoBox'))

        csv = pg.evaluate("() => IELTS.exportCsv()")
        ck('可匯出 CSV 且含表頭', csv.startswith('"word","meaning"'), csv[:40])
        ck('CSV 行數 = 學習中詞數 + 表頭', len(csv.strip().split(chr(10))) == restored + 1,
           '%d 行 vs %d 詞' % (len(csv.strip().split(chr(10))), restored))

        print('-- ⭐整輪操作後，英語精讀資料一筆不動')
        pg.goto(base + '/index.html')
        en = pg.evaluate("() => Object.keys(JD.getBook()).sort()")
        ck('英語精讀仍只有自己的資料', en == ['en-keep'], en)

        ctx.close(); br.close()
    httpd.shutdown()
    return 0


def main():
    print('== 雅思詞彙卡·真操作測試（iPhone 尺寸視窗）==')
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
