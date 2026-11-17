import{safeAsset}from'./model.js';
const colors=[['#dde4de','#33413c'],['#e6dfd3','#4e4537'],['#dce1e7','#37434e'],['#e7dcda','#554540'],['#e1dfe9','#484155']];
const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const coverVersion='generated-cover-v3';
export const isTextCover=path=>safeAsset(path)&&/^assets\/yzc-reader\/books\/[^/]+\/cover\/generated-cover(?:-[^/]+)?\.svg$/.test(path);
export function coverLines(title,measure,width=242,limit=5){
 const lines=[];let line='';
 for(const {segment}of new Intl.Segmenter('zh',{granularity:'word'}).segment(title||'')){
  if(measure(line+segment)>width&&line.trim()){lines.push(line.trim());line='';}
  for(const character of segment){
   if(measure(line+character)>width&&line){lines.push(line.trim());line='';}
   line+=character;
  }
 }
 if(line.trim())lines.push(line.trim());
 if(lines.length>limit){
  lines.length=limit;
  let last=lines[limit-1];while(last&&measure(last+'…')>width)last=[...last].slice(0,-1).join('');
  lines[limit-1]=last+'…';
 }
 return lines;
}
export function textCover(book){
 const seed=parseInt(book.fingerprint?.replace(/^pdf1-/,'').slice(0,4)||'0',16);
 const[background,color]=colors[(Number.isFinite(seed)?seed:0)%colors.length];
 const ctx=document.createElement('canvas').getContext('2d');ctx.font='500 38.2px sans-serif';
 const lines=coverLines(book.title,text=>ctx.measureText(text).width);
 ctx.font='18px sans-serif';const author=coverLines(book.author,text=>ctx.measureText(text).width,242,1)[0]||'';
 return new File([`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="${background}"></rect><g fill="${color}" font-family="sans-serif"><text x="28" y="38" font-size="16" opacity=".6">${escape(book.format)}</text>${lines.map((s,i)=>`<text x="28" y="${230-(lines.length-1)*29.5+i*59}" font-size="38.2" font-weight="500">${escape(s)}</text>`).join('')}<text x="28" y="416" font-size="18" opacity=".65">${escape(author)}</text></g></svg>`],'generated-cover.svg',{type:'image/svg+xml'});
}
export async function ensureTextCovers(library){
 if(library.coverUpdating)return library.coverUpdating;
 const job=(async()=>{for(const book of library.books){
  if(safeAsset(book.cover)&&(!isTextCover(book.cover)||book.cover.includes('/'+coverVersion)))continue;
  const previous=book.cover,file=await library.persist(textCover(book),book.id,coverVersion);
  if(library.books.find(current=>current.id===book.id)?.cover!==previous)continue;
  await library.update(book,{cover:file});
 }})();
 library.coverUpdating=job;
 try{await job;}finally{if(library.coverUpdating===job)library.coverUpdating=undefined;}
}
