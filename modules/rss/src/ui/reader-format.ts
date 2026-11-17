/** Display-only cleanup; original source, translation hashes and trusted URLs remain intact. */
export function readerHtml(html:string):string{
  const doc=new DOMParser().parseFromString(html,'text/html'),walk=doc.createTreeWalker(doc.body,4);
  while(walk.nextNode()){const text=walk.currentNode as Text;if(!text.parentElement?.closest('pre,code,kbd,samp,math'))text.data=text.data.replace(/\uFFFC/g,'');}
  return doc.body.innerHTML;
}
