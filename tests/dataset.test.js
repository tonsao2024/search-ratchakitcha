import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validMonth,monthUrl,normalizeRecord,parseMonthly,fetchMonth} from '../src/dataset.js';
const snapshot=JSON.parse(await readFile(new URL('../data/verified-snapshot.json',import.meta.url),'utf8'));
test('snapshot contains real source identifiers and PDF links, no fake OCR',()=>{
 assert.equal(snapshot.complete,false);
 assert.equal(snapshot.records.length,5);
 for(const r of snapshot.records){const row=normalizeRecord(r);assert.ok(row);assert.match(row.pdf,/^https:\/\/ratchakitcha.soc.go.th\/documents\/\d+\.pdf$/);assert.equal(row.text,'');assert.ok(!row.id.startsWith('demo'));assert.ok(row.date.startsWith(snapshot.month))}
});
test('month validation prevents arbitrary upstream URL or path',()=>{
 for(const value of ['../2026-09','2026-13','2026-00','2026-1','2026-09?x=1','https://example.com']){assert.equal(validMonth(value),false);assert.throws(()=>monthUrl(value))}
 assert.equal(validMonth('2026-09'),true);
 assert.match(monthUrl('2026-09'),/meta\/2026\/2026-09.jsonl$/);
});
test('parse full JSONL, exclude tests and unrelated records, deduplicate',()=>{
 const records=[...snapshot.records,snapshot.records[0],{...snapshot.records[0],id:'test',is_test:true},{id:'unrelated',doctitle:'ประกาศจดทะเบียนสมาคม'}];
 const parsed=parseMonthly('\uFEFF'+records.map(JSON.stringify).join('\r\n')+'\r\n');
 assert.equal(parsed.rows.length,5);assert.equal(parsed.scanned,8);
 assert.equal(parsed.rows.find(r=>r.id==='2026-09-22-00131698').sub,'ตุลาการและอัยการ');
});
test('malformed upstream file is not silently treated as complete',()=>{
 assert.throws(()=>parseMonthly(''));assert.throws(()=>parseMonthly('<html>Failure</html>'));assert.throws(()=>parseMonthly('{"other":1}'));
});
test('successful monthly fetch reports genuine fetch timestamp and completeness',async()=>{
 const data=await fetchMonth('2026-09',async url=>{assert.equal(url,monthUrl('2026-09'));return new Response(snapshot.records.map(JSON.stringify).join('\n'))});
 assert.equal(data.complete,true);assert.equal(data.stale,false);assert.equal(data.rows.length,5);assert.ok(Date.parse(data.connectedAt));
});
test('direct browser fetch rejects a truncated download and accepts an empty month',async()=>{
 const text=snapshot.records.map(JSON.stringify).join('\n');
 await assert.rejects(fetchMonth('2026-09',async()=>new Response(text,{headers:{'content-length':String(new TextEncoder().encode(text).byteLength+5)}})),/incomplete download/);
 const empty=await fetchMonth('2026-09',async()=>new Response('',{headers:{'content-length':'0'}}));
 assert.equal(empty.complete,true);assert.equal(empty.rows.length,0);assert.equal(empty.scanned,0);
});
test('upstream errors propagate; no synthetic success',async()=>{
 await assert.rejects(fetchMonth('2026-09',async()=>new Response('Unavailable',{status:503})),/503/);
 await assert.rejects(fetchMonth('2026-09',async()=>{throw Error('Network failure')}),/Network failure/);
});
test('historical null IDs use source PDF identity, missing titles are counted not fabricated',()=>{
 const good={...snapshot.records[0],id:null};
 const missing={...snapshot.records[1],doctitle:null};
 const result=parseMonthly([good,missing].map(JSON.stringify).join('\n'));
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].id,good.pdf_file);
 assert.equal(result.skippedIncomplete,1);assert.equal(result.scanned,2);
});

test('monthly import keeps removal notices and drops procedural rules',()=>{
 const removal={...snapshot.records[0],id:'2026-09-23-00999999',pdf_file:'2026-09-23-00999999.pdf',source_url:'https://ratchakitcha.soc.go.th/documents/999999.pdf',doctitle:'ประกาศสำนักนายกรัฐมนตรี เรื่อง ให้ข้าราชการพลเรือนพ้นจากตำแหน่ง'};
 const rule={...removal,id:'2026-09-23-00999998',pdf_file:'2026-09-23-00999998.pdf',source_url:'https://ratchakitcha.soc.go.th/documents/999998.pdf',doctitle:'ระเบียบกระทรวงการคลัง ว่าด้วยการพ้นจากตำแหน่งของข้าราชการ'};
 const parsed=parseMonthly([...snapshot.records,removal,rule].map(JSON.stringify).join('\n'));
 const row=parsed.rows.find(r=>r.id===removal.id);
 assert.equal(row.group,'removals');
 assert.equal(row.sub,'ข้าราชการพลเรือน');
 assert.equal(parsed.rows.some(r=>r.id===rule.id),false);
 assert.equal(parsed.rows.length,6);
});
