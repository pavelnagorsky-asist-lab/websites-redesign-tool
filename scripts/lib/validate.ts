import fs from 'node:fs';
import path from 'node:path';
import { leadDir, STATUSES, type Lead } from './leads.ts';

/** Quality gate per status. Returns list of problems (empty = ok). */
export function validateLead(l: Lead): string[] {
  const e: string[] = [];
  if (!STATUSES.includes(l.status)) e.push(`неизвестный статус "${l.status}"`);
  if (!l.company || l.company === l.domain) e.push('не указано название компании');
  if (!l.site) e.push('нет ссылки на сайт');

  const after = (s: Lead['status']) => STATUSES.indexOf(l.status) >= STATUSES.indexOf(s) && l.status !== 'rejected';

  if (l.status === 'rejected') {
    if (!l.rejectReason) e.push('rejected без rejectReason');
    return e;
  }
  if (after('audited') && !l.audit) e.push('нет аудита (scripts/audit.ts)');
  if (after('qualified')) {
    if (!l.industry) e.push('не указана сфера деятельности');
    if (!l.city) e.push('не указан город');
    if (l.rating.outdated == null || l.rating.potential == null || l.rating.complexity == null)
      e.push('не заполнен rating (outdated/potential/complexity)');
    if (l.problems.length < 2) e.push('опишите минимум 2 проблемы сайта (problems)');
    const c = l.contacts;
    if (!c.phones.length && !c.emails.length && !c.telegram.length && !c.viber.length)
      e.push('нет ни одного контакта');
  }
  if (l.status === 'designed') {
    const d = l.design;
    if (!d?.projectId || !d.url) e.push('нет проекта Stitch (design.projectId / design.url)');
    else {
      if (!d.screens.some((s) => s.device === 'DESKTOP')) e.push('нет десктопного экрана в Stitch');
      if (!d.screens.some((s) => s.device === 'MOBILE')) e.push('нет мобильного экрана в Stitch');
      for (const s of d.screens)
        if (s.file && !fs.existsSync(path.join(leadDir(l.slug), 'design', s.file)))
          e.push(`нет локального превью design/${s.file}`);
    }
    if (!l.upsell.length) e.push('не предложен доп. функционал (upsell)');
  }
  return e;
}
