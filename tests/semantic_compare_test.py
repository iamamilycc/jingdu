#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
semantic_compare_test.py —— 背句/跟讀「同義不同形」語義比對閉環測試

真機事故：題目顯示 "twenty"，孩子念對，語音引擎回傳 "20"，字面不同被判錯；
題目含中文名拼音（Zhang），英語識別引擎聽不懂，也被判錯。

舉一反三，凡「意思一樣、字面不同」都該算對（英文 compare）：
  ① 數字詞 ↔ 阿拉伯數字   twenty↔20 / one hundred↔100
  ② 序數                 first↔1st / twentieth↔20th
  ③ 符號 ↔ 詞            &↔and / %↔percent
  ④ 常見縮寫             Mr↔mister / Dr↔doctor
  ⑤ 專有名詞/拼音（識別引擎硬限制，無法根治）→ 減害：該詞識別不出時不計入分母、標記提示，
     不因一個聽不懂的人名把整句拖到低分；但真的念錯別的詞仍要扣分（不放水）。

用法：  python3 tests/semantic_compare_test.py
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

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    url = 'http://127.0.0.1:%d/lessons/nce2-01.html' % port
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(url); pg.wait_for_timeout(800)

        def acc(target, spoken):
            return pg.evaluate("JD.compare(%r, %r).accuracy" % (target, spoken))
        def toks(target, spoken):
            return pg.evaluate("JD.compare(%r, %r).tokens.map(t=>t.st)" % (target, spoken))

        # ---- ① 數字詞 ↔ 阿拉伯數字（雙向）----
        print('-- ① 數字詞 ↔ 阿拉伯數字')
        ck('twenty ↔ 20', acc('I have twenty books', 'i have 20 books') == 100, acc('I have twenty books', 'i have 20 books'))
        ck('20 ↔ twenty', acc('I have 20 books', 'i have twenty books') == 100)
        ck('one hundred ↔ 100', acc('one hundred people came', '100 people came') == 100)
        ck('one hundred and twenty three ↔ 123', acc('it costs one hundred and twenty three', 'it costs 123') == 100)
        ck('twenty-one(識別成 twenty one) ↔ 21', acc('I am 21', 'i am twenty one') == 100)

        # ---- ② 序數 ----
        print('-- ② 序數')
        ck('first ↔ 1st', acc('the first day', 'the 1st day') == 100)
        ck('third ↔ 3rd', acc('my third try', 'my 3rd try') == 100)

        # ---- ③ 符號 ↔ 詞 ----
        print('-- ③ 符號 ↔ 詞')
        ck('& ↔ and', acc('Tom & Jerry', 'tom and jerry') == 100)
        ck('% ↔ percent', acc('fifty percent off', '50% off') == 100)

        # ---- ④ 常見縮寫 ----
        print('-- ④ 常見縮寫')
        ck('Mr ↔ mister', acc('Mr Smith is here', 'mister smith is here') == 100)
        ck('Dr ↔ doctor', acc('Dr Wang came', 'doctor wang came') == 100)

        # ---- ⑤ 專有名詞/拼音 減害（不拖分 + 標記，但別放水）----
        print('-- ⑤ 專有名詞/拼音 減害')
        a = acc('I am Zhang', 'i am')  # Zhang 識別不出，其餘念對
        ck('拼音人名識別不出→其餘念對仍高分(>=95)', a >= 95, a)
        st = toks('I am Zhang', 'i am')
        ck('拼音人名標記為 skip(不算錯)', 'skip' in st, st)
        # 但真的念錯別的詞，仍要扣分（不能因為有 skip 機制就全放水）
        a2 = acc('I have twenty books', 'i have red books')
        ck('念錯普通詞(twenty→red)仍扣分(<100)', a2 < 100, a2)
        a3 = acc('I like Beijing very much', 'i like very much')  # 只 Beijing 沒識別
        ck('句中專有名詞漏識別→不拖垮(>=95)', a3 >= 95, a3)

        # ---- 不放水回歸：完全念對照樣 100、完全念錯照樣低 ----
        print('-- 回歸：正常句判定不變')
        ck('完全念對 100', acc('the boy went to school', 'the boy went to school') == 100)
        ck('完全念錯 低分', acc('the boy went to school', 'a cat sat down') < 40)

        # ---- ⑥ 多候選 bestCompare：引擎首選錯、正確在次選裡 → 取最貼近題目那個 ----
        print('-- ⑥ 多候選 bestCompare：救回「念對卻首選判錯」(aloud→allowed)')
        # 念 "read aloud"，引擎首選 "read allowed"(錯)、次選 "read aloud"(對)
        r = pg.evaluate("""JD.bestCompare(['read allowed','read aloud','red aloud'], c=>JD.compare('read aloud', c)).r.accuracy""")
        ck('aloud 被首選聽成 allowed，次選有 aloud → 取到 100', r == 100, r)
        r2 = pg.evaluate("""JD.bestCompare(['the adverb here','the ad verb here'], c=>JD.compare('the adverb here', c)).r.accuracy""")
        ck('adverb 被聽成 ad verb，正確候選在 → 100', r2 == 100, r2)
        # 採用的候選文字要跟著是對的那個（顯示「你說的是」用它）
        picked = pg.evaluate("""JD.bestCompare(['read allowed','read aloud'], c=>JD.compare('read aloud', c)).text""")
        ck('採用的候選=對的那個(read aloud)', picked == 'read aloud', picked)
        # 全部候選都錯 → 仍然低分（不放水）
        rw = pg.evaluate("""JD.bestCompare(['a cat','a dog','a fish'], c=>JD.compare('read aloud', c)).r.accuracy""")
        ck('候選全念錯→仍低分(<50)', rw < 50, rw)
        # 空候選不崩
        re = pg.evaluate("""JD.bestCompare([], c=>JD.compare('read aloud', c)).r.accuracy""")
        ck('空候選不崩(回 0)', re == 0, re)

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 語義比對全對（數字/序數/符號/縮寫歸一 + 專有名詞減害不放水）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
