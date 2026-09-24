import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {normalizeRecord} from '../src/dataset.js';
const snapshot=JSON.parse(await readFile(new URL('../data/verified-snapshot.json',import.meta.url),'utf8'));
for(const width of [360,390,768,1280]){
 test(`Readable text and reflow at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/search?*',route=>route.fulfill({json:{rows:snapshot.records.map(normalizeRecord),month:'2026-09',complete:true,stale:false,connectedAt:new Date().toISOString()}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.document-title').first()).toBeVisible();
  const size=selector=>page.locator(selector).first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  expect(await size('.document-title')).toBeGreaterThanOrEqual(18);
  expect(await size('.card-meta')).toBeGreaterThanOrEqual(15);
  expect(await size('.category')).toBeGreaterThanOrEqual(16);
  expect(await size('.search-main input')).toBeGreaterThanOrEqual(16);
  const noOverflow=async()=>{
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right}))}));
   expect(layout.scroll,JSON.stringify(layout)).toBeLessThanOrEqual(layout.width+1);
  };
  await noOverflow();
  await page.getByRole('button',{name:'ค้นหาขั้นสูง'}).click();
  await noOverflow();
  await page.getByRole('button',{name:'มุมมองตาราง'}).click();
  expect(await size('.document-title')).toBeGreaterThanOrEqual(18);
  await noOverflow();
  await page.locator('.document-title').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await size('.document-text')).toBeGreaterThanOrEqual(18);
  await noOverflow();
  await page.getByRole('button',{name:'ปิด',exact:true}).click();
  await page.getByRole('button',{name:'สลับโหมดสี'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.evaluate(()=>document.documentElement.style.fontSize='125%');
  await noOverflow();
  expect(await size('.document-title')).toBeGreaterThanOrEqual(22.5);
 });
}
