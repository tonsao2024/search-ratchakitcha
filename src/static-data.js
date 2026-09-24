export function selectMonths(manifest,month,{all=false,year=month.slice(0,4),years,range}={}){
 let available=manifest.months.map(m=>m.month).sort();
 if(years!==undefined&&years!==null){
  if(!Array.isArray(years)||!years.length)throw Error('กรุณาเลือกอย่างน้อยหนึ่งปี');
  const known=new Set(available.map(m=>m.slice(0,4)));
  if(years.some(y=>!known.has(y)))throw Error('บางปีที่เลือกยังไม่มีข้อมูลในฐาน');
  available=available.filter(m=>years.includes(m.slice(0,4)));
 }
 if(range){
  const from=range.from?.slice(0,7)||available[0],to=range.to?.slice(0,7)||available.at(-1);
  if(from>to)throw Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
  const selected=available.filter(m=>m>=from&&m<=to);
  if(!selected.length)throw Error('ต้นทางไม่มีไฟล์ข้อมูลในช่วงวันที่ที่เลือก');
  return selected;
 }
 const selected=all?(years!==undefined?available:available.filter(m=>m.startsWith(year+'-'))):[month];
 if(!selected.length||selected.some(m=>!available.includes(m)))throw Error(`ยังไม่มีข้อมูลสำหรับ ${all?year:month}`);
 return selected;
}
export async function loadPublishedData(base,month,{all=false,year=month.slice(0,4),years,range,onProgress,fetcher=fetch}={}){
 const options={cache:'no-store',signal:AbortSignal.timeout(180000)};
 const m=await fetcher(`${base}data/manifest.json`,options);
 if(!m.ok)throw Error('ยังไม่พบข้อมูลที่เผยแพร่');
 const manifest=await m.json();
 if(!Array.isArray(manifest.months)||!manifest.months.length)throw Error('Published manifest is empty');
 const months=selectMonths(manifest,month,{all,year,years,range});
 // Use one annual bundle instead of twelve monthly requests whenever a complete year is selected.
 const selectedYears=[...new Set(months.map(m=>m.slice(0,4)))].sort();
 const resources=selectedYears.flatMap(y=>{
  const subset=months.filter(m=>m.startsWith(y+'-'));
  const completeYear=subset.length===manifest.months.filter(m=>m.month.startsWith(y+'-')).length;
  return completeYear&&manifest.yearFiles?.includes(y)?[y]:subset;
 });
 const batches=[];let next=0,finished=0;
 onProgress?.({loaded:0,total:resources.length});
 await Promise.all(Array.from({length:Math.min(6,resources.length)},async()=>{
  while(next<resources.length){const i=next++;const key=resources[i];
   const r=await fetcher(`${base}data/${key}.json`,options);
   if(!r.ok)throw Error(`โหลด ${key} ไม่สำเร็จ`);
   const data=await r.json();
   if(!data.complete||!Array.isArray(data.rows)||data.revision!==manifest.revision)throw Error('ข้อมูลระหว่างเผยแพร่ไม่ตรงกัน กรุณารีเฟรชอีกครั้ง');
   batches[i]=data;onProgress?.({loaded:++finished,total:resources.length});
  }
 }));
 return {rows:[...new Map(batches.flatMap(d=>d.rows).map(r=>[r.id,r])).values()],selectedYears,allYears:years===null&&!range,month:months.length>1?`${months[0]} – ${months.at(-1)}`:months[0],source:manifest.source,complete:true,stale:Date.now()-Date.parse(manifest.syncedAt)>48*3600000,connectedAt:manifest.syncedAt,revision:manifest.revision,availableMonths:manifest.months,availableYears:[...new Set(manifest.months.map(m=>m.month.slice(0,4)))].sort().reverse(),loadedMonths:months,scanned:batches.reduce((n,d)=>n+d.scanned,0),published:true};
}
