import {mkdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {parseMonthly} from '../src/dataset.js';
import {DATASET} from '../src/search.js';
const repo='open-law-data-thailand/soc-ratchakitcha';
const year=process.env.DATA_YEAR||new Date().getUTCFullYear().toString();
if(!/^\d{4}$/.test(year))throw Error('Invalid DATA_YEAR');
async function get(url){
 for(let attempt=0;attempt<3;attempt++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error(`HTTP ${r.status}: ${url}`);return r}
  catch(e){if(attempt===2)throw e;await new Promise(resolve=>setTimeout(resolve,2000*(attempt+1)))}
 }
}
// Pin metadata and OCR to the same dataset revision for consistent provenance.
const info=await get(`https://huggingface.co/api/datasets/${repo}`).then(r=>r.json());
if(!info.sha)throw Error('Dataset revision missing');
const revision=info.sha;
const tree=await get(`https://huggingface.co/api/datasets/${repo}/tree/${revision}/meta/${year}?limit=1000`).then(r=>r.json());
const files=tree.filter(f=>f.type==='file'&&/\d{4}-\d{2}\.jsonl$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path));
if(!files.length)throw Error('No monthly metadata files found; refusing to deploy empty dataset');
await mkdir('public/data',{recursive:true});
const manifest={source:DATASET,revision,license:'CC-BY-4.0',year,months:[],syncedAt:null};
for(const file of files){
 const month=file.path.match(/(\d{4}-\d{2})\.jsonl$/)[1];
 const source=`${DATASET}/resolve/${revision}/${file.path}`;
 const result=parseMonthly(await get(source).then(r=>r.text()));
 let ocrStatus='available';let ocrError=null;
 try{
  const response=await get(`${DATASET}/resolve/${revision}/ocr/openlawdata-ocr/${year}/${month}.jsonl`);
  const byKey=new Map();for(const row of result.rows){byKey.set(row.id,row);byKey.set(row.pdfFile,row)}
  const lines=createInterface({input:Readable.fromWeb(response.body),crlfDelay:Infinity});
  for await(const line of lines){if(!line.trim())continue;const r=JSON.parse(line);const row=byKey.get(r.doc_id)||byKey.get(r.pdf_file);if(row&&typeof r.text==='string'&&r.is_valid!==false)row.text=r.text}
 }catch(e){ocrStatus='unavailable';ocrError=e.message;console.warn(`OCR ${month}: ${e.message}`)}
 const connectedAt=new Date().toISOString();
 const data={...result,month,source,revision,complete:true,stale:false,connectedAt,retrievedOn:connectedAt.slice(0,10),ocrStatus,ocrError,ocrCount:result.rows.filter(r=>r.text).length};
 await writeFile(`public/data/${month}.json`,JSON.stringify(data));
 const entry={month,scanned:data.scanned,count:data.rows.length,nacc:data.rows.filter(r=>r.group==='nacc').length,ocrCount:data.ocrCount,ocrStatus};
 manifest.months.push(entry);console.log(JSON.stringify(entry));
}
manifest.syncedAt=new Date().toISOString();
manifest.total=manifest.months.reduce((sum,m)=>sum+m.count,0);
manifest.ocrCount=manifest.months.reduce((sum,m)=>sum+m.ocrCount,0);
if(!manifest.total)throw Error('No matching announcements; refusing to replace published site');
await writeFile('public/data/manifest.json',JSON.stringify(manifest,null,2));
await writeFile('public/.nojekyll','');
console.log(`Synced ${manifest.total} real announcements, ${manifest.ocrCount} OCR texts, revision ${revision}`);

const nacc=manifest.months.reduce((n,m)=>n+m.nacc,0);
console.log(`::notice title=Verified real dataset::${manifest.total} announcements; ${nacc} NACC; ${manifest.ocrCount} OCR texts; ${manifest.months.length} months; revision ${revision}`);
if(process.env.GITHUB_STEP_SUMMARY){
 const {appendFile}=await import('node:fs/promises');
 await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Real Hugging Face data\n\n- Announcements: ${manifest.total}\n- NACC: ${nacc}\n- OCR texts: ${manifest.ocrCount}\n- Months: ${manifest.months.map(m=>m.month).join(', ')}\n- Revision: ${revision}\n- Synced: ${manifest.syncedAt}\n`);
}
