import test from 'node:test';
import assert from 'node:assert/strict';
import {pageItems,requestedPage} from '../src/pagination.js';
import {selectMonths} from '../src/static-data.js';
test('pagination shows ellipses and boundary pages',()=>{assert.deepEqual(pageItems(50,100),[1,'gap-49',49,50,51,'gap-100',100]);assert.deepEqual(pageItems(1,1),[1]);assert.deepEqual(pageItems(2,3),[1,2,3])});
test('jump rejects invalid and out-of-range page numbers',()=>{for(const value of ['0','-1','2.5','abc','101',''])assert.equal(requestedPage(value,100),null);assert.equal(requestedPage('53',100),53)});
const manifest={months:[{month:'1920-02'},{month:'2025-01'},{month:'2025-12'},{month:'2026-01'},{month:'2026-09'}]};
test('year selection loads only that year, not every historical month',()=>{assert.deepEqual(selectMonths(manifest,'2025-01',{all:true,year:'2025'}),['2025-01','2025-12']);assert.deepEqual(selectMonths(manifest,'1920-02',{all:true,year:'1920'}),['1920-02'])});
test('cross-year dates select matching monthly files inclusively',()=>{assert.deepEqual(selectMonths(manifest,'2026-01',{range:{from:'2025-12-31',to:'2026-01-01'}}),['2025-12','2026-01']);assert.throws(()=>selectMonths(manifest,'2026-01',{range:{from:'2026-02-01',to:'2025-01-01'}}));assert.throws(()=>selectMonths(manifest,'1800-01',{all:true,year:'1800'}))});
test('multiple nonconsecutive years, all years, empty selection and date intersection',()=>{
 assert.deepEqual(selectMonths(manifest,'2026-01',{all:true,years:['1920','2026']}),['1920-02','2026-01','2026-09']);
 assert.equal(selectMonths(manifest,'2026-01',{all:true,years:null}).length,5);
 assert.throws(()=>selectMonths(manifest,'2026-01',{all:true,years:[]}),/อย่างน้อย/);
 assert.throws(()=>selectMonths(manifest,'2026-01',{all:true,years:['1858']}));
 assert.deepEqual(selectMonths(manifest,'2026-01',{all:true,years:['1920','2026'],range:{from:'2025-01-01',to:'2026-02-01'}}),['2026-01']);
});
