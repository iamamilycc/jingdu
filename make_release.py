#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_release.py — 產出「可販售的發佈版空殼」到 release/ 目錄。

為什麼：內建課文（新概念英語 nce2-*、日語 jp-*）是第三方版權教材，
        自用可以、但「販售 / 散布」時必須剝掉，否則侵權。本腳本自動：
  1. 複製整站到 release/
  2. 刪掉有版權的內建課文與其原始 JSON、開發用檔案（build 腳本、診斷頁、docs）
  3. 清空課程註冊表（使用者自己拍照/貼課文新增）
  4. 保留隱私政策 privacy.html、服務條款 terms.html
輸出：release/ 目錄，可直接部署（GitHub Pages / 自架 / 打包成 App）販售。

用法：  python3 make_release.py
驗證：  結束會列出「已剝除清單」+「殘留版權字串掃描」，掃描為 0 才安全。
"""
import os, shutil, re, glob, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(ROOT, 'release')

# 整個排除（不進發佈版）：開發檔、版權教材原始資料、內部文件、版本控制
EXCLUDE_DIRS  = {'.git', '__pycache__', 'docs', 'release', 'tests',
                 os.path.join('lessons', 'data'),
                 os.path.join('jp', 'lessons', 'data')}
# 注意：jp-mic-test.html 不能排除——它是日語識別失敗時給家長的診斷頁，
# lesson-jp.js 有連結指過去（../../jp-mic-test.html），排除會讓買家點連結 404。
EXCLUDE_FILES = {'make_release.py', 'build_lessons.py', 'build_lessons_jp.py',
                 'azure-test.html', '.gitignore', '.DS_Store'}
# 有版權的已生成課文頁（樣式：內建教材）
EXCLUDE_GLOBS = ['lessons/nce2-*.html', 'jp/lessons/jp-*.html']

def excluded(rel):
    parts = rel.replace('\\', '/')
    for d in EXCLUDE_DIRS:
        d = d.replace('\\', '/')
        if parts == d or parts.startswith(d + '/'):
            return True
    if os.path.basename(rel) in EXCLUDE_FILES:
        return True
    for g in EXCLUDE_GLOBS:
        # 簡易 glob 比對
        pat = '^' + re.escape(g).replace('\\*', '[^/]*') + '$'
        if re.match(pat, parts):
            return True
    return False

def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    copied, skipped = 0, []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        if rel_dir == '.':
            rel_dir = ''
        # 剪枝：整個排除的目錄不進去
        dirnames[:] = [d for d in dirnames
                       if not excluded(os.path.join(rel_dir, d) if rel_dir else d)]
        for fn in filenames:
            rel = os.path.join(rel_dir, fn) if rel_dir else fn
            if excluded(rel):
                skipped.append(rel)
                continue
            dst = os.path.join(OUT, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(dirpath, fn), dst)
            copied += 1

    # 清空課程註冊表（發佈版不預裝任何課，使用者自建）
    reg_en = os.path.join(OUT, 'assets', 'lessons-registry.js')
    reg_jp = os.path.join(OUT, 'assets', 'lessons-registry-jp.js')
    if os.path.exists(reg_en):
        open(reg_en, 'w', encoding='utf-8').write(
            '/* 課文註冊表（英語）——發佈版預設為空，使用者自建課文自動加入 */\n'
            'window.JD_LESSONS_EN = [];\n')
    if os.path.exists(reg_jp):
        open(reg_jp, 'w', encoding='utf-8').write(
            '/* 課文註冊表（日語）——發佈版預設為空，使用者自建課文自動加入 */\n'
            'window.JD_LESSONS_JP = [];\n')

    # 驗證：掃描發佈版有沒有殘留版權教材痕跡
    bad_terms = ['nce2-0', 'New Concept', '新概念', '大家的日語', 'jp-01']
    hits = []
    for dirpath, _, filenames in os.walk(OUT):
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            try:
                txt = open(p, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            for t in bad_terms:
                if t in txt:
                    hits.append((os.path.relpath(p, OUT), t))

    print('=== 發佈版產出完成：%s ===' % OUT)
    print('複製檔案：%d' % copied)
    print('已剝除（不進發佈版）：%d 個' % len(skipped))
    for s in sorted(skipped):
        print('   - ' + s)
    print('課程註冊表已清空（英/日）。')
    print('--- 版權殘留掃描 ---')
    if hits:
        print('⚠️ 發現殘留（需處理）：')
        for p, t in hits:
            print('   %s  含「%s」' % (p, t))
        sys.exit(1)
    else:
        print('✅ 乾淨：無任何版權教材殘留。release/ 可直接部署販售。')

if __name__ == '__main__':
    main()
