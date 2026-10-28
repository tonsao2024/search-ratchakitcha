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
  if(path.endsWith('manifest.json'))return route.fulfill({json:{revision:'test-revision',source:'https://huggingface.co',syncedAt:new Date().toISOString(),yearFiles:['1920','2025','2026'],months:Object.entries(files).map(([month,r])=>({month,count:r.length}))}});
  const resource=path.split('/').at(-1).replace('.json','');const month=resource.length===4?resource+'-09':resource;loaded.push(month);
  return route.fulfill({json:{rows:files[month],complete:true,revision:'test-revision',scanned:files[month].length}});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 const filterToggle=page.getByRole('button',{name:'ตัวกรอง',exact:true});
 if(await filterToggle.getAttribute('aria-expanded')==='false')await filterToggle.click();
 const pager=page.getByRole('navigation',{name:'การเปลี่ยนหน้าผลลัพธ์'});
 // The default window spans the published years inside the ten-year range (2025-09 + 2026-09 here).
 await expect(pager).toContainText('แสดง 1–20 จาก 92 รายการ');
 await pager.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
 await expect(pager).toContainText('แสดง 21–40');
 await pager.getByRole('button',{name:'หน้าสุดท้าย',exact:true}).click();
 await expect(pager).toContainText('แสดง 81–92');
 await page.getByLabel('เลขหน้าที่ต้องการ').fill('2');await pager.getByRole('button',{name:'ไป',exact:true}).click();
 await expect(pager).toContainText('แสดง 21–40');
 await page.getByLabel('จำนวนรายการต่อหน้า').selectOption('50');
 await expect(pager).toContainText('แสดง 1–50');
 await page.getByRole('button',{name:'เลือกปีประกาศ',exact:true}).click();
 await page.getByRole('button',{name:'ล้างปีที่เลือก',exact:true}).click();
 await expect(page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true})).toBeDisabled();
 await page.getByRole('checkbox',{name:'ปี 2463',exact:true}).check();
 await page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true}).click();
 await expect(pager).toContainText('จาก 2 รายการ');expect(loaded).toContain('1920-09');
 await page.getByRole('button',{name:'เลือกปีประกาศ',exact:true}).click();
 await page.getByRole('button',{name:'ล้างปีที่เลือก',exact:true}).click();
 await page.getByRole('checkbox',{name:'ปี 2568',exact:true}).check();
 await page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true}).click();
 await expect(pager).toContainText('จาก 31 รายการ');
 await page.getByRole('button',{name:'เลือกปีประกาศ',exact:true}).click();
 await page.getByRole('checkbox',{name:'ปี 2569',exact:true}).check();
 await page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true}).click();
 await expect(pager).toContainText('จาก 92 รายการ');
 await page.getByRole('button',{name:'เลือกปีประกาศ',exact:true}).click();
 await page.getByRole('button',{name:'เลือกทุกปี',exact:true}).click();
 await page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true}).click();
 await expect(pager).toContainText('จาก 94 รายการ');
 await expect(page.locator('.year-picker-trigger')).toHaveText('ทุกปี');
 await page.getByRole('button',{name:'เลือกปีประกาศ',exact:true}).click();
 await page.getByRole('button',{name:'ล้างปีที่เลือก',exact:true}).click();
 await page.getByRole('checkbox',{name:'ปี 2463',exact:true}).check();
 await page.getByRole('checkbox',{name:'ปี 2569',exact:true}).check();
 await page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true}).click();
 await expect(pager).toContainText('จาก 63 รายการ');
 await page.getByRole('button',{name:'เลือกปีประกาศ',exact:true}).click();
 await page.getByRole('button',{name:'เลือกทุกปี',exact:true}).click();
 await page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true}).click();
 await expect(pager).toContainText('จาก 94 รายการ');
 await page.getByLabel('ตั้งแต่วันที่ วัน',{exact:true}).selectOption('01');
 await page.getByLabel('ตั้งแต่วันที่ เดือน',{exact:true}).selectOption('01');
 await page.getByLabel('ตั้งแต่วันที่ ปี พ.ศ.',{exact:true}).selectOption('2025');
 await page.getByLabel('ถึงวันที่ วัน',{exact:true}).selectOption('31');
 await page.getByLabel('ถึงวันที่ เดือน',{exact:true}).selectOption('12');
 await page.getByLabel('ถึงวันที่ ปี พ.ศ.',{exact:true}).selectOption('2026');
 await page.locator('.search-main').getByRole('button',{name:'ค้นหาประกาศ'}).click();
 await expect(pager).toContainText('จาก 92 รายการ');
 await page.getByRole('button',{name:'เลือกปีประกาศ',exact:true}).click();
 await page.getByRole('button',{name:'ล้างปีที่เลือก',exact:true}).click();
 await page.getByRole('checkbox',{name:'ปี 2568',exact:true}).check();
 await page.getByRole('button',{name:'ใช้ปีที่เลือก',exact:true}).click();
 await expect(pager).toContainText('จาก 31 รายการ');
 await page.locator('.search-main').getByRole('button',{name:'ค้นหาประกาศ'}).click();
 await expect(pager).toContainText('จาก 31 รายการ');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('default ten-year window loads the latest published data and flags the missing current month',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-26T00:00:00Z'));
 await page.setViewportSize({width:1280,height:900});
 const latest=rows('2026',2);
 await page.route('**/data/*.json',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('manifest.json'))return route.fulfill({json:{revision:'test-revision',source:'https://huggingface.co',syncedAt:'2026-10-26T00:00:00.000Z',currentMonth:'2026-10',latestMonth:'2026-09',complete:true,yearFiles:['2026'],months:[{month:'2026-09',count:2,scanned:2}]}});
  return route.fulfill({json:{revision:'test-revision',complete:true,rows:latest,scanned:2}});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 // The default ten-year window clamps to the published 2026-09 data instead of failing.
 await expect(page.locator('.result-card')).toHaveCount(2);
 await expect(page.locator('.coverage-status')).toContainText('ผลลัพธ์ 2 ประกาศ');
 // The year chip shows the loaded window; the month control stays on the last published month (ค่าปีเป็น ค.ศ. แสดงผลเป็น พ.ศ.)
 await expect(page.locator('.filter-context')).toContainText('2569 พ.ศ. · ทุกเดือน');
 await expect(page.getByLabel('เดือนของฐานข้อมูล เดือน',{exact:true})).toHaveValue('09');
 await expect(page.getByLabel('เดือนของฐานข้อมูล ปี พ.ศ.',{exact:true})).toHaveValue('2026');
 // The unpublished current month is reported instead of being silently hidden.
 await expect(page.locator('.toast.error',{hasText:'ต้นทางยังไม่มีไฟล์เดือน'})).toBeVisible();
});
