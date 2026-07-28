#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
core_behavior_test.py —— 積分/復盤/打卡「行為」閉環測試（fable-5 審查 P0）

原本只有靜態測 levelBar 點數，這裡補「真行為」：艾賓浩斯升級/畢業/打回、streak 連續天數、
登山海拔防刷、家長 PIN。這些是孩子動力與資料正確性的核心，過去零行為測試。

用法：  python3 tests/core_behavior_test.py
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
    url = 'http://127.0.0.1:%d/jp/lessons/jp-01.html' % port
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(url); pg.wait_for_timeout(900)

        def clear_book():
            pg.evaluate("localStorage.removeItem('jingdu_errbook'); localStorage.removeItem('jingdu_days'); localStorage.removeItem('jingdu_days_en'); localStorage.removeItem('jingdu_days_jp');")

        # ---- 艾賓浩斯：加錯題→level0→連對8次畢業→打回 ----
        print('-- 艾賓浩斯復盤行為')
        clear_book()
        pg.evaluate("JD.addError({id:'t1', lessonId:'nce2-01', en:'hello', zh:'哈囉'})")
        lv = pg.evaluate("JD.getBook()['t1'].level")
        ck('加錯題→level 0', lv == 0, lv)
        # 連對 8 次 → 畢業(solid, level 到 INTERVALS.length=8)
        pg.evaluate("for(let i=0;i<8;i++) JD.reviewPass('t1')")
        it = pg.evaluate("JD.getBook()['t1']")
        ck('連對 8 次→level 8', it['level'] == 8, it['level'])
        ck('連對 8 次→solid 畢業', it.get('solid') == True, it)
        inDue = pg.evaluate("JD.dueItems().some(x=>x.id==='t1')")
        ck('畢業後不再出現在到期清單', inDue == False)
        # 再打回：reviewFail → level 0、solid 清除
        pg.evaluate("JD.reviewFail('t1')")
        it2 = pg.evaluate("JD.getBook()['t1']")
        ck('答錯→level 打回 0', it2['level'] == 0, it2['level'])
        ck('答錯→solid 清除', not it2.get('solid'), it2)
        # dueItems 只回「未畢業且已到期」：塞一筆過去到期 + 一筆未來到期
        clear_book()
        pg.evaluate("""localStorage.setItem('jingdu_errbook', JSON.stringify({
            due1:{id:'due1',lessonId:'jp-01',en:'x',zh:'x',level:0,due:1,solid:false,lang:'jp'},
            future1:{id:'future1',lessonId:'jp-01',en:'y',zh:'y',level:0,due:Date.now()+9e9,solid:false,lang:'jp'},
            solid1:{id:'solid1',lessonId:'jp-01',en:'z',zh:'z',level:8,due:1,solid:true,lang:'jp'}
        }))""")
        due_ids = pg.evaluate("JD.dueItems().map(x=>x.id)")
        ck('dueItems 含已到期未畢業', 'due1' in due_ids, due_ids)
        ck('dueItems 不含未到期', 'future1' not in due_ids, due_ids)
        ck('dueItems 不含已畢業(solid)', 'solid1' not in due_ids, due_ids)

        # ---- streak 連續天數 ----
        print('-- streak 打卡連續天數')
        pg.evaluate("localStorage.removeItem('jingdu_days')")
        # 注入「今天+昨天+前天」
        pg.evaluate("""(()=>{const ds=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
            const m={}; for(let i=0;i<3;i++){ const d=new Date(); d.setDate(d.getDate()-i); m[ds(d)]=1; }
            localStorage.setItem('jingdu_days', JSON.stringify(m));})()""")
        st = pg.evaluate("JD.streak()")
        ck('連續 3 天→n=3, 今天已學', st['n'] == 3 and st['todayDone'] == True, st)
        # 只有昨天+前天(今天沒學)→ todayDone false，n 仍算昨天起 2
        pg.evaluate("""(()=>{const ds=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
            const m={}; for(let i=1;i<=2;i++){ const d=new Date(); d.setDate(d.getDate()-i); m[ds(d)]=1; }
            localStorage.setItem('jingdu_days', JSON.stringify(m));})()""")
        st2 = pg.evaluate("JD.streak()")
        ck('今天沒學但昨前天有→todayDone false, n=2', st2['todayDone'] == False and st2['n'] == 2, st2)
        # 斷天(只有前天)→ n=0
        pg.evaluate("""(()=>{const ds=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
            const d=new Date(); d.setDate(d.getDate()-3); localStorage.setItem('jingdu_days', JSON.stringify({[ds(d)]:1}));})()""")
        st3 = pg.evaluate("JD.streak()")
        ck('斷了好幾天→n=0', st3['n'] == 0, st3)

        # ---- 登山海拔：防刷(min(score,done)) + 邊界 ----
        print('-- 登山海拔記分（防刷 + 邊界）')
        pg.evaluate("""(()=>{ for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k&&k.indexOf('jingdu_secpos_')===0){localStorage.removeItem(k); i--;}} })()""")
        # score 灌水成 99 但 done 只有 3 → 只該記 min=3
        pg.evaluate("localStorage.setItem('jingdu_secpos_x', JSON.stringify({speak:{score:99,done:3,n:10}, recite:{score:2,done:2,n:5}}))")
        tc = pg.evaluate("JD.totalCorrect()")
        ck('防刷：score灌水只記min(score,done)=3+2=5', tc == 5, tc)
        alt = pg.evaluate("JD.altitude()")
        ck('海拔=答對題×10=50', alt == 50, alt)
        ms0 = pg.evaluate("JD.mountainState(0)")
        ck('海拔0→在第一座山、frac 0', ms0['cur'] is not None and ms0['frac'] == 0, ms0)
        msTop = pg.evaluate("JD.mountainState(999999)")
        ck('超高海拔→atTop=true, next=null', msTop['atTop'] == True and msTop['next'] is None, msTop)
        msMid = pg.evaluate("JD.mountainState(JD.MOUNTAINS[0].m + (JD.MOUNTAINS[1].m-JD.MOUNTAINS[0].m)/2)")
        ck('中間海拔→frac 約 0.5', 0.4 <= msMid['frac'] <= 0.6, msMid['frac'])

        # ---- 家長 PIN ----
        print('-- 家長 PIN（雜湊/驗證）')
        pg.evaluate("localStorage.removeItem('jingdu_parent_pin')")
        ck('未設 PIN→parentHasPin false', pg.evaluate("JD.parentHasPin()") == False)
        ck('未設 PIN→任何驗證都 false', pg.evaluate("JD.checkParentPin('1234')") == False)
        pg.evaluate("JD.setParentPin('2580')")
        ck('設了 PIN→parentHasPin true', pg.evaluate("JD.parentHasPin()") == True)
        ck('對的 PIN→true', pg.evaluate("JD.checkParentPin('2580')") == True)
        ck('錯的 PIN→false', pg.evaluate("JD.checkParentPin('0000')") == False)
        ck('PIN 非明文(存的是雜湊)', pg.evaluate("localStorage.getItem('jingdu_parent_pin')") not in ('2580', '"2580"'))

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 積分/復盤/打卡行為全對（艾賓浩斯畢業/streak/登山防刷/PIN）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
