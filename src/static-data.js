export function selectMonths(manifest,month,{all=false,year=month.slice(0,4),range}={}){
 const available=manifest.months.map(m=>m.month).sort();
 if(range){
  const from=range.from?.slice(0,7)||available[0],to=range.to?.slice(0,7)||available.at(-1);
  if(from>to)throw Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
  const selected=available.filter(m=>m>=from&&m<=to);
  if(!selected.length)throw Error('ต้นทางไม่มีไฟล์ข้อมูลในช่วงวันที่ที่เลือก');
  return selected;
 }
 const selected=all?available.filter(m=>m.startsWith(year+'-')):[month];
 if(!selected.length||selected.some(m=>!available.includes(m)))throw Error(`ยังไม่มีข้อมูลสำหรับ ${all?year:month}`);
 return selected;
}
export async function loadPublishedData(base,month,{all=false,year=month.slice(0,4),range,fetcher=fetch}={}){
 const options={cache:'no-store',signal:AbortSignal.timeout(180000)};
 const m=await fetcher(`${base}data/manifest.json`,options);
 if(!m.ok)throw Error('ยังไม่พบข้อมูลที่เผยแพร่');
 const manifest=await m.json();
 if(!Array.isArray(manifest.months)||!manifest.months.length)throw Error('Published manifest is empty');
 const months=selectMonths(manifest,month,{all,year,range});
 const batches=[];let next=0;
 await Promise.all(Array.from({length:Math.min(6,months.length)},async()=>{
  while(next<months.length){const i=next++;const key=months[i];
   const r=await fetcher(`${base}data/${key}.json`,options);
   if(!r.ok)throw Error(`โหลด ${key} ไม่สำเร็จ`);
   const data=await r.json();
   if(!data.complete||!Array.isArray(data.rows)||data.revision!==manifest.revision)throw Error('ข้อมูลระหว่างเผยแพร่ไม่ตรงกัน กรุณารีเฟรชอีกครั้ง');
   batches[i]=data;
  }
 }));
 return {rows:batches.flatMap(d=>d.rows),month:months.length>1?`${months[0]} – ${months.at(-1)}`:months[0],source:manifest.source,complete:true,stale:Date.now()-Date.parse(manifest.syncedAt)>48*3600000,connectedAt:manifest.syncedAt,revision:manifest.revision,availableMonths:manifest.months,availableYears:[...new Set(manifest.months.map(m=>m.month.slice(0,4)))].sort().reverse(),loadedMonths:months,scanned:batches.reduce((n,d)=>n+d.scanned,0),published:true};
}
