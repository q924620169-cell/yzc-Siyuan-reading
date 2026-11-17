/** Reuse the effective host rules, including hover, inside the isolated renderer. */
export function nativeScrollbarCSS(sample){
 const rules=[];
 const walk=list=>{for(const rule of list){
  if(rule.media&&!matchMedia(rule.conditionText).matches)continue;
  if(rule.type===CSSRule.SUPPORTS_RULE&&!CSS.supports(rule.conditionText))continue;
  if(rule.selectorText?.includes('::-webkit-scrollbar')){
   const selectors=[];
   for(const selector of rule.selectorText.split(',')){
    const index=selector.indexOf('::-webkit-scrollbar');if(index<0)continue;
    const base=selector.slice(0,index).trim(),states=base.match(/:(?:hover|active|focus-visible|focus-within|focus)\b/g)||[];
    const match=base.replace(/:(?:hover|active|focus-visible|focus-within|focus)\b/g,'')||'*';
    try{if(sample.matches(match))selectors.push('#container'+states.join('')+selector.slice(index));}catch{}
   }
   if(selectors.length)rules.push(selectors.join(',')+'{'+rule.style.cssText+'}');
  }else if(rule.cssRules)walk(rule.cssRules);
 }};
 for(const sheet of document.styleSheets){if(sheet.disabled||sheet.media.length&&!matchMedia(sheet.media.mediaText).matches)continue;try{walk(sheet.cssRules);}catch{}}
 const computed=getComputedStyle(sample);
 return '#container{scrollbar-width:'+computed.scrollbarWidth+';scrollbar-color:'+computed.scrollbarColor+'}'+rules.join('\n');
}
