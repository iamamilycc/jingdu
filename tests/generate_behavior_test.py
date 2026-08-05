#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_behavior_test.py —— 自建課生成模組 JDGen 行為閉環測試（fable-5 審查 P1）

過去只間接驗「quiz 下標合法」，這裡直接測純函數：
  - sanitizeListening：1-based 整體減 1、越界/非法題丟棄、選項剝「A. 」前綴
  - buildFallbackListening：保底題答案 100% 正確（opts[ans]===原句）、<4 句湊不齊回 []
  - deleteLesson：刪課連帶清 prog_/secpos_/story_/errbook（**含新修的 secpos_，否則刪課還灌登山海拔**）

用法：  python3 tests/generate_behavior_test.py
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

        # ---- sanitizeListening：1-based 減 1 ----
        print('-- sanitizeListening：1-based 修正 / 越界丟棄 / 剝 A. 前綴')
        r1 = pg.evaluate("""(()=>{
            const d={ sentences:[{en:'a'},{en:'b'},{en:'c'}], listening:[
                {q:'Q1', srcIdx:1, play:[1], ans:0, opts:['A. one','B. two']},   // 1-based(最小1 最大==句數3? 這裡最大是3)
                {q:'Q2', srcIdx:3, play:[3], ans:1, opts:['x','y']}
            ]};
            const o=JDGen.sanitizeListening(JSON.parse(JSON.stringify(d)));
            return o.listening;
        })()""")
        # 句數3，下標最小1最大3 → 判定 1-based → 全體減1 → srcIdx 變 0 和 2
        ck('1-based 偵測→整體減 1（srcIdx 3→2）', any(it['srcIdx'] == 2 for it in r1), r1)
        ck('選項剝掉「A. 」前綴', r1[0]['opts'][0] == 'one', r1[0]['opts'])

        r2 = pg.evaluate("""(()=>{
            const d={ sentences:[{en:'a'},{en:'b'}], listening:[
                {q:'ok', srcIdx:0, play:[0], ans:0, opts:['p','q']},
                {q:'bad-ans', srcIdx:1, play:[1], ans:9, opts:['p','q']},   // ans 越界→丟
                {q:'bad-idx', srcIdx:50, play:[50], ans:0, opts:['p','q']}  // 下標越界→丟
            ]};
            return JDGen.sanitizeListening(JSON.parse(JSON.stringify(d))).listening;
        })()""")
        ck('非法 ans / 越界下標的題被丟棄（只剩 1 題）', len(r2) == 1 and r2[0]['q'] == 'ok', [it['q'] for it in r2])

        # ---- buildFallbackListening：答案 100% 正確 ----
        print('-- buildFallbackListening：保底題答案永遠==原句')
        r3 = pg.evaluate("""(()=>{
            const d={ sentences:[{en:'I like cats'},{en:'She runs fast'},{en:'We eat rice'},{en:'They play ball'},{en:'He reads books'}] };
            const qs=JDGen.buildFallbackListening(d,'en');
            return qs.map(it=>({ okAns: it.opts[it.ans]===d.sentences[it.srcIdx].en, nopt: it.opts.length }));
        })()""")
        ck('保底題有生成', len(r3) >= 1, r3)
        ck('每題 opts[ans] 正好==該句原文（答案100%對）', all(x['okAns'] for x in r3), r3)
        ck('每題四選一', all(x['nopt'] == 4 for x in r3), r3)
        r4 = pg.evaluate("JDGen.buildFallbackListening({sentences:[{en:'only one'},{en:'two'}]},'en').length")
        ck('少於 4 句→湊不齊回空陣列', r4 == 0, r4)

        # ---- deleteLesson：刪課清孤兒（含 secpos_）----
        print('-- deleteLesson：刪課連帶清 prog_/secpos_/story_/errbook（含新修 secpos_）')
        res = pg.evaluate("""(()=>{
            const id='u-del1';
            const all={}; all[id]={id:id, lang:'en', title:'待刪', sentences:[], vocab:[], _meta:{created:1}};
            localStorage.setItem('jingdu_userlessons', JSON.stringify(all));
            localStorage.setItem('jingdu_prog_'+id, JSON.stringify({speak:true}));
            localStorage.setItem('jingdu_secpos_'+id, JSON.stringify({speak:{score:5,done:5,n:5}}));
            localStorage.setItem('jingdu_story_'+id, 'once upon a time');
            localStorage.setItem('jingdu_errbook', JSON.stringify({e1:{id:'e1',lessonId:id,en:'x'}, keep:{id:'keep',lessonId:'nce2-01',en:'y'}}));
            JDGen.deleteLesson(id);
            const book=JSON.parse(localStorage.getItem('jingdu_errbook')||'{}');
            return {
                lessonGone: !(JDGen.allUserLessons()[id]),
                progGone: localStorage.getItem('jingdu_prog_'+id)===null,
                secposGone: localStorage.getItem('jingdu_secpos_'+id)===null,
                storyGone: localStorage.getItem('jingdu_story_'+id)===null,
                errGone: !book['e1'],
                otherErrKept: !!book['keep']
            };
        })()""")
        ck('課本身刪掉', res['lessonGone'], res)
        ck('清 prog_', res['progGone'], res)
        ck('清 secpos_（登山海拔來源，否則刪課還灌海拔）', res['secposGone'], res)
        ck('清 story_', res['storyGone'], res)
        ck('清該課錯題', res['errGone'], res)
        ck('別課的錯題保留(不誤傷)', res['otherErrKept'], res)

        # ---- 單詞課：isWordList 偵測 + fromText 分流 + 生成失敗兜底 ----
        print('-- 單詞課：偵測詞表 / 走單詞課 prompt / 生成失敗自動兜底')
        wl = pg.evaluate("""(()=>({
            multiline: JDGen.isWordList('apple\\nbanana\\ncat\\norange'),
            comma: JDGen.isWordList('apple, banana, cat, orange'),
            withZh: JDGen.isWordList('apple 蘋果\\nbanana 香蕉\\ncat 貓'),
            sentence: JDGen.isWordList('The boy went to the theatre last week.'),
            twoSent: JDGen.isWordList('I like apples. She likes bananas too.'),
            oneLineNoPunct: JDGen.isWordList('I have a red book')
        }))""")
        ck('多行詞表→是詞表', wl['multiline'] == True, wl)
        ck('逗號詞表→是詞表', wl['comma'] == True, wl)
        ck('帶中文注釋詞表→是詞表', wl['withZh'] == True, wl)
        ck('正常句子→不是詞表', wl['sentence'] == False, wl)
        ck('多句課文→不是詞表', wl['twoSent'] == False, wl)
        ck('單行漏標點句→保守判非詞表(靠兜底)', wl['oneLineNoPunct'] == False, wl)

        # fromText 分流：mock fetch 捕捉送出的 system prompt
        good = ('{"title":"水果單詞 Fruits","level":1,'
                '"sentences":[{"en":"I like apples.","zh":"我喜歡蘋果。","ana":"用 like 表達喜歡。"}],'
                '"vocab":[{"w":"apple","ipa":"/ˈæpl/","pos":"n.","zh":"蘋果","eg":"I like apples."}],'
                '"listening":[],"grammar":[]}')
        empty = '{"title":"x","level":1,"sentences":[],"vocab":[],"listening":[],"grammar":[]}'
        pg.evaluate("JDGen.setKey('k')")
        # 詞表輸入 → 應走 wordsSystemPrompt（system 含「單詞精讀課」）
        pg.evaluate("""window.__sys=[]; window.fetch=async(u,o)=>{
            if(!o||!o.body) return { ok:true, status:200, json:async()=>({}) };
            const b=JSON.parse(o.body); if(!b.messages) return {ok:true,status:200,json:async()=>({})};
            window.__sys.push(b.messages[0].content);
            return { ok:true, status:200, json:async()=>({choices:[{message:{content: %s }}]}) }; };""" % ('`'+good+'`'))
        pg.evaluate("(async()=>{ try{ await JDGen.fromText('en','apple\\nbanana\\ncat', ()=>{}); }catch(e){ window.__err=String(e); } })()")
        pg.wait_for_timeout(400)
        sys1 = pg.evaluate("window.__sys")
        ck('詞表輸入→走單詞課 prompt', any('單詞精讀課' in s for s in sys1), sys1)

        # 兜底：正常句輸入但第一次生成「沒有句子」→ 自動改走單詞課重試
        pg.evaluate("""window.__sys=[]; window.__n=0;
            const goodJ=%s, emptyJ=%s;
            window.fetch=async(u,o)=>{ if(!o||!o.body) return {ok:true,status:200,json:async()=>({})};
              const b=JSON.parse(o.body); if(!b.messages) return {ok:true,status:200,json:async()=>({})};
              window.__sys.push(b.messages[0].content); window.__n++;
              const c = (window.__n===1) ? emptyJ : goodJ;   // 第一次回空(沒句子)，第二次回好
              return { ok:true, status:200, json:async()=>({choices:[{message:{content:c}}]}) }; };"""
            % ('`'+good+'`', '`'+empty+'`'))
        # 'random blah' 不是詞表→第一次走正常 prompt(回空拋「沒有句子」)→自動兜底改走單詞課重試
        pg.evaluate("""(async()=>{ try{ const d=await JDGen.fromText('en','random blah', ()=>{}); window.__r2={ok:true,title:d.title}; }catch(e){ window.__r2={ok:false,err:String(e)}; } })()""")
        pg.wait_for_timeout(600)
        sys2 = pg.evaluate("window.__sys")
        r2 = pg.evaluate("window.__r2")
        ck('兜底：第一次走正常 prompt', len(sys2) >= 2 and '精讀老師，為小學生製作' in sys2[0], sys2[:1])
        ck('兜底：沒句子→第二次改走單詞課 prompt', len(sys2) >= 2 and '單詞精讀課' in sys2[1], sys2[1:2])
        ck('兜底：最終成功回傳課(有 title)', r2 and r2.get('ok') == True, r2)

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 生成模組行為全對（聽力保底答案100%對/1-based修正/刪課清孤兒含secpos）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
