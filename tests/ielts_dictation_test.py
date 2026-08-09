#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ielts_dictation_test.py —— 精聽聽寫的「錯因分類」測試

聽寫本身不難（播一句、打字、比對），真正決定提不提分的是**知道自己錯在哪一類**：
連讀沒聽出、拼寫錯、生詞、數字/專名、還是語速跟不上。分類錯了，練習方向就錯了。
所以這支專測分類邏輯——用真實會發生的聽寫錯誤當案例。

用法：  python3 tests/ielts_dictation_test.py
"""
import os, sys, socket, http.server, threading, functools, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []


def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)))
    if not cond:
        FAILS.append(name)


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def serve(port):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# (原句, 使用者聽寫, 期望分類, 說明)
CASES = [
    ("The library opens at nine.", "The library opens at nine.",
     None, "全對"),
    ("He is going to the airport.", "He is going the airport.",
     'weak', "漏掉弱讀的 to —— 雅思聽力最常見失分"),
    ("Please write it in the box.", "Please write it in the box",
     None, "只差句末標點，不算錯"),
    ("The accommodation is expensive.", "The accomodation is expensive.",
     'spell', "詞聽對了但拼錯（accommodation 是雅思高頻拼錯詞）"),
    ("Call me on 07700 900123.", "Call me on 07700 900132.",
     'number', "數字聽錯——雅思填空題重災區"),
    ("Dr Watson works in Bristol.", "Dr Watson works in Bristow.",
     'proper', "專有名詞聽錯"),
    ("The phenomenon was unprecedented.", "The was unprecedented.",
     'unknown', "生詞完全沒寫出來"),
    ("She said she would come back later today.", "She said she would come",
     'speed', "後半段整段沒跟上＝語速問題"),
]


def run():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('  --  未安裝 playwright，跳過')
        return 0

    port = free_port(); httpd = serve(port)
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(); pg = ctx.new_page()
        pg.goto('http://127.0.0.1:%d/ielts/dictation.html' % port)
        pg.wait_for_function("() => !!window.DICT", timeout=15000)

        print('-- 切句：貼一段文字要能切成可逐句聽寫的句子')
        segs = pg.evaluate("""() => DICT.split(
            'The library opens at nine. It closes at five! Does it open on Sunday? Yes.')""")
        ck('切成 4 句', len(segs) == 4, segs)
        ck('保留句末標點（聽寫要對得上）', segs[0].endswith('.'), segs[0])
        ck('過短的碎片不獨立成句', all(len(s.split()) >= 1 for s in segs), segs)

        print('-- 錯因分類（決定練習方向，分錯就練錯）')
        for target, typed, want, why in CASES:
            got = pg.evaluate("([t, s]) => DICT.diff(t, s).kinds", [target, typed])
            if want is None:
                ck('全對不報錯：%s' % why, got == [], got)
            else:
                ck('%s → %s' % (why, want), want in got, '得到 %s' % got)

        print('-- 逐詞比對結果要能標出「錯在哪個字」')
        d = pg.evaluate("() => DICT.diff('The library opens at nine.', 'The library open at nine.')")
        ck('標出有問題的詞', any(w['ok'] is False for w in d['words']), d['words'])
        ck('對的詞標成 ok', sum(1 for w in d['words'] if w['ok']) >= 4, d['words'])
        ck('給出正確率', 0 < d['score'] < 1, d['score'])

        print('-- 錯的詞要自動進復習隊列（否則錯了也不會再遇到）')
        n0 = pg.evaluate("() => Object.keys(JD.getBook()).length")
        pg.evaluate("() => DICT.commit('The accommodation is expensive.', 'The accomodation is expensive.')")
        n1 = pg.evaluate("() => Object.keys(JD.getBook()).length")
        ck('錯詞進了錯題本', n1 > n0, '%d → %d' % (n0, n1))
        ck('用的是雅思空間（不污染英語精讀）',
           pg.evaluate("() => window.JD_NS") == 'ielts_')

        print('-- 錯因統計：讓使用者知道自己弱在哪一類')
        pg.evaluate("() => { DICT.commit('Call me on 07700 900123.', 'Call me on 07700 900132.'); }")
        st = pg.evaluate("() => DICT.stats()")
        ck('統計有累計次數', st['total'] >= 2, st)
        ck('分類分佈有內容', len(st['kinds']) >= 1, st)

        ctx.close(); br.close()
    httpd.shutdown()
    return 0


def main():
    print('== 精聽聽寫·錯因分類 ==')
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
