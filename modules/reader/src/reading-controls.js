import{el,button,report}from'./dom.js';
import{NativePDF}from'./native-pdf.js';

const modes=new Set(['auto','page-actual','page-fit','page-width','page-height']);
export function readingZoom(value){
 const mode=typeof value==='object'?value?.mode:value;
 if(modes.has(mode))return{mode};
 const scale=Number(typeof value==='object'?value?.scale:value);
 if(Number.isFinite(scale)&&scale>=.1&&scale<=10)return{mode:'percent',scale:Math.round(scale*10000)/10000};
 return{mode:'page-actual'};
}
export function zoomValue(zoom){return zoom.mode==='percent'?zoom.scale:zoom.mode;}
export function textScale(zoom){return zoom.mode==='percent'?zoom.scale:1;}
const modeLabels={auto:'自动缩放','page-actual':'实际大小','page-fit':'适合页面','page-width':'适合宽度','page-height':'适合高度'};

/** One persistent preference per book, and one temporary reading session. */
export class ReadingControls{
 constructor(plugin){this.plugin=plugin;this.ui=plugin.ui;this.maximized=false;}
 get scale(){return textScale(this.zoom||readingZoom());}
 prepare(book){
  if(this.bookID!==book.id)this.maximized=false;
  this.transitioning=true;
  this.native?.dispose();this.native=undefined;
  this.ui.root.classList.remove('yr-maximized');
 }
 begin(book,envelope){
  this.bookID=book.id;this.envelope=envelope;
  this.zoom=readingZoom(envelope.zoom);
  this.transitioning=false;
 }
 changeZoom(value){
  const zoom=readingZoom(value);
  if(!this.envelope||JSON.stringify(zoom)===JSON.stringify(this.envelope.zoom))return;
  this.zoom=zoom;this.envelope.zoom=zoom;
  this.paintZoom();this.ui.syncTheme();
  clearTimeout(this.zoomTimer);
  const bookID=this.bookID,envelope=this.envelope;
  this.zoomTimer=setTimeout(()=>this.ui.library.saveState(bookID,envelope).catch(report),400);
 }
 clearSave(){clearTimeout(this.zoomTimer);}
 reflowTools(){
  const tools=el('div','yr-reading-controls');
  this.select=el('select','b3-select yr-scale-select');
  this.select.setAttribute('aria-label','阅读缩放');
  for(const scale of [.5,.75,.9,1,1.1,1.25,1.5,1.75,2,3,4]){
   const option=el('option','',Math.round(scale*100)+'%');option.value=String(scale);this.select.append(option);
  }
  this.select.onchange=()=>this.changeZoom(this.select.value);
  this.maxButton=button('最大化',()=>this.toggleMaximize(),'iconFullscreen');
  this.maxButton.classList.add('yr-maximize');
  tools.append(this.select,this.maxButton);this.paintZoom();this.paintMaximize();return tools;
 }
 paintZoom(){
  if(!this.select)return;
  this.select.querySelector('[data-current-zoom]')?.remove();
  const value=String(this.zoom.mode==='page-actual'?1:zoomValue(this.zoom));
  if(![...this.select.options].some(o=>o.value===value)){
   const option=el('option','',modeLabels[value]||Math.round(this.zoom.scale*100)+'%');
   option.value=value;option.dataset.currentZoom='';this.select.prepend(option);
  }
  this.select.value=value;
 }
 paintMaximize(){
  const button=this.maxButton;if(!button)return;
  const label=this.maximized?'还原':'最大化';button.title=label;
  button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(this.maximized));
  button.querySelector('use').setAttribute('href',this.maximized?'#iconFullscreenExit':'#iconFullscreen');
 }
 toggleMaximize(){this.maximized=!this.maximized;this.sync();}
 bindPDF(tab){
  this.native?.dispose();
  this.native=new NativePDF(tab,{
   zoom:this.zoom,
   ui:this.ui,
   signal:this.plugin.stop.signal,
   zoomChanged:value=>this.changeZoom(value),
   maximizeChanged:value=>{this.maximized=value;this.paintMaximize();},
  });
  this.sync();
 }
 sync(){
  if(this.transitioning)return;
  const active=this.plugin.isRoomTab(this.plugin.host.getActiveTab())&&(!this.plugin.bridge||this.plugin.host.active);
  this.native?.sync(active&&this.ui.pdfReading,this.maximized);
  const reflow=!!(active&&this.ui.view&&this.maximized);
  const root=this.ui.root;
  if(root.classList.contains('yr-maximized')!==reflow){
   const cfi=this.ui.state?.location?.cfi,view=this.ui.view;
   root.style.setProperty('--yr-maximized-top',Math.max(0,document.querySelector('#toolbar')?.getBoundingClientRect().bottom||0)+'px');
   root.classList.toggle('yr-maximized',reflow);
   if(view)requestAnimationFrame(()=>{
    if(this.ui.view!==view)return;
    this.ui.syncTheme();
    if(cfi)void view.goTo(cfi).catch(report);
   });
  }
  this.paintMaximize();
 }
 end(){
  this.clearSave();this.native?.dispose();this.native=undefined;
  this.maximized=false;this.transitioning=false;this.bookID=undefined;this.envelope=undefined;
  this.select=undefined;this.maxButton=undefined;
  this.ui.root.classList.remove('yr-maximized');this.ui.root.style.removeProperty('--yr-maximized-top');
 }
}
