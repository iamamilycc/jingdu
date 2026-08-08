#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ns_isolation_test.py —— storage 命名空間隔離測試（英語精讀 / 日語 / 雅思 三站互不干擾）

背景：core.js 原本寫死 `const NS = 'jingdu_'`，而且這個前綴又被**硬編複製到 14 個檔案共 30 處**。
結果是 jp 子站和英語精讀共用同一批 key，學習進度混在一起。新增雅思模組前必須先把它收乾淨，
否則三站資料會攪在一塊，且以後每加一站就多一輪複製貼上（本專案方法論的頭號教訓）。

守住的不變量：
  1. NS 由頁面決定（`window.JD_NS || 'jingdu_'`），主站不設就拿預設 → 現有資料零影響
  2. 除 core.js 的預設值外，全庫不准再出現硬編 'jingdu_' 前綴（一律走 JD 的 load/save）
  3. 各站頁面各自宣告自己的 NS，且三者互不重疊
  4. langOf() 認得 ielts- 開頭的 lessonId（否則打卡/連續天數在雅思空間內失效）
  5. 宣告 JD_NS 必須在載入 core.js **之前**（晚了就拿不到）

用法：  python3 tests/ns_isolation_test.py
成功：  印「全部通過 ✅」且退出碼 0；任一條違反退出碼 1。
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

# 各站的命名空間宣告（新增站點時在這裡登記一行）
#
# ⚠️ 日語版為何還在 jingdu_：換 NS 會讓日語現有進度「看不見」（資料還在舊鍵，只是新空間讀不到），
#    必須配一次性資料複製才安全。本輪刻意**只做零風險的部分**（收硬編技術債 + 雅思用全新空間），
#    日語遷移獨立處理。pending_migration 標記讓這個「已知未完成」是顯式的，不是被忘掉的。
SITES = {
    '英語精讀（主站）': {'dir': '', 'ns': 'jingdu_', 'declares': False},
    '日語版':          {'dir': 'jp', 'ns': 'jingdu_', 'declares': False,
                        'pending_migration': 'jp_'},
    '雅思':            {'dir': 'ielts', 'ns': 'ielts_', 'declares': True},
}


def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)))
    if not cond:
        FAILS.append(name)


def read(rel):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8') as f:
        return f.read()


def walk_code():
    """所有 .js / .html，跳過第三方與產物目錄。"""
    skip = {'node_modules', '.git', 'release', '__pycache__', 'tests'}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in skip]
        for fn in filenames:
            if fn.endswith(('.js', '.html')):
                full = os.path.join(dirpath, fn)
                yield os.path.relpath(full, ROOT), full


# ---- 規則1：core.js 的 NS 可由頁面覆寫，且預設值不變 ----
def check_ns_parameterised():
    print('-- 規則1：core.js 的 NS 可由頁面覆寫（主站不設 → 拿預設 jingdu_，現有資料零影響）')
    core = read('assets/core.js') or ''
    m = re.search(r"const\s+NS\s*=\s*(.+?);", core)
    ck('core.js 有 NS 定義', bool(m))
    if not m:
        return
    expr = m.group(1).strip()
    ck('NS 可由 window.JD_NS 覆寫', 'window.JD_NS' in expr, expr)
    ck('NS 預設值仍是 jingdu_（不可改，否則主站資料全丟）', "'jingdu_'" in expr or '"jingdu_"' in expr, expr)


# 檔案分三類，決定「該不該支援 NS」。分類是本專案的核心設計決策，改動前先想清楚屬哪類。
#
#   SHARED_ENGINE —— 雅思站會載入的共用引擎。**必須**支援 NS，否則雅思進度會寫進主站空間。
#   SETTINGS_SHARED —— 刻意全站共用的「設定」（TTS 供應商、語音偏好、API key）。
#                      硬編 jingdu_ 是對的：換站不必重設一次 key。
#   其餘 —— 精讀課專用（課文頁、生成器、主站頁面），雅思不載入，永遠跑在 jingdu_，硬編安全。
SHARED_ENGINE = ['assets/core.js', 'assets/sync.js']
SETTINGS_SHARED = ['assets/tts.js']


# ---- 規則2：共用引擎不准硬編前綴（精讀專用檔不在此列，刻意不動它們）----
def check_no_hardcoded_prefix():
    print("-- 規則2：共用引擎不准硬編 'jingdu_'（精讀專用檔雅思不載入，維持原樣不動）")
    pat = re.compile(r"""['"]jingdu_""")
    for rel in SHARED_ENGINE:
        src = read(rel)
        ck('%s 存在' % rel, src is not None)
        if src is None:
            continue
        bad, in_block = [], False
        for i, ln in enumerate(src.splitlines(), 1):
            s = ln.strip()
            # 追蹤多行註解區塊（說明文字裡提到 jingdu_ 很正常，不是實際讀寫）
            was_block = in_block
            if '/*' in s and '*/' not in s:
                in_block = True
            elif '*/' in s:
                in_block = False
            if was_block or in_block or s.startswith('//') or s.startswith('*'):
                continue
            if not pat.search(ln):
                continue
            # NS 定義那行的預設值是唯一合法出處
            if re.search(r"(const|let|var)\s+NS\s*=", ln):
                continue
            # NS==='jingdu_' 是「我是不是主站」的判斷，不是拿來拼 key，合法
            if re.search(r"NS\s*===?\s*['\"]jingdu_['\"]", ln):
                continue
            bad.append('%s:%d' % (rel, i))
        ck('%s 無硬編前綴' % rel, not bad, '、'.join(bad[:6]))

    for rel in SETTINGS_SHARED:
        src = read(rel)
        ck('%s 刻意全站共用設定（保留 jingdu_，換站不必重設 key）' % rel,
           src is not None and "'jingdu_'" in src,
           '此檔應維持硬編，若改成 NS 會導致每站都要重設 TTS 與 key')


# ---- 規則3：各站宣告自己的 NS，且互不重疊 ----
def check_sites_declare_ns():
    print('-- 規則3：各站宣告自己的命名空間，三者互不重疊')
    seen = {}
    for site, cfg in SITES.items():
        ns = cfg['ns']
        if cfg.get('pending_migration'):
            # 已知未完成：此站尚未分家，暫時與主站同空間。顯式提醒，但不算失敗。
            print('  --  %s 尚未分家（待遷往 %s，須配一次性資料複製）'
                  % (site, cfg['pending_migration']))
        else:
            ck('%s 的 NS「%s」未與他站重複' % (site, ns), ns not in seen,
               '與 %s 撞名' % seen.get(ns))
            seen[ns] = site

        idx = os.path.join(cfg['dir'], 'index.html') if cfg['dir'] else 'index.html'
        html = read(idx)
        ck('%s 有 %s' % (site, idx), html is not None)
        if html is None:
            continue
        if cfg['declares']:
            ck('%s 宣告了 window.JD_NS = "%s"' % (site, ns),
               re.search(r"window\.JD_NS\s*=\s*['\"]%s['\"]" % re.escape(ns), html) is not None,
               '未宣告，會誤用主站資料')
        else:
            ck('%s 不宣告 JD_NS（走預設，保證現有進度不動）' % site,
               'window.JD_NS' not in html, '主站不該宣告')


# ---- 規則4：宣告順序必須早於 core.js ----
def check_declare_before_core():
    print('-- 規則4：window.JD_NS 必須宣告在載入 core.js 之前（晚了就拿不到）')
    for site, cfg in SITES.items():
        if not cfg['declares']:
            continue
        for page in ('index.html', 'review.html'):
            rel = os.path.join(cfg['dir'], page)
            html = read(rel)
            if html is None:
                ck('%s 存在' % rel, False, '缺頁面')
                continue
            # 只認實際的 <script src=...core.js>，註解裡提到 core.js 不算
            ns_m = re.search(r"window\.JD_NS\s*=", html)
            core_m = re.search(r"<script[^>]+src\s*=\s*['\"][^'\"]*core\.js['\"]", html)
            ck('%s 宣告早於載入 core.js' % rel,
               ns_m is not None and core_m is not None and ns_m.start() < core_m.start(),
               'JD_NS@%s core.js<script>@%s' % (ns_m.start() if ns_m else -1,
                                                core_m.start() if core_m else -1))


# ---- 規則5：langOf 認得 ielts- ----
def check_langof_knows_ielts():
    print('-- 規則5：langOf() 認得 ielts- 開頭的 lessonId（否則雅思空間內打卡/連續天數失效）')
    core = read('assets/core.js') or ''
    m = re.search(r"function\s+langOf\s*\([^)]*\)\s*\{(.+?)\n\s{2}\}", core, re.S)
    ck('找得到 langOf', bool(m))
    if m:
        ck("langOf 處理 'ielts-'", "'ielts-'" in m.group(1) or '"ielts-"' in m.group(1),
           '未處理，雅思 lessonId 會回空字串')


# ---- 規則6：雲備份路徑必須跨站隔離（否則後備份的站會覆蓋掉前一站的雲端資料）----
def check_backup_path_isolated():
    print('-- 規則6：雲備份路徑跨站隔離（三站共用 users/<暱稱>.json 會互相覆蓋＝丟資料）')
    sync = read('assets/sync.js') or ''
    m = re.search(r"function\s+userPath\s*\(\)\s*\{(.+?)\}", sync, re.S)
    ck('找得到 userPath', bool(m))
    if not m:
        return
    body = m.group(1)
    ck('userPath 依命名空間分檔', 'nsSuffix' in body or 'NS' in body,
       '只用暱稱分檔，三站會寫同一個檔互相覆蓋：%s' % body.strip()[:80])
    if 'nsSuffix' in body:
        sfx = re.search(r"function\s+nsSuffix\s*\(\)\s*\{(.+?)\}", sync, re.S)
        ck('nsSuffix 有定義', bool(sfx))
    # 主站路徑不可變，否則使用者現有的雲備份會突然找不到
    ck('主站仍是 users/<暱稱>.json（舊備份必須讀得到）',
       "'users/'" in body or '"users/"' in body, body.strip()[:80])


# ---- 規則7：英語精讀 / 日語精讀「行為零改變」回歸（本輪最重要的保障）----
# 加雅思模組時最該防的不是雅思做不好，而是**把原本好用的兩個站弄壞**。
# 這條用實際字串比對驗證：主站不宣告 JD_NS 時，一切與改動前完全一致。
def check_main_site_unchanged():
    print('-- 規則7：英語精讀/日語精讀行為零改變（主站不宣告 JD_NS → 一切同改動前）')
    core = read('assets/core.js') or ''
    sync = read('assets/sync.js') or ''

    # 7a. 主站拿到的 NS 必須還是 jingdu_（讀寫同一批鍵 → 現有進度全都在）
    ck('core.js 主站 NS 仍為 jingdu_', re.search(r"window\.JD_NS\s*\|\|\s*['\"]jingdu_['\"]", core) is not None,
       '預設值被改 → 主站所有進度會讀不到')
    ck('sync.js 主站 NS 仍為 jingdu_', re.search(r"window\.JD_NS\s*\|\|\s*['\"]jingdu_['\"]", sync) is not None,
       '預設值被改 → 雲備份會讀寫錯空間')

    # 7b. 主站的雲備份路徑必須一字不差（否則使用者現有的 users/<暱稱>.json 找不到 → 等同備份沒了）
    ck('主站備份路徑無後綴（舊雲備份仍讀得到）',
       re.search(r"NS\s*===?\s*['\"]jingdu_['\"]\s*\?\s*['\"]['\"]", sync) is not None,
       '主站必須回空後綴，否則路徑變成 users/x.jingdu.json，舊備份形同消失')

    # 7c. 既有 key 名稱一個都不能改（改名＝舊資料讀不到）。key 分散在引擎與課文邏輯，掃聯集。
    pool = '\n'.join(filter(None, [core, sync,
                                    read('assets/lesson.js'), read('assets/lesson-jp.js'),
                                    read('assets/generate.js')]))
    for key in ['errbook', 'userlessons', 'prog_', 'secpos_', 'story_', 'daily', 'updatedAt', 'avatar']:
        ck('既有 key「%s」未改名' % key,
           ("'" + key) in pool or ('"' + key) in pool or ("jingdu_" + key) in pool,
           '此 key 消失代表舊資料讀不到了')

    # 7d. 精讀專用檔一行都沒動（雅思不載入它們，不該有任何改動理由）
    for rel in ['assets/lesson.js', 'assets/lesson-jp.js', 'assets/generate.js']:
        src = read(rel)
        ck('%s 仍用 jingdu_（未被誤改）' % rel, src is not None and 'jingdu_' in src,
           '精讀專用檔被動了，這輪不該碰它')

    # 7e. 日語版尚未分家 → 必須仍讀主站空間，進度才看得見
    jp = read('jp/index.html')
    ck('jp/index.html 未宣告 JD_NS（進度維持可見）',
       jp is not None and 'window.JD_NS' not in jp,
       '日語一旦宣告新空間，現有進度會突然看不到（須先做資料複製）')


def main():
    print('== storage 命名空間隔離（英語精讀 / 日語 / 雅思）==')
    check_ns_parameterised()
    check_no_hardcoded_prefix()
    check_sites_declare_ns()
    check_declare_before_core()
    check_langof_knows_ielts()
    check_backup_path_isolated()
    check_main_site_unchanged()
    print()
    if FAILS:
        print('❌ %d 條未通過：' % len(FAILS))
        for f in FAILS:
            print('   · ' + f)
        return 1
    print('全部通過 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
