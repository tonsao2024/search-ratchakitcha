import {classify,DATASET} from './search.js';
export function validMonth(month){return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&Number(month.slice(0,4))>=1858&&Number(month.slice(0,4))<=2100}
export function monthUrl(month){if(!validMonth(month))throw Error('Invalid month');return `${DATASET}/raw/main/meta/${month.slice(0,4)}/${month}.jsonl`}
export function normalizeRecord(r){
 if(r.is_test||typeof r.doctitle!=='string'||!r.doctitle.trim())return null;
 const id=String(r.id||r.pdf_file||r.source_url||'');if(!id)return null;
 const category=classify(r.doctitle);
 if(category.group==='other')return null;
 const issuer=r.doctitle.match(/^(?:ประกาศ|ระเบียบ|ข้อบังคับ)(.+?)(?: เรื่อง| ว่าด้วย)/)?.[1]||'';
 return {id,title:r.doctitle,date:r.publishDate||'',text:'',issuer,volume:r.bookNo||'',part:[r.section,r.category].filter(Boolean).join(' '),page:r.pageNo||'',pdf:/^https:\/\//.test(r.source_url||'')?r.source_url:null,pdfFile:r.pdf_file,source:DATASET,...category};
}
export function parseMonthly(text){
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim());
 if(!lines.length)throw Error('Empty dataset file');
 const records=lines.map((line,i)=>{try{return JSON.parse(line)}catch{throw Error(`Invalid JSONL at line ${i+1}`)}});
 if(records.some(r=>!r||typeof r!=='object'||!('doctitle' in r)||!('id' in r||'pdf_file' in r||'source_url' in r)))throw Error('Unexpected metadata schema');
 const skippedIncomplete=records.filter(r=>typeof r.doctitle!=='string'||!r.doctitle.trim()||!(r.id||r.pdf_file||r.source_url)).length;
 return {rows:[...new Map(records.map(normalizeRecord).filter(Boolean).map(r=>[r.id,r])).values()],scanned:records.length,skippedIncomplete};
}
export async function fetchMonth(month,fetcher=fetch){
 const source=monthUrl(month);
 const r=await fetcher(source,{signal:AbortSignal.timeout(18000),cache:'no-store'});
 if(!r.ok)throw Error(`Hugging Face HTTP ${r.status}`);
 const result=parseMonthly(await r.text());
 return {...result,month,source,complete:true,stale:false,connectedAt:new Date().toISOString(),retrievedOn:new Date().toISOString().slice(0,10)};
}
