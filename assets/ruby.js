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
  window.JDRuby = { toRubyHTML, toKana, toPlain };
})();
