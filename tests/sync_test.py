#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_test.py —— 雲端備份/還原 資料安全 閉環測試（fable-5 審查 P0：資料一丟全丟）

雲同步過去零測試。這裡用 mock fetch 走公開的 JDSYNC.init()，驗證資料安全的關鍵路徑：
  1. 還原：雲端較新 → 覆蓋本機（舊鍵清掉、新鍵入、**同步設定 CFG 不被清掉**）、觸發 ONRESTORE
  2. 推送請求格式：Gitee 走 POST/PUT + access_token；GitHub 走 PUT + Bearer（格式錯會備份失敗=丟資料）
  3. 本機較新 → 推送；相等 → 不動

真實令牌讀寫需用戶拿真令牌驗（無法本機測），這裡把「能測的路由/覆蓋/保留」測到閉環。

用法：  python3 tests/sync_test.py
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

        # ---- 1. 還原：雲端較新→覆蓋本機、保留 CFG、觸發 ONRESTORE ----
        print('-- 還原：雲端較新→覆蓋本機（舊鍵清、新鍵入、CFG 保留、ONRESTORE 觸發）')
        pg.evaluate("""(()=>{
            // 本機：一把舊資料鍵 + 舊 updatedAt + 同步設定
            localStorage.clear();
            localStorage.setItem('jingdu_prog_old','LOCAL_OLD');
            localStorage.setItem('jingdu_updatedAt','100');
            localStorage.setItem('jingdu_sync', JSON.stringify({provider:'gitee',user:'mire',token:'TOK',owner:'me',repo:'ccjingdu'}));
            // 雲端回一份較新的快照（updatedAt 999，資料換成 prog_new）
            const remoteJson = JSON.stringify({updatedAt:999, data:{'jingdu_prog_new':'CLOUD_NEW'}});
            const contentB64 = btoa(unescape(encodeURIComponent(remoteJson)));
            window.__restored=false; window.JDSYNC_ONRESTORE=()=>{ window.__restored=true; };
            window.fetch = async (u,o)=>{
                // pull=GET users/xxx.json → 回檔案(base64 content)
                return { ok:true, status:200, json: async()=>({ content:contentB64, sha:'sha1' }) };
            };
        })()""")
        pg.evaluate("JDSYNC.init()"); pg.wait_for_timeout(400)
        r = pg.evaluate("""(()=>({
            oldGone: localStorage.getItem('jingdu_prog_old')===null,
            newIn: localStorage.getItem('jingdu_prog_new'),
            cfgKept: !!localStorage.getItem('jingdu_sync'),
            upd: localStorage.getItem('jingdu_updatedAt'),
            restored: window.__restored
        }))""")
        ck('舊鍵被清掉', r['oldGone'], r)
        ck('雲端新鍵寫入', r['newIn'] == 'CLOUD_NEW', r)
        ck('⚠️同步設定 CFG 保留(否則會登出丟令牌)', r['cfgKept'], r)
        ck('updatedAt 更新成雲端的 999', r['upd'] == '999', r)
        ck('觸發 ONRESTORE(讓頁面重繪)', r['restored'] == True, r)

        # ---- 2. Gitee 推送請求格式（本機較新→push）----
        print('-- 推送格式 Gitee：POST/PUT + access_token 在 body')
        pg.evaluate("""(()=>{
            localStorage.clear();
            localStorage.setItem('jingdu_prog_x','1');
            localStorage.setItem('jingdu_updatedAt', String(Date.now()));  // 本機較新
            localStorage.setItem('jingdu_sync', JSON.stringify({provider:'gitee',user:'mire',token:'GTOK',owner:'me',repo:'ccjingdu'}));
            window.__writeReq=null;
            window.fetch = async (u,o)=>{ o=o||{}; const m=(o.method||'GET').toUpperCase();
                if(m==='GET'){ return { ok:false, status:404, json:async()=>({}) }; }  // 雲端沒檔→本機較新→push 建檔
                window.__writeReq={ url:String(u), method:m, headers:o.headers||{}, body:o.body||'' };
                return { ok:true, status:200, json:async()=>({content:{sha:'newsha'}}) };
            };
        })()""")
        pg.evaluate("JDSYNC.init()"); pg.wait_for_timeout(500)
        w = pg.evaluate("window.__writeReq")
        ck('Gitee 有發寫入請求', w is not None, w)
        if w:
            import json as _j
            body = {}
            try: body = _j.loads(w['body'])
            except Exception: pass
            ck('Gitee URL 指向 repos/owner/repo/contents/users', 'gitee.com/api/v5/repos/me/ccjingdu/contents/users/mire.json' in w['url'], w['url'])
            ck('Gitee 建檔用 POST', w['method'] == 'POST', w['method'])
            ck('Gitee access_token 在 body(不在 header)', body.get('access_token') == 'GTOK', list(body.keys()))
            ck('Gitee body 帶 content(base64)', bool(body.get('content')), list(body.keys()))

        # ---- 3. GitHub 推送格式：PUT + Bearer ----
        print('-- 推送格式 GitHub：PUT + Authorization Bearer')
        pg.evaluate("""(()=>{
            localStorage.clear();
            localStorage.setItem('jingdu_prog_x','1');
            localStorage.setItem('jingdu_updatedAt', String(Date.now()));
            localStorage.setItem('jingdu_sync', JSON.stringify({provider:'github',user:'mire',token:'HTOK',owner:'me',repo:'jingdu-data'}));
            window.__writeReq=null;
            window.fetch = async (u,o)=>{ o=o||{}; const m=(o.method||'GET').toUpperCase();
                if(m==='GET'){ return { ok:false, status:404, json:async()=>({}) }; }
                window.__writeReq={ url:String(u), method:m, headers:o.headers||{} };
                return { ok:true, status:200, json:async()=>({content:{sha:'newsha'}}) };
            };
        })()""")
        pg.evaluate("JDSYNC.init()"); pg.wait_for_timeout(500)
        w2 = pg.evaluate("window.__writeReq")
        ck('GitHub 有發寫入請求', w2 is not None, w2)
        if w2:
            ck('GitHub URL api.github.com', 'api.github.com/repos/me/jingdu-data/contents/users/mire.json' in w2['url'], w2['url'])
            ck('GitHub 用 PUT', w2['method'] == 'PUT', w2['method'])
            ck('GitHub 令牌走 Authorization Bearer', (w2['headers'].get('Authorization') or '') == 'Bearer HTOK', w2['headers'])

        # ---- 4. 相等→不動（不 push、不還原）----
        print('-- 本機==雲端 → 不動')
        pg.evaluate("""(()=>{
            localStorage.clear();
            localStorage.setItem('jingdu_updatedAt','500');
            localStorage.setItem('jingdu_sync', JSON.stringify({provider:'gitee',user:'mire',token:'T',owner:'me',repo:'r'}));
            const remoteJson=JSON.stringify({updatedAt:500, data:{}});
            const cB64=btoa(unescape(encodeURIComponent(remoteJson)));
            window.__wrote=false;
            window.fetch=async(u,o)=>{ o=o||{}; const m=(o.method||'GET').toUpperCase();
                if(m==='GET') return {ok:true,status:200,json:async()=>({content:cB64,sha:'s'})};
                window.__wrote=true; return {ok:true,status:200,json:async()=>({content:{sha:'x'}})};
            };
        })()""")
        pg.evaluate("JDSYNC.init()"); pg.wait_for_timeout(400)
        wrote = pg.evaluate("window.__wrote")
        ck('updatedAt 相等→不推送(省流量、不覆蓋)', wrote == False, wrote)

        pg.close(); b.close()

    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS: print('   - ' + f)
        return 1
    print('✅ 雲備份/還原 資料安全全對（覆蓋保留CFG/Gitee POST/GitHub PUT/相等不動）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception as ex:
        print('測試執行出錯：', ex)
        sys.exit(2)
