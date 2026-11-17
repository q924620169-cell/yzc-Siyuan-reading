const installed = new WeakSet();
const maxPixels = 8 * 1024 * 1024;
const sampleMargin = 4;

function replaceMethod(target, name, wrap) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  const method = wrap(target[name]);
  target[name] = method;
  return () => {
    if (target[name] !== method) return;
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
  };
}

function sampleVisibleStrip(draw, context, image, args, aspect) {
  const width = image?.width ?? image?.displayWidth;
  const height = image?.height ?? image?.displayHeight;
  const [sx, sy, sw, sh, dx, dy, dw, dh] = args;
  if (args.length !== 8 || sx !== 0 || sy !== 0 || sw !== width || sh !== height ||
      height < 4096 || Math.abs(height / width - aspect) > aspect * 0.02 ||
      dw <= width || dh <= height) return draw.call(context, image, ...args);

  const {a, b, c, d, f} = context.getTransform();
  if (a !== 1 || b !== 0 || c !== 0 || d !== 1) return draw.call(context, image, ...args);
  const scale = dh / sh;
  const start = Math.max(0, Math.floor((-f - dy) / scale) - sampleMargin);
  const end = Math.min(sh, Math.ceil((context.canvas.height - f - dy) / scale) + sampleMargin);
  const rows = end - start;
  if (rows <= 0 || rows >= sh || dw * rows * scale > maxPixels) return draw.call(context, image, ...args);

  const smoothing = context.imageSmoothingEnabled;
  const quality = context.imageSmoothingQuality;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  try {
    return draw.call(context, image, sx, sy + start, sw, rows, dx, dy + start * scale, dw, rows * scale);
  } finally {
    context.imageSmoothingEnabled = smoothing;
    context.imageSmoothingQuality = quality;
  }
}

function renderScan(page, render, options, aspect, signal) {
  const canvas = options.canvas ?? options.canvasContext?.canvas;
  if (!canvas || signal.aborted || options.intent === 'print') return render.call(page, options);
  const patchContext = context => replaceMethod(context, 'drawImage', draw => function (image, ...args) {
    if (signal.aborted) return draw.call(this, image, ...args);
    return sampleVisibleStrip(draw, this, image, args, aspect);
  });
  let restoreContext = () => {}, restoreCanvas = () => {};
  if (options.canvasContext) {
    restoreContext = patchContext(options.canvasContext);
  } else {
    restoreCanvas = replaceMethod(canvas, 'getContext', getContext => function (type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (type === '2d' && context) {
        restoreCanvas();
        restoreContext = patchContext(context);
      }
      return context;
    });
  }
  const restore = () => {
    restoreContext();
    restoreCanvas();
  };
  try {
    const task = render.call(page, options);
    task.promise.then(restore, restore);
    return task;
  } catch (error) {
    restore();
    throw error;
  }
}

// SiYuan 3.8.10 supplies the PDF.js viewer per asset tab. Use its own render
// task and canvas, and keep the host's rendering queue and pixel budgets.
export function prepareScanRendering(pdf, signal) {
  if (signal.aborted || !pdf?.pdfViewer?.getPageView || !pdf.eventBus?.on || installed.has(pdf)) return;
  installed.add(pdf);
  let restoreRender;
  const install = () => {
    if (signal.aborted || pdf.pdfDocument?.numPages !== 1) return;
    const view = pdf.pdfViewer.getPageView(0), page = view?.pdfPage;
    if (!Array.isArray(page?.view) || typeof page.render !== 'function') return;
    const [x0, y0, x1, y1] = page.view;
    const aspect = (y1 - y0) / (x1 - x0);
    if (!Number.isFinite(aspect) || aspect < 8 || y1 - y0 < 4096) return;
    restoreRender = replaceMethod(page, 'render', render => function (options) { return renderScan(this, render, options, aspect, signal); });
    const detail = view.detailView;
    if (detail?.renderingState === 3 && typeof detail.reset === 'function' && typeof pdf.pdfViewer.update === 'function') {
      detail.reset({keepCanvas: true});
      pdf.pdfViewer.update();
    }
  };
  const dispose = () => {
    restoreRender?.();
    installed.delete(pdf);
    pdf.eventBus.off?.('pagesinit', install);
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, {once: true});
  if (pdf.pdfViewer.getPageView(0)?.pdfPage) install();
  else pdf.eventBus.on('pagesinit', install, {once: true, signal});
  return dispose;
}
