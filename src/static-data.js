export async function loadPublishedData(base,month,{all=false,fetcher=fetch}={}){
 const options={cache:'no-store',signal:AbortSignal.timeout(60000)};
 const m=await fetcher(`${base}data/manifest.json`,options);
 if(!m.ok)throw Error('ยังไม่พบข้อมูลที่เผยแพร่');
 const manifest=await m.json();
 if(!Array.isArray(manifest.months)||!manifest.months.length)throw Error('Published manifest is empty');
 const months=all?manifest.months.map(m=>m.month):[month];
 if(months.some(key=>!manifest.months.some(m=>m.month===key)))throw Error(`ยังไม่ได้นำเข้าข้อมูลเดือน ${month}`);
 const batches=await Promise.all(months.map(async key=>{
  const r=await fetcher(`${base}data/${key}.json`,options);
  if(!r.ok)throw Error(`โหลด ${key} ไม่สำเร็จ`);
  const data=await r.json();
  if(!data.complete||!Array.isArray(data.rows)||data.revision!==manifest.revision)throw Error('ข้อมูลระหว่างเผยแพร่ไม่ตรงกัน กรุณารีเฟรชอีกครั้ง');
  return data;
 }));
 return {rows:batches.flatMap(d=>d.rows),month:all?`${months[0]} – ${months.at(-1)}`:month,source:manifest.source,complete:true,stale:Date.now()-Date.parse(manifest.syncedAt)>48*3600000,connectedAt:manifest.syncedAt,revision:manifest.revision,availableMonths:manifest.months,scanned:batches.reduce((n,d)=>n+d.scanned,0),published:true};
}
