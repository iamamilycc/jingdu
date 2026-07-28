/* 振假名標記轉換：「新[あたら]しい」→ <ruby>新<rt>あたら</rt></ruby>しい
   提供 toKana()：轉純假名（給 TTS / 比對 / 盲聽用）；toPlain()：去標記留漢字。
   ⚠️ base 只能是「緊貼方括號前的漢字」，不能貪婪吞掉前面的假名/片假名/數字，
      否則 toKana 會把夾在中間的內容刪掉（曾導致 TTS 讀不完整、語音比對目標錯誤）。 */
(function(){
  'use strict';
  /* 漢字（含疊字符々〇・部分計數用ヶ），一次只吃緊貼 [ 前的一段漢字 */
  const RE = /([一-鿿㐀-䶿々〇ヶ々]+)\[([^\[\]]+)\]/g;
  function toRubyHTML(s){
    return String(s).replace(RE, function(_, base, kana){
      return '<ruby>'+base+'<rt>'+kana+'</rt></ruby>';
    });
  }
  function toKana(s){
    return String(s).replace(RE, function(_, base, kana){ return kana; });
  }
  function toPlain(s){
    return String(s).replace(RE, function(_, base){ return base; });
  }
  /* 抽出所有「漢字→讀音」對照，供語音比對把識別回來的漢字換成假名。
     ⚠️ 必須跟 toKana 用同一條 RE（只吃緊貼括號前的漢字），否則 key 會被前面的
     假名污染（曾把「これからお世話[せわ]」整串當成 key，導致把識別文字整段替換錯、
     念對也對不上）。這是本檔唯一的振假名解析真源，別在別處另寫一條正則。 */
  function kanjiReadings(s){
    const out = []; const re = new RegExp(RE.source, 'g'); let m;
    while((m = re.exec(String(s)))){ out.push([m[1], m[2]]); }
    return out;
  }
  window.JDRuby = { toRubyHTML, toKana, toPlain, kanjiReadings };
})();
