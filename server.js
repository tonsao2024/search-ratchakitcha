import express from 'express';
import {readFile,mkdir,writeFile,rename,readdir} from 'node:fs/promises';
import {classify} from './src/search.js';
import {fetchMonth,normalizeRecord,validMonth} from './src/dataset.js';
import {searchLocalOcr,parseOcrJsonl,OCR_SOURCES} from './src/ocr.js';
import {createOcrQueue} from './src/ocr-queue.js';
import {fetchPdf,processPdfBuffer,recordLocalOcr,loadState,LOCAL_OCR_DIR} from './scripts/ocr-pipeline.mjs';
const app=express();
app.use(express.json({limit:'100kb'}));
const cache=new Map(),pending=new Map();
const snapshot=JSON.parse(await readFile(new URL('./data/verified-snapshot.json',import.meta.url),'utf8'));
// Re-apply the current classification rules so caches written before the
// removal ("พ้นจากตำแหน่ง") category existed still show every group.
function reclassify(data){
 return {...data,rows:(data.rows||[]).map(row=>({...row,...classify(row.title)})).filter(row=>row.group!=='other')};
}
cache.set(snapshot.month,{...snapshot,records:undefined,rows:snapshot.records.map(normalizeRecord).filter(Boolean),scanned:5,connectedAt:null,stale:true});
async function loadCache(month){
 if(cache.has(month))return cache.get(month);
 try{const saved=reclassify(JSON.parse(await readFile(`.cache/${month}.json`,'utf8')));cache.set(month,saved);return saved}catch{return null}
}
// A persisted complete import is preferable to the bundled partial snapshot.
try{const saved=reclassify(JSON.parse(await readFile(`.cache/${snapshot.month}.json`,'utf8')));cache.set(snapshot.month,saved)}catch{}
async function sync(month){
 if(pending.has(month))return pending.get(month);
 const task=(async()=>{
 const data=await fetchMonth(month);cache.set(month,data);
 await mkdir('.cache',{recursive:true});
 await writeFile(`.cache/${month}.tmp`,JSON.stringify(data));await rename(`.cache/${month}.tmp`,`.cache/${month}.json`);
 return data;
 })();pending.set(month,task);
 try{return await task}finally{pending.delete(month)}
}
app.get('/api/search',async(req,res)=>{
 const month=String(req.query.month||new Date().toISOString().slice(0,7));
 if(!validMonth(month))return res.status(400).json({error:'เดือนต้องอยู่ในรูปแบบ YYYY-MM'});
 const saved=await loadCache(month);
 if(req.query.refresh!=='1'&&saved){
 return res.json({...saved,stale:!saved.connectedAt||Date.now()-Date.parse(saved.connectedAt)>86400000});
 }
 try{return res.json(await sync(month))}catch(e){
 if(saved)return res.json({...saved,stale:true,warning:'เชื่อมต่อสดไม่สำเร็จ แสดงสำเนาข้อมูลจริงที่มีอยู่',detail:e.message});
 return res.status(502).json({error:'ยังโหลดข้อมูลจริงของเดือนนี้ไม่ได้ กรุณาลองใหม่',detail:e.message});
 }
});
// Retry cached months daily; refresh always bypasses this interval.
setInterval(()=>{const month=new Date().toISOString().slice(0,7);sync(month).catch(e=>console.warn('Daily sync failed:',e.message))},86400000).unref();
// Local OCR text extracted by scripts/ocr-pipeline.mjs (cached in memory,
// re-read when the files on disk change).
let localCache=null;
async function loadLocalOcrRecords(){
 let files=[];
 try{files=await readdir(LOCAL_OCR_DIR)}catch{return localCache?.records||[]}
 const stamps=new Map();
 const records=[];
 for(const name of files.filter(n=>/^\d{4}-\d{2}\.jsonl$/.test(n))){
  try{
   const file=`${LOCAL_OCR_DIR}/${name}`;
   const stat=await (await import('node:fs/promises')).stat(file);
   stamps.set(name,stat.mtimeMs);
   records.push(...parseOcrJsonl(await readFile(file,'utf8')));
  }catch(e){console.warn(`Local OCR cache ${name} unreadable: ${e.message}`)}
 }
 localCache={records,stamps,at:Date.now()};
 return records;
}
app.get('/api/ocr-search',async(req,res)=>{
 const q=String(req.query.q||'').trim().slice(0,200);
 const queries=q?[q]:['แต่งตั้ง','ป้องกันและปราบปรามการทุจริตแห่งชาติ'];
 // Upstream (Hugging Face) results — best effort: if the dataset service is
 // unreachable, local OCR results below can still answer the query.
 let rows=[];
 let upstreamError=null;
 try{
 const batches=await Promise.all(queries.map(async query=>{
 const url=new URL('https://datasets-server.huggingface.co/search');
 url.search=new URLSearchParams({dataset:'open-law-data-thailand/soc-ratchakitcha',config:'openlawdata',split:'train',query,offset:'0',length:'100'});
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`Dataset service HTTP ${response.status}`);
 const data=await response.json();
 if(!Array.isArray(data.rows))throw Error('Unexpected dataset response');
 return data.rows.map(({row:r})=>{
 const title=r.doctitle||r.title||r.subject||'ไม่มีชื่อประกาศ';
 const raw=r.publish_date||'';
 const date=/^\d{4}-\d{2}-\d{2}/.test(raw)?raw.slice(0,10):'';
 const pdf=[r.source_url,r.pdf_file].find(x=>/^https?:\/\//.test(x||''))||null;
 return {id:r.doc_id||r.pdf_file||title,title,date,text:r.text||'',issuer:r.issuer||'',volume:r.volume||'',part:r.part||'',pdf,...classify(title)};
 });
 }));
 rows=[...new Map(batches.flat().filter(r=>r.group!=='other').map(r=>[r.id,r])).values()];
 }catch(e){upstreamError=e.message;}
 // Extend the results with locally extracted text for documents the dataset
 // service has no OCR for (same row shape, tagged with the text source).
 let localAdded=0;
 if(q){
  try{
   const records=await loadLocalOcrRecords();
   for(const hit of searchLocalOcr(records,q).slice(0,100)){
    const id=hit.id||hit.pdfFile;
    if(!id||rows.some(r=>r.id===id))continue;
    const title=hit.doctitle||hit.title||id;
    rows.push({id,title,date:hit.publish_date||'',text:hit.text,issuer:'',volume:'',part:'',pdf:hit.source_url||null,textSource:hit.source==='textlayer'?OCR_SOURCES.textlayer:OCR_SOURCES.local,...classify(title)});
    localAdded++;
   }
  }catch(e){upstreamError=upstreamError||`Local OCR cache unreadable: ${e.message}`;}
 }
 if(!rows.length){
  if(q)return res.status(502).json({error:'ไม่พบข้อความที่ตรงกับคำค้น (และไม่สามารถเชื่อมต่อฐาน OCR ต้นทางได้)',detail:upstreamError||undefined});
  return res.status(502).json({error:'ไม่สามารถเชื่อมต่อบริการค้นหาของ Hugging Face ได้ กรุณาลองใหม่ภายหลัง',detail:upstreamError||undefined});
 }
 res.json({rows,connectedAt:new Date().toISOString(),limit:queries.length*100,localAdded,upstreamOk:!upstreamError});
});
// On-demand OCR: "OCR ฉบับนี้" for a single notice that has no text yet.
// One job at a time (CPU/OCR engine bound); the client polls the job state.
const ocrQueue=createOcrQueue({
 runJob:async payload=>{
  const {id,pdf,title,month}=payload;
  const buffer=await fetchPdf(pdf);
  const result=await processPdfBuffer(buffer);
  if(result.source==='none')throw Error('ไม่พบข้อความในไฟล์ (ไม่มี text layer และ OCR อ่านไม่ได้)');
  const targetMonth=/^\d{4}-\d{2}$/.test(month||'')?month:new Date().toISOString().slice(0,7);
  const state=await loadState();
  await recordLocalOcr({id,pdfFile:null,source_url:pdf,title:title||id,date:'',text:result.text,source:result.source,pages:result.pages},{state,month:targetMonth});
  return {text:result.text,source:result.source,pages:result.pages,month:targetMonth};
 },
});
app.post('/api/ocr-one',async(req,res)=>{
 const {id,pdf,title,month}=req.body||{};
 if(!id||typeof id!=='string')return res.status(400).json({error:'ต้องมี id ของประกาศ'});
 if(!/^https?:\/\//.test(pdf||''))return res.status(400).json({error:'ต้องมี URL PDF ของต้นฉบับ'});
 const jobId=ocrQueue.submit({id:id.slice(0,200),pdf,title:String(title||'').slice(0,300),month});
 res.json({jobId});
});
app.get('/api/ocr-one/:jobId',async(req,res)=>{
 const job=ocrQueue.get(String(req.params.jobId).slice(0,40));
 if(!job)return res.status(404).json({error:'ไม่พบ job (อาจหมดอายุแล้ว)'});
 res.json({id:job.id,status:job.status,result:job.result||null,error:job.error||null});
});
// Answer body-parser failures (e.g. malformed JSON) as JSON, not HTML.
app.use((err,req,res,next)=>{
 if(err&&(err.type==='entity.parse.failed'||err.status===400))return res.status(400).json({error:'เนื้อหาที่ไม่ถูกต้อง'});
 next(err);
});
if(process.env.NODE_ENV==='production')app.use(express.static('dist'));
app.listen(3001,'0.0.0.0',()=>console.log('API listening on 3001'));
