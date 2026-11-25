const prefix='tokyo-expenses-'+self.registration.scope+'-';
const cacheName=prefix+'v5';
const shell=['./','./index.html','./style.css','./icon.svg','./book.js','./excel.js','./backup.js','./app.js'];
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const cache=await caches.open(cacheName);await cache.addAll([...shell,'./config.js']);await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==cacheName)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET'||!req.url.startsWith(self.registration.scope))return;
  e.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    if(new URL(req.url).pathname.endsWith('/config.js')){
      try{const res=await fetch(req,{cache:'no-store'});if(res.ok){await cache.put(req,res.clone());return res}}catch{}
    }
    return await cache.match(req,{ignoreSearch:true})||(req.mode==='navigate'?await cache.match('./index.html'):null)||fetch(req);
  })());
});
