/* jingdu Service Worker —— 網絡優先（network-first）
   目的：讓「普通刷新」就能拿到最新代碼，不必每次硬刷新。
   策略：同源的頁面/JS/CSS/字體，每次都先走網絡拿最新（順手更新緩存）；
        只有網絡失敗（離線）才用緩存回退。跨源請求（智譜 API、GitHub 同步）一律不攔，直接放行。 */
const CACHE = 'jingdu-cache-v1';

self.addEventListener('install', e => { self.skipWaiting(); });               /* 新版立即就緒，不等舊頁面關閉 */
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); }); /* 激活後立即接管所有頁面 */

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                     /* 只管讀取類請求 */
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           /* 智譜 API / GitHub 同步等跨源請求不攔 */
  /* cache:'no-cache' 關鍵——帶 etag 向服務器驗證，繞過瀏覽器的 max-age 緩存：
     內容變了拿新的、沒變回 304 省流量。這才是真正「普通刷新即最新」。 */
  e.respondWith(
    fetch(new Request(req, {cache:'no-cache'})).then(resp => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(req, clone)); /* 順手把最新版存進緩存，供離線回退 */
      }
      return resp;
    }).catch(() => caches.match(req))                    /* 網絡失敗 → 用緩存（離線也能用） */
  );
});
