/** Narrow, version-checked integration patches; upstream files stay unchanged. */
export function rendererCompat(contents){
 const marker='    open(book) {';
 const bridge=`    setScrollbarStyles(css) {
        let style = this.#root.querySelector('style[data-reader-scrollbar]')
        if (!style) {
            style = document.createElement('style')
            style.dataset.readerScrollbar = ''
            this.#root.append(style)
        }
        if (style.textContent !== css) style.textContent = css
    }
`;
 if(!contents.includes(marker))throw Error('Pinned paginator scrollbar bridge changed');
 return contents.replace(marker,bridge+marker);
}
