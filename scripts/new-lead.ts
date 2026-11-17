/**
 * npx tsx scripts/new-lead.ts <url> --name "Компания" --industry "Типография" --city "Минск" [--country BY] [--source "..."] [--force]
 * Создаёт leads/<slug>/lead.json после проверки на дубли (локально + общий список).
 */
import { CONFIG, today } from './lib/config.ts';
import {
  emptyContacts,
  findDuplicates,
  normalizeDomain,
  parseArgs,
  slugFromDomain,
  writeLead,
  type Lead,
} from './lib/leads.ts';

const { positional, flags } = parseArgs();
const url = positional[0];
if (!url) {
  console.error('Usage: npx tsx scripts/new-lead.ts <url> --name "..." --industry "..." --city "..."');
  process.exit(1);
}

const domain = normalizeDomain(url);
if (!domain) {
  console.error(`Не похоже на URL: ${url}`);
  process.exit(1);
}

const name = typeof flags.name === 'string' ? flags.name : domain;

const all = findDuplicates({ domain, name });
const dups = all.filter((d) => d.by !== 'name~');
for (const d of all.filter((d) => d.by === 'name~'))
  console.warn(`⚠ Похожее название [${d.where}]: ${d.detail} — проверьте, не та же ли компания`);
if (dups.length && !flags.force) {
  console.error(`✗ ДУБЛЬ — ${domain} уже есть:`);
  for (const d of dups) console.error(`  [${d.where}/${d.by}] ${d.detail}`);
  console.error('Пропустите компанию (или --force, если уверены, что это ошибка сопоставления).');
  process.exit(2);
}

const slug = slugFromDomain(domain);
const site = /^https?:\/\//i.test(url) ? new URL(url).origin : `https://${url.replace(/\/.*$/, '')}`;

const lead: Lead = {
  slug,
  company: name,
  industry: String(flags.industry ?? ''),
  city: String(flags.city ?? ''),
  country: String(flags.country ?? 'BY'),
  site,
  domain,
  contacts: emptyContacts(),
  status: 'candidate',
  rating: { outdated: null, potential: null, complexity: null },
  problems: [],
  upsell: [],
  ideas: [],
  rejectReason: '',
  activitySignals: [],
  design: null,
  source: String(flags.source ?? ''),
  assignee: CONFIG.assignee,
  createdAt: today(),
  updatedAt: today(),
  reportedAt: '',
  audit: null,
  notes: '',
};

writeLead(lead);
console.log(`✓ Создан лид: leads/${slug}/lead.json`);
console.log(`  Дальше: npx tsx scripts/audit.ts ${slug}`);
