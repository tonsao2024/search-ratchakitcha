export function pageItems(page,total){
 const values=[...new Set([1,total,page-1,page,page+1].filter(n=>n>=1&&n<=total))].sort((a,b)=>a-b);
 const items=[];
 for(const n of values){const previous=items.at(-1);if(typeof previous==='number'&&n-previous>1)items.push(`gap-${n}`);items.push(n)}
 return items;
}
export function requestedPage(value,total){
 if(!/^\d+$/.test(String(value)))return null;
 const n=Number(value);return Number.isSafeInteger(n)&&n>=1&&n<=total?n:null;
}
