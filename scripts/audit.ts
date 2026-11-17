/**
 * npx tsx scripts/audit.ts <slug> [<slug> ...]   аудит конкретных лидов
 * npx tsx scripts/audit.ts --pending              все лиды со статусом candidate
 *   [--concurrency 3]
 *
 * Результат в leads/<slug>/audit/:
 *   desktop.jpg, desktop-full.jpg, mobile.jpg, mobile-full.jpg — скриншоты
 *   audit.json   — технические данные
 *   content.json — тексты, меню, картинки, контакты (сырьё для редизайна)
 * И обновляет lead.json: контакты, audit-сводку, статус candidate → audited.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { launchBrowser, DESKTOP, MOBILE, MOBILE_UA } from './lib/browser.ts';
import { ROOT, today } from './lib/config.ts';
import {
  formatPhone,
  leadDir,
  listLeads,
  normalizePhone,
  parseArgs,
  readLead,
  uniq,
  writeLead,
  type AuditSummary,
  type Lead,
} from './lib/leads.ts';

const probe = (name: string) =>
  fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'probes', name), 'utf8');
const PAGE_PROBE = probe('page-probe.js');
const MOBILE_PROBE = probe('mobile-probe.js');
const AUTOSCROLL = probe('autoscroll.js');

type PageProbe = {
  url: string;
  title: string;
  description: string;
  generator: string;
  lang: string;
  viewportMeta: string;
  headings: { tag: string; text: string }[];
  nav: { text: string; href: string }[];
  links: { text: string; href: string }[];
  text: string;
  images: { src: string; alt?: string; w: number; h: number; hint?: string; bg?: boolean }[];
  brokenImages: number;
  logo: string;
  ogImage: string;
  favicon: string;
  legacy: Record<string, number>;
  jquery: string;
  copyrightYears: number[];
  contentWidth: number;
  docHeight: number;
  bodyFont: string;
  cms: string[];
  complexity: string[];
  contacts: Omit<Lead['contacts'], 'address'> & { address: string };
};
type MobileProbe = {
  viewportMeta: string;
  innerWidth: number;
  scrollWidth: number;
  smallTextRatio: number;
  smallTapRatio: number;
  overflow: string[];
  brokenImages: number;
  docHeight: number;
};

const EXTRA_PAGES: [kind: string, re: RegExp][] = [
  ['contacts', /контакт|contact|kontakt|svyaz|связаться/i],
  ['services', /услуг|продукц|каталог|меню|прайс|цены|ассортимент|services|products|catalog|price|menu|uslugi/i],
  ['about', /о компании|о нас|об агентстве|about|o-kompanii|o-nas|company/i],
];

async function gotoSafe(page: Page, url: string) {
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('load', { timeout: 25_000 }).catch(() => {});
  const loadMs = Date.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
  return { resp, loadMs };
}

async function fullShot(page: Page, file: string, width: number, maxH: number) {
  const h: number = await page.evaluate('document.documentElement.scrollHeight');
  await page.screenshot({
    path: file,
    type: 'jpeg',
    quality: 60,
    fullPage: true,
    scale: 'css',
    clip: h > maxH ? { x: 0, y: 0, width, height: maxH } : undefined,
  });
}

async function auditLead(browser: Browser, lead: Lead) {
  const outDir = path.join(leadDir(lead.slug), 'audit');
  fs.mkdirSync(outDir, { recursive: true });

  // ------------------------------------------------ desktop
  const dctx = await browser.newContext({ viewport: DESKTOP, locale: 'ru-RU', ignoreHTTPSErrors: true });
  const page = await dctx.newPage();
  const consoleErrors: string[] = [];
  let bytes = 0;
  let requests = 0;
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
  page.on('requestfinished', async (r) => {
    requests++;
    try {
      bytes += (await r.sizes()).responseBodySize;
    } catch {
      /* ignore */
    }
  });

  let nav: Awaited<ReturnType<typeof gotoSafe>>;
  let startUrl = lead.site;
  try {
    nav = await gotoSafe(page, startUrl);
  } catch (e) {
    // https failed → try http
    if (startUrl.startsWith('https://')) {
      startUrl = startUrl.replace('https://', 'http://');
      try {
        nav = await gotoSafe(page, startUrl);
      } catch (e2) {
        await dctx.close();
        return failLead(lead, (e2 as Error).message);
      }
    } else {
      await dctx.close();
      return failLead(lead, (e as Error).message);
    }
  }
  const status = nav.resp?.status() ?? 0;
  const headers = nav.resp?.headers() ?? {};
  await page.evaluate(AUTOSCROLL).catch(() => {});
  await page.screenshot({ path: path.join(outDir, 'desktop.jpg'), type: 'jpeg', quality: 70 });
  await fullShot(page, path.join(outDir, 'desktop-full.jpg'), DESKTOP.width, 9000);
  const main = (await page.evaluate(PAGE_PROBE)) as PageProbe;
  const finalUrl = page.url();

  // extra pages for content + contacts
  const host = new URL(finalUrl).hostname;
  const pages: { kind: string; url: string; title: string; headings: PageProbe['headings']; text: string }[] = [];
  const extraImages: PageProbe['images'] = [];
  const extraContacts: PageProbe['contacts'][] = [];
  const visited = new Set([finalUrl.replace(/[#?].*$/, '').replace(/\/$/, '')]);
  for (const [kind, re] of EXTRA_PAGES) {
    const link = main.links.find((l) => {
      try {
        const u = new URL(l.href);
        const key = l.href.replace(/[#?].*$/, '').replace(/\/$/, '');
        return u.hostname === host && !visited.has(key) && (re.test(l.text) || re.test(u.pathname));
      } catch {
        return false;
      }
    });
    if (!link) continue;
    visited.add(link.href.replace(/[#?].*$/, '').replace(/\/$/, ''));
    try {
      await gotoSafe(page, link.href);
      const p = (await page.evaluate(PAGE_PROBE)) as PageProbe;
      pages.push({ kind, url: p.url, title: p.title, headings: p.headings.slice(0, 30), text: p.text.slice(0, 5000) });
      extraImages.push(...p.images);
      extraContacts.push(p.contacts);
    } catch {
      /* ignore broken subpages */
    }
  }
  await dctx.close();

  // ------------------------------------------------ mobile
  const mctx = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
    locale: 'ru-RU',
    ignoreHTTPSErrors: true,
  });
  const mpage = await mctx.newPage();
  let mobile: MobileProbe | null = null;
  try {
    await gotoSafe(mpage, finalUrl);
    await mpage.evaluate(AUTOSCROLL).catch(() => {});
    await mpage.screenshot({ path: path.join(outDir, 'mobile.jpg'), type: 'jpeg', quality: 70 });
    await fullShot(mpage, path.join(outDir, 'mobile-full.jpg'), MOBILE.width, 7000);
    mobile = (await mpage.evaluate(MOBILE_PROBE)) as MobileProbe;
  } catch (e) {
    consoleErrors.push('mobile: ' + (e as Error).message.slice(0, 150));
  }
  await mctx.close();

  // ------------------------------------------------ scoring
  const reasons: string[] = [];
  let score = 0;
  const add = (pts: number, reason: string) => {
    score += pts;
    reasons.push(reason);
  };
  const year = new Date().getFullYear();
  const L = main.legacy;
  const hasViewport = /width\s*=\s*device-width/i.test(main.viewportMeta);

  if (!hasViewport)
    add(25, 'Нет мобильной версии: сайт на телефоне показывается уменьшенной копией десктопа');
  if (mobile && mobile.scrollWidth > mobile.innerWidth + 4)
    add(15, `На телефоне страница шире экрана — появляется горизонтальная прокрутка (${mobile.scrollWidth}px при ширине ${mobile.innerWidth}px)`);
  if (mobile && mobile.smallTextRatio > 0.3)
    add(10, `На телефоне ${Math.round(mobile.smallTextRatio * 100)}% текста мельче 12px — читать невозможно без зума`);
  if (mobile && mobile.smallTapRatio > 0.4)
    add(5, 'Мелкие ссылки и кнопки — по ним сложно попасть пальцем');
  if (L.layoutTables || L.nestedTables > 1) add(15, 'Вёрстка таблицами (технология 2000-х)');
  if (L.fontTags + L.centerTags + L.marquee + L.bgcolorAttr > 3)
    add(10, 'Устаревшие HTML-теги (<font>, <center>, bgcolor и т.п.)');
  if (L.frames) add(15, 'Сайт на фреймах');
  if (L.flash) add(15, 'Используется Flash — не работает ни в одном современном браузере');
  if (L.spacerGifs) add(5, 'Прозрачные GIF-распорки в вёрстке');
  if (!finalUrl.startsWith('https://'))
    add(10, 'Нет HTTPS — браузер помечает сайт как «Не защищён»');
  if (main.contentWidth <= 1000 && main.contentWidth >= 500)
    add(8, `Узкая фиксированная вёрстка ${main.contentWidth}px — на современных мониторах по бокам пустота`);
  const maxYear = main.copyrightYears.length ? Math.max(...main.copyrightYears) : 0;
  if (maxYear && maxYear <= year - 3) add(10, `В подвале © ${maxYear} — сайт выглядит заброшенным`);
  if (main.jquery && /^1\.([0-9]|1[01])\./.test(main.jquery)) add(5, `Очень старый jQuery ${main.jquery}`);
  if (bytes > 6_000_000) add(5, `Тяжёлая главная страница: ${(bytes / 1e6).toFixed(1)} МБ`);
  if (nav.loadMs > 6000) add(5, `Медленная загрузка: ${(nav.loadMs / 1000).toFixed(1)} с`);
  const broken = main.brokenImages + (mobile?.brokenImages ?? 0);
  if (broken) add(5, `Битые изображения: ${broken}`);
  if (consoleErrors.length > 3) add(3, `Ошибки JavaScript в консоли: ${consoleErrors.length}`);
  if (!main.description) add(2, 'Нет meta description — хуже выглядит в поиске');
  if (main.cms.some((c) => ['Tilda', 'Wix', 'Webflow', 'Next.js', 'Nuxt', 'Flexbe', 'Craftum'].includes(c)))
    add(-15, `Сайт на ${main.cms.join(', ')} — вероятно, уже относительно современный`);
  if (main.cms.includes('uCoz')) add(10, 'Сайт на uCoz');
  score = Math.max(0, Math.min(100, score));

  const cx = main.complexity;
  const complexity: AuditSummary['complexity'] =
    cx.some((c) => /корзина|кабинет/.test(c)) || cx.length >= 4 ? 'high' : cx.length >= 2 ? 'medium' : 'low';

  // ------------------------------------------------ contacts merge
  const allC = [main.contacts, ...extraContacts];
  const c = lead.contacts;
  c.emails = uniq([...c.emails, ...allC.flatMap((x) => x.emails)].map((e) => e.toLowerCase().trim()))
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e) && !/example|sentry|wixpress/.test(e));
  const phoneDigits = new Map<string, string>();
  for (const p of [...c.phones, ...allC.flatMap((x) => x.phones)]) {
    const d = normalizePhone(p);
    if (d.length >= 11 && d.length <= 12 && !phoneDigits.has(d)) phoneDigits.set(d, formatPhone(d));
  }
  c.phones = [...phoneDigits.values()];
  for (const k of ['telegram', 'viber', 'whatsapp', 'instagram', 'vk', 'facebook'] as const)
    c[k] = uniq([...c[k], ...allC.flatMap((x) => x[k])]);
  c.address ||= allC.map((x) => x.address).find(Boolean) ?? '';

  // ------------------------------------------------ write files
  const images = dedupeImages([...main.images, ...extraImages]);
  const content = {
    url: finalUrl,
    title: main.title,
    description: main.description,
    lang: main.lang,
    headings: main.headings,
    nav: main.nav,
    text: main.text,
    pages,
    logo: main.logo,
    ogImage: main.ogImage,
    favicon: main.favicon,
    images,
    contacts: c,
  };
  const audit = {
    date: today(),
    requestedUrl: lead.site,
    finalUrl,
    httpStatus: status,
    lastModified: headers['last-modified'] ?? '',
    server: headers['server'] ?? '',
    loadMs: nav.loadMs,
    bytes,
    requests,
    viewportMeta: main.viewportMeta,
    generator: main.generator,
    cms: main.cms,
    jquery: main.jquery,
    legacy: L,
    copyrightYears: main.copyrightYears,
    contentWidth: main.contentWidth,
    docHeight: main.docHeight,
    bodyFont: main.bodyFont,
    mobile,
    brokenImages: broken,
    consoleErrors: consoleErrors.slice(0, 20),
    complexity: cx,
    score,
    reasons,
  };
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2));
  fs.writeFileSync(path.join(outDir, 'content.json'), JSON.stringify(content, null, 2));

  lead.audit = {
    date: today(),
    outdatedScore: score,
    reasons,
    complexity,
    complexitySignals: cx,
    cms: main.cms,
    mobileFriendly: hasViewport && !!mobile && mobile.scrollWidth <= mobile.innerWidth + 4,
  };
  if (maxYear >= year - 1) uniqPush(lead.activitySignals, `© ${maxYear} в подвале сайта`);
  if (lead.status === 'candidate') lead.status = 'audited';
  writeLead(lead);
  return lead;
}

function uniqPush(arr: string[], v: string) {
  if (!arr.includes(v)) arr.push(v);
}

function dedupeImages(list: PageProbe['images']) {
  const seen = new Map<string, PageProbe['images'][number]>();
  for (const i of list) {
    if (!i.src || i.src.startsWith('data:')) continue;
    const prev = seen.get(i.src);
    if (!prev || i.w * i.h > prev.w * prev.h) seen.set(i.src, i);
  }
  return [...seen.values()].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 80);
}

function failLead(lead: Lead, message: string) {
  lead.audit = {
    date: today(),
    outdatedScore: 0,
    reasons: [`Сайт не открывается: ${message.split('\n')[0].slice(0, 200)}`],
    complexity: 'low',
    complexitySignals: [],
    cms: [],
    mobileFriendly: false,
  };
  if (lead.status === 'candidate') lead.status = 'audited';
  writeLead(lead);
  return lead;
}

// ------------------------------------------------------------------ main
const { positional, flags } = parseArgs();
let targets: Lead[];
if (flags.pending) targets = listLeads().filter((l) => l.status === 'candidate');
else if (positional.length) targets = positional.map(readLead);
else {
  console.error('Usage: npx tsx scripts/audit.ts <slug> [...] | --pending');
  process.exit(1);
}
if (!targets.length) {
  console.log('Нечего проверять.');
  process.exit(0);
}

const concurrency = Number(flags.concurrency ?? 3);
const browser = await launchBrowser();
const queue = [...targets];
let failed = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let lead = queue.shift(); lead; lead = queue.shift()) {
      const t0 = Date.now();
      try {
        const r = await auditLead(browser, lead);
        const a = r.audit!;
        console.log(
          `\n■ ${r.slug} — ${r.company}  [${((Date.now() - t0) / 1000).toFixed(0)}s]\n` +
            `  Устарелость (авто): ${a.outdatedScore}/100 · сложность: ${a.complexity}` +
            (a.complexitySignals.length ? ` (${a.complexitySignals.join(', ')})` : '') +
            (a.cms.length ? ` · CMS: ${a.cms.join(', ')}` : '') +
            `\n  ${a.reasons.map((x) => '- ' + x).join('\n  ')}` +
            `\n  Контакты: ${[...r.contacts.phones, ...r.contacts.emails].slice(0, 4).join(', ') || '—'}` +
            `\n  Скриншоты: leads/${r.slug}/audit/{desktop,mobile}.jpg`,
        );
      } catch (e) {
        failed++;
        console.error(`✗ ${lead.slug}: ${(e as Error).message}`);
      }
    }
  }),
);
await browser.close();
process.exit(failed ? 1 : 0);
