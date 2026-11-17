/** Read original SFNT metadata without renaming or modifying font files. */
export function fontMetadata(bytes) {
  const b=Buffer.from(bytes),tables={};
  for(let i=0;i<b.readUInt16BE(4);i++){
    const e=12+i*16;tables[b.toString('ascii',e,e+4)]=b.readUInt32BE(e+8);
  }
  const n=tables.name,strings=n+b.readUInt16BE(n+4),names={};
  for(let i=0;i<b.readUInt16BE(n+2);i++){
    const e=n+6+i*12,platform=b.readUInt16BE(e),id=b.readUInt16BE(e+6),length=b.readUInt16BE(e+8),offset=strings+b.readUInt16BE(e+10);
    if(![1,2,5,6,16,17].includes(id))continue;
    const raw=b.subarray(offset,offset+length);
    const value=platform===0||platform===3?Buffer.from(raw).swap16().toString('utf16le'):raw.toString('latin1');
    (names[id]??=[]).includes(value)||names[id].push(value);
  }
  return {weight:b.readUInt16BE(tables['OS/2']+4),names};
}
