#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
word_norm_test.py —— 單字比對正規化閉環測試（修「打對卻判錯進錯題本」）

Bug：自建課(AI 生成)的詞常混進看不見的字元(零寬空格)或標點(don't / e-mail)，
單字比對是「去空白後完全相同」，使用者打了「看起來完全正確」的字卻不相等→判錯→進錯題本。
修法：JD.normWord(英文)/JD.normKana(日文)在比對前去掉隱形字元/撇號/連字號/大小寫差異。
用法： python3 tests/word_norm_test.py
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

# 模擬 AI 生成、含隱形字元/標點/大小寫的自建課
ZWSP = '​'
VOCAB = [
    {"w": "apple", "ipa": "", "pos": "n.", "zh": "蘋果", "eg": "x"},
    {"w": "banana" + ZWSP, "ipa": "", "pos": "n.", "zh": "香蕉", "eg": "x"},   # 零寬空格
    {"w": "don't", "ipa": "", "pos": "", "zh": "不(縮寫)", "eg": "x"},           # 撇號
    {"w": "e-mail", "ipa": "", "pos": "n.", "zh": "電子郵件", "eg": "x"},        # 連字號
    {"w": "Dog", "ipa": "", "pos": "n.", "zh": "狗", "eg": "x"},                 # 大寫
]
CLEAN = {"apple": "apple", "banana" + ZWSP: "banana", "don't": "dont", "e-mail": "email", "Dog": "dog"}

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    sents = [{"en": "a " + v["w"] + ".", "zh": "x", "ana": "x"} for v in VOCAB]
    lesson = {"id": "u-test", "lang": "en", "badge": "NCE·自建", "title": "測試課", "level": 1,
              "sentences": sents, "vocab": VOCAB, "listening": [], "grammar": [],
              "_meta": {"created": 1, "lang": "en", "title": "測試課"}}
    store = json.dumps({"u-test": lesson})
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto('http://127.0.0.1:%d/lessons/view.html' % port); pg.wait_for_timeout(300)
        pg.evaluate("s => localStorage.setItem('jingdu_userlessons', s)", store)
        pg.evaluate("localStorage.removeItem('jingdu_errbook')")
        pg.goto('http://127.0.0.1:%d/lessons/view.html?id=u-test' % port); pg.wait_for_timeout(900)

        print('-- 中轉英(cn2en) 打「看起來正確」的答案，全部應判對、不進錯題本')
        pg.evaluate("switchTab('vocab'); vdStart('cn2en')"); pg.wait_for_timeout(200)
        total = pg.evaluate("document.querySelectorAll('#vdPills .pill').length")
        for step in range(total):
            zh = pg.evaluate("(document.querySelector('#vdStage .target b')||{}).innerText||''")
            if not zh: break
            realw = pg.evaluate("z => { var m=(window.LESSON.vocab||[]).find(v=>v.zh===z); return m?m.w:null; }", zh)
            typed = CLEAN.get(realw, realw)
            before = pg.evaluate("Object.keys(JD.getBook()).length")
            pg.evaluate("t => { document.getElementById('vdIn').value=t; }", typed)
            pg.evaluate("vdCheckCn2En()"); pg.wait_for_timeout(50)
            after = pg.evaluate("Object.keys(JD.getBook()).length")
            ck('中轉英「%s」打 %r → 判對不進錯題本' % (zh, typed), after == before, 'book %d→%d' % (before, after))
            pg.evaluate("vdNext()"); pg.wait_for_timeout(40)

        print('-- 真的答錯仍要判錯進錯題本(別因放寬而漏判)')
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); vdStart('cn2en')"); pg.wait_for_timeout(150)
        before = pg.evaluate("Object.keys(JD.getBook()).length")
        pg.evaluate("document.getElementById('vdIn').value='zzzwrong'; vdCheckCn2En()"); pg.wait_for_timeout(80)
        after = pg.evaluate("Object.keys(JD.getBook()).length")
        ck('中轉英 打錯字 → 仍判錯進錯題本', after == before + 1, 'book %d→%d' % (before, after))

        print('-- 生詞卡拼寫也吃同一套正規化(零寬字元詞打乾淨版算對)')
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); switchTab('vocab')"); pg.wait_for_timeout(150)
        # banana(帶零寬)那張卡：找 zh=香蕉 的卡，打 banana
        res = pg.evaluate("""(()=>{
            const cards=[...document.querySelectorAll('#vocabGrid .vcard')];
            const idx=(window.LESSON.vocab||[]).findIndex(v=>v.zh==='香蕉');
            const c=cards[idx]; if(!c) return 'no card';
            c.classList.add('flip'); const inp=c.querySelector('.vspell input'); inp.value='banana';
            c.querySelector('.vbtn.yes').click(); return 'done';
        })()""")
        pg.wait_for_timeout(150)
        book = pg.evaluate("Object.keys(JD.getBook()).length")
        ck('生詞卡 零寬字元詞打乾淨版 → 判對不進錯題本', book == 0, 'card=%s book=%d' % (res, book))

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 單字正規化全對（隱形字元/標點打對算對·真錯仍判錯·卡片與強化練習一致）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
