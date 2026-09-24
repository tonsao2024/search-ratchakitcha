import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {parseMonthly} from '../src/dataset.js';
import {DATASET} from '../src/search.js';
process.on('uncaughtException',error=>{console.log(`::error title=Historical import failed::${String(error.stack||error).replaceAll('%','%25').replaceAll('\n','%0A').replaceAll('\r','%0D')}`);process.exit(1)});
const repo='open-law-data-thailand/soc-ratchakitcha';
const currentYear=new Date().getUTCFullYear();
async function get(url){
 for(let attempt=0;attempt<5;attempt++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error(`HTTP ${r.status}: ${url}`);return r}
  catch(e){if(attempt===4)throw e;await new Promise(resolve=>setTimeout(resolve,5000*(attempt+1)))}
 }
}
async function pool(items,fn,concurrency=4){
 let next=0;const result=[];
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await fn(items[i])}}));return result;
}
const info=await get(`https://huggingface.co/api/datasets/${repo}`).then(r=>r.json());
if(!info.sha)throw Error('Dataset revision missing');
const revision=info.sha;
async function tree(path){
 let url=`https://huggingface.co/api/datasets/${repo}/tree/${revision}/${path}?limit=1000`;const items=[];
 while(url){const r=await get(url);items.push(...await r.json());url=r.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1]||null}
 return items;
}
const years=(await tree('meta')).filter(f=>f.type==='directory'&&/^meta\/\d{4}$/.test(f.path)).map(f=>f.path.slice(-4)).sort();
if(!years.length)throw Error('No metadata years');
const files=(await pool(years,async year=>(await tree(`meta/${year}`)).filter(f=>f.type==='file'&&/\d{4}-\d{2}\.jsonl$/.test(f.path)))).flat();
if(!files.length)throw Error('No metadata files');
// Full historical metadata; import OCR for the current and previous year to bound Pages size.
const ocrFiles=new Map();
for(const year of years.filter(y=>+y>=currentYear-1)){
 for(const f of await tree(`ocr/openlawdata-ocr/${year}`)){if(f.type==='file'&&f.path.endsWith('.jsonl'))ocrFiles.set(f.path.split('/').at(-1),f)}
}
await mkdir('public/data',{recursive:true});await mkdir('.cache/month-import',{recursive:true});
const manifest={source:DATASET,revision,license:'CC-BY-4.0',year:String(currentYear),years:[],months:[],syncedAt:null};
const entries=await pool(files,async file=>{
 const month=file.path.match(/(\d{4}-\d{2})\.jsonl$/)[1];
 const source=`${DATASET}/resolve/${revision}/${file.path}`;
 const ocrFile=ocrFiles.get(`${month}.jsonl`);
 const cacheKey=`v4-${file.oid}-${ocrFile?.oid||'metadata'}`;
 let cached;try{cached=JSON.parse(await readFile(`.cache/month-import/${cacheKey}.json`,'utf8'))}catch{}
 let result=cached;let ocrStatus=cached?.ocrStatus||'not-imported',ocrError=cached?.ocrError||null;
 if(!result){
  try{const text=await get(source).then(r=>r.text());result=file.size===0?{rows:[],scanned:0}:parseMonthly(text)}catch(e){throw Error(`${month}: ${e.message}`)}
  if(ocrFile){
   try{
    const response=await get(`${DATASET}/resolve/${revision}/${ocrFile.path}`);
    const byKey=new Map();for(const row of result.rows){byKey.set(row.id,row);byKey.set(row.pdfFile,row)}
    const lines=createInterface({input:Readable.fromWeb(response.body),crlfDelay:Infinity});
    for await(const line of lines){if(!line.trim())continue;const r=JSON.parse(line);const row=byKey.get(r.doc_id)||byKey.get(r.pdf_file);if(row&&typeof r.text==='string'&&r.is_valid!==false)row.text=r.text}
    ocrStatus='available';
   }catch(e){ocrStatus='unavailable';ocrError=e.message;console.warn(`OCR ${month}: ${e.message}`)}
  }
  result={...result,ocrStatus,ocrError,downloadedAt:new Date().toISOString()};
  if(ocrStatus!=='unavailable')await writeFile(`.cache/month-import/${cacheKey}.json`,JSON.stringify(result));
 }
 const connectedAt=new Date().toISOString();
 const data={...result,month,source,revision,complete:true,stale:false,connectedAt,retrievedOn:connectedAt.slice(0,10),ocrStatus,ocrError,ocrCount:result.rows.filter(r=>r.text).length};
 await writeFile(`public/data/${month}.json`,JSON.stringify(data));
 return {month,skippedIncomplete:data.skippedIncomplete||0,scanned:data.scanned,count:data.rows.length,nacc:data.rows.filter(r=>r.group==='nacc').length,ocrCount:data.ocrCount,ocrStatus};
});
manifest.months=entries.sort((a,b)=>a.month.localeCompare(b.month));
manifest.years=years.map(year=>({year,count:entries.filter(m=>m.month.startsWith(year)).reduce((n,m)=>n+m.count,0)}));
manifest.skippedIncomplete=entries.reduce((n,m)=>n+m.skippedIncomplete,0);
manifest.syncedAt=new Date().toISOString();
manifest.total=entries.reduce((sum,m)=>sum+m.count,0);manifest.ocrCount=entries.reduce((sum,m)=>sum+m.ocrCount,0);
if(!manifest.total)throw Error('No matching announcements');
await writeFile('public/data/manifest.json',JSON.stringify(manifest,null,2));await writeFile('public/.nojekyll','');
const summary=`${manifest.total} announcements; ${entries.reduce((n,m)=>n+m.nacc,0)} NACC; ${manifest.ocrCount} OCR texts; ${years[0]}–${years.at(-1)}; ${entries.length} months; ${manifest.skippedIncomplete} incomplete records skipped; revision ${revision}`;
console.log(`::notice title=Verified real dataset::${summary}`);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Actual historical dataset\n${summary}\n\nOCR imported for ${currentYear-1}–${currentYear}; older metadata remains title-searchable.\n`);
