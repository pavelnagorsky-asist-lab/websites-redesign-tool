---
name: report-leads
description: Обновление и показ общего списка (локальный list.csv + list.md) по готовым лидам — компания, сфера, сайт, контакты, проблемы, ссылка на редизайн в Stitch, доп. функционал, идеи. Использовать, когда просят «отчёт», «список», «итоги», «выгрузи».
---

# Общий список

Список ведётся локально: `D:\web-dev\websites-redesign\list.csv` (Excel) и `list.md`. Обычно он уже обновлён в конце `stitch-design`; этот скилл — для явного запроса.

1. `npx tsx scripts/validate.ts` — исправить ошибки у designed-лидов (дозаполнить поля), а не игнорировать.
2. Если `report.ts` пишет «проект Stitch не публичный» — `npx tsx scripts/stitch.ts publish <projectId>`, поставить `design.shared: true`.
3. `npx tsx scripts/report.ts` — пересоберёт список и проставит `reportedAt` новым.
4. Ответ пользователю: таблица (компания · сфера · сайт · ссылка Stitch · главный upsell), отдельно — какие добавлены сейчас; полные пути к `list.csv` / `list.md`.

`--all` — дополнительно `reports/all-<дата>.csv` со всеми лидами, включая отклонённые. Сводка по воронке: `npx tsx scripts/status.ts`.
