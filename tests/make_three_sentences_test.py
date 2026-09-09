#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_three_sentences_test.py —— 造句環節新規則閉環測試（2026-09-07）

規則（用戶定）：所有生詞都要造句、每詞 3 句、每句至少 5 個單詞、三句不得重複。
另加：孩子沒有判斷能力，所以擋下來時必須告訴他「怎麼改」，不能只說「錯了」；
     沒有 AI Key 時的兜底不能是「你覺得對嗎」，必須是逐項可核對的清單。

覆蓋：
  1. 每個詞顯示 3 個例句（來自 data 的 egs）
  2. 進度總數 = 生詞數 × 3
  3. 少於 5 個單詞 → 擋下 + 給「怎麼加長」的示範
  4. 沒用上該生詞 → 擋下 + 說明變形也算
  5. 和自己前一句重複 → 擋下 + 給「換角度」的具體建議
  6. 用了該詞的變形（複數/過去式）→ 不擋
  7. 無 AI Key 的兜底是「核對清單」而不是「你覺得對嗎」
  8. 三句都過才換下一個詞

用法： python3 tests/make_three_sentences_test.py
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


def fb(pg):
    return pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''")


def stage(pg):
    return pg.evaluate("(document.getElementById('mkStage')||{}).innerText||''")


def setval(pg, v):
    pg.evaluate("v => document.getElementById('mkInput').value = v", v)


def check(pg, v):
    setval(pg, v)
    pg.evaluate("mkCheck()")
    pg.wait_for_timeout(160)
    return fb(pg)


def main():
    from playwright.sync_api import sync_playwright
    port = free_port(); httpd = serve(port)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch()
            pg = br.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(f'http://127.0.0.1:{port}/lessons/nce2-02.html?tab=make', wait_until='networkidle')
            pg.wait_for_timeout(400)

            # --- 1 例句要顯示 3 句 ---
            n_eg = pg.evaluate("document.querySelectorAll('#mkStage .jd-mkeg').length")
            ck('每個詞顯示 3 個例句', n_eg == 3, f'實際 {n_eg}')

            # --- 2 進度總數 = 生詞數 × 3 ---
            pg.evaluate("mkNext()"); pg.wait_for_timeout(150)
            tot = pg.evaluate("(JD.getSecPos(LESSON.id).make||{}).n")
            nvocab = pg.evaluate("(LESSON.vocab||[]).length")
            ck('進度總數 = 生詞數 × 3', tot == nvocab * 3, f'總數 {tot}，生詞 {nvocab}')
            pg.evaluate("mkPrev()"); pg.wait_for_timeout(150)
            ck('標題顯示「第 N 句 / 3」', '/ 3 句' in stage(pg), stage(pg)[:60])

            word = pg.evaluate("LESSON.vocab[0].w")

            # --- 3 詞數不足 → 擋下並給示範 ---
            f = check(pg, f'I like {word}.')
            ck('少於 5 個單詞被擋下', '至少' in f and '個單詞' in f, f[:70])
            ck('擋下時給了「怎麼加長」的示範', '例：' in f or '什麼時候' in f, f[:90])

            # --- 4 沒用上生詞 → 擋下並說明變形也算 ---
            f = check(pg, 'I go to school every single day.')
            ck('沒用上生詞被擋下', '沒有用上' in f, f[:70])
            ck('擋下時說明變形也算數', '變形' in f or '複數' in f, f[:90])

            # --- 5 用變形應該不被擋（不出現「沒有用上」）---
            f = check(pg, f'I really enjoy every {word}s in spring.')
            ck('用複數變形不被判成沒用上', '沒有用上' not in f, f[:70])

            # --- 6 沒有 AI Key 時，規則引擎自己給結論（2026-09-09：核對清單也是把校驗推給孩子，已廢除）---
            has_key = pg.evaluate("!!(window.JDGen && JDGen.getKey && JDGen.getKey())")
            if not has_key:
                ck('沒 Key 也直接給結論', ('檢查通過' in f) or ('要改一改' in f), f[:90])
                ck('沒 Key 時說清楚查過哪些', '系統能確定的都查過了' in f or '要改一改' in f, f[:120])
                ck('不再叫孩子自己核對', ('都核對過' not in f) and ('覺得這個詞用對了嗎' not in f), f[:90])
                # 規則層真的在判：文法錯的句子必須被判錯
                bad = check(pg, f'He like this {word} very much.')
                ck('規則層判得出文法錯', '要改一改' in bad and '少了 s' in bad, bad[:120])
                ck('判錯時給改好的整句', '改好應該是這樣' in bad, bad[:150])
            else:
                print('  --  已設 AI Key，跳過兜底檢查')

            # --- 7 重複偵測：第 1 句通過並前進到第 2 句，再送幾乎一樣的句子 ---
            # 規則層判過就是過（不再有自評），直接前進到第 2 句
            check(pg, f'I really enjoy every {word}s in spring.')
            pg.evaluate("mkNext()"); pg.wait_for_timeout(200)
            f = check(pg, f'I really enjoy every {word}s in spring.')
            ck('和前一句重複被擋下', '太像' in f, f[:80])
            ck('重複時給了「換角度」的建議', '換' in f and ('角度' in f or '時間' in f), f[:100])
            # 同一格重寫自己不算重複（回到第 1 句改寫應該放行）
            pg.evaluate("mkPrev()"); pg.wait_for_timeout(150)
            f2 = check(pg, f'I really enjoy every {word}s in spring.')
            ck('回到同一格重寫自己不算重複', '太像' not in f2, f2[:70])
            pg.evaluate("mkNext()"); pg.wait_for_timeout(200)       # 回到第 2 句

            # --- 8 三句都過才換詞（從畫面標題判斷，不摸內部變數）---
            import re as _re
            def where(pg):
                t = stage(pg)
                m = _re.search(r'第\s*(\d+)\s*/\s*\d+\s*個詞.*?第\s*(\d+)\s*/\s*\d+\s*句', t, _re.S)
                return (int(m.group(1)), int(m.group(2))) if m else (None, None)
            w0, s0 = where(pg)
            ck('目前在第 1 個詞的第 2 句', (w0, s0) == (1, 2), f'{w0=} {s0=}')
            f = check(pg, f'My brother bought a new {word} yesterday.')
            pg.evaluate("mkNext()"); pg.wait_for_timeout(200)
            w1, s1 = where(pg)
            ck('造完第 2 句仍停在同一個詞、進到第 3 句', (w1, s1) == (w0, 3), f'{w1=} {s1=}')
            f = check(pg, f'The old {word} near my house looks nice.')
            pg.evaluate("mkNext()"); pg.wait_for_timeout(200)
            w2, s2 = where(pg)
            ck('第 3 句做完才換下一個詞', (w2, s2) == (w0 + 1, 1), f'{w2=} {s2=}')

            ck('全程沒有 JS 錯誤', not errs, errs[:2])
            br.close()
    finally:
        httpd.shutdown()

    print()
    if FAILS:
        print(f'❌ 失敗 {len(FAILS)} 項：' + '、'.join(FAILS))
        sys.exit(1)
    print('✅ 造句三句規則全部通過')


if __name__ == '__main__':
    main()
