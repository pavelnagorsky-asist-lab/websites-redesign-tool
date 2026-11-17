// Одноразово: мобильный экран получил Space Grotesk (нет кириллицы) → Unbounded, как на десктопе.
import { stitchCall } from '../../scripts/lib/stitch.ts';

const name = 'projects/7374928701699833914/screens/6eba3d07651e4b27b7078294e3bbd1a0';
const info = await stitchCall('get_screen', { name });
const dl = await stitchCall('download_file', { name: info.htmlCode.name });
let html: string = dl?.html ?? dl?.content;
html = html.replace('family=Space+Grotesk:wght@500;600;700', 'family=Unbounded:wght@500;600;700');
html = html.replace(/"Space Grotesk"/g, '"Unbounded"').replace('Google Fonts: Space Grotesk', 'Google Fonts: Unbounded');
html = html.replace(/text-primary flex-shrink-0 w-12/g, 'text-primary flex-shrink-0 w-16');
html = html.replace(/<div class="(fixed|sticky) bottom-0 left-0 right-0 max-w-\[390px\]/,'<div class="relative w-full max-w-[390px]');
html = html.replace('pt-space-lg pb-24 flex flex-col gap-6', 'pt-space-lg pb-space-lg flex flex-col gap-6');
if (/Space.Grotesk/.test(html)) throw new Error('осталось Space Grotesk');
if (process.argv.includes('--dry')) {
  (await import('node:fs')).writeFileSync('D:/web-dev/websites-redesign/leads/gomelmebel-by/design/mobile-font.html', html);
  console.log('dry ok');
} else {
  await stitchCall('update_screen', { name, htmlCodeBase64: Buffer.from(html, 'utf8').toString('base64'), updateMask: ['html_code'] });
  console.log('ok');
}
