import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPublishedData} from '../src/static-data.js';
const manifest={months:[{month:'2026-08'},{month:'2026-09'}],syncedAt:new Date().toISOString(),revision:'abc',source:'https://huggingface.co/datasets/open-law-data-thailand/soc-ratchakitcha'};
function fixture(url){
 if(url.endsWith('manifest.json'))return new Response(JSON.stringify(manifest));
 return new Response(JSON.stringify({revision:'abc',complete:true,rows:[{id:url,text:'ข้อความจริงจาก OCR'}],scanned:20}));
}
test('static site uses project-relative JSON, never Node API',async()=>{
 const urls=[];const data=await loadPublishedData('/search-ratchakitcha/','2026-09',{all:true,fetcher:async url=>{urls.push(url);return fixture(url)}});
 assert.equal(data.rows.length,2);assert.equal(data.scanned,40);assert.equal(data.published,true);
 assert.ok(urls.every(u=>u.startsWith('/search-ratchakitcha/data/')));
 assert.equal(data.connectedAt,manifest.syncedAt);
});
test('single month and missing month',async()=>{
 assert.equal((await loadPublishedData('/','2026-09',{fetcher:async u=>fixture(u)})).rows.length,1);
 await assert.rejects(loadPublishedData('/','2025-01',{fetcher:async u=>fixture(u)}),/2025-01/);
});
test('mixed revision or failed download cannot appear as success',async()=>{
 await assert.rejects(loadPublishedData('/','2026-09',{fetcher:async url=>url.endsWith('manifest.json')?fixture(url):new Response(JSON.stringify({complete:true,rows:[],revision:'wrong'}))}),/ไม่ตรงกัน/);
 await assert.rejects(loadPublishedData('/','2026-09',{fetcher:async()=>new Response('',{status:404})}));
});
test('annual bundles load multi-year or all-year records with bounded requests and progress',async()=>{
 const manifest={revision:'test',syncedAt:new Date().toISOString(),source:'https://huggingface.co',months:[{month:'1920-01'},{month:'2025-01'},{month:'2025-02'},{month:'2026-01'}],yearFiles:['1920','2025','2026']};
 const urls=[],progress=[];
 const fetcher=async url=>{urls.push(url);return new Response(JSON.stringify(url.endsWith('manifest.json')?manifest:{revision:'test',complete:true,scanned:2,rows:[{id:url}]}))};
 const data=await loadPublishedData('/site/','2026-01',{all:true,years:['2025','2026'],fetcher,onProgress:p=>progress.push(p)});
 assert.deepEqual(data.selectedYears,['2025','2026']);assert.equal(data.rows.length,2);
 assert.deepEqual(urls,['/site/data/manifest.json','/site/data/2025.json','/site/data/2026.json']);
 assert.deepEqual(progress.at(-1),{loaded:2,total:2});
 const all=await loadPublishedData('/site/','2026-01',{all:true,years:null,fetcher});
 assert.equal(all.allYears,true);assert.equal(all.rows.length,3);
});
