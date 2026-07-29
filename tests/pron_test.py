#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pron_test.py —— Azure 發音評估（JDPron）請求格式 + 解析 + 開關邏輯 閉環測試

⚠️ 這是「會花錢的功能」的把關：用 mock 攔住 fetch，驗證
  1. 送去 Azure 的請求格式正確（端點/語言/Pronunciation-Assessment 標頭/key）——格式錯會白扣費或永遠 0 分
  2. 回應的四維分數解析正確
  3. opt-in 開關：沒 key→configured() false；沒開→enabled() false
真實的 Azure 呼叫 + iOS 錄音無法在此測（無 key、無麥克風），需用戶拿真 key 真機跑並對帳。

用法：  python3 tests/pron_test.py
"""
import os, sys, time, socket, http.server, threading, functools, base64, json

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

CANNED = {
    "DisplayText": "これからお世話になります",
    "NBest": [{"PronunciationAssessment": {
        "AccuracyScore": 92, "FluencyScore": 85, "CompletenessScore": 100,
        "ProsodyScore": 78, "PronScore": 88}}]
}

def run():
    from playwright.sync_api import sync_playwright
    port = free_port(); serve(port); time.sleep(0.4)
    url = 'http://127.0.0.1:%d/jp/lessons/jp-01.html' % port
    with sync_playwright() as p:
        # fake media = 假麥克風(產生一個音調)，讓 MediaRecorder 真的錄到東西、可測捕獲→解碼→WAV 路徑
        b = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        pg = b.new_page()
        pg.goto(url); pg.wait_for_timeout(900)

        # ---- 開關邏輯：沒 key → 沒 configured；沒開 → 沒 enabled ----
        print('-- 開關/設定邏輯')
        pg.evaluate("localStorage.removeItem('jingdu_az_key'); localStorage.removeItem('jingdu_az_region'); JDPron.setOn(false);")
        ck('沒 key → configured() false', pg.evaluate("JDPron.configured()") == False)
        pg.evaluate("localStorage.setItem('jingdu_az_key','testkey'); localStorage.setItem('jingdu_az_region','EastAsia');")
        ck('有 key → configured() true', pg.evaluate("JDPron.configured()") == True)
        ck('沒開 → enabled() false', pg.evaluate("JDPron.enabled()") == False)
        pg.evaluate("JDPron.setOn(true)")
        ck('開了 → enabled() true', pg.evaluate("JDPron.enabled()") == True)

        # ---- mock fetch，驗證日語請求格式 + 解析 ----
        print('-- 日語 assessBlob：請求格式 + 四維解析')
        pg.evaluate("""window.__req=null; window.__realFetch=window.fetch;
            window.fetch = async (u,o)=>{ o=o||{};
                if(String(u).indexOf('stt.speech')>=0){
                    window.__req={url:String(u), headers:o.headers||{}, method:o.method,
                        bodyType:(o.body&&o.body.constructor&&o.body.constructor.name)||typeof o.body};
                    return { ok:true, json: async()=> (%s) };
                }
                return window.__realFetch(u,o);
            };""" % json.dumps(CANNED))
        sc = pg.evaluate("JDPron.assessBlob(new Blob(['x'],{type:'audio/wav'}), 'これからお世話になります', 'ja')")
        req = pg.evaluate("window.__req")
        ck('端點是 stt.speech + region', 'eastasia.stt.speech.microsoft.com' in req['url'], req['url'])
        ck('language=ja-JP', 'language=ja-JP' in req['url'], req['url'])
        ck('⚠️format=detailed(否則沒NBest/四維分,會誤報no-speech)', 'format=detailed' in req['url'], req['url'])
        ck('帶 Ocp-Apim-Subscription-Key', req['headers'].get('Ocp-Apim-Subscription-Key') == 'testkey', req['headers'])
        ck('Content-Type 是 wav pcm 16k', 'audio/wav' in (req['headers'].get('Content-Type') or ''), req['headers'].get('Content-Type'))
        ck('body 是 Blob(WAV)', req['bodyType'] == 'Blob', req['bodyType'])
        # 解碼 Pronunciation-Assessment 標頭（base64(UTF-8 JSON)）
        pah = req['headers'].get('Pronunciation-Assessment', '')
        try:
            cfg = json.loads(base64.b64decode(pah).decode('utf-8'))
        except Exception as e:
            cfg = {}
        ck('標頭含 ReferenceText(日文正確)', cfg.get('ReferenceText') == 'これからお世話になります', cfg)
        ck('標頭 EnableProsodyAssessment=true(才有語調分)', cfg.get('EnableProsodyAssessment') is True, cfg)
        ck('標頭 Dimension=Comprehensive(四維全開)', cfg.get('Dimension') == 'Comprehensive', cfg)
        # 解析
        ck('四維解析：準確92', sc['accuracy'] == 92, sc)
        ck('四維解析：流利85', sc['fluency'] == 85, sc)
        ck('四維解析：完整100', sc['completeness'] == 100, sc)
        ck('四維解析：語調78', sc['prosody'] == 78, sc)
        ck('總分 pron88', sc['pron'] == 88, sc)
        ck('識別文字回傳', sc['text'] == 'これからお世話になります', sc)

        # ---- ⚠️真實 REST v1 格式：分數平鋪在 NBest[0]（非巢狀 PronunciationAssessment），且常無 ProsodyScore ----
        print('-- 平鋪格式解析（REST v1 真實回應：NBest[0].AccuracyScore 直接、無語調）')
        pg.evaluate("""window.fetch = async ()=>({ ok:true, status:200, json:async()=>({
            RecognitionStatus:'Success', DisplayText:'hello world',
            NBest:[{ Confidence:0.9, Lexical:'hello world', Display:'hello world',
                     AccuracyScore:90, FluencyScore:88, CompletenessScore:100, PronScore:91 }] }) });""")
        flat = pg.evaluate("JDPron.assessBlob(new Blob(['x'],{type:'audio/wav'}), 'hello world', 'en')")
        ck('平鋪：準確90(讀 NBest[0].AccuracyScore)', flat['accuracy'] == 90, flat)
        ck('平鋪：流利88', flat['fluency'] == 88, flat)
        ck('平鋪：完整100', flat['completeness'] == 100, flat)
        ck('平鋪：總分91', flat['pron'] == 91, flat)
        ck('無語調→hasProsody=false(前端不顯示語調條)', flat['hasProsody'] == False, flat)

        # ---- 英語走 en-US ----
        print('-- 英語 assessBlob：language=en-US')
        pg.evaluate("""window.__req=null;
            window.fetch = async (u,o)=>{ o=o||{}; if(String(u).indexOf('stt.speech')>=0){
                window.__req={url:String(u)}; return { ok:true, status:200, json:async()=> (%s) }; }
                return { ok:false, status:404, json:async()=>({}) }; };""" % json.dumps(CANNED))
        pg.evaluate("JDPron.assessBlob(new Blob(['x'],{type:'audio/wav'}), 'Hello world', 'en')")
        pg.wait_for_timeout(100)
        req2 = pg.evaluate("window.__req")
        ck('英語 language=en-US', req2 is not None and 'language=en-US' in req2['url'], req2)

        # ---- Azure 回錯（4xx）→ 丟錯讓呼叫端退回 ----
        print('-- Azure 失敗 → 丟錯（呼叫端好退回 Web Speech）')
        pg.evaluate("window.fetch = async ()=>({ ok:false, status:401, json:async()=>({}) });")
        errored = pg.evaluate("""(async()=>{ try{ await JDPron.assessBlob(new Blob(['x']),'x','en'); return false; }catch(e){ return String(e.message||e); } })()""")
        ck('401 會丟錯', bool(errored) and '401' in str(errored), errored)
        # Azure 回 200 但沒 NBest(simple格式/沒說話)→錯誤訊息帶出 RecognitionStatus 方便真機定位
        pg.evaluate("""window.fetch = async ()=>({ ok:true, status:200, json:async()=>({ RecognitionStatus:'InitialSilenceTimeout', DisplayText:'' }) });""")
        e2 = pg.evaluate("""(async()=>{ try{ await JDPron.assessBlob(new Blob(['x']),'x','en'); return ''; }catch(e){ return String(e.message||e); } })()""")
        ck('無NBest→錯誤帶RecognitionStatus(InitialSilenceTimeout=沒收到聲音)', 'InitialSilenceTimeout' in str(e2), e2)
        pg.close()

        # ---- 整合閉環：背句 Pron 模式（mock 掉真麥克風/Azure）----
        print('-- 背句整合：Pron 模式不自動錄→點開始背→我說完了→四維條→更新進度')
        pg = b.new_page()
        pg.goto(url); pg.wait_for_timeout(900)
        pg.evaluate("""
          localStorage.setItem('jingdu_az_key','k'); localStorage.setItem('jingdu_az_region','eastasia');
          JDPron.setOn(true);
          JDPron.supported=()=>true;
          JDPron.start=async()=>({ stop: async()=>({accuracy:91,fluency:82,completeness:100,prosody:75,hasProsody:true,pron:86,text:'テスト'}), cancel:()=>{} });
        """)
        ck('enabled() true', pg.evaluate("JDPron.enabled()") == True)
        pg.evaluate("switchTab('recite'); rcRender2()"); pg.wait_for_timeout(150)
        pg.evaluate("rcStart()"); pg.wait_for_timeout(120)
        pg.evaluate("rcSkipPeek()"); pg.wait_for_timeout(150)
        pre = pg.evaluate("!!document.querySelector('#rcResult .pron-bars')")
        ck('Pron 模式蓋句後沒自動起錄', pre == False)
        maskTxt = pg.evaluate("(document.querySelector('#rcTarget')||{}).innerText||''")
        ck('提示改成點開始背', ('開始背' in maskTxt) or ('開麥' in maskTxt), maskTxt[:40])
        pg.evaluate("document.getElementById('rcRecBtn').click()"); pg.wait_for_timeout(200)
        pg.evaluate("document.getElementById('rcRecBtn').click()"); pg.wait_for_timeout(300)
        rows = pg.evaluate("document.querySelectorAll('#rcResult .pron-bars .pron-row').length")
        ck('出現四維分數條(4 條)', rows == 4, rows)
        badge = pg.evaluate("(document.querySelector('#rcResult .acc-badge')||{}).innerText||''")
        ck('顯示綜合發音分', '86' in badge, badge)
        heard = pg.evaluate("(document.querySelector('#rcHeard')||{}).innerText||''")
        ck('顯示識別文字', 'テスト' in heard, heard)
        # 閉環證明：綜合分(86>=85)餵進 onAcc→rc.results→進度/總評分/爬山；該句 pill 應標綠(ok)
        okPills = pg.evaluate("document.querySelectorAll('#rcPills .pill.ok').length")
        ck('綜合分進了背句進度(pill 標綠=餵給復盤/爬山/總評分同一管線)', okPills >= 1, okPills)
        secpos = pg.evaluate("localStorage.getItem('jingdu_secpos_'+LESSON.id)||''")
        ck('背句 secpos 有寫入(總評分/爬山讀這個)', 'recite' in secpos, secpos[:80])

        # 低分要進復盤(錯題本)：綜合分 50<85 → 該句加進 errbook
        print('-- 閉環：綜合分低於 85 → 進復盤錯題本')
        pg.evaluate("JDPron.start=async()=>({ stop: async()=>({accuracy:40,fluency:30,completeness:60,prosody:20,hasProsody:true,pron:50,text:'x'}), cancel:()=>{} });")
        before = pg.evaluate("Object.keys(JD.getBook()).length")
        pg.evaluate("rcNav(1)"); pg.wait_for_timeout(120)          # 換下一句
        pg.evaluate("rcStart()"); pg.wait_for_timeout(120); pg.evaluate("rcSkipPeek()"); pg.wait_for_timeout(150)
        pg.evaluate("document.getElementById('rcRecBtn').click()"); pg.wait_for_timeout(200)
        pg.evaluate("document.getElementById('rcRecBtn').click()"); pg.wait_for_timeout(300)
        after = pg.evaluate("Object.keys(JD.getBook()).length")
        ck('低分綜合分→錯題本多一條(進復盤)', after == before + 1, '%d→%d' % (before, after))
        pg.close()

        # ---- 真捕獲路徑：MediaRecorder→decodeAudioData→WAV 非空（假麥克風，不碰 Azure）----
        print('-- 真捕獲：MediaRecorder 錄音→解碼→WAV 非空(修 iOS 靜音根因)')
        cp = b.new_page()
        cp.goto(url); cp.wait_for_timeout(800)
        cp.evaluate("""(()=>{ window.__wavSize=-1;
            localStorage.setItem('jingdu_az_key','k'); localStorage.setItem('jingdu_az_region','eastasia');
            // mock fetch：assessBlob 內部會 POST WAV → 捕捉 body(WAV Blob) 大小，回一份合法 NBest
            window.fetch = async (u,o)=>{ o=o||{}; if(String(u).indexOf('stt.speech')>=0){
                window.__wavSize = (o.body && o.body.size)||0;
                return { ok:true, status:200, json:async()=>({DisplayText:'x',NBest:[{PronunciationAssessment:{AccuracyScore:80,FluencyScore:80,CompletenessScore:80,ProsodyScore:80,PronScore:80}}]}) };
            } return { ok:false, status:404, json:async()=>({}) }; };
        })()""")
        cap = cp.evaluate("""(async()=>{
            if(!JDPron.supported()) return {sup:false};
            let ctl; try{ ctl = await JDPron.start('hello world','en'); }catch(e){ return {sup:true, startErr:String(e.message||e)}; }
            await new Promise(r=>setTimeout(r, 700));   // 錄 0.7 秒假音
            try{ await ctl.stop(); }catch(e){ return {sup:true, stopErr:String(e.message||e), wav:window.__wavSize}; }
            return {sup:true, wav:window.__wavSize};
        })()""")
        ck('supported()（有 MediaRecorder）', cap.get('sup') == True, cap)
        ck('錄到非空 WAV（>2KB，證明真收到音訊非靜音）', isinstance(cap.get('wav'), (int, float)) and cap.get('wav', 0) > 2000, cap)
        cp.close()

        # ---- 自建課(view.html)也要能用發音評估 + 生詞強化(和內建課同一引擎)----
        print('-- 自建課(view.html)：發音評估依賴齊 + 生詞強化有渲染')
        import json as _json
        lesson = {"id":"u-t1","lang":"jp","title":"自建測試課","badge":"日語 · 自建",
            "sentences":[{"jp":"これからお世話[せわ]になります","zh":"以後請多關照"},
                         {"jp":"私[わたし]は学生[がくせい]です","zh":"我是學生"}],
            "vocab":[{"w":"世話[せわ]","zh":"關照","pos":"名詞"},{"w":"学生[がくせい]","zh":"學生","pos":"名詞"}],
            "listening":[],"grammar":[],"_meta":{"created":1}}
        vp = b.new_page(viewport={'width':390,'height':820})
        verrs=[]; vp.on('pageerror', lambda e: verrs.append(str(e)))
        vp.goto('http://127.0.0.1:%d/jp/lessons/view.html?id=u-t1' % port)
        vp.evaluate("(l)=>localStorage.setItem('jingdu_userlessons', JSON.stringify({'u-t1':l}))", lesson)
        vp.reload(); vp.wait_for_timeout(1600)
        v = vp.evaluate("""(()=>({
            engine: typeof window.switchTab==='function',
            pron: !!(window.JDPron && JDPron.assessBlob),
            ruby: !!(window.JDRuby && JDRuby.toPlain),
            drill: (document.getElementById('p-vocab')||{}).innerText? document.getElementById('p-vocab').innerText.indexOf('生詞強化')>=0 : false
        }))""")
        ck('自建課引擎載入', v['engine'])
        ck('自建課 JDPron 發音評估可用', v['pron'])
        ck('自建課 ruby.toPlain(日語參考文)可用', v['ruby'])
        ck('自建課生詞強化練習有渲染(和內建同引擎)', v['drill'])
        ck('自建課無 JS 錯誤', len(verrs) == 0, verrs[:2])
        vp.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 發音評估請求格式/解析/開關 全對（真實 Azure 呼叫需真機真 key 對帳）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
