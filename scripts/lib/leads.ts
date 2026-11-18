import fs from 'node:fs';
import path from 'node:path';
import { PATHS, today } from './config.ts';
import { parseCsv } from './csv.ts';

/**
 * candidate  — найден, ещё не проверен
 * audited    — автоаудит выполнен, ждёт решения
 * qualified  — подходит, можно делать редизайн
 * rejected   — не подходит (причина в rejectReason) — оставляем, чтобы не проверять повторно
 * designed   — дизайн в Stitch готов и проверен (ссылка в design.url)
 */
export const STATUSES = [
  'candidate',
  'audited',
  'qualified',
  'rejected',
  'designed',
] as const;
export type Status = (typeof STATUSES)[number];

export interface Contacts {
  emails: string[];
  phones: string[];
  telegram: string[];
  viber: string[];
  whatsapp: string[];
  instagram: string[];
  vk: string[];
  facebook: string[];
  address: string;
}

export interface AuditSummary {
  date: string;
  outdatedScore: number; // 0..100, чем выше — тем устаревшее
  reasons: string[];
  complexity: 'low' | 'medium' | 'high';
  complexitySignals: string[];
  cms: string[];
  mobileFriendly: boolean;
}

export interface DesignScreen {
  id: string;
  device: 'DESKTOP' | 'MOBILE' | 'TABLET' | string;
  title: string;
  /** локальная копия превью: leads/<slug>/design/<file> */
  file: string;
}

export interface Design {
  tool: 'stitch';
  projectId: string;
  /** ссылка для клиента: https://stitch.withgoogle.com/projects/<id> */
  url: string;
  /** проект публичный (stitch.ts design делает его публичным) */
  shared: boolean;
  screens: DesignScreen[];
  /** стилевое направление, коротко — для отчёта и чтобы не повторяться между лидами */
  style: string;
  date: string;
}

export interface Lead {
  slug: string;
  company: string;
  industry: string;
  city: string;
  country: 'BY' | 'RU' | string;
  site: string;
  domain: string;
  contacts: Contacts;
  status: Status;
  /** Оценка агента/человека по рубрике docs/criteria.md */
  rating: { outdated: number | null; potential: number | null; complexity: number | null };
  /** Проблемы текущего сайта — коротко, понятным владельцу языком */
  problems: string[];
  /** Что предложить сверх редизайна (см. docs/upsell-catalog.md) */
  upsell: string[];
  /** Прочие идеи */
  ideas: string[];
  /** Нужна ли клиенту CMS: "нет" | "да: галерея, цены" | "?" (docs/criteria.md). В общей таблице — колонка «Админка» */
  admin?: string;
  /** Основные контакты для общей таблицы (колонка «Contact info»): телефоны и email через запятую, без соцсетей и адресов (docs/criteria.md) */
  contactInfo?: string;
  rejectReason: string;
  activitySignals: string[];
  design: Design | null;
  source: string;
  assignee: string;
  createdAt: string;
  updatedAt: string;
  reportedAt: string;
  audit: AuditSummary | null;
  notes: string;
}

export function emptyContacts(): Contacts {
  return {
    emails: [],
    phones: [],
    telegram: [],
    viber: [],
    whatsapp: [],
    instagram: [],
    vk: [],
    facebook: [],
    address: '',
  };
}

export function leadDir(slug: string): string {
  return path.join(PATHS.leads, slug);
}

export function leadFile(slug: string): string {
  return path.join(leadDir(slug), 'lead.json');
}

export function listLeads(): Lead[] {
  if (!fs.existsSync(PATHS.leads)) return [];
  return fs
    .readdirSync(PATHS.leads, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(leadFile(d.name)))
    .map((d) => readLead(d.name));
}

export function readLead(slug: string): Lead {
  const file = leadFile(slug);
  if (!fs.existsSync(file)) throw new Error(`Лид не найден: ${slug} (${file})`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Lead;
}

export function writeLead(lead: Lead): void {
  lead.updatedAt = today();
  fs.mkdirSync(leadDir(lead.slug), { recursive: true });
  fs.writeFileSync(leadFile(lead.slug), JSON.stringify(lead, null, 2) + '\n', 'utf8');
}

/** "https://www.Типография.бел/contacts" -> "xn--...". Returns '' if not a URL/domain. */
export function normalizeDomain(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'http://' + s;
  try {
    const host = new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    return host.includes('.') ? host : '';
  } catch {
    return '';
  }
}

export function slugFromDomain(domain: string): string {
  return domain.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const LEGAL_WORDS = new Set([
  'ооо', 'оао', 'зао', 'пао', 'ао', 'чуп', 'чтуп', 'чп', 'уп', 'ип', 'одо', 'оо',
  'частное', 'унитарное', 'торговое', 'производственное', 'предприятие',
  'общество', 'с', 'ограниченной', 'ответственностью', 'ltd', 'llc',
]);

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !LEGAL_WORDS.has(w))
    .join(' ');
}

export function normalizePhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('80') && d.length === 11) d = '375' + d.slice(2); // BY: 80 29 xxx -> 375 29 xxx
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1); // RU: 8 9xx -> 7 9xx
  return d;
}

export function formatPhone(digits: string): string {
  const d = normalizePhone(digits);
  if (d.startsWith('375') && d.length === 12)
    return `+375 (${d.slice(3, 5)}) ${d.slice(5, 8)}-${d.slice(8, 10)}-${d.slice(10)}`;
  if (d.startsWith('7') && d.length === 11)
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  return d ? '+' + d : '';
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr.filter(Boolean))];
}

// ---------------------------------------------------------------- dedupe

export interface DupMatch {
  where: 'local' | 'shared';
  /** name~ = нечёткое совпадение названия (только предупреждение) */
  by: 'domain' | 'name' | 'name~';
  detail: string;
}

interface SharedEntry {
  domains: string[];
  names: string[];
  raw: string;
}

let sharedCache: SharedEntry[] | null = null;

export function sharedListInfo(): { exists: boolean; ageHours: number; rows: number } {
  if (!fs.existsSync(PATHS.sharedList)) return { exists: false, ageHours: Infinity, rows: 0 };
  const ageHours = (Date.now() - fs.statSync(PATHS.sharedList).mtimeMs) / 36e5;
  return { exists: true, ageHours, rows: loadSharedList().length };
}

export function loadSharedList(): SharedEntry[] {
  if (sharedCache) return sharedCache;
  if (!fs.existsSync(PATHS.sharedList)) return (sharedCache = []);
  const rows = parseCsv(fs.readFileSync(PATHS.sharedList, 'utf8'));
  const domainRe = /(?:https?:\/\/)?(?:www\.)?([a-zа-я0-9-]+(?:\.[a-zа-я0-9-]+)*\.(?:by|ru|бел|рф|com|net|org|su|info|biz|pro|shop|online|site|store|eu))(?![a-zа-я0-9-])/gi;
  sharedCache = rows.slice(1).map((r) => {
    const domains: string[] = [];
    for (const cell of r) {
      if (/@/.test(cell)) {
        // skip e-mail domains (gmail.com etc.) — but keep corporate domain from emails? no: too noisy
        const withoutEmails = cell.replace(/\S+@\S+/g, ' ');
        for (const m of withoutEmails.matchAll(domainRe)) domains.push(normalizeDomain(m[0]));
      } else for (const m of cell.matchAll(domainRe)) domains.push(normalizeDomain(m[0]));
    }
    // first non-empty, non-URL short cell is usually the company name
    const names = r
      .filter((c) => c.trim() && c.length < 120 && !/\.(by|ru|бел|рф|com)(?![a-zа-я])|https?:|@/i.test(c))
      .slice(0, 2)
      .map(normalizeName)
      .filter((n) => n.length >= 3);
    return { domains: uniq(domains), names, raw: r.join(' | ').slice(0, 160) };
  });
  return sharedCache;
}

/** 'name' = exact, 'name~' = one name contains the other (min 5 chars), null = no match */
function namesMatch(a: string, b: string): 'name' | 'name~' | null {
  if (!a || !b) return null;
  if (a === b) return a.length >= 4 ? 'name' : null;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 5 && ` ${long} `.includes(` ${short} `) ? 'name~' : null;
}

export function findDuplicates(query: { domain?: string; name?: string }): DupMatch[] {
  const matches: DupMatch[] = [];
  const domain = query.domain ? normalizeDomain(query.domain) : '';
  const name = query.name ? normalizeName(query.name) : '';

  for (const l of listLeads()) {
    if (domain && l.domain === domain)
      matches.push({ where: 'local', by: 'domain', detail: `${l.slug} (${l.company}, ${l.status})` });
    else {
      const by = namesMatch(normalizeName(l.company), name);
      if (by) matches.push({ where: 'local', by, detail: `${l.slug} (${l.company}, ${l.status})` });
    }
  }
  for (const e of loadSharedList()) {
    if (domain && e.domains.includes(domain))
      matches.push({ where: 'shared', by: 'domain', detail: e.raw });
    else {
      const by = e.names.map((n) => namesMatch(n, name)).find(Boolean);
      if (by) matches.push({ where: 'shared', by, detail: e.raw });
    }
  }
  return matches;
}

/** Tiny argv helper: positional args + --flag / --key value / --key=value */
export function parseArgs(argv = process.argv.slice(2)) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}
