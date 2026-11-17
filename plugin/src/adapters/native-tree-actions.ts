/** Keep the host header and its event handlers intact. Only its placement and
 * redundant title/minimize visibility change while unified navigation is on. */
export class NativeTreeActions {
  private headers=new Map<HTMLElement,{tree:HTMLElement;next:ChildNode|null}>();
  mount(tree:HTMLElement,heading:HTMLElement):void {
    const header=tree.querySelector<HTMLElement>(':scope>.block__icons');
    if(!header)return;
    this.headers.set(header,{tree,next:header.nextSibling});
    header.classList.add('yzc-native-tree-actions');heading.append(header);
  }
  dispose():void {
    for(const[header,{tree,next}]of this.headers){
      header.classList.remove('yzc-native-tree-actions');
      if(header.isConnected&&tree.isConnected&&tree.contains(header))tree.insertBefore(header,next?.parentNode===tree?next:tree.firstChild);
    }
    this.headers.clear();
  }
}
