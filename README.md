# Учебный проект

Обучение через агентов OpenCode: основной оркестратор, субагент-учитель, независимый оценщик и детерминированный движок прогресса.

## Быстрый старт

Откройте сессию и выберите агента `study-orchestrator` (он уже стоит по умолчанию в репозитории), затем:

```text
/study компьютерные сети
```

Цикл: `/study <тема>` → ответы на диагностику → `/lesson` → ответы на задания → `/check <ответы>` → `/progress`.

## Тема или профессия

```text
/study компьютерные сети        → subjects/computer-networks/
/study python backend developer → tracks/python-backend/ + subjects/<секция>/
```

Одна тема — один предмет. Профессия — трек: набор секций (`python-core`, `git-basics`, `sql-for-backend`, `fastapi`) со своим порядком, общей диагностикой и агрегированным дашбордом. Секции лежат плоско в `subjects/` и не дублируются между треками: `git-basics` может входить и в backend, и во frontend.

## Структура

```text
.opencode/
├── agents/          study-orchestrator (primary), teacher, evaluator
├── commands/        /study /lesson /check /progress /market
└── skills/
    ├── subject-setup/      план + диагностика + прогресс
    ├── market-research/    требования рынка с hh.ru: market.json + market.md
    ├── lesson-generator/   теория + задания + ключ ответов + линтер
    ├── answer-evaluator/   рубрика и evaluation.json
    ├── lesson-checks/      проверка файловых заданий (код, Docker, конфиги)
    └── gamify-progress/    движок progress.json, треков и дашбордов
subjects/<slug>/     секция = обычный предмет, например computer-networks
tracks/<slug>/       профессия: состав секций, общая диагностика, агрегат прогресса
```

## Урок

Один урок — одна тема и один проверяемый результат. 15–25 минут: чтение 5–7,
практика остальное. Теория не больше 5 абзацев прозы, обязательны пример кода и
раздел «Где это в работе». Формат проверяет линтер:

```sh
node .opencode/skills/lesson-generator/scripts/lint-lesson.mjs \
  --lesson subjects/<slug>/lessons/lesson_N
```

Секция — 15–25 уроков, одиночный предмет — 20–30. Финальный урок секции —
чек-поинт «всё вместе». Длительность уроков лежит в `plan.md` колонкой «мин»,
по ней считается остаток часов на дашборде.

## Требования рынка

Перед составлением плана проект собирает требования к целевой роли из публичного поиска hh.ru: навыки, опыт, формат работы и зарплаты. Отчёт `market.md` ложится рядом с планом, и каждый навык с долей 30% и выше либо получает урок, либо явно исключается с причиной.

```sh
node .opencode/skills/market-research/scripts/market.mjs roles --text "аналитик данных"
node .opencode/skills/market-research/scripts/market.mjs collect --subject subjects/<slug> --role 156
node .opencode/skills/market-research/scripts/market.mjs render --subject subjects/<slug>

# Для профессии снапшот один на трек: hh-роль описывает профессию, а не навык
node .opencode/skills/market-research/scripts/market.mjs collect --track tracks/<track> --role 96
```

Обновить снапшот: `/market <slug>`. Подробности — в `market-research/SKILL.md`.

## Разделение ответственности

- Учитель пишет материалы и ключ ответов, но не выставляет оценки и не трогает `progress.json`.
- Оценщик проверяет только по файлам и пишет `evaluation.json`; он не может менять ответы или прогресс.
- Оркестратор делегирует работу, фиксирует результат и обновляет прогресс через скрипт.

## Движок прогресса

```sh
npm run verify                                 # валидация конфигурации + тесты движка
npm test                                       # только юнит-тесты движка
node .opencode/skills/gamify-progress/scripts/progress.mjs init --help  # см. gamify-progress/SKILL.md
```

Никогда не редактируйте `progress.json`, `dashboard.html`, `track.json` вручную. Все три принадлежат скрипту. `dashboard.html` хранит данные внутри себя, поэтому открывается по `file://` без сервера.

```sh
# Агрегат трека: только читает progress.json секций
node .opencode/skills/gamify-progress/scripts/progress.mjs track render --track tracks/<track>
```

## Оценка

Текстовые ответы оцениваются по рубрике: три критерия × 0–3, максимум 9, проходной балл 7. XP = `score × 10`, плюс 10 за 9/9. Неудачные попытки не дают XP, но записываются для бейджа `comeback_kid`.

## Файловые задания

Код, Dockerfile, `docker compose`, SQL-схемы и конфиги проверяются не текстом, а файлами:

```text
subjects/<slug>/lessons/lesson_N/
├── checks.json      # декларативные проверки
├── work/            # сюда пишет ученик
└── checks-result.json  # создаётся скриптом
```

```sh
# Безопасно: только статические проверки (файлы, YAML/JSON, регулярки)
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson subjects/<slug>/lessons/lesson_N

# С запуском Docker/сборки/тестов
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson ... --allow-exec
```

Урок сдан, только если `evaluation.json.score >= 7` (когда есть текстовые ответы) **и** `checks-result.json.status === "passed"` (когда есть `checks.json`). Для файлового урока без текста передай `--checks`:

```sh
node .opencode/skills/gamify-progress/scripts/progress.mjs complete \
  --progress subjects/<slug>/progress.json --lesson N \
  --checks subjects/<slug>/lessons/lesson_N/checks-result.json
```

Оценку `--checks` выводит скрипт из доли пройденных проверок: модель не может «на глаз» засчитать нерабочий конфиг.
