export const DATASET='https://huggingface.co/datasets/open-law-data-thailand/soc-ratchakitcha';
export const groups={appointments:['ข้าราชการพลเรือน','กรรมการและผู้ทรงคุณวุฒิ','ข้าราชการการเมือง','ทหารและตำรวจ','บุคลากรอื่น ๆ','ตุลาการและอัยการ'],nacc:['สำนักงาน ป.ป.ช.','คณะกรรมการ ป.ป.ช.','ระเบียบและข้อบังคับ','ประกาศและคำสั่งอื่น ๆ']};
export function classify(title=''){
 const normalized=title.trim().replace(/\s+/g,' ');
 const [heading,...topics]=normalized.split(/\s*เรื่อง\s*/);
 const subject=topics.join(' เรื่อง ');
 const isRule=/^(?:ระเบียบ|ข้อบังคับ)/.test(heading);
 const authority=topics.length?heading:normalized;
 const nacc=/ป\.?\s*ป\.?\s*ช\.?|ป้องกันและปราบปรามการทุจริตแห่งชาติ/.test(authority);
 if(nacc) return {group:'nacc',sub:isRule?groups.nacc[2]:/สำนักงาน/.test(authority)?groups.nacc[0]:/คณะกรรมการ/.test(authority)?groups.nacc[1]:groups.nacc[3]};
 // A regulation about appointment procedures is not an appointment notice.
 if(isRule || !/แต่งตั้ง|ให้.*ดำรงตำแหน่ง/.test(subject || normalized))return {group:'other',sub:''};
 const appointmentText=subject || normalized;
 return {group:'appointments',sub:/ตุลาการ|อัยการ/.test(appointmentText)?groups.appointments[5]:/ทหาร|ตำรวจ/.test(appointmentText)?groups.appointments[3]:/กรรมการ|ผู้ทรงคุณวุฒิ/.test(appointmentText)?groups.appointments[1]:/ข้าราชการการเมือง|(?:แต่งตั้ง|ดำรงตำแหน่ง)\s*(?:นายก)?รัฐมนตรี/.test(appointmentText)?groups.appointments[2]:/พลเรือน|ข้าราชการ/.test(appointmentText)?groups.appointments[0]:groups.appointments[4]};
}
export function filterRows(rows,f){
 const terms=f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return rows.filter(r=>{
 const text=(f.scope==='title'?r.title:f.scope==='text'?r.text:r.title+' '+r.text).toLowerCase();
 return (f.group==='all'||r.group===f.group)&&(!f.sub||r.sub===f.sub)&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to)&&(!f.ocr||!!r.text)&&(!f.exclude||!text.includes(f.exclude.toLowerCase()))&&(!f.agency||(r.title+' '+r.issuer).includes(f.agency))&&(!terms.length||(f.match==='exact'?text.includes(f.q.toLowerCase()):f.match==='any'?terms.some(t=>text.includes(t)):terms.every(t=>text.includes(t))));
 }).sort((a,b)=>f.sort==='oldest'?a.date.localeCompare(b.date):f.sort==='title'?a.title.localeCompare(b.title,'th'):b.date.localeCompare(a.date));
}
