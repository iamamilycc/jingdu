#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
content_guard_test.py —— 給孩子的內容「程序化把關」閉環測試（不靠模型自我判斷）

免費/弱模型生成的內容小朋友當事實學、自己判斷不了對錯，所以用**程式驗得出來的規則**攔截：
  A. 生詞卡 sanitizeVocab：
     ① 沒有中文意思(空/整串沒中文字) → 丟棄壞卡
     ② 音標格式不對(不是 /../ 或 [..]、或混進中文) → 清空(錯音標會教錯發音)
     ③ 例句沒真的含這個詞 → 換成課文裡真的含它的句子
     ④ 重複的詞 → 去重
  B. 造句回饋 judgeSentence 程序化把關：
     · 「改好的句子/地道說法」沒真的用上指定單詞 → 不顯示
     · 和孩子那句錯句一模一樣(等於沒改) → 不顯示

用法： python3 tests/content_guard_test.py
"""
import os, sys, time, socket, http.server, threading, functools, json

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

# 一份「模型可能生成的爛資料」：每個生詞各踩一個雷
BAD_LESSON = {
    "title": "Test", "level": 2,
    "sentences": [
        {"en": "The cat sat on the mat.", "zh": "貓坐在墊子上。", "ana": "x"},
        {"en": "I bought a ticket yesterday.", "zh": "我昨天買了一張票。", "ana": "x"}
    ],
    "vocab": [
        {"w": "cat", "ipa": "/kæt/", "pos": "n.", "zh": "貓", "eg": "The cat sat on the mat."},      # 正常，應保留
        {"w": "ticket", "ipa": "/ˈtɪkɪt/", "pos": "n.", "zh": "", "eg": "x"},                        # ① 無中文意思→丟棄
        {"w": "mat", "ipa": "墊子的音標", "pos": "n.", "zh": "墊子", "eg": "The cat sat on the mat."}, # ② 音標混中文→清空
        {"w": "bought", "ipa": "/bɔːt/", "pos": "v.", "zh": "買（過去式）", "eg": "Totally unrelated example."},  # ③ 例句不含詞→換課文句
        {"w": "cat", "ipa": "/kæt/", "pos": "n.", "zh": "貓咪", "eg": "x"},                          # ④ 重複→去重
        {"w": "sat", "ipa": "/sæt/", "pos": "v.", "zh": "sit past tense", "eg": "x"}                 # ① zh 沒中文字→丟棄
    ],
    "listening": [], "grammar": []
}

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto('http://127.0.0.1:%d/new.html' % port); pg.wait_for_timeout(700)

        print('-- A. 生詞卡程序化把關 sanitizeVocab')
        out = pg.evaluate("raw => JDGen.parseLesson(raw, 'en')", json.dumps(BAD_LESSON))
        vocab = out['vocab']
        words = [v['w'] for v in vocab]
        ck('① 沒有中文意思的詞被丟棄(ticket)', 'ticket' not in words, words)
        ck('① 中文意思其實是英文的被丟棄(sat)', 'sat' not in words, words)
        ck('④ 重複的詞去重(cat 只留 1 個)', words.count('cat') == 1, words)
        mat = [v for v in vocab if v['w'] == 'mat']
        ck('② 音標混中文→清空(mat)', bool(mat) and mat[0].get('ipa', '') == '', mat)
        cat = [v for v in vocab if v['w'] == 'cat']
        ck('② 正常音標保留不動(cat)', bool(cat) and cat[0].get('ipa') == '/kæt/', cat)
        bought = [v for v in vocab if v['w'] == 'bought']
        ck('③ 例句不含該詞→換成課文裡真的含它的句子',
           bool(bought) and 'bought' in bought[0].get('eg', ''), bought)

        print('-- B. 造句回饋程序化把關 judgeSentence')
        # 用假 fetch 餵模型回應，驗程式的把關（不需真 key/真 API）
        def judge(mock):
            js = ("""(async (mock) => {
                const real = window.fetch;
                window.fetch = async () => ({ ok:true, status:200, json: async () => ({
                    choices:[{ message:{ content: JSON.stringify(mock) } }] }) });
                try { localStorage.setItem('jingdu_zhipu_key','x');
                      return await JDGen.judgeSentence('en', 'ticket', 'I buyed a ticket yesterday.'); }
                finally { window.fetch = real; }
            })""")
            return pg.evaluate(js, mock)

        r1 = judge({"ok": False, "fix": "I bought a bus pass yesterday.", "tip": "時態錯",
                    "better": "I picked up a ticket yesterday.", "betterZh": "我昨天拿了張票。"})
        ck('改好的句子沒用上指定單詞→不顯示(fix 清空)', r1['fix'] == '', r1)
        ck('地道說法有用上單詞→保留', 'ticket' in r1['better'], r1)

        r2 = judge({"ok": False, "fix": "I buyed a ticket yesterday.", "tip": "時態錯",
                    "better": "I buyed a ticket yesterday.", "betterZh": "x"})
        ck('改好的句子跟錯句一模一樣→不顯示(等於沒改)', r2['fix'] == '', r2)
        ck('地道說法跟錯句一樣→不顯示', r2['better'] == '', r2)
        ck('沒示範句時不留孤兒翻譯', r2['betterZh'] == '', r2)

        r3 = judge({"ok": False, "fix": "I bought a ticket yesterday.", "tip": "時態錯：buyed 要改成 bought",
                    "better": "I grabbed a ticket yesterday.", "betterZh": "我昨天買了張票。"})
        ck('正常的改好句子→保留(不誤擋)', r3['fix'] == 'I bought a ticket yesterday.', r3)
        ck('正常的地道說法→保留(不誤擋)', r3['better'] == 'I grabbed a ticket yesterday.', r3)
        ck('錯在哪+怎麼改的說明保留', '改成' in r3['tip'], r3)

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 內容把關全對（壞生詞卡擋掉/錯音標清空/例句校正·造句示範句程序化把關）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
