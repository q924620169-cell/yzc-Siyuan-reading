import test from 'node:test';
import assert from 'node:assert/strict';
import {Library} from '../src/storage.js';
test('a host data notification cannot read a half-created library schema',async()=>{
 const library=new Library(),previous=globalThis.fetch;let release,reads=0;
 library.initializing=new Promise(resolve=>release=resolve);
 globalThis.fetch=async()=>{reads++;return Response.json({version:1,lists:[]});};
 try{const load=library.load();await new Promise(r=>setTimeout(r,10));assert.equal(reads,0);release();await load;assert.equal(reads,1);}
 finally{globalThis.fetch=previous;}
});
test('fresh notebook creation retries only the host indexUnavailable response using one document path',async()=>{
 const library=new Library(),previous=globalThis.fetch;let creates=0;const paths=[];
 globalThis.fetch=async(route,options)=>{const body=JSON.parse(options.body);
  if(route.endsWith('lsNotebooks'))return Response.json({code:0,data:{notebooks:[]}});
  if(route.endsWith('createNotebook'))return Response.json({code:0,data:{notebook:{id:'new-notebook'}}});
  if(route.endsWith('createDocWithMd')){paths.push(body.path);creates++;return Response.json(creates<3?{code:-1,msg:'document metadata is not ready',data:{reason:'indexUnavailable'}}:{code:0,data:'stable-document'});}
  throw Error(route);
 };
 library.completeSchema=async()=>{};
 try{await library.initialize();assert.equal(creates,3);assert.deepEqual(paths,['/藏书','/藏书','/藏书']);assert.equal(library.config.docID,'stable-document');}
 finally{globalThis.fetch=previous;}
});
