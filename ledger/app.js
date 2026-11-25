'use strict';
const $=id=>document.getElementById(id);
const make=(tag,txt,cls)=>Object.assign(document.createElement(tag),{textContent:txt??'',className:cls||''});
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const fmtSource=p=>p.source+' '+yen(p.amount);
const suica='Suica 購卡／增值';
let db,rows=[],cloud=null,access=false,activeTab='entry',timer,cloudMessage='',flushing=false,offlineReady=false;
const configured=!!window.tripFirebase;
function toast(msg){$('toast').textContent=msg;clearTimeout(timer);timer=setTimeout(()=>$('toast').textContent='',4500)}
function database(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('tokyo-2026-expenses',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('records',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
function storeRows(records){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite');
    records.forEach(r=>tx.objectStore('records').put(r));
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });
}
function readRows(){
  return new Promise((resolve,reject)=>{
    const q=db.transaction('records').objectStore('records').getAll();
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  });
}
function option(value){return new Option(value,value)}
function updateItems(){
  const old=$('item').value;
  const items=new Map(Object.entries(menu).map(([cat,names])=>[cat,new Set(names)]));
  for(const r of rows.filter(r=>r.type==='item')) items.get(r.category)?.add(r.item);
  $('item').replaceChildren();
  for(const [label,names] of items){
    const group=document.createElement('optgroup');group.label=label;
    for(const name of names) group.append(option(name));
    $('item').append(group);
  }
  if([...$('item').options].some(o=>o.value===old)) $('item').value=old;
  itemChoices();
}
function status(){
  const pending=rows.filter(r=>!r.synced).length;
  const msg=cloudMessage || (!configured?(navigator.onLine?'離線帳簿・已存此機':'離線・本機帳簿'):!access?'請登入以開啟私人帳簿':!navigator.onLine?'離線・已存此機':!cloud?'正在連接帳簿':pending?'已存此機・待同步':'已同步');
  $('network').textContent=msg+(configured&&access&&pending?'（'+pending+' 筆待同步）':'')+(!configured&&offlineReady?' · 可離線開啟':'');
  $('login').hidden=!configured||!!cloud;
}
function showTab(id){
  activeTab=id;document.querySelectorAll('main section').forEach(s=>s.hidden=s.id!==id||!access);
  document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.tab===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');b.disabled=!access});
}
function displayLine(key,val){
  const d=make('div','','line');d.append(make('span',key),make('strong',val,'money'));return d;
}
function stat(label,val){const d=make('div','','stat');d.append(make('small',label),make('strong',val));return d}
function removeButton(r){
  const button=make('button','移除','link remove-record');
  button.type='button';
  button.onclick=async()=>{
    const title=r.type==='expense'?r.item:r.person+(r.type==='deposit'?' 放入現金':' 取回現金');
    if(!confirm('移除整筆記錄？\n'+r.day+' · '+title+' · '+yen(r.amount)+'\n錢包及結算會重新計算。'))return;
    button.disabled=true;
    try{await save({type:'removal',target:r.id,day:r.day});toast('已移除。請與旅伴交換更新後的當日記錄。')}
    catch{button.disabled=false;toast('未能移除，請重試。')}
  };
  return button;
}
function card(r){
  const a=make('article'),head=make('div','','head');
  const title=r.type==='expense'?r.item:r.person+(r.type==='deposit'?' 放入現金':' 取回現金');
  head.append(make('b',title),make('strong',yen(r.amount)));a.append(head);
  a.append(make('small',r.day+' · '+(r.synced?'已同步':'已存此機')));
  if(r.type==='expense'){
    a.append(make('p',r.payments.map(fmtSource).join(' ＋ ')),make('p',people.map((p,i)=>p+' '+yen(r.shares[i])).join(' ／ ')));
    if(r.owner)a.append(make('p','卡主 '+r.owner));if(r.note)a.append(make('p',r.note));
  }
  const copy=make('button','複製文字','link');copy.onclick=()=>copyText(recordText(r));a.append(copy,removeButton(r));return a;
}
async function refresh(){
  rows=await readRows();status();if(!access)return;
  updateItems();
  $('openingList').replaceChildren(...people.map(p=>{const r=openingFor(rows,p);return displayLine(p,r?yen(r.amount):'未填寫')}));
  const sorted=activeRecords(rows).filter(r=>r.type!=='item'&&r.type!=='opening').sort((a,b)=>b.day.localeCompare(a.day)||b.time-a.time);
  const b=totals(sorted);
  const days=new Map();
  for(const row of sorted){
    if(!days.has(row.day))days.set(row.day,[]);
    days.get(row.day).push(row);
  }
  $('history').replaceChildren();
  const localDay=r=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date(r.time));
  for(const r of rows.filter(r=>r.type==='opening')){
    const day=localDay(r);if(!days.has(day))days.set(day,[]);
  }
  for(const r of rows.filter(r=>r.type==='removal'))if(!days.has(r.day))days.set(r.day,[]);
  for(const [day,entries] of [...days].sort(([a],[b])=>b.localeCompare(a))){
    const title=make('h2',day);
    const dailySpend=entries.reduce((sum,r)=>sum+(r.type==='expense'?r.amount:0),0);
    const total='當日開支 '+yen(dailySpend);
    const copy=make('button','複製全日記錄','secondary');
    const removals=rows.filter(r=>r.type==='removal'&&r.day===day);
    const openings=rows.filter(r=>r.type==='opening'&&localDay(r)===day);
    copy.onclick=()=>{
      const records=[...removals,...entries,...rows.filter(r=>r.type==='item'),...openings].map(({synced,...r})=>r);
      const packet=JSON.stringify({format:backupFormat,records});
      copyText(['東京旅帳 · '+day,total,...(removals.length?['含移除記錄更新']:[]),...entries.map(recordText),...openings.map(r=>r.person+' 起始現金 '+yen(r.amount)),'【旅帳合併資料】',packet].join('\n'));
    };
    $('history').append(title,make('strong',total),copy,...entries.map(card));
  }
  if(!days.size)$('history').append(make('p','尚未有記錄。'));
  $('walletTotals').replaceChildren(stat('可用現金',yen(b.wallet)),...people.map((p,i)=>displayLine(p+' 累計放入',yen(b.deposits[i]))));
  const wallet=sorted.filter(r=>r.type!=='expense'||r.payments.some(p=>p.source===pool));
  $('walletLog').replaceChildren(...wallet.map(r=>{
    const amount=r.type==='expense'?r.payments.find(p=>p.source===pool).amount:r.amount;
    const line=displayLine(r.day+' · '+(r.item||r.person),(r.type==='deposit'?'＋':'−')+yen(amount));
    line.append(removeButton(r));return line;
  }));
  if(!wallet.length)$('walletLog').append(make('p','尚未有錢包收支。'));
  $('results').replaceChildren(stat('旅程總開支',yen(b.spent)),...people.map((p,i)=>displayLine(p+' 承擔',yen(b.shares[i]))),displayLine('公用錢包餘額',yen(b.wallet)),make('h2','結算結果'),make('p',settlement(b)),make('h2','按分類'),...[...b.categories].map(([k,v])=>displayLine(k,yen(v))),make('h2','按日期'),...[...b.days].sort().map(([k,v])=>displayLine(k,yen(v))));
}
function addPayment(source=sources[0],value=''){
  const row=make('div','','payrow'), sel=make('select'), amt=make('input'), del=make('button','移除');
  sel.append(...sources.map(option));sel.value=source;sel.setAttribute('aria-label','付款來源');
  Object.assign(amt,{type:'number',inputMode:'numeric',min:'1',step:'1',placeholder:'金額',value});amt.setAttribute('aria-label','付款金額');
  del.type='button';del.onclick=()=>{row.remove();paymentLayout()};
  sel.hidden=true;const choices=make('div','','chips paychips');
  function render(){choices.replaceChildren(...sources.map(s=>choice(s,sel.value===s,()=>{sel.value=s;render()})))}
  render();row.append(sel,amt,del,choices);$('pays').append(row);paymentLayout();
}
function paymentLayout(){
  const list=[...$('pays').children];for(const r of list){
    r.children[1].hidden=list.length===1;r.children[1].required=list.length>1;r.children[2].hidden=list.length===1;
  }
  $('addPay').disabled=list.length>=sources.length;
}
function shareHint(){
  const total=Number($('amount').value),mode=$('split').value;
  $('exactBox').hidden=mode!=='exact';$('exact').required=mode==='exact';$('exact').max=total||999999999;
  const shares=splitShares(total,mode,Number($('exact').value));
  $('shares').textContent=total>0&&shares.every(n=>n>=0)?people.map((p,i)=>p+' '+yen(shares[i])).join(' ／ '):'';
}
function pickItem(){
  itemChoices();const isCard=$('item').value===suica;$('suicaBox').hidden=!isCard;
  $('split').value=isCard?$('owner').value:'half';shareHint();
}
function amountOK(n){return Number.isSafeInteger(n)&&n>0&&n<=999999999}
function expense(){
  const amount=Number($('amount').value);
  if(!amountOK(amount)||!$('day').value)throw Error('請填寫日期及日圓整數金額。');
  const inputs=[...$('pays').children];
  const payments=inputs.map(r=>({source:r.children[0].value,amount:inputs.length===1?amount:Number(r.children[1].value)}));
  if(new Set(payments.map(p=>p.source)).size!==payments.length)throw Error('同一付款來源請合併金額。');
  if(payments.some(p=>!amountOK(p.amount))||payments.reduce((n,p)=>n+p.amount,0)!==amount)throw Error('付款來源的金額合計必須等於帳單金額。');
  const mode=$('split').value,shares=splitShares(amount,mode,Number($('exact').value));
  if((mode==='exact'&&$('exact').value==='')||shares.some(n=>!Number.isInteger(n)||n<0))throw Error('請核對個人分額。');
  const item=$('item').value,category=$('item').selectedOptions[0].parentNode.label;
  return {type:'expense',day:$('day').value,amount,item,category,owner:item===suica?$('owner').value:'',payments,shares,note:$('note').value.trim()};
}
async function copyText(txt){
  try{await navigator.clipboard.writeText(txt);toast('已複製，可貼到 WhatsApp 或備忘錄。')}
  catch{$('manual').value=txt;$('clipboard').showModal();$('manual').select()}
}
async function save(data){
  if(!access)throw Error('請先登入。');
  const r={...data,id:crypto.randomUUID(),time:Date.now(),synced:false};
  await storeRows([r]);await refresh();void flush();return r;
}
function submit(id,fn){
  let busy=false;$(id).onsubmit=async e=>{
    e.preventDefault();if(busy)return;busy=true;const btn=$(id).querySelector('.primary');btn.disabled=true;
    try{await fn()}catch(err){toast(err.message||'未能儲存，請重試。')}finally{busy=false;btn.disabled=false}
  };
}
function setup(){
  $('day').value=$('walletDay').value=today();$('category').append(...Object.keys(menu).map(option));addPayment();updateItems();
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  $('addItem').onclick=()=>{$('itemName').value='';$('newItem').showModal()};
  submit('itemForm',async()=>{
    const item=$('itemName').value.trim(),category=$('category').value;
    if(!item)throw Error('請輸入項目名稱。');
    if([...$('item').options].some(o=>o.value===item))throw Error('已有同名項目，請直接選用。');
    await save({type:'item',item,category});$('item').value=item;pickItem();$('newItem').close();
  });
  $('addPay').onclick=()=>{
    const used=[...$('pays').querySelectorAll('select')].map(s=>s.value);
    addPayment(sources.find(s=>!used.includes(s))||sources[0]);
  };
  $('item').onchange=pickItem;$('owner').onchange=pickItem;
  ['amount','exact','split'].forEach(k=>$(k).oninput=shareHint);
  $('copyDraft').onclick=()=>{try{void copyText(recordText(expense()))}catch(e){toast(e.message)}};
  submit('expense',async()=>{
    await save(expense());$('amount').value=$('note').value=$('exact').value='';$('pays').replaceChildren();addPayment();pickItem();toast('開支已儲存。');
  });
  submit('transfer',async()=>{
    const amount=Number($('walletAmount').value);
    if(!amountOK(amount))throw Error('請填寫日圓整數金額。');
    await save({type:$('kind').value,person:$('person').value,day:$('walletDay').value,amount});
    $('walletAmount').value='';toast('錢包交易已儲存。');
  });
  submit('openingForm',async()=>{
    const amount=Number($('openingAmount').value),person=$('openingPerson').value;
    if(!Number.isInteger(amount)||amount<0||amount>999999999)throw Error('請填寫有效的日圓金額。');
    await save({type:'opening',person,amount});$('openingAmount').value='';toast('已記錄起始現金。');
  });
  $('mergeDay').onclick=async()=>{
    try{
      const input=$('pasteDay').value.trim(),marker='\n【旅帳合併資料】\n';
      const pos=input.lastIndexOf(marker);
      if(pos<0)throw Error('請複製完整訊息，包括最下方的旅帳合併資料。');
      const count=await importBackup(new Blob([input.slice(pos+marker.length)]));
      await refresh();void flush();$('pasteDay').value='';$('mergeResult').textContent='合併完成，新增 '+count+' 筆記錄。';
    }catch(e){$('mergeResult').textContent=e.message}
  };
  $('backupOut').onclick=async()=>{try{downloadBackup(await readRows());$('mergeResult').textContent='帳簿已準備下載。'}catch{toast('備份失敗，請重試。')}};
  $('backupIn').onchange=async e=>{
    const input=e.target,file=input.files[0];if(!file)return;
    try{
      const count=await importBackup(file);
      await refresh();void flush();$('mergeResult').textContent='合併完成，新增 '+count+' 筆記錄。';
    }catch(err){$('mergeResult').textContent=err.message}
    finally{input.value=''}
  };
  $('export').onclick=()=>downloadBook(rows);$('login').onclick=()=>connect(true);
}
async function flush(){
  if(!cloud||!navigator.onLine||flushing)return;flushing=true;
  try{
    for(;;){
      const pending=(await readRows()).filter(r=>!r.synced);if(!pending.length)break;
      for(const r of pending){
        const {synced,...payload}=r;
        await cloud.api.setDoc(cloud.api.doc(cloud.col,r.id),payload);
        await storeRows([{...r,synced:true}]);
      }
    }
    cloudMessage='';
  }catch{cloudMessage='同步未完成・帳目已存此機'}finally{flushing=false;await refresh()}
}
let sdk,connecting=false,unsubscribe;
async function connect(interactive=false){
  if(!configured||!navigator.onLine||connecting)return;
  connecting=true;
  try{
    if(!sdk){
      const base='https://www.gstatic.com/firebasejs/13.3.0/';
      const [app,authApi,api]=await Promise.all(['firebase-app','firebase-auth','firebase-firestore'].map(n=>import(base+n+'.js')));
      const instance=app.initializeApp(window.tripFirebase);
      sdk={authApi,api,auth:authApi.getAuth(instance),fire:api.getFirestore(instance)};
    }
    const {authApi,api,auth,fire}=sdk;
    await auth.authStateReady();
    if(!auth.currentUser&&interactive)await authApi.signInWithPopup(auth,new authApi.GoogleAuthProvider());
    if(!auth.currentUser){access=false;localStorage.removeItem('trip-member');return}
    const email=auth.currentUser.email;
    const member=await api.getDocFromServer(api.doc(fire,'members',email));
    if(!member.exists()){
      access=false;localStorage.removeItem('trip-member');await authApi.signOut(auth);throw Error('這個帳戶未加入旅帳。');
    }
    localStorage.setItem('trip-member',window.tripFirebase.projectId+'|'+email);
    access=true;cloudMessage='';const col=api.collection(fire,'trips','tokyo26','records');
    cloud={api,col};unsubscribe?.();
    unsubscribe=api.onSnapshot(col,async snap=>{
      const records=snap.docChanges().filter(c=>c.type!=='removed'&&!c.doc.metadata.hasPendingWrites).map(c=>({...c.doc.data(),id:c.doc.id,synced:true}));
      if(records.length)await storeRows(records);await refresh();
    },()=>{cloudMessage='讀取雲端帳簿失敗・請重新連線';status()});
    await flush();
  }catch(e){cloudMessage=e.message==='這個帳戶未加入旅帳。'?e.message:'未能連接 Google・請檢查網絡或帳簿設定';}
  finally{connecting=false;showTab(activeTab);await refresh()}
}
async function start(){
  try{
    db=await database();setup();
    access=!configured||(localStorage.getItem('trip-member')||'').startsWith(window.tripFirebase.projectId+'|');
    showTab('entry');await refresh();
    if(location.protocol!=='file:' && 'serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js')
      .then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;status()})
      .catch(()=>toast('未能準備離線頁面，請連線重開。'));
    void connect();addEventListener('online',()=>{status();void connect()});addEventListener('offline',status);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cloud)void flush()});
    setInterval(()=>{if(cloud&&rows.some(r=>!r.synced))void flush()},30000);
  }catch(e){access=false;showTab('entry');$('network').textContent='未能開啟本機儲存，請用 Safari 開啟網站。'}
}
start();

function choice(label,active,action){
  const button=make('button',label);button.type='button';
  button.setAttribute('aria-pressed',String(active));button.onclick=action;return button;
}
function itemChoices(){
  const select=$('item'),current=select.selectedOptions[0];if(!current)return;
  const group=current.parentElement;
  function selectOption(o){select.selectedIndex=o.index;pickItem()}
  $('catTabs').replaceChildren(...Array.from(select.children,g=>choice(g.label,g===group,()=>selectOption(g.children[0]))));
  $('itemTabs').replaceChildren(...Array.from(group.children,o=>choice(o.value,o===current,()=>selectOption(o))));
}
