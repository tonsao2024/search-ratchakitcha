import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',reporter:process.env.CI?'github':'list',
 use:{headless:true},
 projects:[
  {name:'readability',testMatch:'**/readability.pw.js',use:{baseURL:'http://127.0.0.1:4180'}},
  {name:'ocr-reader',testMatch:'**/ocr-reader.pw.js',use:{baseURL:'http://127.0.0.1:4181'}},
  {name:'historical-search',testMatch:'**/history.pw.js',use:{baseURL:'http://127.0.0.1:4181'}},
 ],
 webServer:[
  {command:'npx vite --host 0.0.0.0 --port 4180 --strictPort',url:'http://127.0.0.1:4180',reuseExistingServer:!process.env.CI},
  {command:'VITE_STATIC_DATA=true npx vite --host 0.0.0.0 --port 4181 --strictPort',url:'http://127.0.0.1:4181',reuseExistingServer:!process.env.CI},
 ],
});
