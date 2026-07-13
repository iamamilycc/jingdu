#!/usr/bin/env python3
"""
精讀 jingdu — 日語課文生成器（build_lessons.py 的日語版）
輸入：jp/lessons/data/*.json（每課數據，schema 見 docs/spec-jp.md）
輸出：jp/lessons/<id>.html + 更新 jp/index.html 的 LESSONS 目錄
用法：python3 build_lessons_jp.py           # 生成全部
      python3 build_lessons_jp.py jp-01     # 只生成一課
"""
import json, sys, os, re, glob

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'jp', 'lessons', 'data')
LESSONS_DIR = os.path.join(ROOT, 'jp', 'lessons')
INDEX = os.path.join(ROOT, 'jp', 'index.html')

PAGE = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>{title_tag} · 日語精讀</title>
<link rel="stylesheet" href="../../assets/style.css">
</head>
<body>
<header class="site"><div class="row">
  <a href="../index.html">← 目錄</a>
  <h1 id="hTitle">日語精讀</h1>
  <a href="../review.html">📅 復盤</a>
</div></header>

<nav class="tabs">
  <button class="tab-btn active" data-t="listen"  onclick="switchTab('listen')">🎧 聽全文<span class="dot" data-s="listen"></span></button>
  <button class="tab-btn" data-t="read"    onclick="switchTab('read')">📖 逐句<span class="dot" data-s="read"></span></button>
  <button class="tab-btn" data-t="vocab"   onclick="switchTab('vocab')">🃏 生詞<span class="dot" data-s="vocab"></span></button>
  <button class="tab-btn" data-t="grammar" onclick="switchTab('grammar')">📝 語法<span class="dot" data-s="grammar"></span></button>
  <button class="tab-btn" data-t="build"   onclick="switchTab('build')">🧩 連詞<span class="dot" data-s="build"></span></button>
  <button class="tab-btn" data-t="speak"   onclick="switchTab('speak')">🗣️ 跟讀<span class="dot" data-s="speak"></span></button>
  <button class="tab-btn" data-t="quiz"    onclick="switchTab('quiz')">🎯 聽力題<span class="dot" data-s="quiz"></span></button>
  <button class="tab-btn" data-t="recite"  onclick="switchTab('recite')">🧠 背句<span class="dot" data-s="recite"></span></button>
  <button class="tab-btn" data-t="make"    onclick="switchTab('make')">🖊️ 造句<span class="dot" data-s="make"></span></button>
  <button class="tab-btn" data-t="done"    onclick="switchTab('done')">✅ 打卡<span class="dot" data-s="done"></span></button>
</nav>

<main>
  <section id="p-listen" class="tab-panel active">
    <h2 class="sec">🎧 聽全文</h2>
    <p class="hint">整篇連續朗讀，讀到哪句亮哪句。「盲聽」開啟後文字會藏起來，只用耳朵！完整聽完一遍自動打勾。</p>
    <div class="card" style="text-align:center">
      <button id="ltPlayBtn" class="big-btn teal" onclick="ltPlay()">▶️ 播放全文</button>
      <button class="big-btn ghost" onclick="ltToggleSpeed(this)">🐢 慢速：關</button>
      <button class="big-btn ghost" onclick="ltToggleBlind(this)">🙈 盲聽：關</button>
      <button class="big-btn ghost" onclick="ltToggleLoop(this)">🔁 循環：關</button>
    </div>
    <div class="card stitch" id="ltText"></div>
  </section>

  <section id="p-read" class="tab-panel">
    <h2 class="sec">📖 逐句精讀</h2>
    <p class="hint">點每一句展開中文和講解；🔊 聽發音，「慢」是慢速。全部點開過，本環節自動打勾。</p>
    <div id="readList"></div>
  </section>

  <section id="p-vocab" class="tab-panel">
    <h2 class="sec">🃏 生詞卡</h2>
    <p class="hint">正面記住讀音 → 翻面憑記憶輸入平假名讀音！對了打勾，錯的詞自動進錯題本。</p>
    <div class="vgrid" id="vocabGrid"></div>
  </section>

  <section id="p-grammar" class="tab-panel">
    <h2 class="sec">📝 本課語法點</h2>
    <div id="grammarBox"></div>
    <div style="text-align:center"><button id="grammarDoneBtn" class="big-btn teal">我讀完了 ✓</button></div>
  </section>

  <section id="p-build" class="tab-panel">
    <h2 class="sec">🧩 連詞成句</h2>
    <p class="hint">把打亂的詞語按正確順序排成句子（日語動詞在句末哦）。排對打勾，看答案的句子會進錯題本。</p>
    <div class="progress-pills" id="bdPills"></div>
    <div id="buildBox"></div>
  </section>

  <section id="p-speak" class="tab-panel">
    <h2 class="sec">🗣️ 口語跟讀</h2>
    <p class="hint">先聽 → 按 🎙️ 大聲跟讀 → 讀完停一下會<b>自動結束打分</b>。綠=對，黃=漏，紅=不對。</p>
    <div class="progress-pills" id="spkPills"></div>
    <div class="stage">
      <div class="target" id="spkTarget"></div>
      <div style="margin-top:10px">
        <button class="big-btn teal" onclick="spkPlay()">🔊 聽一遍</button>
        <button class="big-btn mango" onclick="spkPlaySlow()">🐢 慢速</button>
        <button id="spkRecBtn" class="big-btn rec" onclick="spkRec()">🎙️ 跟讀</button>
      </div>
      <div id="spkResult" style="margin-top:14px"></div>
      <div class="heard" id="spkHeard"></div>
      <div style="margin-top:10px">
        <button class="big-btn ghost" onclick="spkNext(-1)">← 上一句</button>
        <button class="big-btn ghost" onclick="spkNext(1)">下一句 →</button>
      </div>
    </div>
  </section>

  <section id="p-quiz" class="tab-panel">
    <h2 class="sec">🎯 聽力題</h2>
    <p class="hint">不看課文，只用耳朵！聽錄音選答案，答錯的句子會自動進錯題本。</p>
    <div id="quizBox"></div>
  </section>

  <section id="p-recite" class="tab-panel">
    <h2 class="sec">🧠 背句挑戰</h2>
    <p class="hint">看 10 秒 → 句子蓋住 → 開口背 → 得分。低於 85% 自動進錯題本。</p>
    <div class="progress-pills" id="rcPills"></div>
    <div class="stage">
      <div class="ring" id="rcRing" style="display:none"></div>
      <div class="target" id="rcTarget"></div>
      <div id="rcBtns" style="margin-top:12px"></div>
      <div id="rcResult" style="margin-top:14px"></div>
      <div class="heard" id="rcHeard"></div>
    </div>
  </section>

  <section id="p-make" class="tab-panel">
    <h2 class="sec">🖊️ 造句挑戰</h2>
    <p class="hint">用本課學的詞，說一句<b>你自己的話</b>！打字或按 🎤 用說的，AI 老師會幫你看；改一改可以再檢查。</p>
    <div class="progress-pills" id="mkPills"></div>
    <div class="stage" id="mkStage"></div>
  </section>

  <section id="p-done" class="tab-panel">
    <h2 class="sec">✅ 本課打卡</h2>
    <div class="card"><ul class="check-list" id="doneList"></ul></div>
    <div class="celebrate card stitch" id="celebrate">
      <div class="emoji">🎉🏆🎉</div>
      <h3>太棒了！本課全部完成！</h3>
      <p style="color:var(--muted);margin-top:6px">記得明天回來看「📅 復盤」哦</p>
    </div>
  </section>
</main>
<footer class="site">jingdu 日語版 · 給小家伙的日語精讀站</footer>

<script>
window.LESSON = {lesson_json};
</script>
<script src="../../assets/core.js"></script>
<script src="../../assets/sync.js"></script>
<script src="../../assets/generate.js"></script>
<script src="../../assets/ruby.js"></script>
<script src="../../assets/lesson-jp.js"></script>
</body>
</html>
"""


def validate(d):
    errs = []
    for k in ('id', 'num', 'title', 'sentences', 'vocab', 'listening', 'grammar'):
        if k not in d:
            errs.append(f"缺欄位 {k}")
    n = len(d.get('sentences', []))
    for i, q in enumerate(d.get('listening', [])):
        for pi in q.get('play', []):
            if pi < 0 or pi >= n:
                errs.append(f"listening[{i}].play 索引 {pi} 超出範圍 0..{n-1}")
        si = q.get('srcIdx', -1)
        if si < 0 or si >= n:
            errs.append(f"listening[{i}].srcIdx {si} 超出範圍")
        if not (0 <= q.get('ans', -1) < len(q.get('opts', []))):
            errs.append(f"listening[{i}].ans 超出選項範圍")
    for i, s in enumerate(d.get('sentences', [])):
        if 'jp' not in s or 'zh' not in s:
            errs.append(f"sentences[{i}] 缺 jp/zh")
    for i, v in enumerate(d.get('vocab', [])):
        for k in ('w', 'pos', 'zh'):
            if k not in v:
                errs.append(f"vocab[{i}] 缺 {k}")
    return errs


def build_one(path):
    d = json.load(open(path, encoding='utf-8'))
    errs = validate(d)
    if errs:
        raise ValueError(f"{os.path.basename(path)} 數據錯誤：\n  - " + "\n  - ".join(errs))
    lesson = {
        'id': d['id'], 'badge': '日語 · ' + d['num'], 'title': d['title'],
        'sentences': d['sentences'], 'vocab': d['vocab'],
        'listening': d['listening'], 'grammar': d['grammar'],
    }
    html = PAGE.format(title_tag=d['id'].upper() + ' · ' + d['title'],
                        lesson_json=json.dumps(lesson, ensure_ascii=False, indent=2))
    open(os.path.join(LESSONS_DIR, d['id'] + '.html'), 'w', encoding='utf-8').write(html)
    return d


def _numkey(num):
    mm = re.search(r'(\d+)', num or '')
    return int(mm.group(1)) if mm else 0


def rebuild_index(metas):
    s = open(INDEX, encoding='utf-8').read()
    m = re.search(r"const LESSONS = \[(.*?)\];", s, flags=re.S)
    assert m, "jp/index.html 找不到 LESSONS 區塊"
    entries = {}
    for em in re.finditer(r"\{id:'([^']+)'.*?num:'([^']*)'.*?\}", m.group(1), flags=re.S):
        entries[em.group(1)] = {'num': em.group(2), 'text': em.group(0).strip()}
    for d in metas:
        title = d['title'].replace("'", "\\'")
        entries[d['id']] = {'num': d['num'],
            'text': "{id:'%s', badge:'日語', num:'%s', title:'%s', href:'lessons/%s.html', secs:9}"
                    % (d['id'], d['num'], title, d['id'])}
    ordered = sorted(entries.values(), key=lambda e: _numkey(e['num']))
    block = "const LESSONS = [\n" + ",\n".join('  ' + e['text'] for e in ordered) + "\n];"
    new = s[:m.start()] + block + s[m.end():]
    open(INDEX, 'w', encoding='utf-8').write(new)
    return len(ordered)


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    files = sorted(glob.glob(os.path.join(DATA, '*.json')))
    if not files:
        print("沒有找到任何 jp/lessons/data/*.json"); return
    metas = []
    for f in files:
        d = json.load(open(f, encoding='utf-8'))
        metas.append(d)
        if only and d['id'] != only:
            continue
        try:
            build_one(f)
            print(f"✓ 生成 {d['id']}  ({len(d['sentences'])} 句 / {len(d['vocab'])} 生詞 / {len(d['listening'])} 聽力題)")
        except Exception as e:
            print(f"✗ {d['id']} 失敗：{e}"); sys.exit(1)
    total = rebuild_index(metas)
    print(f"✓ jp/index.html 註冊表已更新，共 {total} 課")


if __name__ == '__main__':
    main()
