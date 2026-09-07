#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_override_test.py —— 造句「AI 誤判正確句」人工否決閉環測試

AI 判分會幻想文法錯，把本來正確的句子判錯（例如挑剔 nearly 的語序）。
給人工否決：判錯時顯示「🙋 我覺得這句沒問題」，一按→當對 + 撤掉剛加的錯題。
若該詞本來就在錯題本(真的錯過)，否決只還原到誤判前、不誤刪整條。英日共用 mkAfter。
用法： python3 tests/make_override_test.py
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

MOCK_WRONG = ("window.JDGen=Object.assign(window.JDGen||{},{getKey:function(){return 'x'},"
              "judgeSentence:function(){return Promise.resolve({ok:false,fix:'try',tip:'語序怪',better:'',betterZh:''})}});")

# 2026-09-07：造句新規則（≥5 詞 + 必須用上生詞）——句子要先過得了前端檢查才會送到 AI，
# 否則根本走不到「AI 判錯 → 人工否決」這條路。用當前生詞現組一句合規的句子。
SEND_BAD = ("""(()=>{const w=(document.querySelector('#mkStage .target b')||{}).innerText||'thing';
  document.getElementById('mkInput').value='I nearly go home with the '+w+' today.'; mkCheck();})()""")


def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.goto('http://127.0.0.1:%d/lessons/nce2-01.html' % port); pg.wait_for_timeout(900)
        pg.evaluate("JD.setMkMin(0); localStorage.removeItem('jingdu_errbook'); switchTab('make')"); pg.wait_for_timeout(200)
        pg.evaluate(MOCK_WRONG)

        print('-- 判錯→否決→撤回錯題+算對')
        pg.evaluate("mkRestart&&mkRestart()"); pg.wait_for_timeout(120)
        pg.evaluate(SEND_BAD); pg.wait_for_timeout(300)
        ck('判錯→錯題本 +1', pg.evaluate("Object.keys(JD.getBook()).length") == 1)
        ck('判錯→出現否決鈕', pg.evaluate("!!document.querySelector('#mkFb .jd-mkok')"))
        pg.evaluate("document.querySelector('#mkFb .jd-mkok').click()"); pg.wait_for_timeout(200)
        ck('否決→錯題本撤回(回 0)', pg.evaluate("Object.keys(JD.getBook()).length") == 0)
        ck('否決→顯示算你對', '算你對' in pg.evaluate("(document.getElementById('mkFb')||{}).innerText||''"))

        print('-- 該詞本來就在錯題本(真錯過)→否決只還原不誤刪')
        pg.evaluate("localStorage.removeItem('jingdu_errbook'); mkRestart&&mkRestart()"); pg.wait_for_timeout(120)
        w0 = pg.evaluate("(document.querySelector('#mkStage .target b')||{}).innerText||''")
        pg.evaluate("w=>JD.addError({id:'w:'+LESSON.id+'#'+w,lessonId:LESSON.id,en:w,zh:'x',type:'word'})", w0)
        f_before = pg.evaluate("w=>JD.getBook()['w:'+LESSON.id+'#'+w].fails", w0)
        pg.evaluate(SEND_BAD); pg.wait_for_timeout(300)
        f_mid = pg.evaluate("w=>(JD.getBook()['w:'+LESSON.id+'#'+w]||{}).fails", w0)
        pg.evaluate("var o=document.querySelector('#mkFb .jd-mkok'); if(o)o.click();"); pg.wait_for_timeout(200)
        still = pg.evaluate("w=>!!JD.getBook()['w:'+LESSON.id+'#'+w]", w0)
        f_after = pg.evaluate("w=>(JD.getBook()['w:'+LESSON.id+'#'+w]||{}).fails", w0)
        ck('誤判時 fails +1', f_mid == f_before + 1, 'mid=%s' % f_mid)
        ck('否決後條目仍在(沒誤刪本來的錯題)', still)
        ck('否決還原到誤判前 fails(%s)' % f_before, f_after == f_before, 'after=%s' % f_after)

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 造句人工否決全對（撤回誤判錯題/算對·本來的錯題只還原不誤刪）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
