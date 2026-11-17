import {HostTypography} from '../src/ui/host-typography';
const formatter=new HostTypography();Object.assign(window,{typeProbe:{formatter,sync:()=>formatter.sync(document.querySelector<HTMLElement>('.rss-reader-body')!,document.querySelector<HTMLElement>('.rss-reader-title h1')),dispose:()=>formatter.dispose()}});
