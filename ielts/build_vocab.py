#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_vocab.py —— 從 ECDICT 重建雅思分層詞表（可重現，不是一次性手工產物）

為什麼要有這支：詞表若是手工產出的一坨 JSON，日後想調整分層規則、換詞量、補欄位，
就只能再手工做一次，而且沒人知道當初怎麼來的。這支腳本把「怎麼選這 6000 個詞」
固化成可重跑、可審查的規則。

資料來源：ECDICT（https://github.com/skywind3000/ECDICT，MIT 授權）
  下載：curl -sL https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv -o ecdict.csv

分層規則（決定背誦順序，是本專案的核心業務判斷）：
  L1 基礎   —— tag 含 zk/gk/cet4。雅思核心詞有一半以上落在這層，先補這裡的洞
  L2 進階   —— tag 含 cet6/ky
  L3 雅思獨有 —— tag 含 ielts 但不在上述範圍
  L4 學術拓展 —— toefl 高頻，用來補足到目標詞量；衝 7.0 才需要

用法：
    python3 ielts/build_vocab.py --ecdict /path/to/ecdict.csv
    python3 ielts/build_vocab.py --ecdict ecdict.csv --total 6000 --out ielts/data
輸出：data/L1.json … L4.json + data/meta.json
驗證：python3 tests/ielts_vocab_test.py
"""
import argparse
import csv
import json
import os
import sys
from datetime import date

CORE_TAGS = {'ielts', 'cet6', 'ky', 'cet4', 'gk', 'zk'}
LAYER_NAMES = {
    1: '基礎（中考/高考/四級）',
    2: '進階（六級/考研）',
    3: '雅思獨有',
    4: '學術拓展（托福高頻）',
}


def layer_of(tags):
    """分層規則的唯一定義處。改規則只改這裡，測試會核對輸出與規則一致。"""
    if tags & {'zk', 'gk', 'cet4'}:
        return 1
    if tags & {'cet6', 'ky'}:
        return 2
    if 'ielts' in tags:
        return 3
    return 4


def build(ecdict_path, total):
    rows = []
    csv.field_size_limit(10 ** 7)
    with open(ecdict_path, encoding='utf-8', errors='ignore') as f:
        for r in csv.DictReader(f):
            tags = set((r.get('tag') or '').split())
            if not tags:
                continue
            try:
                frq = int(r.get('frq') or 0)
            except ValueError:
                frq = 0
            rows.append({
                'w': r['word'],
                'ph': (r.get('phonetic') or '').strip(),
                'tr': (r.get('translation') or '').replace('\\n', '; ').strip(),
                'tags': sorted(tags),
                'frq': frq,
                'ox': r.get('oxford') or '',
                'col': r.get('collins') or '',
            })

    core = [r for r in rows if set(r['tags']) & CORE_TAGS]
    # 補足用的學術詞：按當代詞頻排序（frq 0 表示無資料，排最後）
    extra = sorted([r for r in rows if 'toefl' in r['tags'] and not set(r['tags']) & CORE_TAGS],
                   key=lambda x: (x['frq'] == 0, x['frq']))
    final = core + extra[:max(0, total - len(core))]

    for r in final:
        r['L'] = layer_of(set(r['tags']))
        # 缺音標的走瀏覽器 TTS 發音（前端據此決定要不要顯示音標欄）
        if not r['ph']:
            r['noPh'] = 1
    return final


def main():
    ap = argparse.ArgumentParser(description='從 ECDICT 重建雅思分層詞表')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--ecdict', required=True, help='ecdict.csv 路徑')
    ap.add_argument('--total', type=int, default=6000, help='目標詞量（預設 6000）')
    ap.add_argument('--out', default=os.path.join(here, 'data'), help='輸出目錄')
    a = ap.parse_args()

    if not os.path.exists(a.ecdict):
        print('❌ 找不到 ecdict.csv：%s' % a.ecdict, file=sys.stderr)
        print('   下載：curl -sL https://raw.githubusercontent.com/skywind3000/ECDICT'
              '/master/ecdict.csv -o ecdict.csv', file=sys.stderr)
        return 2

    final = build(a.ecdict, a.total)
    os.makedirs(a.out, exist_ok=True)

    meta = {
        'source': 'ECDICT (github.com/skywind3000/ECDICT)',
        'license': 'MIT',
        'built': date.today().isoformat(),
        'total': len(final),
        'layers': {},
        'fields': {
            'w': '單詞', 'ph': '音標（空字串代表缺，配 noPh=1）', 'tr': '中文釋義',
            'tags': '原始考試標記', 'frq': '當代詞頻（越小越常用，0=無資料）',
            'ox': '牛津核心詞', 'col': '柯林斯星級', 'L': '層級 1-4',
            'noPh': '缺音標，走瀏覽器 TTS 發音',
        },
    }

    for L in (1, 2, 3, 4):
        items = [r for r in final if r['L'] == L]
        # 同層內按詞頻排序：常用的先背
        items.sort(key=lambda x: (x['frq'] == 0, x['frq']))
        path = os.path.join(a.out, 'L%d.json' % L)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, separators=(',', ':'))
        meta['layers'][str(L)] = {
            'name': LAYER_NAMES[L],
            'count': len(items),
            'ielts_tagged': sum(1 for r in items if 'ielts' in r['tags']),
            'no_phonetic': sum(1 for r in items if r.get('noPh')),
            'file': 'L%d.json' % L,
            'kb': round(os.path.getsize(path) / 1024),
        }

    with open(os.path.join(a.out, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print('✅ 詞表已重建 → %s' % a.out)
    print('%-4s %-24s %6s %8s %7s %7s' % ('層', '名稱', '詞數', '雅思標記', '缺音標', '大小'))
    for L in (1, 2, 3, 4):
        m = meta['layers'][str(L)]
        print('L%-3d %-24s %6d %8d %7d %6dKB'
              % (L, m['name'], m['count'], m['ielts_tagged'], m['no_phonetic'], m['kb']))
    print('%-4s %-24s %6d' % ('', '合計', meta['total']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
