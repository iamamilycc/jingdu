# 精讀 jingdu

給孩子用的通用課文精讀站（靜態，GitHub Pages 託管）。貼什麼課文，精讀什麼。

- 每課 6 環節：逐句精讀 / 生詞卡 / 語法點 / 口語跟讀 / 背句挑戰（看10秒→蓋住→口語背→語音識別評分）/ 打卡
- 錯題自動進錯題本，按艾賓浩斯（30分→1天→2天→4天→7天→15天）在「復盤中心」排隊
- iPad Safari 需 iOS 14.5+ 且開啟 Siri 與聽寫；進度存設備本地（localStorage）

新增課文：按 docs/spec.md 的數據結構生成 lessons/<id>.html 並在 index.html 的 LESSONS 註冊表加一行。
