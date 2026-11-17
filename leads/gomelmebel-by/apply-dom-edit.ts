// Одноразово: применить DOM-операции из ответа edit (Stitch не сохранил их в HTML экрана).
import fs from 'node:fs';
import { stitchCall } from '../../scripts/lib/stitch.ts';

const name = 'projects/7374928701699833914/screens/197aba67e1334585a1ec422abcf43e53';
const j = JSON.parse(fs.readFileSync('D:/web-dev/websites-redesign/leads/gomelmebel-by/design/stitch-edit-2026-11-17T09-51-25.json', 'utf8'));
const op = j.outputComponents.flatMap((c: any) => c.sessionEvent?.eventPayload?.dom_operations ?? []).find((o: any) => o.action === 'set_attribute');
const info = await stitchCall('get_screen', { name });
const dl = await stitchCall('download_file', { name: info.htmlCode.name });
let html: string = dl?.html ?? dl?.content;
const before = html.length;
html = html.replace(/(<img alt="Кухни"[^>]*?src=")[^"]+(")/, `$1${op.attr_value}$2`);
html = html.replace(/<div class="absolute top-6 left-8[^"]*">\s*Гомель · Центральный район\s*<\/div>/, '');
html = html.replace(/<div class="absolute bottom-6 right-8[^"]*">\s*ул\. Добролюбова\s*<\/div>/, '');
if (!html.includes(op.attr_value) || html.includes('Центральный район')) throw new Error('замена не прошла');
console.log('len', before, '→', html.length);
await stitchCall('update_screen', { name, htmlCodeBase64: Buffer.from(html, 'utf8').toString('base64'), updateMask: ['html_code'] });
console.log('ok');
