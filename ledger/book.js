const people = ['Usagi','Momonga'];
const sources = ['Usagi 現金','Usagi 信用卡','Momonga 現金','Momonga 信用卡','公用錢包'];
const pool = sources[4];
const menu = {
  '飲食':['早餐','午餐','晚餐','咖啡／甜品','零食／飲品'],
  '交通':['鐵路／地鐵','機場列車','巴士／接駁車','交通套票','Suica 購卡／增值'],
  '門票':['樂園／景點','庭園／寺社','活動門票'],
  '購物':['角色精品','服飾鞋履','手信','藥妝'],
  '雜項':['行李寄存','其他']
};
const yen = n => '¥' + n.toLocaleString('en-US');
function splitShares(total,mode,exact) {
  const u = mode === 'half' ? Math.ceil(total/2) : mode === 'Usagi' ? total : mode === 'Momonga' ? 0 : exact;
  return [u,total-u];
}
function activeRecords(records) {
  const removed=new Set(records.filter(r=>r.type==='removal').map(r=>r.target));
  return records.filter(r=>r.type!=='removal'&&!removed.has(r.id));
}
function totals(rows) {
  rows=activeRecords(rows);
  const b={spent:0,wallet:0,paid:[0,0],shares:[0,0],deposits:[0,0],categories:new Map(),days:new Map()};
  const add=(m,k,n)=>m.set(k,(m.get(k)||0)+n);
  for (const r of rows) {
    if (r.type==='item' || r.type==='opening') continue;
    if (r.type!=='expense') {
      const i=people.indexOf(r.person), delta=r.type==='deposit'?r.amount:-r.amount;
      b.wallet+=delta; b.paid[i]+=delta;
      if(r.type==='deposit') b.deposits[i]+=delta;
      continue;
    }
    b.spent+=r.amount; add(b.categories,r.category,r.amount); add(b.days,r.day,r.amount);
    r.shares.forEach((s,i)=>b.shares[i]+=s);
    for(const p of r.payments) {
      if(p.source===pool) b.wallet-=p.amount;
      else b.paid[p.source.startsWith('Usagi')?0:1]+=p.amount;
    }
  }
  return b;
}
function settlement(b) {
  if (b.wallet!==0) return b.wallet>0?'錢包尚餘 '+yen(b.wallet)+'，請記錄兩人取回的現金再結算。':'錢包出現負數，請核對供款及收支。';
  const credit=b.paid[0]-b.shares[0];
  return credit===0?'兩人已結清':(credit>0?'Momonga 付給 Usagi ':'Usagi 付給 Momonga ')+yen(Math.abs(credit));
}
function recordText(r) {
  if(r.type!=='expense') return [r.day,r.person,r.type==='deposit'?'放入公用錢包':'取回現金',yen(r.amount)].join('｜');
  return [r.day,r.item,r.owner && '卡主 '+r.owner,yen(r.amount),r.payments.map(p=>p.source+' '+yen(p.amount)).join('＋'),people.map((p,i)=>p+' '+yen(r.shares[i])).join('・'),r.note].filter(Boolean).join('｜');
}

function openingFor(records,person) {
  return records.filter(r=>r.type==='opening'&&r.person===person)
    .sort((a,b)=>b.time-a.time||b.id.localeCompare(a.id))[0];
}
