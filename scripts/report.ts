/**
 * npx tsx scripts/report.ts          обновить общий список: list.csv (Excel) + list.md — все готовые лиды (designed)
 * npx tsx scripts/report.ts --all    + выгрузка всех лидов, включая отклонённые → reports/all-<дата>.csv
 *
 * Лид попадает в список, если status=designed, проходит validate и проект Stitch публичный.
 * При первом попадании ставится reportedAt (дата внесения).
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT, today } from './lib/config.ts';
import { toCsv } from './lib/csv.ts';
import { listLeads, parseArgs, writeLead, type Lead } from './lib/leads.ts';
import { validateLead } from './lib/validate.ts';

const { flags } = parseArgs();
const all = listLeads().sort(
  (a, b) => (a.reportedAt || '9999').localeCompare(b.reportedAt || '9999') || a.createdAt.localeCompare(b.createdAt),
);

const warnings: string[] = [];
const ready: Lead[] = [];
for (const l of all.filter((l) => l.status === 'designed')) {
  const errs = validateLead(l);
  if (l.design && !l.design.shared) errs.push('проект Stitch не публичный (scripts/stitch.ts verify)');
  if (errs.length) warnings.push(`⚠ ${l.slug} не внесён: ${errs.join('; ')}`);
  else ready.push(l);
}

const added: Lead[] = [];
for (const l of ready)
  if (!l.reportedAt) {
    l.reportedAt = today();
    writeLead(l);
    added.push(l);
  }

const messengers = (l: Lead) =>
  [
    ...l.contacts.telegram.map((x) => `Telegram: ${x}`),
    ...l.contacts.viber.map((x) => `Viber: ${x}`),
    ...l.contacts.whatsapp.map((x) => `WhatsApp: ${x}`),
    ...l.contacts.instagram.map((x) => `Instagram: ${x}`),
    ...l.contacts.vk.map((x) => `VK: ${x}`),
    ...l.contacts.facebook.map((x) => `Facebook: ${x}`),
  ].join('\n');
const bullets = (a: string[]) => a.map((x) => `• ${x}`).join('\n');

const header = [
  '№', 'Компания', 'Сфера', 'Город', 'Сайт', 'Email', 'Телефон', 'Мессенджеры / соцсети',
  'Проблемы текущего сайта', 'Редизайн (Stitch)', 'Доп. функционал', 'Идеи', 'Исполнитель', 'Внесён',
];
const row = (l: Lead, i: number) => [
  String(i + 1),
  l.company,
  l.industry,
  l.city,
  l.site,
  l.contacts.emails.join('\n'),
  l.contacts.phones.join('\n'),
  messengers(l),
  l.status === 'rejected' ? `Отклонён: ${l.rejectReason}` : bullets(l.problems),
  l.design?.url ?? '',
  bullets(l.upsell),
  bullets(l.ideas),
  l.assignee,
  l.reportedAt,
];

// ; + BOM — открывается в русском Excel по колонкам
const writeCsv = (file: string, leads: Lead[]) =>
  fs.writeFileSync(file, '﻿' + toCsv([header, ...leads.map(row)], ';'), 'utf8');

const listCsv = path.join(ROOT, 'list.csv');
const listMd = path.join(ROOT, 'list.md');
writeCsv(listCsv, ready);

const card = (l: Lead, i: number) =>
  [
    `### ${i + 1}. ${l.company} — ${l.industry}${l.city ? `, ${l.city}` : ''}`,
    `**Сайт:** ${l.site}  `,
    `**Редизайн:** ${l.design?.url ?? '—'}  `,
    `**Контакты:** ${[...l.contacts.phones, ...l.contacts.emails].join(', ') || '—'}`,
    messengers(l) ? messengers(l).split('\n').map((x) => `- ${x}`).join('\n') : '',
    `**Проблемы сайта:**\n${l.problems.map((x) => `- ${x}`).join('\n')}`,
    l.upsell.length ? `**Доп. функционал:**\n${l.upsell.map((x) => `- ${x}`).join('\n')}` : '',
    l.ideas.length ? `**Идеи:**\n${l.ideas.map((x) => `- ${x}`).join('\n')}` : '',
    `_Внесён: ${l.reportedAt}${l.assignee ? ` · ${l.assignee}` : ''}_`,
  ]
    .filter(Boolean)
    .join('\n');
fs.writeFileSync(
  listMd,
  `# Общий список — потенциальные клиенты на редизайн\n\nОбновлён: ${today()} · всего: ${ready.length}\n\n${ready.map(card).join('\n\n---\n\n')}\n`,
  'utf8',
);

if (flags.all) {
  fs.mkdirSync(PATHS.reports, { recursive: true });
  const file = path.join(PATHS.reports, `all-${today()}.csv`);
  writeCsv(file, all);
  console.log(`✓ Все лиды (${all.length}) → ${file}`);
}

console.log(`✓ Общий список: ${ready.length} компаний → ${listCsv}, ${listMd}`);
if (added.length) console.log(`  новые: ${added.map((l) => l.company).join(', ')}`);
warnings.forEach((w) => console.log(w));
