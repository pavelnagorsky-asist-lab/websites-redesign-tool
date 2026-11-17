// Runs inside the browser (page.evaluate). Plain JS on purpose — no TS/esbuild helpers.
(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const txt = (el) => clean(el && (el.innerText || el.textContent));
  const abs = (u) => {
    try {
      return new URL(u, location.href).href;
    } catch (e) {
      return '';
    }
  };
  const count = (sel) => {
    try {
      return document.querySelectorAll(sel).length;
    } catch (e) {
      return 0;
    }
  };
  const html = document.documentElement.outerHTML;
  const bodyText = document.body ? document.body.innerText || '' : '';
  const metaContent = (sel) => {
    const m = document.querySelector(sel);
    return m ? m.getAttribute('content') || '' : '';
  };

  // ---------- structure / content
  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: txt(a).slice(0, 80), href: abs(a.getAttribute('href')) }))
    .filter((l) => l.href);
  const headings = [...document.querySelectorAll('h1,h2,h3')]
    .map((h) => ({ tag: h.tagName.toLowerCase(), text: txt(h).slice(0, 160) }))
    .filter((h) => h.text)
    .slice(0, 60);
  const navRoot =
    document.querySelector('nav') ||
    document.querySelector('header') ||
    document.querySelector('[class*="menu"], [id*="menu"]');
  const nav = navRoot
    ? [...navRoot.querySelectorAll('a[href]')]
        .map((a) => ({ text: txt(a).slice(0, 60), href: abs(a.getAttribute('href')) }))
        .filter((l) => l.text)
        .slice(0, 40)
    : [];

  // ---------- images
  const imgs = [...document.images];
  const images = imgs
    .map((i) => ({
      src: i.currentSrc || i.src,
      alt: i.alt || '',
      w: i.naturalWidth,
      h: i.naturalHeight,
      hint: clean(
        [i.className, i.id, i.parentElement && i.parentElement.className].join(' '),
      ).slice(0, 80),
    }))
    .filter((i) => i.src && i.w > 0);
  const brokenImages = imgs.filter(
    (i) => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.src),
  ).length;
  const bgImages = [];
  const all = document.querySelectorAll('body *');
  for (let k = 0; k < all.length && k < 4000 && bgImages.length < 30; k++) {
    const el = all[k];
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg.indexOf('url(') !== 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 300 || r.height < 150) continue;
    const m = bg.match(/url\(["']?(.*?)["']?\)/);
    if (m) bgImages.push({ src: abs(m[1]), w: Math.round(r.width), h: Math.round(r.height), bg: true });
  }
  const logoImg =
    imgs.find((i) =>
      /logo|лого/i.test(
        [i.src, i.alt, i.className, i.id, i.parentElement && i.parentElement.className].join(' '),
      ),
    ) || document.querySelector('header img');
  const iconLink = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');

  // ---------- legacy markers
  const legacy = {
    tables: count('table'),
    nestedTables: count('table table'),
    layoutTables: [...document.querySelectorAll('table')].filter(
      (t) => t.getBoundingClientRect().width > 600 && t.querySelectorAll('img, table, td').length > 6,
    ).length,
    fontTags: count('font'),
    centerTags: count('center'),
    marquee: count('marquee'),
    frames: count('frameset, frame'),
    flash: count('embed[src*=".swf"], object[data*=".swf"], param[value*=".swf"]'),
    bgcolorAttr: count('[bgcolor]'),
    spacerGifs: count('img[src*="spacer"], img[src*="pixel.gif"], img[src*="blank.gif"]'),
    inlineStyles: count('[style]'),
  };
  const jquery = (window.jQuery && window.jQuery.fn && window.jQuery.fn.jquery) || '';

  // ---------- copyright years
  const years = [];
  const yearRe = /(?:©|\(c\)|copyright|все права защищены)[^\n\d]{0,40}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  let ym;
  while ((ym = yearRe.exec(bodyText))) years.push(+(ym[2] || ym[1]));

  // ---------- desktop content width (fixed narrow layouts)
  const docH = document.documentElement.scrollHeight;
  const widths = [...document.querySelectorAll('body > *, body > * > *, body > * > * > *')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.height > docH * 0.4 && r.width >= 500)
    .map((r) => Math.round(r.width));
  const contentWidth = widths.length ? Math.min(...widths) : innerWidth;

  // ---------- CMS
  const cms = [];
  const cmsRules = [
    ['WordPress', /wp-content|wp-includes/i],
    ['1С-Битрикс', /\/bitrix\/|bx-panel|BX\.setJSList/],
    ['Joomla', /\/media\/jui\/|joomla|\/components\/com_/i],
    ['Drupal', /drupal-settings-json|\/sites\/default\/files/i],
    ['MODX', /\/assets\/components\/|modx/i],
    ['OpenCart', /catalog\/view\/theme|route=product/i],
    ['UMI.CMS', /umi\.cms|\/templates\/.*\/umi/i],
    ['NetCat', /netcat/i],
    ['HostCMS', /hostcms/i],
    ['Tilda', /tildacdn|tilda\.ws/i],
    ['Wix', /wixstatic|_wixCssImports|wix\.com/i],
    ['Nethouse', /nethouse/i],
    ['uCoz', /ucoz|\/\.s\/src\//i],
    ['Flexbe', /flexbe/i],
    ['Craftum', /craftum/i],
    ['Webflow', /webflow/i],
    ['Next.js', /__NEXT_DATA__|\/_next\//],
    ['Nuxt', /__NUXT__|\/_nuxt\//],
  ];
  const gen = metaContent('meta[name="generator"]');
  for (const [name, re] of cmsRules) if (re.test(html) || re.test(gen)) cms.push(name);

  // ---------- complexity (logic that we would have to rebuild)
  const lower = bodyText.toLowerCase();
  const complexity = [];
  if (count('input[type="search"], form[action*="search"], input[name*="search"], input[name="q"]'))
    complexity.push('поиск по сайту');
  if (/в корзину|корзина|оформить заказ/.test(lower)) complexity.push('корзина / оформление заказа');
  if (/личный кабинет|войти в кабинет|регистрация|авторизац/.test(lower)) complexity.push('личный кабинет / авторизация');
  if (/калькулятор|рассчитать стоимость|расчет стоимости|расчёт стоимости/.test(lower)) complexity.push('калькулятор');
  if (count('select') >= 3 || /подбор по параметрам|фильтр/.test(lower)) complexity.push('фильтры / подбор');
  if (/онлайн-запись|онлайн запись|забронировать|бронирование/.test(lower) || /yclients|dikidi|bookform|travelline|bnovo/i.test(html))
    complexity.push('онлайн-запись / бронирование');
  if (count('iframe[src*="map"], [class*="ymaps"], script[src*="api-maps.yandex"], script[src*="maps.googleapis"]'))
    complexity.push('карта');
  const priceMatches = bodyText.match(/\d[\d\s]{0,7}(?:[.,]\d{1,2})?\s?(?:руб|р\.|byn|₽|бел\.?\s?руб)/gi) || [];
  if (priceMatches.length >= 20) complexity.push(`каталог с ценами (~${priceMatches.length} цен на главной)`);
  const multiLang = links.filter((l) => /\/(en|eng|by|be|pl|de)\/?$|[?&]lang=/i.test(l.href)).length;
  if (multiLang) complexity.push('многоязычность');

  // ---------- contacts
  const emails = new Set();
  const phones = new Set();
  links.forEach((l) => {
    if (/^mailto:/i.test(l.href)) emails.add(decodeURIComponent(l.href.replace(/^mailto:/i, '').split('?')[0]));
    if (/^tel:/i.test(l.href)) phones.add(decodeURIComponent(l.href.replace(/^tel:/i, '')));
  });
  (bodyText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).forEach((e) => emails.add(e));
  (bodyText.match(/(?:\+?375|\b80)[\s\-(]*(?:17|25|29|33|44|1\d{2}|2\d{2})[\s\-)]*\d[\d\s-]{5,9}\d/g) || []).forEach((p) => phones.add(p));
  (bodyText.match(/(?:\+7|\b8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g) || []).forEach((p) => phones.add(p));
  const pick = (re) => [...new Set(links.filter((l) => re.test(l.href)).map((l) => l.href))];
  const addrLine = bodyText
    .split('\n')
    .map(clean)
    .find((s) => s.length < 200 && /(ул\.|улица|пр-т|проспект|пр\.|пер\.|переулок|тракт|шоссе|д\.\s?\d)/i.test(s) && /\d/.test(s));

  return {
    url: location.href,
    title: document.title,
    description: metaContent('meta[name="description"]'),
    generator: gen,
    lang: document.documentElement.lang || '',
    viewportMeta: metaContent('meta[name="viewport"]'),
    headings,
    nav,
    links: links.slice(0, 300),
    text: bodyText.slice(0, 8000),
    images: images.concat(bgImages),
    brokenImages,
    logo: logoImg ? logoImg.currentSrc || logoImg.src : '',
    ogImage: metaContent('meta[property="og:image"]'),
    favicon: iconLink ? abs(iconLink.getAttribute('href')) : abs('/favicon.ico'),
    legacy,
    jquery,
    copyrightYears: years,
    contentWidth,
    docHeight: docH,
    bodyFont: getComputedStyle(document.body).fontFamily,
    cms,
    complexity,
    contacts: {
      emails: [...emails],
      phones: [...phones],
      telegram: pick(/t\.me\/|telegram\.(me|org)\/|tg:\/\//i),
      viber: pick(/^viber:|viber\.(com|click)/i),
      whatsapp: pick(/wa\.me|whatsapp\.com|api\.whatsapp/i),
      instagram: pick(/instagram\.com\//i),
      vk: pick(/vk\.com\//i),
      facebook: pick(/facebook\.com\//i),
      address: addrLine || '',
    },
  };
})();
