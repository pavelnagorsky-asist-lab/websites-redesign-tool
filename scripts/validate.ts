/**
 * npx tsx scripts/validate.ts
 * Проверяет все lead.json на полноту для текущего статуса.
 */
import { listLeads } from './lib/leads.ts';
import { validateLead } from './lib/validate.ts';

let bad = 0;
for (const l of listLeads()) {
  const errs = validateLead(l);
  if (!errs.length) continue;
  bad++;
  console.log(`✗ ${l.slug} [${l.status}]`);
  errs.forEach((e) => console.log('    - ' + e));
}
console.log(bad ? `\nПроблем: ${bad}` : '✓ Все лиды заполнены корректно');
process.exit(bad ? 1 : 0);
