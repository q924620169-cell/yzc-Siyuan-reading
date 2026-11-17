import {JSDOM} from 'jsdom';
export const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://host.test',pretendToBeVisual:true});
for(const name of ['window','document','DOMParser','XMLSerializer','HTMLElement','Element','Node','CustomEvent','MutationObserver'] as const)
  Object.defineProperty(globalThis,name,{value:(dom.window as unknown as Record<string,unknown>)[name],configurable:true});
