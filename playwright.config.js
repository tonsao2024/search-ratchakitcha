import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',testMatch:'**/*.pw.js',reporter:process.env.CI?'github':'list',
 use:{baseURL:'http://127.0.0.1:4180',headless:true},
 webServer:{command:'npx vite --host 0.0.0.0 --port 4180 --strictPort',url:'http://127.0.0.1:4180',reuseExistingServer:!process.env.CI},
});
