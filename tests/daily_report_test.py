#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
daily_report_test.py —— 家長「日報」閉環測試

需求：每天能看清楚完成了哪些課、每課完整度多少、得分多少。
現有數據（secpos 累積、daysMap 布爾）無法回溯歷史每天明細，故新增每日快照 jingdu_daily：
  markDone / setSecPos 時記 daily[今天][課] = {secs:[今天完成的環節], completion, accuracy, lang}。

驗證：
  ① 記錄：markDone/setSecPos 後 getDailyLog 有今天該課的正確快照（環節、完整度、得分、語言）
  ② report 日報頁：切到「日報」→ 列出當天各課的課名/今天做的環節/完整度%/得分%，英日分開
  ③ 日期導航：切到沒紀錄的日期顯示空提示；不能看未來

用法：  python3 tests/daily_report_test.py
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
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---- ① 記錄：markDone / setSecPos 寫入今日快照 ----
        print('-- ① 每日快照記錄（markDone/setSecPos）')
        pg = b.new_page()
        pg.goto('http://127.0.0.1:%d/lessons/nce2-01.html' % port); pg.wait_for_timeout(800)
        rec = pg.evaluate("""(()=>{
            localStorage.removeItem('jingdu_daily');
            const today = (d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))(new Date());
            // 模擬今天在 nce2-01 做了 speak（3/3 對 3）與 vocab（打勾）
            JD.setSecPos('nce2-01','speak',3,3,3);
            JD.markDone('nce2-01','speak');
            JD.markDone('nce2-01','vocab');
            const log = JD.getDailyLog();
            const day = log[today] || {};
            const r = day['nce2-01'] || null;
            return { today, hasDay: !!log[today], r };
        })()""")
        ck('今天有快照', rec['hasDay'], rec)
        r = rec.get('r') or {}
        ck('記錄了今天完成的環節（含 speak/vocab）', set(['speak','vocab']).issubset(set(r.get('secs', []))), r)
        ck('記錄了完整度(0-100)', isinstance(r.get('completion'), (int, float)) and r['completion'] >= 0, r)
        ck('記錄了得分(0-100)', isinstance(r.get('accuracy'), (int, float)) and r['accuracy'] >= 0, r)
        ck('記錄了語言=en', r.get('lang') == 'en', r)
        pg.close()

        # ---- ② report 日報頁渲染 ----
        print('-- ② report 日報頁：課名/環節/完整度/得分')
        rp = b.new_page()
        errs = []; rp.on('pageerror', lambda e: errs.append(str(e)))
        rp.goto('http://127.0.0.1:%d/report.html' % port); rp.wait_for_timeout(700)
        # 注入今天的 daily 資料（英一課 + 日一課），再切到日報
        rp.evaluate("""(()=>{
            const today=(d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))(new Date());
            const log={}; log[today]={
              'nce2-01':{ secs:['vocab','speak'], completion:66, accuracy:90, done:6, n:9, lang:'en' },
              'jp-01':{ secs:['recite'], completion:33, accuracy:80, done:3, n:9, lang:'jp' }
            };
            localStorage.setItem('jingdu_daily', JSON.stringify(log));
        })()""")
        rp.evaluate("document.querySelector('#periodSeg [data-v=\"day\"]').click()"); rp.wait_for_timeout(300)
        txt = rp.evaluate("document.querySelector('main').innerText")
        ck('日報顯示英語課名', 'NCE2' in txt, txt[:200])
        ck('日報顯示完整度%', '66%' in txt, txt[:400])
        ck('日報顯示得分', '90' in txt, txt[:400])
        ck('日報顯示今天做的環節(生詞卡/跟讀)', ('生詞卡' in txt and '跟讀' in txt), txt[:400])
        ck('英語日報不含日語課(jp-01)', '第1課' not in txt or '33%' not in txt, txt[:400])
        # 切日語
        rp.evaluate("document.querySelector('#langSeg [data-v=\"jp\"]').click()"); rp.wait_for_timeout(300)
        txtjp = rp.evaluate("document.querySelector('main').innerText")
        ck('切日語→顯示日語課的背句/33%', ('背句' in txtjp and '33%' in txtjp), txtjp[:400])
        ck('日報頁無 JS 錯誤', len(errs) == 0, errs[:2])

        # ---- ③ 日期導航：沒紀錄的日期 / 不能看未來 ----
        print('-- ③ 日期導航')
        rp.evaluate("document.querySelector('#langSeg [data-v=\"en\"]').click()"); rp.wait_for_timeout(200)
        rp.evaluate("dayStep(-1)"); rp.wait_for_timeout(200)  # 前一天（無紀錄）
        txtPrev = rp.evaluate("document.querySelector('main').innerText")
        ck('前一天(無紀錄)→顯示空提示', '沒有' in txtPrev and '學習紀錄' in txtPrev, txtPrev[:200])
        # 回今天，再點「後一天」應被擋（不能看未來）
        rp.evaluate("dayStep(1)"); rp.wait_for_timeout(200)  # 回今天
        curDay = rp.evaluate("DAY")
        rp.evaluate("dayStep(1)"); rp.wait_for_timeout(150)  # 試圖到未來
        ck('不能看未來(DAY 不動)', rp.evaluate("DAY") == curDay, rp.evaluate("DAY"))

        rp.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 日報全對（每日快照記錄 + 課名/環節/完整度/得分渲染 + 英日分開 + 日期導航）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
