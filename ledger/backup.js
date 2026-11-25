const backupFormat='tokyo26-ledger-v1';
function downloadBackup(records){
  const data={format:backupFormat,records:records.map(({synced,...r})=>r)};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='東京旅帳-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function validRecord(r){
  const text=(s,limit)=>typeof s==='string'&&s.length<=limit;
  const cash=n=>Number.isSafeInteger(n)&&n>=0&&n<=999999999;
  if(!r||typeof r!=='object'||typeof r.id!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.id)
      ||!Number.isSafeInteger(r.time)||r.time<0)return false;
  const knownItem=()=>Object.hasOwn(menu,r.category)&&text(r.item,40)&&r.item.trim().length>0;
  if(r.type==='removal')return typeof r.target==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(r.target)&&typeof r.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.day);
  if(r.type==='item')return knownItem();
  if(!cash(r.amount))return false;
  if(r.type==='opening')return people.includes(r.person);
  if(r.amount===0||!text(r.day,10)||!/^\d{4}-\d{2}-\d{2}$/.test(r.day))return false;
  if(['deposit','return'].includes(r.type))return people.includes(r.person);
  if(r.type!=='expense'||!knownItem()||!text(r.note,500)||!['',...people].includes(r.owner))return false;
  if(!Array.isArray(r.shares)||r.shares.length!==2||!r.shares.every(cash)||r.shares[0]+r.shares[1]!==r.amount)return false;
  const p=r.payments;
  return Array.isArray(p)&&p.length>0&&p.length<=sources.length&&p.every(x=>x&&sources.includes(x.source)&&cash(x.amount)&&x.amount>0)
    &&new Set(p.map(x=>x.source)).size===p.length&&p.reduce((s,x)=>s+x.amount,0)===r.amount;
}
function contents(r){
  const {synced,...data}=r;
  return JSON.stringify(data,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
}
async function importBackup(file){
  if(file.size>16*1024*1024)throw Error('備份檔案過大。');
  let data;try{data=JSON.parse(await file.text())}catch{throw Error('請選擇由旅帳匯出的 JSON 備份。')}
  if(data?.format!==backupFormat||!Array.isArray(data.records)||!data.records.every(validRecord))
    throw Error('檔案格式或帳目有誤，未有匯入。');
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
    let added=0,conflict=false;
    const read=store.getAll();
    read.onsuccess=()=>{
      const known=new Map(read.result.map(r=>[r.id,r]));
      for(const row of data.records){
        const existing=known.get(row.id);
        if(existing){
          if(contents(existing)!==contents(row)){conflict=true;tx.abort();return}
        }else{
          const record={...row,synced:false};known.set(row.id,record);store.add(record);added++;
        }
      }
    };
    tx.oncomplete=()=>resolve(added);
    tx.onabort=()=>reject(Error(conflict?'同一編號的記錄內容有差異，整份檔案未匯入。':'匯入失敗，請重試。'));
  });
}
