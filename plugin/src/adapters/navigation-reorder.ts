import {Menu} from 'siyuan';
import type {NavigationPreferences,OrderGroup} from '../navigation-order';
import {draggableNavigation} from './navigation-drag';

/** Pointer drag, keyboard and menu entry points share the same preferences. */
export function reorderable(button:HTMLButtonElement,id:string,group:OrderGroup,prefs:NavigationPreferences):()=>void {
  button.draggable=false;button.dataset.orderId=id;button.classList.add('yzc-orderable');
  button.title+=(button.title?' · ':'')+'拖动排序；Alt + 方向键调整顺序';
  button.addEventListener('dragstart',event=>event.preventDefault());
  button.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('text/x-yzc-navigation')){event.preventDefault();button.dataset.dropTarget='true';}});
  button.addEventListener('dragleave',()=>delete button.dataset.dropTarget);
  button.addEventListener('drop',event=>{
    event.preventDefault();delete button.dataset.dropTarget;
    try{const source=JSON.parse(event.dataTransfer?.getData('text/x-yzc-navigation')||'{}');if(source.group!==group)return;
      const order=prefs.order(group),after=order.indexOf(source.id)<order.indexOf(id);prefs.move(group,source.id,after?order[order.indexOf(id)+1]??null:id);
    }catch{/* Foreign drags are ignored. */}
  });
  button.addEventListener('keydown',event=>{if(!event.altKey)return;const offset=['ArrowLeft','ArrowUp'].includes(event.key)?-1:['ArrowRight','ArrowDown'].includes(event.key)?1:0;if(offset){event.preventDefault();prefs.step(group,id,offset);button.focus();}});
  button.addEventListener('contextmenu',event=>{
    event.preventDefault();const menu=new Menu();const order=prefs.order(group),index=order.indexOf(id);
    menu.addItem({label:'向前移动',disabled:index===0,click:()=>prefs.step(group,id,-1)});
    menu.addItem({label:'向后移动',disabled:index===order.length-1,click:()=>prefs.step(group,id,1)});
    menu.addItem({label:'恢复默认顺序',click:()=>prefs.reset(group)});menu.open({x:event.clientX,y:event.clientY});
  });
  return draggableNavigation(button,id,group,prefs);
}
