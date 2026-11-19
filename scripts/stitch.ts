/**
 * Google Stitch: один проект на лид, ровно 2 генерации (desktop + mobile), правки — локально в HTML, без генераций.
 *
 * npx tsx scripts/stitch.ts design <slug> [--redo]
 *   — из leads/<slug>/prompt-desktop.txt и prompt-mobile.txt: новый публичный проект, генерация DESKTOP, затем MOBILE
 *     в том же стиле (4–10 мин). Скачивает HTML в design/desktop.html, mobile.html и превью design/*-view-N.jpg,
 *     пишет design-блок в lead.json, в конце проверяет публичную ссылку (verify).
 *     Если Stitch отказал сразу (service unavailable / 5xx) — сам повторяет до 3 раз. Если упал mobile при готовом
 *     desktop — проект сохраняется (design/stitch-partial.json), повторный запуск design продолжит с mobile.
 *     Если связь оборвалась (socket hang up) — до 10 мин ищет дорисованный Stitch экран в проекте и продолжает с ним.
 *     Если экран так и не появился и он первый — пустой проект удаляется (обрывок был бы виден клиенту), запустить снова.
 *     --redo: удалить текущий (или незаконченный) проект лида и сделать заново (только если концепт не годится целиком).
 * npx tsx scripts/stitch.ts push <slug>
 *   — типографика + рендер design/desktop.html и mobile.html → залить в те же экраны Stitch (без генераций),
 *     обновить превью, проверить публичную ссылку (verify).
 * npx tsx scripts/stitch.ts pull <slug>
 *   — заново скачать HTML и превью экранов из Stitch (перезаписывает локальные правки).
 * npx tsx scripts/stitch.ts verify <slug...>
 *   — открыть публичную ссылку как клиент: ровно 2 экрана, проект PUBLIC.
 *
 * Скрипт ходит в Stitch API напрямую по STITCH_API_KEY (MCP-клиент не нужен; долгая генерация не обрывается по таймауту).
 */
import fs from 'node:fs';
import path from 'node:path';
import { leadDir } from './lib/leads.ts';
import { launchBrowser } from './lib/browser.ts';
import { bareProjectId, bareScreenId, stitchCall, stitchCallLong } from './lib/stitch.ts';

const MODEL = 'GEMINI_3_8_FLASH';
const GEN_TRIES = 3; // попыток генерации одного экрана, если Stitch отказал сразу (service unavailable / 5xx)
const RETRY_DELAY_S = 90;
const DEVICES = [
  { device: 'DESKTOP', key: 'desktop', title: 'Главная', width: 1280 },
  { device: 'MOBILE', key: 'mobile', title: 'Главная (мобильная)', width: 390 },
] as const;

const [cmd, ...args] = process.argv.slice(2);

const leadFile = (slug: string) => path.join(leadDir(slug), 'lead.json');
const readLead = (slug: string) => JSON.parse(fs.readFileSync(leadFile(slug), 'utf8'));
const writeLead = (slug: string, lead: any) => fs.writeFileSync(leadFile(slug), JSON.stringify(lead, null, 2) + '\n');
const designDir = (slug: string) => {
  const d = path.join(leadDir(slug), 'design');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const screenName = (p: string, s: string) => `projects/${bareProjectId(p)}/screens/${bareScreenId(s)}`;

/** Ответ генерации: screenId, designSystem, текст Stitch. Полный ответ — в design/stitch-<key>.json */
function parseGeneration(slug: string, key: string, res: any) {
  fs.writeFileSync(path.join(designDir(slug), `stitch-${key}.json`), JSON.stringify(res, null, 2));
  const screens: string[] = [];
  let designSystem: string | undefined;
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.name === 'string') {
      if (/screens\//.test(o.name) && o.deviceType && !screens.includes(bareScreenId(o.name))) screens.push(bareScreenId(o.name));
      if (!designSystem && /^assets\//.test(o.name)) designSystem = o.name;
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(res);
  const text = (res?.outputComponents ?? []).map((c: any) => c.text).filter(Boolean).join(' | ');
  return { screens, designSystem, text };
}

async function download(fileName: string): Promise<string> {
  const dl = await stitchCall('download_file', { name: fileName });
  const v = dl?.html ?? dl?.image ?? dl?.data ?? dl?.content;
  if (!v) throw new Error(`download_file: неожиданный ответ ${JSON.stringify(dl).slice(0, 200)}`);
  return v;
}

/**
 * Рендер HTML экрана как в Stitch (ширина экрана, окно = высота экрана — fixed-панели внизу).
 * Возвращает полный PNG (для update_screen) и пишет превью design/<key>-view-N.jpg кусками по 2000px.
 */
async function render(browser: any, slug: string, key: string, html: string, width: number, height: number): Promise<Buffer> {
  const dir = designDir(slug);
  for (const f of fs.readdirSync(dir)) if (f.startsWith(`${key}-view-`)) fs.rmSync(path.join(dir, f));
  const page = await browser.newPage({ viewport: { width, height } });
  const out: string[] = [];
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.evaluate('document.fonts.ready');
    const png: Buffer = await page.screenshot({ fullPage: true });
    fs.writeFileSync(path.join(dir, `${key}.png`), png);
    const h = Number(await page.evaluate('document.documentElement.scrollHeight'));
    for (let y = 0, n = 1; y < h; y += 2000, n++) {
      const v = path.join(dir, `${key}-view-${n}.jpg`);
      await page.screenshot({ path: v, type: 'jpeg', quality: 75, fullPage: true, clip: { x: 0, y, width, height: Math.min(2000, h - y) } });
      out.push(path.basename(v));
    }
    console.log(`  смотреть: design/${out.join(', ')}`);
    return png;
  } finally {
    await page.close();
  }
}

/** ID всех экранов проекта. API (list_screens) их не отдаёт — берём из ответов страницы проекта в браузере. */
async function projectScreenIds(p: string): Promise<string[]> {
  const browser = await launchBrowser();
  const ids = new Set<string>();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('response', async (r: any) => {
      if (!r.url().includes('batchexecute')) return;
      const t: string = await r.text().catch(() => '');
      for (const m of t.matchAll(/screens\/([0-9a-f]{32})/g)) ids.add(m[1]);
    });
    await page.goto(`https://stitch.withgoogle.com/projects/${p}`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(15000);
  } finally {
    await browser.close();
  }
  return [...ids];
}

/**
 * Связь оборвалась во время генерации, но Stitch мог дорисовать экран на сервере.
 * Каждые 30 с (до 10 мин) ищем в проекте новый экран нужного устройства.
 */
async function recoverScreen(p: string, device: string, known: string[]): Promise<{ id: string; designSystem?: string } | undefined> {
  for (let i = 1; i <= 20; i++) {
    for (const id of await projectScreenIds(p)) {
      if (known.includes(id)) continue;
      const info = await stitchCall('get_screen', { name: screenName(p, id) }).catch(() => undefined);
      if (info?.deviceType === device && info?.htmlCode?.name) {
        const ds = await stitchCall('list_design_systems', { projectId: p }).catch(() => undefined);
        return { id, designSystem: ds?.designSystems?.[0]?.name };
      }
    }
    console.log(`  … ${device}: экрана пока нет (проверка ${i}/20)`);
    await new Promise((r) => setTimeout(r, 30000));
  }
  return undefined;
}

const screenHeight = (info: any, width: number) => Math.round((Number(info.height) * width) / Number(info.width)) || 900;

/** Скачать HTML экранов из Stitch в design/ + превью. */
async function pull(slug: string) {
  const d = readLead(slug).design;
  if (!d?.projectId) throw new Error(`${slug}: нет design.projectId — сначала stitch.ts design`);
  const browser = await launchBrowser();
  try {
    for (const { device, key, width } of DEVICES) {
      const s = d.screens.find((x: any) => x.device === device);
      const info = await stitchCall('get_screen', { name: screenName(d.projectId, s.id) });
      const html = await download(info.htmlCode.name);
      fs.writeFileSync(path.join(designDir(slug), `${key}.html`), html);
      console.log(`✓ ${key}: design/${key}.html`);
      await render(browser, slug, key, html, width, screenHeight(info, width));
    }
  } finally {
    await browser.close();
  }
}

async function design(slug: string, redo: boolean) {
  const lead = readLead(slug);
  const prompts = DEVICES.map(({ key }) => {
    const f = path.join(leadDir(slug), `prompt-${key}.txt`);
    if (!fs.existsSync(f)) throw new Error(`нет ${f}`);
    return fs.readFileSync(f, 'utf8');
  });
  if (lead.design?.projectId) {
    if (!redo) throw new Error(`у лида уже есть проект ${lead.design.url}; переделать целиком — --redo, правки — в design/*.html + push`);
    await stitchCall('delete_project', { name: `projects/${bareProjectId(lead.design.projectId)}` }).catch(() => {});
    console.log(`старый проект ${lead.design.projectId} удалён`);
    delete lead.design;
    writeLead(slug, lead);
  }
  // Незаконченный проект прошлого запуска (desktop готов, mobile упал) — продолжить с того же места
  const partialFile = path.join(designDir(slug), 'stitch-partial.json');
  let partial: { projectId: string; screens: any[]; designSystem?: string } | undefined = fs.existsSync(partialFile)
    ? JSON.parse(fs.readFileSync(partialFile, 'utf8'))
    : undefined;
  if (partial && redo) {
    await stitchCall('delete_project', { name: `projects/${partial.projectId}` }).catch(() => {});
    console.log(`незаконченный проект ${partial.projectId} удалён`);
    partial = undefined;
  }
  if (partial) {
    const ok = await stitchCall('get_project', { name: `projects/${partial.projectId}` }).then(() => true, () => false);
    if (!ok) partial = undefined;
  }
  let p: string;
  if (partial) {
    p = partial.projectId;
    console.log(`продолжаю проект ${p}: готово ${partial.screens.map((s) => s.device).join(', ')}`);
  } else {
    p = bareProjectId((await stitchCall('create_project', { title: `${lead.company} — концепт редизайна` })).name);
    await stitchCall('update_project', { name: `projects/${p}`, visibility: 'PUBLIC', updateMask: ['visibility'] });
    console.log(`проект ${p}`);
  }
  const screens: any[] = partial?.screens ?? [];
  let designSystem: string | undefined = partial?.designSystem;
  const savePartial = () => fs.writeFileSync(partialFile, JSON.stringify({ projectId: p, screens, designSystem }, null, 2));

  for (const [i, { device, key, title }] of DEVICES.entries()) {
    if (screens.some((s) => s.device === device)) continue;
    const a: Record<string, unknown> = { projectId: p, deviceType: device, modelId: MODEL, prompt: prompts[i] };
    if (designSystem) a.designSystem = designSystem;
    const t0 = Date.now();
    let g;
    for (let attempt = 1; ; attempt++) {
      try {
        g = parseGeneration(slug, key, await stitchCallLong('generate_screen_from_text', a));
        break;
      } catch (e) {
        const msg = (e as Error).message;
        // Stitch отказал сразу («service unavailable», 5xx): экран не создан — подождать и повторить в том же проекте
        const refused = /unavailable|HTTP 5\d\d|RESOURCE_EXHAUSTED|try again/i.test(msg);
        if (refused && attempt < GEN_TRIES) {
          console.log(`⚠ ${device}: ${msg.slice(0, 120)} — повтор ${attempt + 1}/${GEN_TRIES} через ${RETRY_DELAY_S} с`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_S * 1000));
          continue;
        }
        if (!refused) {
          // обрыв связи (socket hang up и т.п.): генерация могла завершиться на сервере — забрать экран, а не выбрасывать
          console.log(`⚠ ${device}: ${msg.slice(0, 120)} — ищу экран в проекте до 10 мин`);
          const rec = await recoverScreen(p, device, screens.map((s) => s.id));
          if (rec) {
            g = { screens: [rec.id], designSystem: rec.designSystem, text: '' };
            break;
          }
        }
        if (screens.length) {
          // готовые экраны не выбрасываем: следующий запуск design продолжит с этого устройства
          savePartial();
          throw new Error(`генерация ${device} не удалась (${msg}); проект ${p} сохранён с готовым ${screens.map((s) => s.device).join(', ')} — запустить design снова позже, продолжит с ${device}`);
        }
        // в пустом проекте мог остаться экран-обрывок, удалить его нельзя — выбрасываем проект целиком
        await stitchCall('delete_project', { name: `projects/${p}` }).catch(() => {});
        throw new Error(`генерация ${device} не удалась (${msg}); проект ${p} удалён — запустить design снова`);
      }
    }
    if (g.screens.length !== 1) console.log(`⚠ ${device}: Stitch вернул экранов ${g.screens.length} — проверить verify`);
    if (!g.screens[0]) throw new Error(`генерация ${device} не вернула экран (ответ: design/stitch-${key}.json)`);
    designSystem ??= g.designSystem;
    screens.push({ id: g.screens[0], device, title, file: `${key}.png` });
    savePartial();
    console.log(`✓ ${device} ${g.screens[0]} (${Math.round((Date.now() - t0) / 1000)} с)${g.text ? `\n  Stitch: ${g.text.slice(0, 400)}` : ''}`);
  }
  screens.sort((x, y) => DEVICES.findIndex((d) => d.device === x.device) - DEVICES.findIndex((d) => d.device === y.device));
  lead.design = {
    tool: 'stitch',
    projectId: p,
    url: `https://stitch.withgoogle.com/projects/${p}`,
    shared: true,
    screens,
    style: lead.design?.style ?? '',
    date: new Date().toISOString().slice(0, 10),
  };
  writeLead(slug, lead);
  fs.rmSync(partialFile, { force: true });
  await pull(slug);
  await verify([slug]); // ровно 2 экрана: после сбоев в проекте мог остаться лишний экран
  console.log(`✓ ${lead.design.url}\nДальше: проверить превью, править design/desktop.html и mobile.html, затем stitch.ts push ${slug}`);
}

/** Типографика (идемпотентно): тире не начинает строку, предлоги и числа не висят, телефоны не рвутся. */
function typography(src: string): string {
  const NB = ' ';
  let html = src.replace(/[ \t]+—(?=\s)/g, NB + '—').replace(/\n\s*—(?=\s)/g, NB + '—');
  for (let i = 0; i < 2; i++) html = html.replace(/(?<=[\s>(«" ])([А-Яа-яЁё]{1,2})[ \t]+(?=[А-Яа-яЁё0-9«"])/g, '$1' + NB);
  html = html.replace(/(?<=\d)[ \t]+(?=[а-яё])/g, NB);
  html = html.replace(/(?<=[\s>(«" ])(под|над|без|для|при|про|из-за|или|как|что|все|всё)[ \t]+(?=[А-Яа-яЁё0-9«"])/gi, '$1' + NB);
  const inTag = (off: number, s: string) => s.lastIndexOf('<', off) > s.lastIndexOf('>', off);
  const wrapped = (off: number, s: string) => s.slice(Math.max(0, off - 40), off).endsWith('white-space:nowrap">');
  const nowrap = (m: string, off: number, s: string) => (inTag(off, s) || wrapped(off, s) ? m : `<span style="white-space:nowrap">${m}</span>`);
  html = html.replace(/\+375[\s ]*\(?\d{2,4}\)?[\s ]*\d{2,3}[-\s ]\d{2}[-\s ]\d{2}/g, nowrap);
  html = html.replace(/(?<=[\s>(«" ])[A-Za-zА-Яа-яЁё0-9]{1,3}-[A-Za-zА-Яа-яЁё0-9]{1,3}(?=[\s<,.»" ])/g, nowrap);
  // текстовый элемент начинается с тире («— офис») → убрать тире
  return html.replace(/>(\s*)—[\s ]+(?=[А-Яа-яЁёA-Za-z0-9])/g, '>$1');
}

async function push(slug: string) {
  const d = readLead(slug).design;
  if (!d?.projectId) throw new Error(`${slug}: нет design.projectId`);
  const browser = await launchBrowser();
  try {
    for (const { device, key, width } of DEVICES) {
      const file = path.join(designDir(slug), `${key}.html`);
      const html = typography(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(file, html);
      const s = d.screens.find((x: any) => x.device === device);
      const name = screenName(d.projectId, s.id);
      const h = screenHeight(await stitchCall("get_screen", { name }), width);
      const png = await render(browser, slug, key, html, width, h);
      await stitchCall('update_screen', {
        name,
        htmlCodeBase64: Buffer.from(html, 'utf8').toString('base64'),
        screenshotBase64: png.toString('base64'),
        updateMask: ['html_code', 'screenshot'],
      });
      console.log(`✓ ${key} залит в Stitch`);
    }
  } finally {
    await browser.close();
  }
  await verify([slug]);
}

/** Публичная ссылка глазами клиента: проект PUBLIC, на холсте ровно 2 экрана (iframe *.stitched.dev). */
async function verify(slugs: string[]) {
  const browser = await launchBrowser();
  let bad = 0;
  try {
    for (const slug of slugs) {
      const d = readLead(slug).design;
      if (!d?.url) throw new Error(`${slug}: нет design.url`);
      const proj = await stitchCall('get_project', { name: `projects/${bareProjectId(d.projectId)}` });
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.goto(d.url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
      await page.waitForTimeout(15000);
      const n = page.frames().filter((f) => f.url().includes('stitched.dev')).length;
      await page.close();
      const ok = n === 2 && proj?.visibility === 'PUBLIC';
      if (!ok) bad++;
      console.log(`${ok ? '✓' : '✗'} ${slug}: экранов ${n}, ${proj?.visibility} — ${d.url}`);
    }
  } finally {
    await browser.close();
  }
  if (bad) throw new Error(`${bad} проект(ов) не готовы для клиента`);
}

try {
  const pos = args.filter((a) => !a.startsWith('--'));
  if (cmd === 'design' && pos.length === 1) await design(pos[0], args.includes('--redo'));
  else if (cmd === 'push' && pos.length === 1) await push(pos[0]);
  else if (cmd === 'pull' && pos.length === 1) await pull(pos[0]);
  else if (cmd === 'verify' && pos.length >= 1) await verify(pos);
  else {
    console.error(
      'Usage:\n' +
        '  npx tsx scripts/stitch.ts design <slug> [--redo]\n' +
        '  npx tsx scripts/stitch.ts push <slug>\n' +
        '  npx tsx scripts/stitch.ts pull <slug>\n' +
        '  npx tsx scripts/stitch.ts verify <slug...>',
    );
    process.exit(1);
  }
} catch (e) {
  console.error('✗', (e as Error).message);
  process.exit(1);
}
