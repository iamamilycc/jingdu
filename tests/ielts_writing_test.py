#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ielts_writing_test.py —— 寫作模組測試（話題庫資料 + 本地體檢 + 分數口徑）

重點不在「AI 會不會批改」（那要真 key、且模型輸出本來就不穩），
而在**不花錢就該抓到的東西有沒有抓到**，以及**雅思分數口徑有沒有算對**。

⚠️ 最重要的一條：AI 給分偏高必須在畫面上寫明。使用者若以為自己已經 7 分，
   這個功能就是負價值——所以把「有沒有講清楚」也焊成測試。

用法：  python3 tests/ielts_writing_test.py
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
    print('-- 話題庫資料（考場上要能直接組裝，不是拿來背的範文）')
    p = os.path.join(ROOT, 'ielts', 'data', 'writing-topics.json')
    ck('writing-topics.json 存在', os.path.exists(p))
    if not os.path.exists(p):
        return None
    d = json.load(open(p, encoding='utf-8'))

    ck('至少 8 個高頻話題', len(d.get('topics', [])) >= 8, len(d.get('topics', [])))
    ck('有四段結構指引', len(d.get('structure', {}).get('paras', [])) == 4)
    ck('有連接詞分組', len(d.get('connectors', {}).get('groups', [])) >= 5)
    ck('提醒連接詞不可濫用', '濫用' in d.get('connectors', {}).get('warn', ''))
    ck('說明 Task 2 佔 2/3', '2/3' in d.get('meta', {}).get('band65', ''))
    ck('說明不要背範文（會被判雷同）', '雷同' in d.get('meta', {}).get('note', ''))

    ids = set()
    for t in d['topics']:
        tag = t.get('name', '?')
        ck('%s 有 id 且不重複' % tag, t.get('id') and t['id'] not in ids, t.get('id'))
        ids.add(t.get('id'))
        ck('%s 有 2 個常見問法' % tag, len(t.get('questions', [])) >= 2)
        ck('%s 正反論點各 ≥3（能寫兩種立場）' % tag,
           len(t.get('for', [])) >= 3 and len(t.get('against', [])) >= 3,
           '%d/%d' % (len(t.get('for', [])), len(t.get('against', []))))
        ck('%s 有可用例子' % tag, len(t.get('examples', [])) >= 2)
        ck('%s 有高分表達' % tag, len(t.get('phrases', [])) >= 3)
    return d


def check_behavior():
    print('-- 本地體檢（不花 API 額度就該抓到的問題）')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('  --  未安裝 playwright，跳過行為測試')
        return

    port = free_port(); httpd = serve(port)
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 390, 'height': 844})
        pg = ctx.new_page()
        pg.goto('http://127.0.0.1:%d/ielts/writing.html' % port)
        pg.wait_for_function("() => !!window.WRITE", timeout=15000)

        short = pg.evaluate("() => WRITE.lint('This is short.', '')")
        ck('字數不足會報紅', any(i['level'] == 'bad' and '250' in i['msg'] for i in short), short)

        q = 'Some people think schools should teach practical skills rather than academic subjects.'
        copied = pg.evaluate("""(q) => WRITE.lint(
            'Some people think schools should teach practical skills rather than academic subjects. '
            + 'I agree with this. '.repeat(60), q)""", q)
        ck('引言照抄題目會報紅', any(i['level'] == 'bad' and '照抄' in i['msg'] for i in copied), copied)

        noturn = pg.evaluate("() => WRITE.lint('word '.repeat(260), '')")
        ck('缺轉折／讓步會提醒', any('轉折' in i['msg'] for i in noturn), noturn)

        mech = pg.evaluate("""() => WRITE.lint(
            'Firstly this. Secondly that. Finally another. ' + 'word '.repeat(260), '')""")
        ck('連接詞太機械會提醒', any('機械' in i['msg'] for i in mech), mech)

        print('-- ⭐雅思分數進位口徑（.25 進 .5、.75 進 1.0，不是四捨五入）')
        cases = [(6.0, 6.0), (6.2, 6.0), (6.25, 6.5), (6.5, 6.5),
                 (6.7, 6.5), (6.75, 7.0), (6.9, 7.0)]
        for raw, want in cases:
            got = pg.evaluate("(x) => WRITE.roundBand(x)", raw)
            ck('%.2f → %.1f' % (raw, want), got == want, got)

        print('-- ⚠️ AI 給分偏高必須在畫面上講明（否則這功能是負價值）')
        body = pg.inner_text('body')
        ck('畫面寫明會偏高 0.5–1 分', '偏高' in body and '0.5' in body, body[:80])
        ck('明說不要當分數用', '不要拿它' in body or '當分數' in body)

        print('-- key 是全站共用的（換站不必重設）')
        keyname = pg.evaluate("""() => {
            WRITE.setKey('probe-key-123');
            return localStorage.getItem('jingdu_zhipu_key');
        }""")
        ck('批改 key 寫進共用的 jingdu_zhipu_key', keyname == 'probe-key-123', keyname)
        ck('學習紀錄仍在雅思空間', pg.evaluate("() => window.JD_NS") == 'ielts_')

        print('-- 預設用免費模型（金絲雀：先免費跑通再談花錢）')
        ck('預設 glm-4-flash', pg.evaluate("() => WRITE.getModel()") == 'glm-4-flash')

        print('-- 批改提示詞有要求從嚴給分')
        pr = pg.evaluate("() => WRITE._prompt('Q', 'E')")
        ck('要求給分從嚴', '從嚴' in pr)
        ck('要求指到具體句子', '具體到句子' in pr)
        ck('要求輸出 JSON 便於程式校驗', 'JSON' in pr)

        ctx.close(); br.close()
    httpd.shutdown()


def main():
    print('== 雅思寫作 Task 2 ==')
    check_data()
    check_behavior()
    print()
    if FAILS:
        print('❌ %d 條未通過：' % len(FAILS))
        for f in FAILS:
            print('   · ' + f)
        return 1
    print('全部通過 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
