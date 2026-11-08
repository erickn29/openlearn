# AGENTS.md

## Проект

Учебная система на агентах OpenCode. Это не приложение, а конфигурация и контент. Поведение описано в `.opencode/agents`, `.opencode/commands` и `.opencode/skills`; данные ученика лежат в `subjects/<slug>/`, программы из нескольких предметов — в `tracks/<slug>/`.

## Тема или профессия

- «Хочу разобраться в сетях» — один предмет в `subjects/<slug>/`.
- «Хочу стать python backend» — трек в `tracks/<slug>/`, который ссылается на несколько `subjects/<секция>/` по slug.

Секция — обычный предмет: те же уроки, тот же `progress.json`, тот же дашборд. Трек не дублирует уроки, а только задаёт состав, порядок и общий снапшот рынка. Секции лежат плоско (`subjects/git-basics/`), а не внутри трека: `lesson-checks` считает относительный путь `../../../../.opencode/...` от папки урока, и лишняя вложенность ломает все проверки молча.

## Основные команды

```sh
npm run verify                                              # валидация конфигурации + тесты; запускать перед завершением изменений
npm test                                                    # юнит-тесты движков (node:test)
node .opencode/skills/gamify-progress/scripts/progress.mjs <init|diagnostic|attempt|complete|render> ...
node .opencode/skills/gamify-progress/scripts/progress.mjs track <init|render> --track tracks/<slug> ...
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson <папка урока> [--allow-exec] [--only id]
node .opencode/skills/lesson-generator/scripts/lint-lesson.mjs --lesson <папка урока>
node .opencode/skills/market-research/scripts/market.mjs <roles|collect|render> [--subject|--track <папка>] ...
```

Один файл тестов: `node --test test/progress.test.mjs`. Один тест по имени: `node --test --test-name-pattern "streak"`.

`npm run check` проверяет frontmatter агентов, команд и скиллов, ловит V1-ключи и завершающие общие `deny`. Предупреждения про «last-match-wins» ожидаемы.

## Неочевидные правила

- Никогда не редактируй `subjects/*/progress.json` и `dashboard.html` вручную. Ими владеет `progress.mjs`: `complete`/`attempt` меняют состояние, `render` перерисовывает дашборд.
- `tracks/*/track.json` и `tracks/*/dashboard.html` тоже принадлежат `progress.mjs` (`track init` и `track render`). Агрегат трека не хранится: он пересчитывается из `progress.json` секций, и `track render` не имеет права писать в `subjects/`.
- `subjects/*/market.json` и `market.md` принадлежат `market.mjs` (`collect` пишет снапшот, `render` — отчёт). Руками не править: цифры должны пересобираться, а не подкручиваться. У секции внутри трека своего снапшота нет: рынок собирается один раз на профессию в `tracks/<slug>/`, потому что hh-роль описывает профессию, а не отдельный навык.
- `complete` отклоняет оценку ниже 7 и уже засчитанные уроки (кроме случая с `--force`). Для провалов используй `attempt`, иначе не сработает `comeback_kid`.
- `init` отказывается перезаписывать существующий `progress.json`. Никогда не сбрасывай прогресс ученика только чтобы перерисовать дашборд — для этого есть `render`.
- Учитель не должен писать `progress.json`, `dashboard.html`, `market.json`, `market.md`, `answers.md`, `evaluation.json` и `checks-result.json`; оценщик может писать только `evaluation.json`. Папка `work/` принадлежит ученику: не редактируй её.
- Уроки выдаются только после ответов на диагностику. Не создавай урок 1, пока нет `diagnostic-answers.md`. В треке гейт один на все секции: `tracks/<slug>/diagnostic-answers.md`.
- Один урок — одна тема и один проверяемый результат, 15–25 минут. Теория — не больше 5 абзацев прозы, практика не меньше чтения, обязательны пример кода и раздел «Где это в работе». Формат проверяет `lint-lesson.mjs`; урок с кодом выхода `1` ученику не показывают.
- Секция — 15–25 атомарных уроков, одиночный предмет — 20–30. Если тема не влезает, делится секция, а не растягивается урок. Финальный урок секции — чек-поинт «всё вместе», на нём выдаётся `boss_defeated`.
- Длительность уроков живёт в `plan.md` колонкой «мин». Отдельного `lesson.json` нет: второй источник истины разъедется с планом. `track render` читает эту колонку и считает остаток часов, а если колонки нет — не выдумывает цифру.
- Практические задания проверяются файлами через `lesson-checks`, а не текстом. Урок сдан, только если `evaluation.json.score >= 7` (при наличии ответов) и `checks-result.json.status === "passed"` (при наличии `checks.json`). Файловый урок засчитывается через `complete --checks <checks-result.json>`: оценку выводит скрипт, а не модель.
- `run`-проверки в `checks.json` выполняются только с `--allow-exec` и должны иметь `teardown`; без флага они дают статус `incomplete`, а не «сдано».
- Slug предмета — kebab-case из строчной латиницы и должен оставаться неизменным между сессиями: это имя папки и идентификатор прогресса.
- `dashboard.html` должен держать данные внутри файла: `file://` блокирует `fetch`, поэтому отдельной загрузки JSON нет.
- Требования рынка берутся с публичного поиска hh.ru, а не с API: `api.hh.ru/vacancies` без токена отдаёт 403. Данные лежат в `<template id="HH-Lux-InitialState">` на странице поиска. Разметка не контракт: код выхода `3` у `market.mjs` значит «починить парсер», а не «вакансий нет».
- Сбор с hh идёт с паузой 800–1500 мс и бюджетом времени (`--max-seconds`); `keySkills` заполнены не у всех вакансий, поэтому доля навыка считается от вакансий с навыками, а не от всех собранных.

## Формат конфигурации OpenCode (V2)

Во frontmatter агентов используется `permissions:` — упорядоченный список `{action, resource, effect}`, а не карта `permission:` из V1. Действия: `shell`/`subagent`/`edit` (в V1 было `bash`/`task`/`write`). Правила прав работают по принципу last-match-wins. В `opencode.jsonc` агентом по умолчанию назначен `study-orchestrator`.

ID скилла — это имя его папки в `.opencode/skills/`, а не поле `name` во frontmatter. Команды лежат в `.opencode/commands/*.md`: тело файла — шаблон промпта, а `$ARGUMENTS` дописывается, если в шаблоне нет плейсхолдера.

MCP описывается через `mcp.servers`, провайдеры — через `providers` (с ключом `package`, например `aisdk:@ai-sdk/openai-compatible`), а не `provider` + `npm`. Ключи `compaction.prune`, `compaction.tail_turns`, `compaction.reserved` помечены deprecated — используйте `compaction.buffer` и `compaction.keep.tokens`. Локальные MCP не запускайте через `npx @scope/pkg@latest`: это скачивает новую версию при каждом старте. Предпочитайте встроенный `browser`-скилл вместо `@playwright/mcp`.

## Диагностика зависаний

- Сервис один на машину: `opencode service status|restart`. Не запускайте параллельно десктоп и TUI разных версий — они перезаписывают `~/.local/state/opencode/service.json` и убивают in-flight ходы (`managed service registration replaced`).
- `Session.MessageDecodeError` в логе частая реакция на несовпадение версий и на битую запись, а не обязательно на порчу БД. Перед правкой `opencode.db` сделайте бэкап и проверьте, что сессия читается: `opencode api get /api/session/<id>/context`.
- Логи: `~/.local/share/opencode/log/opencode.log` (сервер) и `~/.local/share/opencode/log/<timestamp>.log` (десктоп).

## Полезные файлы

- `.opencode/skills/gamify-progress/references/schema.md` — структура `progress.json`.
- `.opencode/skills/gamify-progress/references/badges.md` — условия бейджей.
- `.opencode/skills/market-research/references/hh-web.md` — разметка hh.ru, лимиты, коды выхода.
- `subjects/computer-networks/` — рабочий пример предмета.
