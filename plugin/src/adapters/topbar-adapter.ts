import { Menu, type Plugin } from 'siyuan';
import { STYLES, TYPOGRAPHIES, selectStyle, type Settings } from '../settings';

/** Official host menu; delegated capture survives host replacement of the topbar element. */
export class TopbarAdapter {
  private button: HTMLElement;
  private menu?: Menu;
  private events = new AbortController();
  constructor(private plugin: Plugin, private read: () => Settings, private update: (patch: Partial<Settings>) => Promise<void>) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'toolbar__item yzc-topbar';
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
    this.button = plugin.addTopBar({ id: 'yzc', title: 'yzc阅读', position: 'right', element: button }) ?? button;
    document.addEventListener('click', this.click, {capture: true, signal: this.events.signal});
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.close(); }, {signal: this.events.signal});
    this.render();
  }
  private click = (event: MouseEvent): void => {
    const target = event.target as Element;
    const button = target.closest<HTMLElement>('.yzc-topbar');
    if (button?.id === this.button.id) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.button = button;
      // isOpen can outlive a host outside-click cleanup. Inspect the mounted view.
      const mounted = document.querySelector('.yzc-appearance');
      if (mounted?.isConnected && mounted.getClientRects().length) this.close(); else this.open();
    } else if (this.menu && !target.closest('#commonMenu, .yzc-appearance')) this.close();
  };
  render(): void {
    this.button = document.getElementById(this.button.id) ?? this.button;
    const state = this.read();
    const title = `yzc阅读 · ${state.style[0].toUpperCase()}${state.style.slice(1)}`;
    this.button.style.setProperty('--yzc-launcher-icon', `url("/plugins/${encodeURIComponent(this.plugin.name)}/icon.png")`);
    this.button.setAttribute('aria-label', title);
    this.button.title = title;
  }
  private close(): void {
    const menu=this.menu;this.menu=undefined;
    // The SDK shares #commonMenu with native menus. A stale Menu reference
    // must never close an unrelated menu opened after our outside-click cleanup.
    if(document.querySelector('.yzc-appearance'))menu?.close();
    this.button.setAttribute('aria-expanded', 'false');
  }
  private open(): void {
    this.close();
    // SiYuan's named Menu constructor is itself a toggle: a retained matching
    // data-name makes isOpen=true and suppresses addItem/open. Own the toggle
    // above and use an unnamed instance so every open builds a fresh menu.
    const menu = new Menu(undefined, () => { this.menu=undefined;this.button.setAttribute('aria-expanded', 'false'); });
    this.menu = menu;
    const state = this.read();
    const appearance = document.createElement('div'); appearance.className = 'yzc-appearance';
    const heading = document.createElement('div'); heading.className = 'yzc-menu-heading'; heading.textContent = '外观';
    appearance.append(heading);
    const choices = (label: string, values: readonly string[], selected: string, typography = false) => {
      const title = document.createElement('div'); title.className = 'yzc-choice-label'; title.textContent = label;
      const row = document.createElement('div'); row.className = 'yzc-choice-row'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', label);
      for (const value of values) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = `yzc-choice${typography ? ` yzc-font-preview yzc-font-${value}` : ''}`;
        button.setAttribute('role','menuitemradio'); button.setAttribute('aria-checked',String(value === selected));
        const name = value[0].toUpperCase() + value.slice(1);
        button.setAttribute('aria-label', `${label} ${name}`);
        if (typography) { const preview = document.createElement('span'); preview.className = 'yzc-ag'; preview.textContent = 'Ag'; preview.setAttribute('aria-hidden','true'); button.append(preview); }
        const caption = document.createElement('span'); caption.textContent = name; button.append(caption);
        button.onclick = event => { event.stopPropagation(); this.close(); void this.update(typography ? {typography: value as Settings['typography']} : selectStyle(value as Settings['style'])).catch(() => {}); };
        row.append(button);
      }
      appearance.append(title,row);
    };
    choices('视觉风格',STYLES,state.style);
    choices('字体',TYPOGRAPHIES,state.typography,true);
    menu.addItem({type:'empty',label:'',bind:element => element.append(appearance)});
    const rect = this.button.getBoundingClientRect();
    menu.open({x:Math.max(8,rect.right-290),y:rect.bottom+4});
    // Menu mounts in the host overlay, outside any toolbar clipping container.
    this.button.setAttribute('aria-expanded','true');
  }
  dispose(): void { this.close(); this.events.abort(); this.plugin.removeTopBar('yzc'); this.button.remove(); }
}
