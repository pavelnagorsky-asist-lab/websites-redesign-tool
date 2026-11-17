// Runs inside the browser on a mobile viewport. Plain JS on purpose.
(() => {
  const vp = document.querySelector('meta[name="viewport"]');
  const scale = Math.min(1, screen.width / innerWidth); // no viewport meta => 980px layout, zoomed out
  let total = 0;
  let small = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim();
    if (t.length < 2) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const eff = parseFloat(cs.fontSize) * scale;
    total += t.length;
    if (eff < 12) small += t.length;
  }
  const taps = [...document.querySelectorAll('a, button')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const smallTaps = taps.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height * scale < 28 && r.width * scale < 60;
  }).length;
  const overflow = [];
  if (document.documentElement.scrollWidth > innerWidth + 4) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 4 && r.width > 0 && overflow.length < 5)
        overflow.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    }
  }
  return {
    viewportMeta: vp ? vp.getAttribute('content') : '',
    innerWidth,
    screenWidth: screen.width,
    scrollWidth: document.documentElement.scrollWidth,
    scale,
    smallTextRatio: total ? small / total : 0,
    smallTapRatio: taps.length ? smallTaps / taps.length : 0,
    overflow,
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src)).length,
    docHeight: document.documentElement.scrollHeight,
  };
})();
