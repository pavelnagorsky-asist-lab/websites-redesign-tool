@AGENTS.md

## Только для Claude Code

- Процессы из `docs/workflows/` подключены как skills: `find-leads`, `qualify-lead`, `stitch-design`, `report-leads` (`.claude/skills/`).
- Субагенты (`.claude/agents/`): `lead-qualifier` — квалификация пачки 3–5 слагов (model sonnet); `stitch-designer` — дизайн одного лида (не больше 3 одновременно, model opus). В бриф дизайнеру: report.ts не запускать — его запускает координатор в конце.
- `stitch.ts design|push` запускать с `run_in_background` и ждать уведомления.
- MCP-сервер `stitch` (`.mcp.json`) необязателен — для просмотра проектов; генерировать через него нельзя (таймаут → экран теряется).
