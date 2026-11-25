// Small, uncompressed Office Open XML workbook. Text is always an inline string.
function workbookBytes(sheets){
  const enc=new TextEncoder(),files=[];
  const xml=s=>String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  function file(name,data){files.push([enc.encode(name),enc.encode('<?xml version="1.0" encoding="UTF-8"?>'+data)])}
  function relationships(items){return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+items.map(([type,path],i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+rel+'/'+type+'" Target="'+path+'"/>').join('')+'</Relationships>'}
  const paths=sheets.map((_,i)=>'worksheets/sheet'+(i+1)+'.xml');
  file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+paths.map(p=>'<Override PartName="/xl/'+p+'" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>');
  file('_rels/.rels',relationships([['officeDocument','xl/workbook.xml']]));
  file('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><sheets>'+sheets.map(([name],i)=>'<sheet name="'+xml(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>');
  file('xl/_rels/workbook.xml.rels',relationships(paths.map(p=>['worksheet',p])));
  sheets.forEach(([,rows],i)=>{
    const cols=rows[0].map((_,j)=>'<col min="'+(j+1)+'" max="'+(j+1)+'" width="19" customWidth="1"/>').join('');
    file('xl/'+paths[i],'<worksheet xmlns="'+ns+'"><cols>'+cols+'</cols><sheetData>'+rows.map((row,n)=>'<row r="'+(n+1)+'">'+row.map((v,j)=>{
      const ref=String.fromCharCode(65+j)+(n+1);
      return typeof v==='number'?'<c r="'+ref+'"><v>'+v+'</v></c>':'<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v??'')+'</t></is></c>';
    }).join('')+'</row>').join('')+'</sheetData></worksheet>');
  });
  const header=size=>{const a=new Uint8Array(size),d=new DataView(a.buffer);return {a,u16:(i,v)=>d.setUint16(i,v,true),u32:(i,v)=>d.setUint32(i,v,true)}};
  const parts=[],directory=[];let offset=0,dirSize=0;
  for(const [name,bytes] of files){
    let crc=-1;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}crc=~crc;
    const h=header(30);h.u32(0,0x04034b50);h.u16(4,20);h.u16(12,33);h.u32(14,crc);h.u32(18,bytes.length);h.u32(22,bytes.length);h.u16(26,name.length);
    parts.push(h.a,name,bytes);
    const c=header(46);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(14,33);c.u32(16,crc);c.u32(20,bytes.length);c.u32(24,bytes.length);c.u16(28,name.length);c.u32(42,offset);
    directory.push(c.a,name);dirSize+=46+name.length;offset+=30+name.length+bytes.length;
  }
  const end=header(22);end.u32(0,0x06054b50);end.u16(8,files.length);end.u16(10,files.length);end.u32(12,dirSize);end.u32(16,offset);
  return new Blob([...parts,...directory,end.a],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function downloadBook(rows){
  rows=activeRecords(rows);
  const b=totals(rows),expenses=[['日期','分類','項目','金額 JPY',...sources,'Usagi 分額','Momonga 分額','Suica 卡主','備註','記錄編號']],wallet=[['日期','事項','成員','收入','支出','記錄編號']];
  for(const r of [...rows].filter(r=>r.type!=='item'&&r.type!=='opening').sort((a,b)=>a.day.localeCompare(b.day)||a.time-b.time)){
    if(r.type==='expense'){
      const paid=sources.map(s=>r.payments.find(p=>p.source===s)?.amount||0);
      expenses.push([r.day,r.category,r.item,r.amount,...paid,...r.shares,r.owner,r.note,r.id]);
      if(paid[4])wallet.push([r.day,r.item,'',0,paid[4],r.id]);
    }else wallet.push([r.day,r.type==='deposit'?'放入現金':'取回現金',r.person,r.type==='deposit'?r.amount:0,r.type==='return'?r.amount:0,r.id]);
  }
  const summary=[['項目','金額／結果'],...people.map(p=>[p+' 起始現金',openingFor(rows,p)?.amount??'未填寫']),['總支出',b.spent],['Usagi 承擔',b.shares[0]],['Momonga 承擔',b.shares[1]],['錢包餘額',b.wallet],['結算',settlement(b)],['分類','金額'],...b.categories,['日期','金額'],...[...b.days].sort()];
  const url=URL.createObjectURL(workbookBytes([['結算',summary],['開支',expenses],['公用錢包',wallet]]));
  const a=document.createElement('a');a.href=url;a.download='東京旅帳.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
