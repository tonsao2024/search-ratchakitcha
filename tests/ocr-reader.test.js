import test from 'node:test';
import assert from 'node:assert/strict';
import {findOcrMatches,ocrSegments,readerSettings} from '../src/ocr-reader.js';
test('all repeated Thai keywords are highlighted, both AND and OR',()=>{
 const text='แต่งตั้ง บุคลากร\nแต่งตั้ง ข้าราชการ';
 for(const mode of ['all','any'])assert.deepEqual(findOcrMatches(text,'แต่งตั้ง ข้าราชการ',mode).map(m=>text.slice(m.start,m.end)),['แต่งตั้ง','แต่งตั้ง','ข้าราชการ']);
});
test('exact phrase mode, case-insensitive matching, empty and absent query',()=>{
 const text='Law LAW law';assert.equal(findOcrMatches(text,'law').length,3);
 assert.equal(findOcrMatches('คำแรก คำสอง คำแรก\nคำสอง','คำแรก คำสอง','exact').length,1);
 assert.deepEqual(findOcrMatches(text,''),[]);assert.deepEqual(findOcrMatches(text,'not found'),[]);
});
test('special regex characters treated literally, longer overlapping terms preferred',()=>{
 const text='ป.ป.ช. [a+b] (test) ป.ป.ช.';
 assert.equal(findOcrMatches(text,'ป.ป.ช. [a+b]').length,3);
 assert.equal(findOcrMatches('ข้าราชการ','ราชการ ข้าราชการ').length,1);
});
test('segments preserve original OCR, including HTML as plain text',()=>{
 const text='<script>alert(1)</script> ค้น ค้น';
 const parts=ocrSegments(text,findOcrMatches(text,'ค้น'));
 assert.equal(parts.map(p=>p.text).join(''),text);
 assert.deepEqual(parts.filter(p=>p.match!==undefined).map(p=>p.match),[0,1]);
 assert.deepEqual(ocrSegments(text,[]),[{text}]);
});
test('reader preferences validate fonts and enforce font size limits',()=>{
 assert.deepEqual(readerSettings(null),{font:'sans',size:18});
 assert.deepEqual(readerSettings({font:'evil',size:1000}),{font:'sans',size:36});
 assert.deepEqual(readerSettings({font:'serif',size:1}),{font:'serif',size:14});
 assert.equal(readerSettings({size:NaN}).size,18);
});
