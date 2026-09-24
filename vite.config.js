import { defineConfig } from 'vite';
export default defineConfig({base:process.env.VITE_BASE_PATH||'/',server:{host:'0.0.0.0',allowedHosts:true,proxy:{'/api':'http://127.0.0.1:3001'}}});
