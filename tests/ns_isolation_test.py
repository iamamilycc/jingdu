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


# ---- 規則2：全庫不准再有硬編 'jingdu_' 前綴 ----
def check_no_hardcoded_prefix():
    print("-- 規則2：除 core.js 預設值外，全庫不准硬編 'jingdu_'（一律走 JD.load/save）")
    pat = re.compile(r"""['"]jingdu_""")
    offenders = []
    for rel, full in walk_code():
        with open(full, encoding='utf-8') as f:
            for i, ln in enumerate(f, 1):
                if not pat.search(ln):
                    continue
                # core.js 的 NS 預設值是唯一合法出處
                if rel == 'assets/core.js' and re.search(r"const\s+NS\s*=", ln):
                    continue
                offenders.append('%s:%d' % (rel, i))
    ck('無殘留硬編前綴', not offenders,
       '%d 處：%s%s' % (len(offenders), '、'.join(offenders[:8]),
                       ' …' if len(offenders) > 8 else ''))


# ---- 規則3：各站宣告自己的 NS，且互不重疊 ----
def check_sites_declare_ns():
    print('-- 規則3：各站宣告自己的命名空間，三者互不重疊')
    seen = {}
    for site, cfg in SITES.items():
        ns = cfg['ns']
        ck('%s 的 NS「%s」未與他站重複' % (site, ns), ns not in seen, '與 %s 撞名' % seen.get(ns))
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
            ns_at = html.find('window.JD_NS')
            core_at = html.find('core.js')
            ck('%s 宣告早於 core.js' % rel,
               ns_at != -1 and core_at != -1 and ns_at < core_at,
               'JD_NS@%d core.js@%d' % (ns_at, core_at))


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
    ck('userPath 依命名空間分檔', 'NS' in body or 'JD_NS' in body,
       '只用暱稱分檔，三站會寫同一個檔互相覆蓋：%s' % body.strip()[:80])
    # 主站路徑不可變，否則使用者現有的雲備份會突然找不到
    ck('主站仍是 users/<暱稱>.json（舊備份必須讀得到）',
       "'users/'" in body or '"users/"' in body, body.strip()[:80])


def main():
    print('== storage 命名空間隔離（英語精讀 / 日語 / 雅思）==')
    check_ns_parameterised()
    check_no_hardcoded_prefix()
    check_sites_declare_ns()
    check_declare_before_core()
    check_langof_knows_ielts()
    check_backup_path_isolated()
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
