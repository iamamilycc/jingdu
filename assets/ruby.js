/* 振假名標記轉換：「新[あたら]しい」→ <ruby>新<rt>あたら</rt></ruby>しい
   同時提供 stripRuby()：轉純假名（給 TTS / 比對 / 聽力題盲聽用，不含漢字） */
(function(){
  'use strict';
  function toRubyHTML(s){
    return String(s).replace(/([^\[\]]+)\[([^\[\]]+)\]/g, function(_, base, kana){
      return '<ruby>'+base+'<rt>'+kana+'</rt></ruby>';
    });
  }
  function toKana(s){
    /* 把 base[kana] 換成 kana，其餘原樣（假名/標點）保留 */
    return String(s).replace(/([^\[\]]+)\[([^\[\]]+)\]/g, function(_, base, kana){ return kana; });
  }
  function toPlain(s){
    /* 去掉方括號標記，只剩基礎文字（漢字+假名），給「看原句」顯示用 */
    return String(s).replace(/([^\[\]]+)\[([^\[\]]+)\]/g, function(_, base){ return base; });
  }
  window.JDRuby = { toRubyHTML, toKana, toPlain };
})();
