import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPDF,pdfFingerprint,verifyPDF} from '../src/pdf.js';
import {scanFolder,planUpdate,persistCourse,courseFormat} from '../src/course.js';

const pdf=(title,body='')=>`%PDF-1.7
1 0 obj
<< /Title (${title}) /Author <FEFF4F5C8005> >>
endobj
${body}
trailer
<< /Info 1 0 R >>
startxref
1
%%EOF
`;
function entry(name,content,modified=1000) {
 const file=new File([content],name.split('/').at(-1),{lastModified:modified});
 Object.defineProperty(file,'webkitRelativePath',{value:'课程/'+name});
 return file;
}

test('PDF metadata reads the referenced Info object and rejects truncated copies',async()=>{
 assert.deepEqual(await inspectPDF(entry('read.pdf',pdf('Book \\(Draft\\)'))),{title:'Book (Draft)',author:'作者'});
 assert.deepEqual(await inspectPDF(entry('fallback.pdf','%PDF-1.7\n%%EOF\n')),{title:'fallback',author:''});
 await assert.rejects(inspectPDF(entry('cut.pdf','%PDF-1.7')),/不完整/);
});

test('PDF fingerprint and response verification agree across chunk boundaries',async()=>{
 const content=pdf('Large','A'.repeat(5*1024*1024));
 const file=entry('read.pdf',content),hash=await pdfFingerprint(file);
 await verifyPDF(new Response(file.stream()),file.size,hash);
 await assert.rejects(verifyPDF(new Response(content.slice(1)),file.size,hash),/大小/);
 await assert.rejects(verifyPDF(new Response(content.replace('Large','Other')),file.size,hash),/校验/);
});

test('mixed course reuses unchanged PDFs, keeps IDs through moves, and retains old versions on change',async()=>{
 const md=entry('01.md','# Intro');
 const before=await scanFolder([md,entry('a/02.pdf',pdf('Moved')),entry('03.pdf',pdf('Old'))]);
 const copies=[];
 const library={
  persistOwned:async(_file,_id,path)=>path,
  persistPDF:async(_file,_id,path)=>{copies.push(path);return path;},
 };
 const {manifest:old}=await persistCourse(library,before,planUpdate(before),null,'course');
 assert.equal(courseFormat(old.articles),'混合格式');
 copies.length=0;
 const scan=await scanFolder([md,entry('b/02.pdf',pdf('Moved')),entry('03.pdf',pdf('New')),entry('bad.pdf','broken')],()=>{},old);
 const plan=planUpdate(scan,old);
 assert.deepEqual(plan.counts,{added:0,changed:1,moved:1,unchanged:1,missing:0});
 const {manifest,failures}=await persistCourse(library,scan,plan,old,'course');
 assert.equal(failures.length,1);
 assert.equal(copies.length,1);
 for(const [oldPath,newPath] of [['03.pdf','03.pdf'],['a/02.pdf','b/02.pdf']]){
  const prior=old.articles.find(a=>a.path===oldPath),next=manifest.articles.find(a=>a.path===newPath);
  assert.equal(next.id,prior.id);
  assert.equal(oldPath===newPath?next.revisions[0].file:next.file,prior.file);
 }
 library.persistPDF=async()=>{throw Error('upload failed');};
 const failed=await persistCourse(library,scan,plan,old,'course');
 assert.equal(failed.failures.length,2);
 assert.deepEqual(failed.manifest.articles.find(a=>a.path==='03.pdf'),old.articles.find(a=>a.path==='03.pdf'));
});
