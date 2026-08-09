#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ielts_speaking_test.py —— 口語模組測試

⚠️ 這支測試有明確的天花板，先說清楚：
   **麥克風與 iOS 音訊行為，桌面 headless 瀏覽器測不出來。**
   本專案方法論明列「本機測試綠 ≠ iOS 能用」，所以這裡只測「測得到的部分」：
   題庫資料、能力偵測、計時邏輯、流利度判準、不上傳錄音的承諾。
   真機能不能錄，必須由使用者在 iPhone 上實測——測試不假裝能證明這件事。

用法：  python3 tests/ielts_speaking_test.py
"""
import json, os, sys, socket, http.server, threading, functools

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


def check_data():
    print('-- 題庫資料')
    p = os.path.join(ROOT, 'ielts', 'data', 'speaking-topics.json')
    ck('speaking-topics.json 存在', os.path.exists(p))
    if not os.path.exists(p):
        return
    d = json.load(open(p, encoding='utf-8'))
    ids = [x['id'] for x in d.get('parts', [])]
    ck('三個 Part 齊全', ids == ['p1', 'p2', 'p3'], ids)

    p1 = d['parts'][0]; p2 = d['parts'][1]; p3 = d['parts'][2]
    ck('Part1 題目 ≥8', len(p1['topics']) >= 8, len(p1['topics']))
    ck('Part1 每題有答題框架（不會只回 Yes/No）',
       all(t.get('frame') for t in p1['topics']))
    ck('Part2 卡片 ≥6', len(p2['cards']) >= 6, len(p2['cards']))
    ck('Part2 每張卡有四個提示點（照著講剛好 2 分鐘）',
       all(len(c.get('points', [])) == 4 for c in p2['cards']))
    ck('⭐有素材複用表（5 段素材覆蓋大部分題目）', len(p2.get('materials', [])) >= 5)
    ck('每段素材列出可覆蓋的題型', all(len(m.get('covers', [])) >= 4 for m in p2['materials']))
    ck('Part3 題目 ≥6', len(p3['topics']) >= 6, len(p3['topics']))
    ck('提醒題庫每年換題', '換題' in d.get('meta', {}).get('rule', ''))
    ck('說明流利度優先於零錯誤', '流利度優先' in d.get('meta', {}).get('band65', ''))
    ck('有流利度自我檢查清單', len(d.get('fluency', {}).get('checks', [])) >= 4)


def check_behavior():
    print('-- 能力偵測與流利度判準')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('  --  未安裝 playwright，跳過')
        return

    port = free_port(); httpd = serve(port)
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 390, 'height': 844})
        pg = ctx.new_page()
        pg.goto('http://127.0.0.1:%d/ielts/speaking.html' % port)
        pg.wait_for_function("() => !!window.SPEAK && document.getElementById('q').textContent !== '載入中…'",
                             timeout=15000)

        caps = pg.evaluate("() => SPEAK.capabilities()")
        ck('能力偵測回傳完整欄位',
           all(k in caps for k in ('record', 'recognise', 'isWeChat', 'reason')), caps)
        ck('畫面明說這台裝置能不能錄', len(pg.inner_text('#caps')) > 10, pg.inner_text('#caps'))

        # 微信 WKWebView 不給麥克風是硬限制，必須直接告訴使用者怎麼辦
        wc = pg.evaluate("""() => {
            const ua = navigator.userAgent;
            Object.defineProperty(navigator, 'userAgent',
              {get: () => ua + ' MicroMessenger/8.0', configurable: true});
            const c = SPEAK.capabilities();
            Object.defineProperty(navigator, 'userAgent', {get: () => ua, configurable: true});
            return c;
        }""")
        ck('微信瀏覽器被判定不能錄音', wc['record'] is False, wc)
        ck('且告訴使用者改用 Safari/Chrome', 'Safari' in wc['reason'], wc['reason'])

        print('-- 流利度判準（Part 2 說不滿 2 分鐘是最常見失分）')
        short = pg.evaluate("() => SPEAK.fluency(80, '')")
        ck('說不滿 2 分鐘報紅', any(n['level'] == 'bad' for n in short['notes']), short['notes'])
        full = pg.evaluate("() => SPEAK.fluency(125, 'word '.repeat(260))")
        ck('說滿判 ok', any(n['level'] == 'ok' and '達標' in n['msg'] for n in full['notes']))
        ck('語速落在區間判 ok', full['wpm'] >= 100 and full['wpm'] <= 170, full['wpm'])
        slow = pg.evaluate("() => SPEAK.fluency(120, 'word '.repeat(150))")
        ck('語速偏慢會提醒', any('偏慢' in n['msg'] for n in slow['notes']), slow['notes'])
        fast = pg.evaluate("() => SPEAK.fluency(120, 'word '.repeat(400))")
        ck('語速偏快會提醒', any('偏快' in n['msg'] for n in fast['notes']), fast['notes'])
        norec = pg.evaluate("() => SPEAK.fluency(125, '')")
        ck('沒有識別時誠實說算不出語速',
           any(n['level'] == 'info' and '算不出' in n['msg'] for n in norec['notes']), norec['notes'])

        print('-- 三個 Part 都能切換、換題不重複')
        for tab, want in (('#tP2', 'Part 2'), ('#tP3', 'Part 3'), ('#tP1', 'Part 1')):
            pg.click(tab)
            ck('%s 切換後有題目' % want, len(pg.inner_text('#q')) > 5)
        pg.click('#tP2')
        ck('Part2 顯示四個提示點', pg.locator('#pts li').count() == 4)
        ck('Part2 顯示素材複用表', pg.is_visible('#p2mat'))
        q1 = pg.inner_text('#q'); pg.click('#btnNext'); q2 = pg.inner_text('#q')
        ck('換一題會換掉（不會抽到同一題）', q1 != q2, '%s / %s' % (q1[:30], q2[:30]))

        print('-- 練習紀錄存在雅思空間，且不存錄音檔')
        pg.evaluate("() => SPEAK.saveSession('p2', 'Q', {seconds:130, words:260, wpm:120})")
        log = pg.evaluate("() => JD.load('speak_log', [])")
        ck('紀錄寫入', len(log) >= 1, log)
        ck('只存統計不存音檔（音檔很大且沒必要留）',
           all('blob' not in s and 'url' not in s for s in log), log[:1])
        ck('用雅思空間', pg.evaluate("() => window.JD_NS") == 'ielts_')
        prog = pg.evaluate("() => SPEAK.progress()")
        ck('進度統計 Part2 說滿次數', prog['p2Full'] >= 1, prog)

        print('-- 隱私承諾要寫在畫面上')
        body = pg.inner_text('body')
        ck('明說錄音不上傳', '不會上傳' in body)

        ctx.close(); br.close()
    httpd.shutdown()


def main():
    print('== 雅思口語練習 ==')
    check_data()
    check_behavior()
    print()
    print('⚠️ 天花板提醒：麥克風與 iOS 音訊行為，本測試證明不了——需 iPhone 真機實測。')
    if FAILS:
        print('❌ %d 條未通過：' % len(FAILS))
        for f in FAILS:
            print('   · ' + f)
        return 1
    print('全部通過 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
