import express from 'express';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {classify} from './src/search.js';
import {fetchMonth,normalizeRecord,validMonth} from './src/dataset.js';
const app=express();
const cache=new Map(),pending=new Map();
const snapshot=JSON.parse(await readFile(new URL('./data/verified-snapshot.json',import.meta.url),'utf8'));
cache.set(snapshot.month,{...snapshot,records:undefined,rows:snapshot.records.map(normalizeRecord).filter(Boolean),scanned:5,connectedAt:null,stale:true});
async function loadCache(month){
 if(cache.has(month))return cache.get(month);
 try{const saved=JSON.parse(await readFile(`.cache/${month}.json`,'utf8'));cache.set(month,saved);return saved}catch{return null}
}
// A persisted complete import is preferable to the bundled partial snapshot.
try{const saved=JSON.parse(await readFile(`.cache/${snapshot.month}.json`,'utf8'));cache.set(snapshot.month,saved)}catch{}
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
app.get('/api/ocr-search',async(req,res)=>{
 const q=String(req.query.q||'').trim().slice(0,200);
 const queries=q?[q]:['แต่งตั้ง','ป้องกันและปราบปรามการทุจริตแห่งชาติ'];
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
 const rows=[...new Map(batches.flat().filter(r=>r.group!=='other').map(r=>[r.id,r])).values()];
 res.json({rows,connectedAt:new Date().toISOString(),limit:queries.length*100});
 }catch(e){res.status(502).json({error:'ไม่สามารถเชื่อมต่อบริการค้นหาของ Hugging Face ได้ กรุณาลองใหม่ภายหลัง',detail:e.message});}
});
if(process.env.NODE_ENV==='production')app.use(express.static('dist'));
app.listen(3001,'0.0.0.0',()=>console.log('API listening on 3001'));
