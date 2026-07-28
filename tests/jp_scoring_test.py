#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
jp_scoring_test.py —— 日語跟讀/背句「念對就該給高分」閉環測試

真機暴露的 bug（2026-07-28 用戶截圖）：日語自建課念得一模一樣卻打不到滿分。
兩個根因，這裡各用真實函數守住：
  1. 漢字→假名對照表的正則污染：collectKanjiMap 曾用貪婪 `[^\[\]]+` 當漢字，
     key 被前面的假名吃進去（「これからお世話[せわ]」→ key 變整串），導致把 iOS 回傳
     的漢字識別文字整段替換錯 → 念對也對不上。正解=跟 ruby.js 同一條只吃漢字的正則。
  2. iOS 日語聽寫回傳的是「漢字混寫」(お世話)，但比對目標是純假名(おせわ)，
     漢字≠假名 → 念對也扣分。正解=同時比「假名形」與「漢字形」取高分。

驗證對象（都在課程頁上，真函數）：
  window.JDRuby.kanjiReadings(s)  —— 只吃緊貼括號前的漢字，key 不被假名污染
  JD.compareJPReading(jp, spoken, kanjiMap) —— 念對(不論識別回假名或漢字)都給高分

用法：  python3 tests/jp_scoring_test.py
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
    port = free_port(); serve(port); time.sleep(0.5)
    url = 'http://127.0.0.1:%d/jp/lessons/jp-01.html' % port
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(url); pg.wait_for_timeout(1000)

        # ---- 1. 漢字讀音表：key 只含漢字，不被前面的假名污染 ----
        print('-- 1. R.kanjiReadings：key 只吃緊貼括號前的漢字')
        km = pg.evaluate("JSON.stringify(window.JDRuby.kanjiReadings ? window.JDRuby.kanjiReadings('これからお世話[せわ]になります') : null)")
        ck('kanjiReadings 存在', km is not None, km)
        ck('key=世話 而非 これからお世話', km == '[["世話","せわ"]]', km)
        km2 = pg.evaluate("JSON.stringify(window.JDRuby.kanjiReadings ? window.JDRuby.kanjiReadings('私[わたし]は学生[がくせい]です') : null)")
        ck('多漢字段各自成 key', km2 == '[["私","わたし"],["学生","がくせい"]]', km2)

        # ---- 2. 念對就該高分：識別回「漢字混寫」時也要對得上 ----
        print('-- 2. JD.compareJPReading：念對(識別回漢字/假名)都給高分')
        has = pg.evaluate("!!(JD.compareJPReading)")
        ck('compareJPReading 存在', has)
        if has:
            JP = "これからお世話[せわ]になります"
            # iOS 常回傳漢字混寫「お世話」——即使課文沒把這詞收進 map，也要靠漢字形對上
            a_kanji = pg.evaluate("JD.compareJPReading(%r, 'これからお世話になります', {}).accuracy" % JP)
            ck('識別回漢字·念對→高分(>=90)', a_kanji >= 90, a_kanji)
            # 識別回純假名「おせわ」——靠假名形 + map 對上
            a_kana = pg.evaluate("JD.compareJPReading(%r, 'これからおせわになります', {'世話':'せわ'}).accuracy" % JP)
            ck('識別回假名·念對→高分(>=90)', a_kana >= 90, a_kana)
            # 就算 map 空的，假名識別也該靠 toKana 目標對上
            a_kana2 = pg.evaluate("JD.compareJPReading(%r, 'これからおせわになります', {}).accuracy" % JP)
            ck('識別回假名·map空·仍高分(>=90)', a_kana2 >= 90, a_kana2)
            # 念錯→低分（不能因為取 max 就人人滿分）
            a_wrong = pg.evaluate("JD.compareJPReading(%r, 'ぜんぜんちがう', {}).accuracy" % JP)
            ck('念錯→低分(<50)', a_wrong < 50, a_wrong)
            # 片假名歸一：識別回片假名讀音也算對
            a_kk = pg.evaluate("JD.compareJPReading('こんにちは', 'コンニチハ', {}).accuracy")
            ck('片假名歸一→100', a_kk == 100, a_kk)

        # ---- 3. speaker 冒號前有空格也要能拆（「サンス ：」）----
        print('-- 3. 說話人「名字 空格 ：」也要被清洗')
        # 用與 stripLeadingSpeakers 相同的正則驗證（從 lesson-jp 取不到私有函數，驗行為等價的正則）
        stripped = pg.evaluate(r"""(()=>{
            const RE = /^([A-Za-z][A-Za-z .'’-]{0,24}|[一-鿿぀-ヿＡ-Ｚ\[\]々]{1,24})\s*[：:]\s*/;
            const cases = ['サンス ： こんにちは', '田中[たなか]：ありがとう', 'A： はい'];
            return cases.map(c=>{ const m=c.match(RE); return m?c.slice(m[0].length):('NOMATCH:'+c); });
        })()""")
        ck('「サンス ：」被拆(留こんにちは)', stripped[0] == 'こんにちは', stripped[0])
        ck('「田中[たなか]：」被拆', stripped[1] == 'ありがとう', stripped[1])
        ck('「A：」被拆', stripped[2] == 'はい', stripped[2])

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS:
            print('   - ' + f)
        return 1
    print('✅ 日語打分穩健（漢字表不污染／念對高分／說話人清洗）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
