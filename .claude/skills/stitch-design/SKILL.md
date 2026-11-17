---
name: stitch-design
description: Создание концепта редизайна сайта компании в Google Stitch (через Stitch MCP) — главная desktop + mobile на реальном контенте компании, с сохранением ссылки и превью в лид. Использовать для лидов в статусе qualified или когда просят «сделай редизайн/дизайн/макет для X».
---

# Концепт редизайна в Google Stitch

Бюджет: ≤ 1 часа и ≤ 4 генерации + 2 правки на лид.

## 0. Проверка доступа

Нужны инструменты `mcp__stitch__*`. Если их нет — остановиться и сказать пользователю, что Stitch MCP не подключён (инструкция в README.md, раздел «Подключение Stitch»). Не подменять дизайн HTML-макетом.

Инструменты: `create_project`, `generate_screen_from_text` (projectId — голый id, prompt, deviceType DESKTOP|MOBILE, modelId `GEMINI_3_8_FLASH` — по умолчанию; `GEMINI_3_5_FLASH_LITE` — только для мелочей), `edit_screens` (projectId, selectedScreenIds[], prompt), `get_screen`, `list_screens`, `get_project`. Скачивание и публикацию делает скрипт (base64 не тянуть в контекст):
- `npx tsx scripts/stitch.ts preview <slug> <projectId> <screenId> desktop.png` → `design/desktop.png` + `design/desktop-view.jpg` (смотреть `-view.jpg`);
- `npx tsx scripts/stitch.ts publish <projectId>` → visibility PUBLIC (ссылка открывается у всех).

## 1. Подготовка (без генераций)

1. `leads/<slug>/lead.json` — статус должен быть `qualified` (или явная просьба пользователя).
2. `leads/<slug>/audit/content.json` — реальные тексты: заголовки, меню, услуги, цены, «о компании», контакты.
3. Скриншоты `audit/desktop.jpg`, `audit/mobile.jpg` — фирменные цвета, логотип, что сейчас плохо.
4. `docs/design-guide.md` — структура, стилевое направление по нише. Проверить `design.style` у других лидов той же ниши, чтобы не повторяться.
5. Написать промпт по шаблону из гайда → сохранить в `leads/<slug>/stitch-prompt.md` (desktop-промпт + мобильное дополнение + отдельный промпт доп. экрана, если делаем).

## 2. Генерация

1. `create_project` — title: `<Компания> — концепт редизайна`.
2. `generate_screen_from_text` — deviceType `DESKTOP`, промпт из файла.
   Генерация идёт минутами. Если вызов упал по таймауту/обрыву — **не генерировать заново**: проверять `list_screens` раз в ~30 с (до 10 раз), экран обычно появляется.
   Из ответа запомнить screenId и `designSystem` (`assets/<id>`) — для мобильного экрана.
3. `scripts/stitch.ts preview … desktop.png` → Read `design/desktop-view.jpg`.
4. Самопроверка по чек-листу гайда. Проблемы → `edit_screens` с точечной правкой (макс. 2 раза), после правки — снова preview.
5. `generate_screen_from_text` — deviceType `MOBILE`, тот же `designSystem`: тот же контент + мобильное дополнение + «same visual style, colors and fonts as the desktop screen». `preview … mobile.png`, проверить.
6. Опционально доп. экран (форма расчёта / меню / запись) — только если он продаёт `upsell`.

## 3. Запись результата

В `lead.json`:
```json
"design": {
  "tool": "stitch",
  "projectId": "<bare id>",
  "url": "https://stitch.withgoogle.com/projects/<id>",
  "shared": true,
  "screens": [
    { "id": "<screenId>", "device": "DESKTOP", "title": "Главная", "file": "desktop.png" },
    { "id": "<screenId>", "device": "MOBILE", "title": "Главная (мобильная)", "file": "mobile.png" }
  ],
  "style": "<направление, палитра, шрифты — одной строкой>",
  "date": "<YYYY-MM-DD>"
},
"status": "designed"
```
Перед записью: `npx tsx scripts/stitch.ts publish <projectId>` (shared: true ставить только после ✓). Затем `npx tsx scripts/validate.ts` и `npx tsx scripts/report.ts` (лид попадает в общий список `list.csv`).

## 4. Сообщить пользователю

- ссылку на проект (уже публичная);
- 1–2 фразы, что изменилось по сравнению с текущим сайтом.
