import React,{useState,useMemo,useEffect,useRef} from 'react';
import {Minus,Plus,Maximize2,Minimize2,RotateCcw,ChevronUp,ChevronDown,Search,X} from 'lucide-react';
import {READER_DEFAULTS,READER_FONTS,readerSettings,findOcrMatches,ocrSegments} from './ocr-reader';
const STORAGE='ratcha-ocr-reader';
function initialSettings(){try{return readerSettings(JSON.parse(localStorage.getItem(STORAGE)))}catch{return READER_DEFAULTS}}
export default function OcrReader({text,query,mode,expanded,onExpand}){
 const [settings,setSettings]=useState(initialSettings);
 const [localQuery,setLocalQuery]=useState(query),[active,setActive]=useState(0);
 const content=useRef(null);
 const matches=useMemo(()=>findOcrMatches(text,localQuery,mode),[text,localQuery,mode]);
 const parts=useMemo(()=>ocrSegments(text,matches),[text,matches]);
 const current=matches.length?Math.min(active,matches.length-1):0;
 useEffect(()=>{try{localStorage.setItem(STORAGE,JSON.stringify(settings))}catch{/* Reading still works if storage is unavailable. */}},[settings]);
 useEffect(()=>{setActive(0)},[localQuery,mode,text]);
 useEffect(()=>{
  // Scroll only the OCR pane, not the entire page/dialog; keep controls visible.
  const pane=content.current,mark=pane?.querySelector(`[data-match="${current}"]`);
  if(!pane)return;
  if(mark){const p=pane.getBoundingClientRect(),m=mark.getBoundingClientRect();pane.scrollTo({top:Math.max(0,pane.scrollTop+m.top-p.top-pane.clientHeight/2+m.height/2),behavior:'auto'})}
  else pane.scrollTop=0;
 },[current,matches,expanded,settings]);
 function size(delta){setSettings(p=>readerSettings({...p,size:p.size+delta}))}
 function navigate(delta){if(matches.length)setActive((current+delta+matches.length)%matches.length)}
 return <section className="ocr-reader" aria-label="เครื่องมืออ่าน OCR">
  <div className="ocr-reader-toolbar">
   <label>แบบอักษร <select aria-label="แบบอักษร OCR" value={settings.font} onChange={e=>setSettings(p=>({...p,font:e.target.value}))}><option value="sans">ไม่มีเชิง · Noto Sans Thai</option><option value="serif">มีเชิง · Noto Serif Thai</option><option value="mono">ความกว้างคงที่</option></select></label>
   <div className="ocr-font-controls" role="group" aria-label="ปรับขนาดตัวอักษร OCR"><button type="button" aria-label="ลดขนาดตัวอักษร OCR" disabled={settings.size<=14} onClick={()=>size(-2)}><Minus size={17}/></button><output aria-live="polite" aria-label="ขนาดตัวอักษร OCR">{settings.size} px</output><button type="button" aria-label="เพิ่มขนาดตัวอักษร OCR" disabled={settings.size>=36} onClick={()=>size(2)}><Plus size={17}/></button></div>
   <button type="button" className="reader-reset" title="คืนค่าฟอนต์และขนาดเริ่มต้น" onClick={()=>setSettings(READER_DEFAULTS)}><RotateCcw size={16}/> คืนค่า</button>
   <button type="button" className="reader-expand" aria-pressed={expanded} onClick={onExpand}>{expanded?<Minimize2 size={17}/>:<Maximize2 size={17}/>} {expanded?'ย่อพื้นที่อ่าน':'ขยายพื้นที่อ่าน'}</button>
  </div>
  <div className="ocr-findbar">
   <label className="ocr-find-input"><Search size={17}/><input aria-label="ค้นหาในข้อความ OCR" value={localQuery} onChange={e=>{setLocalQuery(e.target.value);setActive(0)}} disabled={!text} placeholder="ค้นคำในเอกสารนี้…" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();navigate(e.shiftKey?-1:1)}}}/>{localQuery&&<button type="button" aria-label="ล้างคำค้นใน OCR" onClick={()=>setLocalQuery('')}><X size={16}/></button>}</label>
   <div className="ocr-match-nav"><span role="status" aria-live="polite">{!text?'ยังไม่มี OCR':!localQuery.trim()?'ระบุคำเพื่อไฮไลต์':matches.length?`${current+1} / ${matches.length} จุด`:'ไม่พบคำใน OCR'}</span><button type="button" aria-label="คำที่พบก่อนหน้า" disabled={!matches.length} onClick={()=>navigate(-1)}><ChevronUp size={19}/></button><button type="button" aria-label="คำที่พบถัดไป" disabled={!matches.length} onClick={()=>navigate(1)}><ChevronDown size={19}/></button></div>
  </div>
  <p className="ocr-reader-hint">{mode==='exact'?'ไฮไลต์ตรงทั้งวลี':'ไฮไลต์ทุกคำที่ค้นหา'} • Enter: จุดถัดไป / Shift+Enter: จุดก่อนหน้า • การค้นในช่องนี้ไม่เปลี่ยนตัวกรองรายการ</p>
  <div className="document-text ocr-reader-content" ref={content} tabIndex={0} role="region" aria-label="ข้อความ OCR" style={{fontFamily:READER_FONTS[settings.font],fontSize:`${settings.size/16}rem`}}>
   {text?parts.map((part,i)=>part.match===undefined?<React.Fragment key={i}>{part.text}</React.Fragment>:<mark key={i} data-match={part.match} aria-current={part.match===current?'true':undefined} className={part.match===current?'ocr-current-match':''}>{part.text}</mark>):'ยังไม่มีข้อความ OCR ในข้อมูลที่โหลด โปรดเปิด PDF ต้นฉบับด้านล่าง'}
  </div>
 </section>
}
