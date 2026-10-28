import {test,expect} from '@playwright/test';
import {normalizeRecord} from '../src/dataset.js';

// On-demand OCR ("OCR ฉบับนี้") for a notice that has no text yet: the dialog
// offers the button, polls /api/ocr-one, then shows the text plus the source
// badge on the card. Runs against the dev build (API mode), with both the
// search and OCR endpoints intercepted.
const withText={id:'with-text',doctitle:'ประกาศแต่งตั้ง บุคลากรมีข้อความ',publishDate:'2026-09-01',bookNo:'1',section:'1',category:'ทั่วไป',source_url:'https://example.test/with.pdf',pdf_file:'with.pdf'};
const noText={id:'no-text',doctitle:'ประกาศแต่งตั้ง บุคลากรไม่มีข้อความ',publishDate:'2026-09-01',bookNo:'1',section:'1',category:'ทั่วไป',source_url:'https://example.test/notext.pdf',pdf_file:'notext.pdf'};
const DEMAND_TEXT='ข้อความที่สร้างจาก OCR ในเครื่องของระบบ';

async function setup(page){
 await page.route('**/api/search?*',route=>route.fulfill({json:{rows:[withText,noText].map(normalizeRecord),month:'2026-09',complete:true,stale:false,connectedAt:new Date().toISOString()}}));
 await page.route('**/api/ocr-one',async route=>{
  const payload=route.request().postDataJSON();
  expect(payload.id).toBe('no-text');
  expect(payload.pdf).toBe('https://example.test/notext.pdf');
  await route.fulfill({json:{jobId:'ocr-test-1'}});
 });
 let polls=0;
 await page.route('**/api/ocr-one/ocr-test-1',route=>{
  polls++;
  return route.fulfill({json:polls<2?{id:'ocr-test-1',status:'running'}:{id:'ocr-test-1',status:'done',result:{text:DEMAND_TEXT,source:'ocr',pages:1,month:'2026-09'}}});
 });
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.document-title')).toHaveCount(2);
}

test('on-demand OCR fetches text for a notice without any, then badges the source',async({page})=>{
 await page.setViewportSize({width:1280,height:900});
 await setup(page);
 // The notice without text shows the demand offer, not a dead end.
 await page.locator('.document-title').nth(1).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByText('ยังไม่มีข้อความ OCR')).toBeVisible();
 await expect(dialog.getByText('ไฟล์นี้ยังไม่มีข้อความในฐานข้อมูล')).toBeVisible();
 const run=dialog.getByRole('button',{name:'OCR ฉบับนี้',exact:true});
 await expect(run).toBeVisible();
 await run.click();
 // While the job is in flight the button area shows progress.
 await expect(dialog.getByText('กำลังสร้างข้อความจากไฟล์ PDF…')).toBeVisible();
 // The job finishes (mocked), the reader shows the text and the notice changes.
 await expect(page.getByRole('region',{name:'ข้อความ OCR',exact:true})).toContainText(DEMAND_TEXT);
 await expect(dialog.getByText('ข้อความจาก OCR ในเครื่อง อาจคลาดเคลื่อน')).toBeVisible();
 // Close the dialog: the card keeps the text and gains the local source badge.
 await page.keyboard.press('Escape');
 await expect(page.locator('.result-card').nth(1)).toContainText('OCR ในเครื่อง');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('no demand button appears for notices that already have text',async({page})=>{
 await page.setViewportSize({width:1280,height:900});
 await setup(page);
 await page.locator('.document-title').first().click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByText('ข้อความ OCR อาจคลาดเคลื่อน')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'OCR ฉบับนี้',exact:true})).toHaveCount(0);
});
