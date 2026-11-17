// Scroll through the page to trigger lazy-loaded images, then return to top.
(async () => {
  const max = Math.min(document.documentElement.scrollHeight, 20000);
  for (let y = 0; y < max; y += 700) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
})();
