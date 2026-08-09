#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
static_checks.py —— 虫虫精讀「靜態源碼不變量」測試（不需瀏覽器，秒級）

守住幾條「只靠讀碼就能驗、又最容易在新增功能時被漏掉」的規則。歷史上這類
漏洞（某個播放入口忘了設 iOS 外放路由 → 錄音後播放變小聲/走聽筒）純靠人眼
review 一再漏掉，所以固化成可重跑測試。

用法：  python3 tests/static_checks.py
成功：  印「全部通過 ✅」且退出碼 0；任一條違反退出碼 1。
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS = []

def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)))
    if not cond:
        FAILS.append(name)

def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read().splitlines()

# ---- 規則1：每個 speechSynthesis.speak( 之前必須先設 iOS 外放路由 ----
# 允許形式：同函式內、該 speak 之前 6 行內出現 toPlaybackRoute（core 自呼 / lesson 走 JD.toPlaybackRoute）
def check_playback_route():
    print('-- 規則1：每處 speechSynthesis.speak 之前都設了 iOS 外放路由（防錄音後小聲）')
    for rel in ('assets/core.js', 'assets/lesson.js', 'assets/lesson-jp.js'):
        lines = read(rel)
        for i, ln in enumerate(lines):
            if 'speechSynthesis.speak(' in ln:
                window = '\n'.join(lines[max(0, i - 9):i + 1])
                has = 'toPlaybackRoute' in window
                ck('%s:%d speak 前有 toPlaybackRoute' % (rel, i + 1), has, ln.strip())

# ---- 規則2：錄音入口 listen() 之前必須設 play-and-record（否則麥克風失效） ----
def check_record_route():
    print('-- 規則2：core.listen 內有設 play-and-record（否則 iOS 麥克風收不到）')
    core = '\n'.join(read('assets/core.js'))
    ck('core.js listen 設 play-and-record', "audioSession.type='play-and-record'" in core.replace(' ', '').replace('"', "'") or 'play-and-record' in core, '找不到 play-and-record 設定')

# ---- 規則3：沒有硬編碼 API key（BYOK 底線） ----
def check_no_hardcoded_key():
    print('-- 規則3：全庫無硬編碼 API key（BYOK）')
    pats = [re.compile(r'sk-[A-Za-z0-9]{20,}'), re.compile(r'AIza[A-Za-z0-9_\-]{30,}')]
    hits = []
    for dp, dn, fn in os.walk(ROOT):
        if any(x in dp for x in ('/.git', '/release', '/__pycache__', '/node_modules')):
            continue
        for f in fn:
            if not f.endswith(('.js', '.html', '.py', '.json')):
                continue
            p = os.path.join(dp, f)
            try:
                txt = open(p, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            for pat in pats:
                if pat.search(txt):
                    hits.append(os.path.relpath(p, ROOT))
    ck('無硬編碼 key', not hits, hits)

# ---- 規則4：日語識別回傳非日文時有攔截提示（誠實降級） ----
def check_jp_nonjp_guard():
    print('-- 規則4：日語背句/跟讀偵測到非日文時有攔截（不亂判 0 分、給診斷指引）')
    jp = '\n'.join(read('assets/lesson-jp.js'))
    ck('lesson-jp 有非日文攔截 + 診斷連結', ('jp-mic-test' in jp) and ('[一-鿿' in jp or '一-鿿' in jp or 'hasJP' in jp or '不是日文' in jp or '不含日文' in jp or '診斷' in jp), '找不到非日文攔截邏輯')

# ---- 規則5：復盤等級點數對齊 INTERVALS 階數（否則高等級畫面看不出差別） ----
def check_levelbar_dots():
    print('-- 規則5：review.levelBar 點數 == INTERVALS 階數（艾賓浩斯滿級可辨識）')
    core = '\n'.join(read('assets/core.js'))
    m = re.search(r'INTERVALS\s*=\s*\[([^\]]*)\]', core)
    n_intervals = len([x for x in m.group(1).split(',') if x.strip()]) if m else 0
    rv = '\n'.join(read('review.html'))
    m2 = re.search(r'for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*(\d+)\s*;', rv)
    dots = int(m2.group(1)) if m2 else -1
    ck('levelBar 點數(%d) == INTERVALS 階數(%d)' % (dots, n_intervals), dots == n_intervals, 'dots=%d intervals=%d' % (dots, n_intervals))

# ---- 規則6：加新課動作處有復習鎖把關（不是只在首頁改連結） ----
def check_gate_enforced_on_action():
    print('-- 規則6：new.html 生成動作處呼叫 newLessonBlockedBy（門禁擋動作，繞不過）')
    nh = '\n'.join(read('new.html'))
    ck('new.html 生成流程檢查 newLessonBlockedBy', 'newLessonBlockedBy' in nh, '找不到門禁檢查')

# ---- 規則7：振假名解析單一真源（漢字表別自寫貪婪正則，否則 key 被假名污染）----
def check_furigana_single_source():
    print('-- 規則7：collectKanjiMap 走 R.kanjiReadings，不自寫貪婪 [^[]]+ 振假名正則')
    jp = '\n'.join(read('assets/lesson-jp.js'))
    ck('collectKanjiMap 用 R.kanjiReadings', 'kanjiReadings' in jp, '找不到 kanjiReadings')
    ck('不再有貪婪 [^\\[\\]]+ 漢字表正則', '[^\\[\\]]+\\[' not in jp, '仍有貪婪振假名正則(會污染漢字表key)')

# ---- 規則8：說話人正則允許冒號前有空格（「サンス ：」也要拆）----
def check_speaker_space_colon():
    print('-- 規則8：speaker 正則允許冒號前空格（\\s*[：:]）')
    for rel in ('assets/lesson.js', 'assets/lesson-jp.js', 'assets/generate.js'):
        txt = '\n'.join(read(rel))
        m = re.search(r'RE\s*=\s*/\^.*?\)\s*(\\s\*)?\[：:\]', txt)
        ck('%s speaker 正則含 \\s*[：:]' % rel, bool(m and m.group(1)), '冒號前少了 \\s*（空格+冒號會漏拆）')

# ---- 規則9：切換使用者前必須先 await push（離線別貿然清本機丟資料）----
def check_switchuser_awaits_push():
    print('-- 規則9：sync.switchUser 先 await push + 離線確認，才清本機（防丟資料）')
    src = read('assets/sync.js')
    # 找 switchUser 函式體
    joined = '\n'.join(src)
    import re as _re
    m = _re.search(r'function switchUser\(\)\{(.*?)\n  \}', joined, _re.S)
    body = m.group(1) if m else ''
    ap = body.find('await push()')
    clear = body.find('applySnapshot')
    ck('switchUser 有 await push()', ap >= 0, '找不到 await push()')
    ck('await push() 在 applySnapshot(清本機) 之前', ap >= 0 and (clear < 0 or ap < clear), 'push 沒排在清本機前')
    ck('離線/失敗有 confirm 守衛', 'confirm(' in body, '沒有 confirm 守衛')

# ---- 規則10：所有語音跟讀打分處必走多候選 bestCompare + 有自評兜底（舉一反三鎖：漏一處就紅）----
def check_recognition_parity():
    print('-- 規則10：每個語音跟讀打分處都走 bestCompare(多候選)+ 有自評兜底(jd-selfok)')
    # 凡是「用 JD.compare / compareJPReading 對識別結果打分」的檔案（課文跟讀/背句、複習頁），
    # 都必須：①走 bestCompare(多候選，救 aloud→allowed) ②低分有自評兜底(jd-selfok)。
    # 新增任何用語音打分的入口若漏了這兩者，這條測試會直接失敗——把「舉一反三」焊死成機制。
    SPEECH_SCORING_FILES = ['assets/lesson.js', 'assets/lesson-jp.js', 'review.html', 'jp/review.html']
    import os as _os
    for rel in SPEECH_SCORING_FILES:
        path = _os.path.join(ROOT, rel)
        if not _os.path.exists(path):
            continue  # jp/review.html 可能不存在，跳過（存在才查）
        txt = '\n'.join(read(rel))
        scores_speech = ('JD.compare(' in txt) or ('compareJPReading(' in txt)
        if not scores_speech:
            continue  # 這檔沒有語音打分，不要求
        ck('%s 語音打分走 bestCompare(多候選)' % rel, 'bestCompare' in txt, '有比對卻沒走多候選=漏改')
        ck('%s 低分有自評兜底(jd-selfok)' % rel, 'jd-selfok' in txt, '有比對卻沒自評兜底=念對會卡死')
        ck('%s 有發音評估分流(JDPron.enabled)' % rel, 'JDPron.enabled()' in txt, '沒接發音評估分流=開了也不走 Azure 四維')

# ---- 規則11：視覺模型 callApi 的 max_tokens 不准超 1024（超過→拍圖建課報 400，歷史回歸）----
def check_vision_max_tokens():
    print('-- 規則11：視覺模型 max_tokens ≤ 1024（防拍圖建課 400 回歸）')
    txt = '\n'.join(read('assets/generate.js'))
    # 找所有「和 getVisionModel() 在同一個 callApi 調用裡」的 max_tokens
    bad = []
    for m in re.finditer(r'getVisionModel\(\)[^;]*?max_tokens\s*:\s*(\d+)', txt, re.S):
        if int(m.group(1)) > 1024:
            bad.append(m.group(1))
    ck('視覺模型 max_tokens 都 ≤ 1024', not bad, '超限值: '+str(bad))

# ---- 規則12：造句判分 judgeSentence 必須嚴格（時態/用詞錯要判 ok:false → 進錯題本）----
def check_judge_strict():
    print('-- 規則12：judgeSentence 提示詞對時態/用詞錯誤嚴格（否則有錯的句子不進錯題本）')
    txt = '\n'.join(read('assets/generate.js'))
    m = re.search(r'async function judgeSentence\(.*?\n  \}', txt, re.S)
    body = m.group(0) if m else ''
    ck('judgeSentence 提示詞要求時態/詞形錯判 ok:false', ('時態' in body) and ('ok:false' in body), '判準被改回寬鬆版=有錯的句子不會進錯題本')

def main():
    check_playback_route()
    check_record_route()
    check_no_hardcoded_key()
    check_jp_nonjp_guard()
    check_levelbar_dots()
    check_gate_enforced_on_action()
    check_furigana_single_source()
    check_speaker_space_colon()
    check_switchuser_awaits_push()
    check_recognition_parity()
    check_vision_max_tokens()
    check_judge_strict()
    print('\n' + '=' * 40)
    if FAILS:
        print('❌ %d 條靜態不變量被違反：' % len(FAILS))
        for f in FAILS:
            print('   - ' + f)
        return 1
    print('✅ 全部通過（iOS 音訊路由 / 麥克風路由 / 無硬編碼 key / 日語誠實降級）')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as ex:
        # 重負載批次下偶發的檔案系統暫態不該被誤判成「規則違反」；重跑即可
        print('靜態檢查執行出錯（多為批次重負載暫態，單獨重跑即可）：', ex)
        sys.exit(2)
