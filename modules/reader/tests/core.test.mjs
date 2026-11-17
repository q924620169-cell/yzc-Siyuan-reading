import test from'node:test';import assert from'node:assert/strict';import{decodeText,chapterPattern,cellValue,readValue,safeAsset,nodeID,stableHash}from'../src/model.js';import{Library}from'../src/storage.js';
test('中文编码：UTF-8、GB18030、UTF-16LE',()=>{assert.equal(decodeText(new TextEncoder().encode('第一章 阅读')),'第一章 阅读');assert.equal(decodeText(Uint8Array.from([0xd6,0xd0,0xce,0xc4])),'中文');assert.equal(decodeText(Uint8Array.from([255,254,45,78,135,101])),'中文');});
test('章节识别保守，不把普通叙述当目录',()=>{assert(chapterPattern.test('第一章 初见'));assert(chapterPattern.test('CHAPTER XII. Alice’s Evidence'));assert(!chapterPattern.test('这一章，我们将讨论阅读。'));});
test('数据库字段类型往返',()=>{for(const[type,v]of[['text','作者'],['block','书名'],['select','EPUB'],['mSelect',['历史','文学']],['mAsset','assets/books/a.epub'],['number',42.5],['date',12345]])assert.deepEqual(readValue({type,...cellValue(type,v)}),v);});
test('封面资源使用原生图片类型，原件仍使用文件类型',()=>{assert.equal(cellValue('mAsset','assets/cover.svg').mAsset[0].type,'image');assert.equal(cellValue('mAsset','assets/book.epub').mAsset[0].type,'file');});
test('原件路径不能指向工作空间外部或穿越目录',()=>{assert(safeAsset('assets/yzc-reader/abc/original.epub'));for(const p of['https://evil/a','/data/conf','assets/../conf','assets/%2e%2e/conf','assets/a?x=1'])assert.equal(safeAsset(p),false);});
test('节点 ID 和内容散列稳定',()=>{assert.match(nodeID(),/^\d{14}-[a-z0-9]{7}$/);assert.equal(stableHash('重复标题'),stableHash('重复标题'));});
test('数据库读取不受原生表格过滤、排序和隐藏列影响',async()=>{
 const original=global.fetch;const{schema}=await import('../src/model.js');
 const keyValues=Object.entries(schema).map(([name,[label,type]])=>({key:{id:name,name:label,type},values:[{blockID:'row',type,...cellValue(type,name==='file'?'assets/a.txt':name==='title'?'示例':name==='lists'?['历史']:'')}]}));
 global.fetch=async()=>({json:async()=>({code:0,data:{av:{keyValues}}})});
 try{const lib=new Library();lib.config={avID:'av',keys:{}};await lib.refresh();assert.equal(lib.books.length,1);assert.equal(lib.books[0].title,'示例');assert.deepEqual(lib.books[0].lists,['历史']);}finally{global.fetch=original;}
});
