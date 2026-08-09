#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ielts_vocab_test.py —— 雅思詞表資料完整性測試

詞表是拿來背的，錯一個釋義就背錯一個詞，而且是背熟了才發現。所以這裡不只驗「檔案在」，
而是驗「每一筆都能用」：欄位齊、分層與規則一致、排序正確、meta 與實際檔案對得上。

⭐ 最重要的一條：**分層是用 build_vocab.layer_of() 重新算一次再比對**，不是信任 JSON 裡
   寫的 L。這樣日後改了分層規則卻忘了重建詞表，這裡會直接紅。

用法：  python3 tests/ielts_vocab_test.py
成功：  印「全部通過 ✅」且退出碼 0。
重建：  python3 ielts/build_vocab.py --ecdict /path/to/ecdict.csv
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'ielts', 'data')
sys.path.insert(0, os.path.join(ROOT, 'ielts'))
FAILS = []


def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)))
    if not cond:
        FAILS.append(name)


def load(fn):
    p = os.path.join(DATA, fn)
    if not os.path.exists(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def main():
    print('== 雅思詞表資料完整性 ==')

    meta = load('meta.json')
    ck('meta.json 存在', meta is not None)
    if meta is None:
        print('\n❌ 詞表未建置，先跑：python3 ielts/build_vocab.py --ecdict <ecdict.csv>')
        return 1

    print('-- 來源與授權（可追溯，不能是來路不明的詞表）')
    ck('標明來源 ECDICT', 'ECDICT' in meta.get('source', ''), meta.get('source'))
    ck('標明授權 MIT', meta.get('license') == 'MIT', meta.get('license'))
    ck('標明建置日期', bool(meta.get('built')), meta.get('built'))
    ck('欄位說明齊全', len(meta.get('fields', {})) >= 8, meta.get('fields'))

    print('-- 各層檔案與 schema')
    layers, total = {}, 0
    for L in (1, 2, 3, 4):
        items = load('L%d.json' % L)
        ck('L%d.json 存在' % L, items is not None)
        if items is None:
            continue
        layers[L] = items
        total += len(items)

        bad_field, bad_layer, bad_ph = [], [], []
        for r in items:
            if not r.get('w') or not r.get('tr') or 'L' not in r or 'tags' not in r:
                bad_field.append(r.get('w', '?'))
            if r.get('L') != L:
                bad_layer.append(r.get('w'))
            # 缺音標的必須標 noPh，前端才知道要走 TTS 發音
            if not r.get('ph') and not r.get('noPh'):
                bad_ph.append(r.get('w'))
        ck('L%d 每筆都有 w/tr/L/tags' % L, not bad_field, bad_field[:5])
        ck('L%d 的 L 欄位都等於 %d' % (L, L), not bad_layer, bad_layer[:5])
        ck('L%d 缺音標者都標了 noPh（前端走 TTS）' % L, not bad_ph, bad_ph[:5])

        # 同層按詞頻排序：常用詞先背。frq=0 表示無資料，排最後。
        keys = [(r['frq'] == 0, r['frq']) for r in items]
        ck('L%d 依詞頻排序（常用的先背）' % L, keys == sorted(keys),
           '前 5 筆 frq=%s' % [r['frq'] for r in items[:5]])

    ck('總詞數 6000', total == 6000, total)

    print('-- ⭐分層規則一致性（用規則重算一次，不信任 JSON 裡寫的 L）')
    try:
        from build_vocab import layer_of
    except ImportError as e:
        ck('可載入 build_vocab.layer_of', False, e)
        layer_of = None
    if layer_of:
        wrong = []
        for L, items in layers.items():
            for r in items:
                if layer_of(set(r['tags'])) != r['L']:
                    wrong.append('%s: tags=%s 標L%d 應L%d'
                                 % (r['w'], r['tags'], r['L'], layer_of(set(r['tags']))))
        ck('每一筆的層級都符合 layer_of 規則', not wrong,
           '%d 筆不符：%s' % (len(wrong), wrong[:3]))

    print('-- meta 與實際檔案對得上（parity：兩處數字必須相等）')
    for L, items in layers.items():
        m = meta['layers'][str(L)]
        ck('L%d 詞數 meta=實際' % L, m['count'] == len(items),
           'meta=%d 實際=%d' % (m['count'], len(items)))
        real_ielts = sum(1 for r in items if 'ielts' in r['tags'])
        ck('L%d 雅思標記數 meta=實際' % L, m['ielts_tagged'] == real_ielts,
           'meta=%d 實際=%d' % (m['ielts_tagged'], real_ielts))
        real_noph = sum(1 for r in items if r.get('noPh'))
        ck('L%d 缺音標數 meta=實際' % L, m['no_phonetic'] == real_noph,
           'meta=%d 實際=%d' % (m['no_phonetic'], real_noph))
    ck('meta 總數 = 各層加總', meta['total'] == total, '%d vs %d' % (meta['total'], total))

    print('-- 業務事實（立項報告裡的關鍵發現，變了要知道）')
    if 1 in layers and 3 in layers:
        l1_ielts = sum(1 for r in layers[1] if 'ielts' in r['tags'])
        ck('L1 含大量雅思詞（>1500）→ 先補基礎的策略成立', l1_ielts > 1500, l1_ielts)
        ck('L3 雅思獨有 < 1000（真正要新學的沒想像中多）', len(layers[3]) < 1000, len(layers[3]))
        ck('L3 每一筆都有 ielts 標記', all('ielts' in r['tags'] for r in layers[3]))

    print('-- 手機載入友善（主力裝置是 iPhone）')
    for L in (1, 2, 3, 4):
        kb = os.path.getsize(os.path.join(DATA, 'L%d.json' % L)) / 1024
        ck('L%d.json < 700KB（單層載入不卡）' % L, kb < 700, '%.0fKB' % kb)

    print('-- 無重複詞（同一個詞背兩次是浪費）')
    seen, dup = set(), []
    for L in sorted(layers):
        for r in layers[L]:
            if r['w'] in seen:
                dup.append(r['w'])
            seen.add(r['w'])
    ck('跨層無重複單詞', not dup, '%d 個重複：%s' % (len(dup), dup[:5]))

    # 使用者視角走查的機器化版本：每個頁面都要進得去、回得來。
    # 「功能做好了但沒有入口」是最容易漏、也最讓人惱火的缺口——鏈斷即缺口。
    print('-- 入口與路徑閉環（每個頁面都進得去、回得來）')
    def has(rel, needle, why):
        p = os.path.join(ROOT, rel)
        txt = open(p, encoding='utf-8').read() if os.path.exists(p) else ''
        ck('%s → %s' % (rel, why), needle in txt, '缺連結：%s' % needle)

    has('index.html', 'ielts/index.html', '雅思（主站首頁要有入口，否則只能手動輸網址）')
    has('ielts/index.html', 'review.html', '複習隊列（背完要能去看）')
    has('ielts/index.html', '../index.html', '回英語精讀')
    has('ielts/review.html', 'index.html', '回背單字')
    has('ielts/index.html', 'dictation.html', '精聽聽寫（背單字之外的第二個練法）')
    has('ielts/review.html', 'dictation.html', '精聽聽寫')
    has('ielts/dictation.html', 'index.html', '回背單字')
    has('ielts/dictation.html', 'review.html', '複習隊列')
    has('ielts/index.html', 'writing.html', '寫作 Task 2')
    has('ielts/writing.html', 'index.html', '回背單字')
    has('ielts/writing.html', 'dictation.html', '精聽')
    has('ielts/index.html', 'speaking.html', '口語練習')
    has('ielts/speaking.html', 'index.html', '回背單字')
    has('ielts/speaking.html', 'writing.html', '寫作')
    # 雅思讀者是成人備考者，精讀教程是寫給家長孩子的——必須有自己的說明且各頁進得去
    for pg_ in ('index', 'dictation', 'writing', 'speaking', 'review'):
        has('ielts/%s.html' % pg_, 'help.html', '雅思說明頁')
    has('help.html', 'ielts/help.html', '從精讀教程分流到雅思說明')
    has('ielts/help.html', 'index.html', '說明頁回得去')
    has('help.html', 'ielts/index.html', '教程裡有可點的入口')

    # 前端七律：動態按鈕不准內嵌 onclick 字串（點了沒反應是本專案踩過的坑）
    for rel in ('ielts/index.html', 'ielts/review.html', 'ielts/dictation.html',
                'ielts/writing.html', 'ielts/speaking.html'):
        txt = open(os.path.join(ROOT, rel), encoding='utf-8').read()
        inline = [ln.strip()[:60] for ln in txt.splitlines()
                  if '<button' in ln and 'onclick=' in ln]
        ck('%s 的按鈕不內嵌 onclick（用 id+.onclick 綁定）' % rel, not inline, inline[:3])

    # 本專案方法論的頭號重複犯錯：做完功能忘記同步 help.html，被使用者提醒過兩次以上。
    # 焊成測試：功能的每個對外概念都必須在教程裡講到，漏了就紅。
    print('-- 雅思專屬說明頁（不只講功能，要含備考策略）')
    ih = os.path.join(ROOT, 'ielts', 'help.html')
    ihtxt = open(ih, encoding='utf-8').read() if os.path.exists(ih) else ''
    ck('ielts/help.html 存在', bool(ihtxt))
    for name, kw in {
        '總時數估計': '450',
        '基線測試換算表': '27–29',
        '⭐分層策略的數據依據': '1,706',
        '第一次要先跳過高頻詞': '這批我都會',
        '錯因對應練法': '最大宗失分',
        'AI給分偏高警示': '偏高 0.5–1 分',
        '素材複用': '5 段真實經歷',
        '微信硬限制': '微信內建瀏覽器不開放麥克風',
        '每日流程': '建議的每日流程',
        '資料隔離說明': '完全分開存',
    }.items():
        ck('雅思說明有「%s」' % name, kw in ihtxt, '缺：%s' % kw)

    print('-- 教程同步（做完功能忘了寫教程是本專案反覆犯的錯）')
    help_path = os.path.join(ROOT, 'help.html')
    help_txt = open(help_path, encoding='utf-8').read() if os.path.exists(help_path) else ''
    ck('help.html 存在', bool(help_txt))
    must = {
        '雅思入口連結': 'ielts/index.html',
        '複習頁連結': 'ielts/review.html',
        '分層策略（先補基礎）': '一半以上',
        '批量跳過功能': '這批我都會',
        '重置可還原': '24 小時內可以還原',
        '匯出 CSV': 'CSV',
        '資料隔離說明': '完全分開存',
        '缺音標走語音': '沒有音標',
        '詞表來源與授權': 'ECDICT',
        '重建指令': 'build_vocab.py',
        '精聽入口': 'ielts/dictation.html',
        '錯因分類': '錯因分類',
        '音頻不用上傳': '音頻不用上傳',
        '寫作入口': 'ielts/writing.html',
        'AI給分偏高警示': '偏高 0.5–1 分',
        '不要背範文': '不是拿來背的範文',
        '口語入口': 'ielts/speaking.html',
        '素材複用': '素材複用',
        '錄音不上傳': '不上傳任何伺服器',
        '微信硬限制': '微信內建瀏覽器不開放麥克風',
    }
    for name, kw in must.items():
        ck('教程有講到「%s」' % name, kw in help_txt, '缺關鍵詞：%s' % kw)

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
