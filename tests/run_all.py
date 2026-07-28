#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_all.py —— 一鍵跑全部測試，總結通過/失敗。

用法：  python3 tests/run_all.py
成功：  全部綠 → 退出碼 0；任一紅 → 退出碼 1，並列出是哪支、印它的尾部輸出。

自動掃描 tests/ 下所有 *_test.py（新增測試不用改這裡）。每支之間留一點間隔，避免大量
playwright/瀏覽器同時起造成資源瞬時緊。
"""
import os, sys, glob, subprocess, time

HERE = os.path.dirname(os.path.abspath(__file__))

def main():
    files = sorted(f for f in glob.glob(os.path.join(HERE, '*_test.py')))
    if not files:
        print('找不到任何 *_test.py'); return 1
    py = sys.executable
    results = []
    for f in files:
        name = os.path.basename(f)[:-len('_test.py')]
        print('\n════════ %s ════════' % name)
        r = subprocess.run([py, f], capture_output=True, text=True)
        tail = [ln for ln in r.stdout.splitlines() if ln.strip()][-1:] if r.stdout else []
        ok = (r.returncode == 0)
        print(('✅ ' if ok else '❌ ') + name + ('' if ok else '  (exit %d)' % r.returncode))
        if tail:
            print('   ' + tail[-1])
        if not ok:
            # 印失敗細節（XX 行 + 尾部）
            for ln in r.stdout.splitlines():
                if 'XX' in ln or '❌' in ln or '出錯' in ln:
                    print('   ' + ln)
            if r.stderr.strip():
                print('   [stderr] ' + r.stderr.strip().splitlines()[-1])
        results.append((name, ok))
        time.sleep(0.3)
    npass = sum(1 for _, ok in results if ok)
    print('\n' + '=' * 44)
    print('總結：%d / %d 通過' % (npass, len(results)))
    bad = [n for n, ok in results if not ok]
    if bad:
        print('❌ 失敗：' + '、'.join(bad))
        return 1
    print('✅ 全部綠')
    return 0

if __name__ == '__main__':
    sys.exit(main())
