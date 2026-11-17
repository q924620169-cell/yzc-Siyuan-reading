import{nativeScrollbarCSS}from'./host-scrollbar.js';
/** Measure the host cascade at the reader viewport's actual width. */
const fonts=['font-family','font-size','font-weight','font-style','font-feature-settings','line-height','letter-spacing','color'];
const blocks=[...fonts,'margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','border-top','border-right','border-bottom','border-left','border-radius','background-color','text-align','text-indent'];
export class Typography {
 constructor(){
  this.probe=document.createElement('div');this.probe.className='protyle yr-probe';this.probe.inert=true;this.probe.setAttribute('aria-hidden','true');
  this.probe.style.cssText='position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;contain:layout style paint;height:500px';
  this.content=document.createElement('div');this.content.className='protyle-content';this.content.dataset.paddingMode='responsive';
  this.editor=document.createElement('div');this.editor.className='protyle-wysiwyg';
  const p=(text,id)=>`<div data-node-id="yr-probe-${id}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">${text}</div></div>`;
  this.editor.innerHTML=p('正文 <span data-type="strong">加粗</span> <span data-type="em">斜体</span> <span data-type="a">链接</span> <span data-type="code">代码</span>','p')+p('第二段','next')+[1,2,3,4,5,6].map(n=>`<div data-node-id="yr-probe-h${n}" data-type="NodeHeading" data-subtype="h${n}" class="h${n}"><div contenteditable="true">标题</div></div>`).join('')+`<div data-node-id="yr-probe-quote" data-type="NodeBlockquote" class="bq">${p('引用','quote-p')}</div><div data-node-id="yr-probe-list" data-type="NodeList" class="list"><div data-node-id="yr-probe-li" data-type="NodeListItem" class="li">${p('列表','li-p')}</div></div><div data-node-id="yr-probe-code" data-type="NodeCodeBlock" class="code-block"><div class="hljs">code</div></div><div data-node-id="yr-probe-table" data-type="NodeTable"><table><tbody><tr><th>标题</th><td>单元格</td></tr></tbody></table></div>`;
  this.content.append(this.editor);this.probe.append(this.content);document.body.append(this.probe);
  this.editor.insertAdjacentHTML('beforeend',`<div data-node-id="yr-probe-inline" data-type="NodeParagraph" class="p"><div contenteditable="true"><span data-type="u">下划线</span> <span data-type="s">删除线</span></div></div><div data-node-id="yr-probe-ul" data-type="NodeList" data-subtype="u" class="list"><div data-type="NodeListItem" data-subtype="u" class="li"><div class="protyle-action">•</div>${p('无序项目','ul-p')}</div></div><div data-node-id="yr-probe-ol" data-type="NodeList" data-subtype="o" class="list"><div data-type="NodeListItem" data-subtype="o" class="li"><div class="protyle-action">1.</div>${p('有序项目','ol-p')}</div></div><div data-node-id="yr-probe-hr" data-type="NodeThematicBreak" class="hr"><div></div></div>`);
  this.editor.querySelectorAll('.li').forEach((node,i)=>node.dataset.nodeId='yr-probe-li-'+i);
  this.editor.querySelector('table').innerHTML='<thead><tr><th>标题</th><th>内容</th></tr></thead><tbody><tr><td>第一项</td><td>正文</td></tr><tr><td>第二项</td><td>正文</td></tr></tbody>';
 }
 read(viewport,scale=1){
  this.probe.style.width=(viewport?.clientWidth||this.probe.parentElement.clientWidth)+'px';this.content.style.height='500px';
  if(window.siyuan?.config?.editor?.fullWidth)this.content.dataset.fullwidth='true';else delete this.content.dataset.fullwidth;
  const native=[...document.querySelectorAll('.protyle .protyle-wysiwyg')].find(e=>!e.closest('.yr-probe,.rss-typography-probe,.rss-tab,.yr-database-host')&&e.checkVisibility());
  if(native){const style=getComputedStyle(native);for(const k of fonts)this.editor.style.setProperty(k,style.getPropertyValue(k));}else for(const k of fonts)this.editor.style.removeProperty(k);
  const read=(selector,props)=>{const n=selector===':root'?this.editor:this.editor.querySelector(selector),s=getComputedStyle(n);return Object.fromEntries(props.map(k=>{let value=s.getPropertyValue(k);if(['font-size','line-height','letter-spacing'].includes(k)&&/^-?[\d.]+px$/.test(value))value=parseFloat(value)*scale+'px';return[k,value];}));};
  const mappings=[['body',':root',fonts],['p','.p',blocks],['p+p','[data-node-id=yr-probe-next]',blocks],...[1,2,3,4,5,6].map(n=>['h'+n,'.h'+n,blocks]),['blockquote','.bq',blocks],['blockquote p','[data-node-id=yr-probe-quote-p]',blocks],['li','.li',blocks],['li p','[data-node-id=yr-probe-li-p]',blocks],['pre','.code-block',blocks],['pre code','.hljs',blocks],['th','th',blocks],['td','td',blocks],['a','[data-type=a]',['color','text-decoration','text-underline-offset','border-bottom','padding-bottom']],['strong,b','[data-type=strong]',['font-weight','color']],['em,i','[data-type=em]',['font-style','color']],['code:not(pre code)','[data-type=code]',blocks]];
  const rules=mappings.map(([selector,sample,props])=>`${selector}{${Object.entries(read(sample,props)).map(([k,v])=>k+':'+v).join(';')}}`);
  const inline=['color','font-weight','font-style','text-decoration','text-underline-offset','border-bottom','padding-bottom'];
  for(const[selector,sample,props]of[['u','[data-type=u]',inline],['s,del','[data-type=s]',inline],['ul','[data-node-id=yr-probe-ul]',blocks],['ol','[data-node-id=yr-probe-ol]',blocks],['hr','.hr',blocks]])rules.push(`${selector}{${Object.entries(read(sample,props)).map(([k,v])=>k+':'+v).join(';')}}`);
  // Native quotes use an absolutely positioned ::before, not a border on the block.
  const quote=this.editor.querySelector('.bq'),before=getComputedStyle(quote,'::before');
  const pseudoProps=['content','position','display','top','bottom','left','width','background-color','border-top','border-right','border-bottom','border-left','border-radius','opacity'];
  const quoteBefore=Object.fromEntries(pseudoProps.map(k=>[k,before.getPropertyValue(k)]));
  const pseudoCSS=Object.entries(quoteBefore).map(([k,v])=>k+':'+v).join(';');
  const rule=this.editor.querySelector('.hr>div'),hrStyle=getComputedStyle(rule.parentElement),ruleStyle=getComputedStyle(rule,'::after');
  const listParagraph=read('[data-node-id=yr-probe-ul] .p',blocks),listIndent=listParagraph['margin-left'];
  const barePadding=['top','right','bottom','left'].map(side=>'padding-'+side+':'+listParagraph['padding-'+side]).join(';');
  rules.push(`blockquote{position:relative;display:${getComputedStyle(quote).display};flex-direction:${getComputedStyle(quote).flexDirection}}blockquote::before{${pseudoCSS};height:auto;right:auto;pointer-events:none}`);
  rules.push(`ul,ol{padding-left:${listIndent};display:flex;flex-direction:column;list-style-position:outside}ul{list-style-type:disc}ol{list-style-type:decimal}li{padding-left:0}li:not(:has(>p)){${barePadding}}li p{margin-left:0;margin-right:0}li:not(:has(>p))>ul,li:not(:has(>p))>ol{margin-left:calc(-1 * ${listParagraph['padding-left']})}`);
  rules.push(`hr{border:0;position:relative;box-sizing:border-box;height:${rule.parentElement.getBoundingClientRect().height}px}hr::after{content:${ruleStyle.content};position:absolute;background:${ruleStyle.backgroundColor};height:${ruleStyle.height};top:calc(${ruleStyle.top} + ${hrStyle.paddingTop});left:${hrStyle.paddingLeft};right:calc(${ruleStyle.right} + ${hrStyle.paddingRight})}`);
  const computed=getComputedStyle(this.editor),padding={left:parseFloat(computed.paddingLeft)||0,right:parseFloat(computed.paddingRight)||0};
  const width=Math.max(1,this.editor.clientWidth-padding.left-padding.right);
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--b3-theme-background').trim();
  const faces=[];const scan=(list,base)=>{for(const r of list){if(r.type===CSSRule.FONT_FACE_RULE){let safe=true;const css=r.cssText.replace(/url\(["']?([^"')]+)["']?\)/g,(_,src)=>{const u=new URL(src,base||location.href);if(u.origin!==location.origin&&!u.href.startsWith('data:'))safe=false;return`url("${u.href}")`;});if(safe)faces.push(css);}else if(r.cssRules)scan(r.cssRules,base);}};
  for(const sheet of document.styleSheets)try{scan(sheet.cssRules,sheet.href)}catch{}
  const accent=getComputedStyle(document.querySelector('#dockLeft')||document.documentElement).getPropertyValue('--b3-theme-primary').trim();
  for(const el of[viewport?.closest('.yr-root'),document.querySelector('.yr-sidebar')])if(el)el.style.setProperty('--yr-accent',accent||'var(--b3-theme-primary)');
  const code=read('.hljs',fonts),codePadding=read('.hljs',['padding-top','padding-right','padding-bottom','padding-left']);
  const blockCode=Object.entries({...code,...codePadding}).map(([k,v])=>k+':'+v).join(';');
  return{width,padding,scrollbarCSS:nativeScrollbarCSS(this.content),css:`${faces.join('\n')}html,body{background:${bg};}body{overflow-wrap:anywhere}img,svg,video{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}${rules.join('\n')}
pre{${blockCode};box-sizing:border-box;max-width:100%;overflow-x:auto;overflow-y:hidden;white-space:pre;overflow-wrap:normal;word-break:normal;tab-size:4}
pre code{display:block;padding:0;margin:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;white-space:inherit;overflow-wrap:normal;word-break:normal;min-width:max-content}
html.yr-cursor-hidden,html.yr-cursor-hidden *{cursor:none!important}`};
 }
 dispose(){this.probe.remove();}
}
