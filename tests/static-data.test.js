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
