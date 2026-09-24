import {test,expect} from '@playwright/test';
const date='2026-09-01';
function rows(year,count){return Array.from({length:count},(_,i)=>({id:`test-${year}-${i}`,title:`ประกาศแต่งตั้ง ทดสอบ ${i+1}`,date:`${year}-09-01`,text:'',issuer:'หน่วยงานทดสอบ',volume:'1',part:'1',pdf:null,group:'appointments',sub:'บุคลากรอื่น ๆ'}))}
const files={'1920-09':rows('1920',2),'2025-09':rows('2025',31),'2026-09':rows('2026',61)};
for(const width of [390,1280])test(`Historical years, cross-year dates, and pagination at ${width}px`,async({page})=>{
 await page.clock.setFixedTime(new Date(date));
 await page.setViewportSize({width,height:900});
 const loaded=[];
 await page.route('**/data/*.json',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('manifest.json'))return route.fulfill({json:{revision:'test-revision',source:'https://huggingface.co',syncedAt:new Date().toISOString(),months:Object.entries(files).map(([month,r])=>({month,count:r.length}))}});
  const month=path.split('/').at(-1).replace('.json','');loaded.push(month);
  return route.fulfill({json:{rows:files[month],complete:true,revision:'test-revision',scanned:files[month].length}});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 const pager=page.getByRole('navigation',{name:'การเปลี่ยนหน้าผลลัพธ์'});
 await expect(pager).toContainText('แสดง 1–20 จาก 61 รายการ');
 await pager.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
 await expect(pager).toContainText('แสดง 21–40');
 await pager.getByRole('button',{name:'หน้าสุดท้าย',exact:true}).click();
 await expect(pager).toContainText('แสดง 61–61');
 await page.getByLabel('เลขหน้าที่ต้องการ').fill('2');await pager.getByRole('button',{name:'ไป',exact:true}).click();
 await expect(pager).toContainText('แสดง 21–40');
 await page.getByLabel('จำนวนรายการต่อหน้า').selectOption('50');
 await expect(pager).toContainText('แสดง 1–50');
 await page.getByLabel('ปีประกาศ (พ.ศ.)',{exact:true}).selectOption('1920');
 await expect(pager).toContainText('จาก 2 รายการ');expect(loaded).toContain('1920-09');
 await page.getByLabel('ปีประกาศ (พ.ศ.)',{exact:true}).selectOption('2025');
 await expect(pager).toContainText('จาก 31 รายการ');
 await page.getByText('ตั้งแต่วันที่',{exact:true}).locator('input').fill('2025-01-01');
 await page.getByText('ถึงวันที่',{exact:true}).locator('input').fill('2026-12-31');
 await page.locator('.search-main').getByRole('button',{name:'ค้นหาประกาศ'}).click();
 await expect(pager).toContainText('จาก 92 รายการ');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
