/**
 * npx tsx scripts/status.ts [--status qualified]
 * Сводка по воронке.
 */
import { listLeads, parseArgs, STATUSES } from './lib/leads.ts';

const { flags } = parseArgs();
const leads = listLeads().sort((a, b) => a.status.localeCompare(b.status) || a.slug.localeCompare(b.slug));

const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
for (const l of leads) counts[l.status] = (counts[l.status] ?? 0) + 1;
console.log(STATUSES.map((s) => `${s}: ${counts[s]}`).join('  |  '));
const unreported = leads.filter((l) => l.status === 'designed' && !l.reportedAt).length;
if (unreported) console.log(`Готовы, но не внесены в общий список: ${unreported} → npx tsx scripts/report.ts`);
console.log();

const filtered = typeof flags.status === 'string' ? leads.filter((l) => l.status === flags.status) : leads;
console.table(
  filtered.map((l) => ({
    slug: l.slug,
    company: l.company.slice(0, 32),
    industry: l.industry.slice(0, 18),
    city: l.city,
    status: l.status,
    auto: l.audit?.outdatedScore ?? '',
    rating: l.rating.outdated != null ? `${l.rating.outdated}/${l.rating.potential}/${l.rating.complexity}` : '',
    reported: l.reportedAt,
  })),
);
