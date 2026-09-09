#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lesson_english_audit_test.py —— 課程裡的**英文內容**要過判分引擎複核

⭐ 為什麼要有：課文、例句、講解都是 AI 生成或人寫的，孩子沒有判斷能力，
   不能讓他去發現我們的錯。造句關已經有規則引擎在判分了，那就用同一套引擎
   （assets/grammar-en.js，兩站共用的單一事實源）把課程裡每個英文句子重新判一遍。

三條斷言：
  ① 課程裡的英文句子，被判錯的必須全在白名單（tests/known_bad_en.txt）裡
     —— 新加的課若英文寫錯，這裡立刻變紅
  ② 白名單裡的句子必須**仍然**被判錯 —— 防止把正確句誤當成「刻意的反例」
  ③ 每個生詞的例句必須真的用上那個詞（build_lessons.py 只檢查 data/*.json，
     內嵌在課頁 html 裡的資料沒人查過）

用法： python3 tests/lesson_english_audit_test.py
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WL = os.path.join(ROOT, 'tests', 'known_bad_en.txt')
FAILS = []


def ck(name, cond, detail=''):
    print(('  ok  ' if cond else '  XX  ') + name + ('' if cond else '   <<< ' + str(detail)[:300]))
    if not cond:
        FAILS.append(name)


JS = r'''
const fs=require('fs');
const R=process.argv[1];
const G=new Function('window', fs.readFileSync(R+'/assets/grammar-en.js','utf8')+'\nreturn window.GrammarEN;')({});
const strip=t=>String(t||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const SENT=/[A-Z][A-Za-z0-9'’,\- ]{8,}[.?!]/g;
const seen=new Map(); const vocabIssues=[];
function scanText(where, txt){ (strip(txt).match(SENT)||[]).forEach(x=>{x=x.trim(); if(!seen.has(x)) seen.set(x,where);}); }
function walk(where, node){
  if(node==null) return;
  if(typeof node==='string'){ scanText(where,node); return; }
  if(Array.isArray(node)){ node.forEach((v,i)=>walk(where+'['+i+']',v)); return; }
  if(typeof node==='object'){ Object.entries(node).forEach(([k,v])=>walk(where+'.'+k,v)); }
}
function checkVocab(file, d){
  (d.vocab||[]).forEach(v=>{
    const egs=(v.egs&&v.egs.length)?v.egs:(v.eg?[v.eg]:[]);
    egs.forEach(e=>{ if(!G.hasWord(e, v.w)) vocabIssues.push(file+' 生詞「'+v.w+'」的例句沒用上這個詞：'+e); });
  });
}
const data=[];
fs.readdirSync(R+'/lessons/data').filter(f=>f.endsWith('.json')&&!f.startsWith('jp')).forEach(f=>{
  const d=JSON.parse(fs.readFileSync(R+'/lessons/data/'+f,'utf8')); data.push([f,d]); });
fs.readdirSync(R+'/lessons').filter(f=>f.endsWith('.html')&&f!=='view.html').forEach(f=>{
  const src=fs.readFileSync(R+'/lessons/'+f,'utf8');
  const m=src.match(/const LESSON\s*=\s*([\s\S]*?);\s*\n/)||src.match(/window\.LESSON\s*=\s*([\s\S]*?);\s*\n/);
  if(m){ try{ data.push([f, eval('('+m[1]+')')]); }catch(e){} } });
data.forEach(([f,d])=>{ walk(f,d); checkVocab(f,d); });
const bad=[];
seen.forEach((where,s)=>{
  const e=G.checkGrammar(s).filter(x=>x.level==='error');
  const c=G.collocHits(s), se=G.senseHits(s);
  if(e.length||c.length||se.length)
    bad.push({s:s, where:where, why:e.map(x=>x.why.replace(/<[^>]+>/g,''))
      .concat(c.map(x=>'中式：'+x.good)).concat(se.map(x=>x.why)).join('；')});
});
console.log(JSON.stringify({files:data.map(d=>d[0]), total:seen.size, bad:bad, vocabIssues:vocabIssues}));
'''


def main():
    r = subprocess.run(['node', '-e', JS, ROOT], capture_output=True, text=True)
    if r.returncode != 0:
        print('掃描腳本執行失敗：', r.stderr.strip()[:300])
        sys.exit(2)
    res = json.loads(r.stdout.strip().splitlines()[-1])
    print('掃描課程：%s' % '、'.join(res['files']))
    print('英文句子共 %d 句' % res['total'])

    wl = set()
    if os.path.exists(WL):
        wl = {ln.split('#')[0].strip() for ln in open(WL, encoding='utf-8') if ln.split('#')[0].strip()}

    print('-- ① 被判錯的句子必須是刻意的反例（在白名單裡）')
    unknown = [b for b in res['bad'] if b['s'] not in wl]
    for b in unknown:
        print('     ❌ [%s]「%s」→ %s' % (b['where'], b['s'], b['why']))
    ck('沒有「新寫錯的英文句子」', not unknown,
       '若確實是講解裡刻意舉的反例，加進 tests/known_bad_en.txt；否則請改對它')

    print('-- ② 白名單不能過期（避免把正確句誤當反例）')
    still_bad = {b['s'] for b in res['bad']}
    stale = [s for s in wl if s not in still_bad]
    for s in stale:
        print('     ⚠️ 這句現在判不出錯了，請複查它到底對不對：「%s」' % s)
    ck('白名單裡的句子仍然被判錯', not stale)

    print('-- ③ 生詞的例句必須真的用上那個詞')
    for v in res['vocabIssues']:
        print('     ❌ ' + v)
    ck('每個例句都用上了對應的生詞', not res['vocabIssues'])

    print()
    if FAILS:
        print('❌ %d 項不通過：' % len(FAILS))
        for f in FAILS:
            print('   - ' + f)
        return 1
    print('✅ 課程英文內容全部通過判分引擎複核（%d 句）' % res['total'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
