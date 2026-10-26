import React,{useState} from 'react';
import {ChevronDown,Check} from 'lucide-react';
export function yearLabel(value){
 if(value===null)return 'ทุกปี';
 const years=[...value].sort().reverse().map(y=>Number(y)+543);
 return years.length>4?`${years.slice(0,4).join(', ')} และอีก ${years.length-4} ปี`:years.join(', ');
}
export default function YearPicker({years,value,disabled,onApply}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(value),[find,setFind]=useState('');
 const list=years.filter(y=>`${Number(y)+543} ${y}`.includes(find.trim()));
 function toggle(year){setDraft(previous=>{const selected=previous===null?years:previous;return selected.includes(year)?selected.filter(y=>y!==year):[...selected,year]})}
 function close(){setOpen(false);setFind('')}
 return <div className="year-picker"><span className="year-picker-label" id="year-picker-label">ปีประกาศ (พ.ศ.)</span><button type="button" className="year-picker-trigger" aria-label="เลือกปีประกาศ" aria-expanded={open} aria-controls="year-picker-options" disabled={disabled} onClick={()=>{if(open)close();else{setDraft(value);setOpen(true)}}}>{yearLabel(value)}<ChevronDown size={16}/></button>
  {open&&<div id="year-picker-options" className="year-picker-options" role="group" aria-labelledby="year-picker-label" onKeyDown={e=>{if(e.key==='Escape'){close();e.currentTarget.parentElement.querySelector('.year-picker-trigger').focus()}}}>
   <div className="year-picker-tools"><button type="button" onClick={()=>setDraft(null)}>เลือกทุกปี</button><button type="button" onClick={()=>setDraft([])}>ล้างปีที่เลือก</button></div>
   <label className="year-all"><input type="checkbox" checked={draft===null} onChange={e=>setDraft(e.target.checked?null:[])}/> ทุกปีที่มีในฐานข้อมูล ({years.length} ปี)</label>
   <input className="year-find" aria-label="ค้นหาปี พ.ศ. หรือ ค.ศ." placeholder="ค้นหาปี พ.ศ. หรือ ค.ศ." value={find} onChange={e=>setFind(e.target.value)}/>
   <div className="year-checkboxes">{list.map(year=><label key={year}><input type="checkbox" aria-label={`ปี ${Number(year)+543}`} checked={draft===null||draft.includes(year)} onChange={()=>toggle(year)}/><span>{Number(year)+543} <small>({year})</small></span></label>)}{!list.length&&<p>ไม่พบปีที่ระบุ</p>}</div>
   <p className="year-picker-hint">{draft===null?'เลือกทุกปีแล้ว • อาจใช้เวลาและข้อมูลดาวน์โหลดมากขึ้น':`เลือก ${draft.length} ปี • กดใช้ปีที่เลือกเพื่อโหลดข้อมูล`}</p>
   <div className="year-picker-actions"><button type="button" className="primary" disabled={draft!==null&&!draft.length} onClick={()=>{onApply(draft===null?null:[...draft].sort().reverse());close()}}><Check size={16}/> ใช้ปีที่เลือก</button><button type="button" onClick={close}>ยกเลิก</button></div>
  </div>}
 </div>
}
