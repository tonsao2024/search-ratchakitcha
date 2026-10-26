export const DATASET='https://huggingface.co/datasets/open-law-data-thailand/soc-ratchakitcha';
const personnelTypes=['ข้าราชการพลเรือน','กรรมการและผู้ทรงคุณวุฒิ','ข้าราชการการเมือง','ทหารและตำรวจ','บุคลากรอื่น ๆ','ตุลาการและอัยการ'];
// Appointment and removal notices share the same personnel sub-categories.
export const groups={appointments:personnelTypes,removals:personnelTypes,nacc:['สำนักงาน ป.ป.ช.','คณะกรรมการ ป.ป.ช.','ระเบียบและข้อบังคับ','ประกาศและคำสั่งอื่น ๆ']};
export const groupLabels={appointments:'แต่งตั้งบุคลากร',removals:'พ้นจากตำแหน่ง',nacc:'ป.ป.ช.'};
export const groupTags={appointments:'แต่งตั้ง',removals:'พ้นจากตำแหน่ง',nacc:'ป.ป.ช.'};
// Keyword rules for notices that remove someone from office. Matched against the notice subject.
export const removalPattern=/พ้นจากตำแหน่ง|พ้นจากหน้าที่|ถอดถอน(?:ออก)?จากตำแหน่ง/;
// A subject that only sets out procedures/rates is a regulation, even if it mentions removal wording.
const proceduralPattern=/^(?:หลักเกณฑ์|วิธีการ|แนวทาง|แนวปฏิบัติ|การกำหนด|อัตรา)/;
export function isRemovalNotice(text=''){return removalPattern.test(text)}
function personnelSub(text){
 return /ตุลาการ|อัยการ/.test(text)?groups.appointments[5]:/ทหาร|ตำรวจ/.test(text)?groups.appointments[3]:/กรรมการ|ผู้ทรงคุณวุฒิ/.test(text)?groups.appointments[1]:/ข้าราชการการเมือง|(?:แต่งตั้ง|ดำรงตำแหน่ง|พ้นจากตำแหน่ง|ให้)\s*(?:นายก)?รัฐมนตรี/.test(text)?groups.appointments[2]:/พลเรือน|ข้าราชการ/.test(text)?groups.appointments[0]:groups.appointments[4];
}
export function classify(title=''){
 const normalized=title.trim().replace(/\s+/g,' ');
 const [heading,...topics]=normalized.split(/\s*เรื่อง\s*/);
 const subject=topics.join(' เรื่อง ');
 const isRule=/^(?:ระเบียบ|ข้อบังคับ)/.test(heading);
 const authority=topics.length?heading:normalized;
 const nacc=/ป\.?\s*ป\.?\s*ช\.?|ป้องกันและปราบปรามการทุจริตแห่งชาติ/.test(authority);
 // A regulation about appointment/removal procedures is not itself an appointment or removal notice.
 if(isRule) return nacc?{group:'nacc',sub:groups.nacc[2]}:{group:'other',sub:''};
 // Removal wording wins over appointment wording: a notice that both appoints and removes belongs under removals.
 const body=subject||normalized;
 if(isRemovalNotice(body) && !proceduralPattern.test(body)) return {group:'removals',sub:personnelSub(body)};
 if(nacc) return {group:'nacc',sub:/สำนักงาน/.test(authority)?groups.nacc[0]:/คณะกรรมการ/.test(authority)?groups.nacc[1]:groups.nacc[3]};
 if(!/แต่งตั้ง|ให้.*ดำรงตำแหน่ง/.test(body))return {group:'other',sub:''};
 return {group:'appointments',sub:personnelSub(body)};
}
export function filterRows(rows,f){
 const terms=f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
 return rows.filter(r=>{
 const text=(f.scope==='title'?r.title:f.scope==='text'?r.text:r.title+' '+r.text).toLowerCase();
 return (f.group==='all'||r.group===f.group)&&(!f.sub||r.sub===f.sub)&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to)&&(!f.ocr||!!r.text)&&(!f.exclude||!text.includes(f.exclude.toLowerCase()))&&(!f.agency||(r.title+' '+r.issuer).includes(f.agency))&&(!terms.length||(f.match==='exact'?text.includes(f.q.toLowerCase()):f.match==='any'?terms.some(t=>text.includes(t)):terms.every(t=>text.includes(t))));
 }).sort((a,b)=>f.sort==='oldest'?a.date.localeCompare(b.date):f.sort==='title'?a.title.localeCompare(b.title,'th'):b.date.localeCompare(a.date));
}
