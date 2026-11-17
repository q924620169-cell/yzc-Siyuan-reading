/** Reserve equal sides so the title is centered on the reading viewport. */
export function sizeReadingHeader(header,back,tools){
 const resize=()=>{
  header.toggleAttribute('data-compact',header.clientWidth<700);
  header.toggleAttribute('data-narrow',header.clientWidth<380);
  const side=Math.ceil(Math.max(back.getBoundingClientRect().width,tools.getBoundingClientRect().width));
  if(header.style.getPropertyValue('--yr-reader-side')!==side+'px')header.style.setProperty('--yr-reader-side',side+'px');
 };
 const observer=new ResizeObserver(resize);observer.observe(header);observer.observe(back);observer.observe(tools);resize();
 return()=>observer.disconnect();
}
