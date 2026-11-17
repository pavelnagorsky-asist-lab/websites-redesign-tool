/**
 * npx tsx scripts/stitch.ts preview <slug> <projectId> <screenId> <file.png>
 *   — скачать скриншот экрана в leads/<slug>/design/<file.png> (+ уменьшенную копию <file>-view.jpg для просмотра)
 * npx tsx scripts/stitch.ts publish <projectId>
 *   — сделать проект публичным (visibility PUBLIC), чтобы ссылка открывалась у всех
 *
 * Работает напрямую с Stitch MCP по HTTP: base64 картинок не проходит через контекст Claude.
 */
import fs from 'node:fs';
import path from 'node:path';
import { leadDir } from './lib/leads.ts';
import { launchBrowser } from './lib/browser.ts';
import { bareProjectId, bareScreenId, stitchCall } from './lib/stitch.ts';

const [cmd, ...args] = process.argv.slice(2);

async function preview(slug: string, project: string, screen: string, file: string) {
  const p = bareProjectId(project);
  const s = bareScreenId(screen);
  const info = await stitchCall('get_screen', { name: `projects/${p}/screens/${s}` });
  const fileName = info?.screenshot?.name;
  if (!fileName) throw new Error(`У экрана ${s} нет скриншота (ещё генерируется?)`);
  const dl = await stitchCall('download_file', { name: fileName });
  const b64: string | undefined = dl?.image ?? dl?.data ?? dl?.content;
  if (!b64) throw new Error(`download_file: неожиданный ответ ${JSON.stringify(dl).slice(0, 200)}`);

  const dir = path.join(leadDir(slug), 'design');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, file);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));

  // уменьшенная копия для просмотра (оригинал бывает 2560×7000+)
  const view = out.replace(/\.\w+$/, '-view.jpg');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const w = info.deviceType === 'MOBILE' ? 400 : 800;
    await page.setContent(
      `<body style="margin:0"><img id="i" style="width:${w}px;display:block" src="data:image/png;base64,${b64}"></body>`,
    );
    await page.waitForFunction(() => (document.getElementById('i') as HTMLImageElement).complete);
    const h = await page.evaluate('document.getElementById("i").getBoundingClientRect().height');
    await page.setViewportSize({ width: w, height: Math.min(Math.ceil(Number(h)), 6000) });
    await page.screenshot({ path: view, type: 'jpeg', quality: 80 });
  } finally {
    await browser.close();
  }
  console.log(`✓ ${out} (${info.width}×${info.height}, ${info.deviceType})`);
  console.log(`✓ ${view} — смотреть этот`);
}

async function publish(project: string) {
  const p = bareProjectId(project);
  await stitchCall('update_project', { name: `projects/${p}`, visibility: 'PUBLIC', updateMask: ['visibility'] });
  const proj = await stitchCall('get_project', { name: `projects/${p}` });
  if (proj?.visibility !== 'PUBLIC') throw new Error(`Не удалось: visibility=${proj?.visibility}`);
  console.log(`✓ PUBLIC: https://stitch.withgoogle.com/projects/${p}`);
}

try {
  if (cmd === 'preview' && args.length === 4) await preview(args[0], args[1], args[2], args[3]);
  else if (cmd === 'publish' && args.length === 1) await publish(args[0]);
  else {
    console.error('Usage:\n  npx tsx scripts/stitch.ts preview <slug> <projectId> <screenId> <file.png>\n  npx tsx scripts/stitch.ts publish <projectId>');
    process.exit(1);
  }
} catch (e) {
  console.error('✗', (e as Error).message);
  process.exit(1);
}
