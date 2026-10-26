import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,filterRows} from '../src/search.js';
const base={q:'',group:'all',sub:'',from:'',to:'',scope:'all',match:'all',exclude:'',agency:'',ocr:false,sort:'newest'};
const rows=[{id:1,title:'ประกาศ แต่งตั้งข้าราชการ',text:'นายสมชาย ทำงาน โปร่งใส',date:'2026-01-01',issuer:'รัฐบาล',...classify('แต่งตั้งข้าราชการ')},{id:2,title:'ระเบียบคณะกรรมการ ป.ป.ช.',text:'ตรวจสอบ โปร่งใส',date:'2026-02-01',issuer:'ป.ป.ช.',...classify('ระเบียบคณะกรรมการ ป.ป.ช.')},{id:3,title:'ประกาศ แต่งตั้งทหาร',text:'',date:'2025-12-01',issuer:'กลาโหม',...classify('แต่งตั้งทหาร')},{id:4,title:'ประกาศสำนักนายกรัฐมนตรี เรื่อง ให้ข้าราชการพลเรือนพ้นจากตำแหน่ง',text:'',date:'2026-03-01',issuer:'สำนักนายกรัฐมนตรี',...classify('ประกาศสำนักนายกรัฐมนตรี เรื่อง ให้ข้าราชการพลเรือนพ้นจากตำแหน่ง')}];
test('classification recognizes NACC and appointments, rejects unrelated',()=>{assert.equal(classify('ข่าวทั่วไป').group,'other');assert.equal(rows[0].sub,'ข้าราชการพลเรือน');assert.equal(rows[1].sub,'ระเบียบและข้อบังคับ');assert.equal(rows[2].sub,'ทหารและตำรวจ');assert.equal(classify('ประกาศสำนักงานป้องกันและปราบปรามการทุจริตแห่งชาติ').group,'nacc')});
test('date bounds are inclusive and sorting works',()=>{assert.deepEqual(filterRows(rows,{...base,from:'2026-01-01',to:'2026-02-01'}).map(r=>r.id),[2,1]);assert.equal(filterRows(rows,{...base,sort:'oldest'})[0].id,3)});
test('OCR-only search cannot match titles',()=>{assert.equal(filterRows(rows,{...base,q:'แต่งตั้ง',scope:'text'}).length,0);assert.equal(filterRows(rows,{...base,q:'สมชาย',scope:'text'}).length,1)});
test('AND OR exact and exclusion',()=>{assert.equal(filterRows(rows,{...base,q:'สมชาย โปร่งใส'}).length,1);assert.equal(filterRows(rows,{...base,q:'สมชาย ตรวจสอบ',match:'any'}).length,2);assert.equal(filterRows(rows,{...base,q:'สมชาย โปร่งใส',match:'exact'}).length,0);assert.equal(filterRows(rows,{...base,q:'โปร่งใส',exclude:'ตรวจสอบ'}).length,1)});
test('combine group, agency, OCR and subtype',()=>{assert.deepEqual(filterRows(rows,{...base,group:'appointments',agency:'รัฐบาล',ocr:true,sub:'ข้าราชการพลเรือน'}).map(r=>r.id),[1])});
test('Prime Minister office issuer does not make civil service appointment political',()=>{
 assert.equal(classify('ประกาศสำนักนายกรัฐมนตรี เรื่อง แต่งตั้งข้าราชการพลเรือนสามัญ').sub,'ข้าราชการพลเรือน');
 assert.equal(classify('ประกาศสำนักนายกรัฐมนตรี เรื่อง แต่งตั้งข้าราชการการเมือง').sub,'ข้าราชการการเมือง');
 assert.equal(classify('ประกาศ แต่งตั้งรัฐมนตรี').sub,'ข้าราชการการเมือง');
});
test('classification prioritizes the issuing heading and document kind over topic mentions',()=>{
 assert.equal(classify('ประกาศสำนักงาน ป.ป.ช. เรื่อง หลักเกณฑ์ตามระเบียบการแต่งตั้ง').sub,'สำนักงาน ป.ป.ช.');
 assert.equal(classify('ระเบียบคณะกรรมการ ป.ป.ช. ว่าด้วยการแต่งตั้งกรรมการ').sub,'ระเบียบและข้อบังคับ');
 assert.equal(classify('ประกาศกระทรวงอื่น เรื่อง ระเบียบสำนักงาน ป.ป.ช.').group,'other');
 assert.equal(classify('ระเบียบกระทรวงการคลัง ว่าด้วยการแต่งตั้งข้าราชการ').group,'other');
 assert.equal(classify('ประกาศคณะกรรมการอื่น เรื่อง แต่งตั้งข้าราชการพลเรือน').sub,'ข้าราชการพลเรือน');
});

test('removal notices are classified from the subject wording',()=>{
 const removal=title=>classify(title);
 assert.equal(removal('ประกาศสำนักนายกรัฐมนตรี เรื่อง ให้ข้าราชการพลเรือนพ้นจากตำแหน่ง').group,'removals');
 assert.equal(removal('ประกาศสำนักนายกรัฐมนตรี เรื่อง ให้ข้าราชการพลเรือนพ้นจากตำแหน่ง').sub,'ข้าราชการพลเรือน');
 assert.equal(removal('ประกาศ เรื่อง ให้ข้าราชการตุลาการพ้นจากตำแหน่ง').sub,'ตุลาการและอัยการ');
 assert.equal(removal('ประกาศกระทรวงกลาโหม เรื่อง พ้นจากหน้าที่ทหาร').group,'removals');
 assert.equal(removal('ประกาศ เรื่อง ถอดถอนออกจากตำแหน่งกรรมการ').sub,'กรรมการและผู้ทรงคุณวุฒิ');
 assert.equal(removal('ประกาศ เรื่อง ให้รัฐมนตรีพ้นจากตำแหน่ง').sub,'ข้าราชการการเมือง');
});
test('removal wording wins over appointment wording in the same notice',()=>{
 const category=classify('ประกาศสำนักนายกรัฐมนตรี เรื่อง แต่งตั้งและให้พ้นจากตำแหน่งข้าราชการพลเรือน');
 assert.equal(category.group,'removals');
 assert.equal(category.sub,'ข้าราชการพลเรือน');
});
test('procedural regulations about removal are not removal notices',()=>{
 assert.equal(classify('ระเบียบกระทรวงการคลัง ว่าด้วยการพ้นจากตำแหน่งของข้าราชการ').group,'other');
 assert.equal(classify('ระเบียบคณะกรรมการ ป.ป.ช. ว่าด้วยการพ้นจากตำแหน่ง').group,'nacc');
 assert.equal(classify('ประกาศคณะกรรมการป้องกันและปราบปรามการทุจริตแห่งชาติ เรื่อง หลักเกณฑ์การพ้นจากตำแหน่ง').group,'nacc');
 assert.equal(classify('ประกาศกระทรวงการคลัง เรื่อง หลักเกณฑ์การพ้นจากตำแหน่งของข้าราชการ').group,'other');
});
test('NACC-issued removal notices follow the removal wording',()=>{
 const category=classify('ประกาศสำนักงาน ป.ป.ช. เรื่อง ให้เจ้าหน้าที่พ้นจากตำแหน่ง');
 assert.equal(category.group,'removals');
 assert.equal(classify('ประกาศสำนักงานป้องกันและปราบปรามการทุจริตแห่งชาติ').group,'nacc');
});
test('group filter separates removals from appointments',()=>{
 assert.deepEqual(filterRows(rows,{...base,group:'removals'}).map(r=>r.id),[4]);
 assert.deepEqual(filterRows(rows,{...base,group:'appointments'}).map(r=>r.id),[1,3]);
 assert.deepEqual(filterRows(rows,{...base,group:'removals',sub:'ข้าราชการพลเรือน'}).map(r=>r.id),[4]);
 assert.equal(filterRows(rows,{...base,group:'removals',sub:'ทหารและตำรวจ'}).length,0);
});
