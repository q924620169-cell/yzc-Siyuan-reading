const fonts=['font-family','font-size','font-weight','font-style','font-synthesis','font-feature-settings','font-variant-numeric','line-height','letter-spacing','color'];
const blocks=[...fonts,'margin-top','margin-bottom','padding-top','padding-right','padding-bottom','padding-left','border-top','border-right','border-bottom','border-left','border-radius','background-color','box-shadow'];
/** Inert native-shaped samples read the current cascade, never a stored theme preset.
 * They are outside the editor layout and never enter SiYuan's document model. */
export class HostTypography {
  private probe?:HTMLElement;private signature='';
  private styles=new Map<string,Record<string,string>>();
  private samples():HTMLElement{
    if(this.probe?.isConnected)return this.probe;
    const host=document.createElement('div');host.className='protyle rss-typography-probe';host.inert=true;host.setAttribute('aria-hidden','true');host.style.cssText='position:fixed;left:-10000px;top:0;width:700px;visibility:hidden;pointer-events:none;contain:layout style paint;';
    host.innerHTML='<div class="protyle-title"><div class="protyle-title__input">Title</div></div><div class="protyle-content"><div class="protyle-wysiwyg"><div class="p" data-node-id="rss-probe-p" data-type="NodeParagraph">Text <span data-type="a">Link</span> <span data-type="u">Underline</span> <span data-type="strong">Bold</span> <span data-type="code">Code</span></div><div class="p" data-node-id="rss-probe-next" data-type="NodeParagraph">Next</div>'+[1,2,3,4,5,6].map(n=>`<div class="h${n}" data-node-id="rss-probe-h${n}" data-type="NodeHeading" data-subtype="h${n}">Heading</div>`).join('')+'<div class="bq" data-node-id="rss-probe-quote" data-type="NodeBlockquote"><div class="p" data-node-id="rss-probe-qp" data-type="NodeParagraph">Quote</div></div><div class="list" data-node-id="rss-probe-list" data-type="NodeList"><div class="li" data-node-id="rss-probe-li" data-type="NodeListItem"><div class="p" data-node-id="rss-probe-lp" data-type="NodeParagraph">Item</div></div><div class="li" data-node-id="rss-probe-li2" data-type="NodeListItem"><div class="p" data-type="NodeParagraph">Next</div></div></div><div class="code-block" data-node-id="rss-probe-pre" data-type="NodeCodeBlock"><div class="hljs">Code</div></div><div data-node-id="rss-probe-table" data-type="NodeTable"><table><tbody><tr><th>Head</th><td>Cell</td></tr></tbody></table></div></div></div>';
    document.body.append(host);this.probe=host;return host;
  }
  sync(body:HTMLElement|undefined,title?:HTMLElement|null):void{
    if(!body)return;const probe=this.samples(),editor=probe.querySelector<HTMLElement>('.protyle-wysiwyg')!;
    const native=[...document.querySelectorAll<HTMLElement>('.protyle .protyle-wysiwyg')].find(e=>!probe.contains(e)&&!e.classList.contains('rss-content')&&!e.classList.contains('rss-reader-body'));
    // Per-editor font overrides (including SiYuan's user settings) precede the sample blocks.
    if(native){const style=getComputedStyle(native);for(const k of fonts)editor.style.setProperty(k,style.getPropertyValue(k));}else for(const k of fonts)editor.style.removeProperty(k);
    const read=(selector:string,props=blocks)=>{const style=getComputedStyle(probe.querySelector(selector)!);return Object.fromEntries(props.map(k=>[k,style.getPropertyValue(k)]));};
    const next=new Map<string,Record<string,string>>([[':root',read('.protyle-wysiwyg',fonts)],['p',read('[data-node-id="rss-probe-p"]')],['p+p',read('[data-node-id="rss-probe-next"]')],...([1,2,3,4,5,6].map(n=>['h'+n,read('.h'+n)]) as [string,Record<string,string>][]),['blockquote',read('.bq')],['blockquote p',read('[data-node-id="rss-probe-qp"]')],['li',read('[data-node-id="rss-probe-li"]')],['li+li',read('[data-node-id="rss-probe-li2"]')],['li p',read('[data-node-id="rss-probe-lp"]')],['pre',read('.code-block')],['pre code',read('.hljs',[...blocks,'display','white-space'])],['table',read('[data-type=NodeTable]')],['th',read('th')],['td',read('td')],['a',read('[data-type="a"]',['color','text-decoration','text-underline-offset','text-decoration-thickness','text-decoration-skip-ink','border-bottom'])],['u',read('[data-type="u"]',['color','text-decoration','text-underline-offset','text-decoration-thickness','text-decoration-skip-ink','border-bottom'])],['strong,b',read('[data-type="strong"]',['color','font-weight'])],['code:not(pre code)',read('[data-type="code"]')],[':title',read('.protyle-title__input',fonts)]]);
    const signature=JSON.stringify([...next]);if(signature!==this.signature){this.styles=next;this.signature=signature;}
    const desired=new Map<HTMLElement,Record<string,string>>(),merge=(node:HTMLElement,values:Record<string,string>)=>desired.set(node,{...desired.get(node),...values});
    for(const[selector,values]of this.styles){if(selector===':root')merge(body,values);else if(selector===':title'){if(title)merge(title,values);}else body.querySelectorAll<HTMLElement>(selector).forEach(node=>merge(node,values));}
    // Pairing is a reader-only concept; it must not stack two native block margins.
    body.querySelectorAll<HTMLElement>('.rss-bilingual-pair').forEach(pair=>{for(const child of pair.children)if(child instanceof HTMLElement)merge(child,{'margin-top':child.classList.contains('rss-translated-block')?'4px':'0px','margin-bottom':'0px'});});
    for(const[node,values]of desired)for(const[k,v]of Object.entries(values))if(node.style.getPropertyValue(k)!==v)node.style.setProperty(k,v);
  }
  dispose():void{this.probe?.remove();this.probe=undefined;this.styles.clear();}
}
