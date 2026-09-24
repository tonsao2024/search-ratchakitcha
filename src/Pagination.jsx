import React,{useState,useEffect} from 'react';
import {ChevronLeft,ChevronRight,ChevronsLeft,ChevronsRight} from 'lucide-react';
import {pageItems,requestedPage} from './pagination';
export default function Pagination({page,pages,total,pageSize,onPage,onSize,notify}){
 const [jump,setJump]=useState(String(page));
 useEffect(()=>setJump(String(page)),[page]);
 function submit(e){e.preventDefault();const target=requestedPage(jump,pages);if(target===null){notify(`กรุณาระบุเลขหน้า 1–${pages}`,'error');return}onPage(target)}
 return <nav className="pagination-panel" aria-label="การเปลี่ยนหน้าผลลัพธ์">
  <div className="pagination-summary"><span aria-live="polite">{total?`แสดง ${(page-1)*pageSize+1}–${Math.min(page*pageSize,total)} จาก ${total.toLocaleString('th-TH')} รายการ`:'ไม่พบรายการ'}</span><label>รายการต่อหน้า <select aria-label="จำนวนรายการต่อหน้า" value={pageSize} onChange={e=>onSize(Number(e.target.value))}>{[10,20,50,100].map(n=><option key={n} value={n}>{n}</option>)}</select></label></div>
  <div className="pagination-navigation"><button aria-label="หน้าแรก" title="หน้าแรก" disabled={page===1||!total} onClick={()=>onPage(1)}><ChevronsLeft size={18}/></button><button aria-label="หน้าก่อนหน้า" disabled={page===1||!total} onClick={()=>onPage(page-1)}><ChevronLeft size={18}/></button><div className="page-numbers">{pageItems(page,pages).map(n=>typeof n==='number'?<button key={n} aria-label={`หน้า ${n}`} aria-current={n===page?'page':undefined} className={n===page?'current':''} onClick={()=>onPage(n)}>{n}</button>:<span key={n} aria-hidden="true">…</span>)}</div><button aria-label="หน้าถัดไป" disabled={page===pages||!total} onClick={()=>onPage(page+1)}><ChevronRight size={18}/></button><button aria-label="หน้าสุดท้าย" title="หน้าสุดท้าย" disabled={page===pages||!total} onClick={()=>onPage(pages)}><ChevronsRight size={18}/></button></div>
  <form className="page-jump" onSubmit={submit}><label htmlFor="jump-page">ไปหน้า</label><input id="jump-page" type="text" inputMode="numeric" value={jump} onChange={e=>setJump(e.target.value)} aria-label="เลขหน้าที่ต้องการ"/><span>จาก {pages.toLocaleString('th-TH')} หน้า</span><button type="submit" disabled={!total}>ไป</button></form>
 </nav>
}
