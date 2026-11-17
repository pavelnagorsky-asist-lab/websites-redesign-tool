/**
 * npx tsx scripts/check.ts <url|название> [<url|название> ...]
 * Проверка, не занимается ли уже кто-то компанией (локальные лиды + общий список).
 * Exit code 2, если найден хотя бы один дубль.
 */
import { findDuplicates, normalizeDomain, parseArgs, sharedListInfo } from './lib/leads.ts';

const { positional } = parseArgs();
if (!positional.length) {
  console.error('Usage: npx tsx scripts/check.ts <url|название> [...]');
  process.exit(1);
}

const info = sharedListInfo();
if (info.exists) console.log(`+ внешняя выгрузка data/shared-list.csv: ${info.rows} строк`);

let dupCount = 0;
for (const q of positional) {
  const domain = normalizeDomain(q);
  const matches = findDuplicates(domain ? { domain } : { name: q });
  const hard = matches.filter((m) => m.by !== 'name~');
  if (matches.length) {
    if (hard.length) dupCount++;
    console.log(hard.length ? `✗ ${q} — ЗАНЯТО` : `? ${q} — похожее название, проверьте`);
    for (const m of matches) console.log(`    [${m.where}/${m.by}] ${m.detail}`);
  } else console.log(`✓ ${q} — свободно`);
}
process.exit(dupCount ? 2 : 0);
