export const READER_DEFAULTS={font:'sans',size:18};
export const READER_FONTS={sans:"'Noto Sans Thai', sans-serif",serif:"'Noto Serif Thai', serif",mono:"ui-monospace, 'Noto Sans Thai', monospace"};
export function readerSettings(value){
 return {font:Object.hasOwn(READER_FONTS,value?.font)?value.font:'sans',size:typeof value?.size==='number'&&Number.isFinite(value.size)?Math.max(14,Math.min(36,Math.round(value.size))):18};
}
// Literal, Unicode-aware matches: no HTML injection and no user-supplied regex.
// AND/OR highlight each term; exact mode highlights the entire phrase.
export function findOcrMatches(text,query,mode='all'){
 const q=query.trim();if(!q||!text)return [];
 const terms=[...new Set(mode==='exact'?[q]:q.split(/\s+/))].sort((a,b)=>b.length-a.length);
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const regex=new RegExp(terms.map(escape).join('|'),'giu');
 return Array.from(text.matchAll(regex),m=>({start:m.index,end:m.index+m[0].length}));
}
export function ocrSegments(text,matches){
 const parts=[];let cursor=0;
 matches.forEach((match,index)=>{if(match.start>cursor)parts.push({text:text.slice(cursor,match.start)});parts.push({text:text.slice(match.start,match.end),match:index});cursor=match.end});
 if(cursor<text.length)parts.push({text:text.slice(cursor)});
 return parts;
}
