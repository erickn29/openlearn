# Учебный проект

Обучение через агентов OpenCode: основной оркестратор, субагент-учитель, независимый оценщик и детерминированный движок прогресса.

## Быстрый старт

Откройте сессию и выберите агента `study-orchestrator` (он уже стоит по умолчанию в репозитории), затем:

```text
/study компьютерные сети
```

Цикл: `/study <тема>` → ответы на диагностику → `/lesson` → ответы на задания → `/check <ответы>` → `/progress`.

## Структура

```text
.opencode/
├── agents/          study-orchestrator (primary), teacher, evaluator
├── commands/        /study /lesson /check /progress
└── skills/
    ├── subject-setup/      план + диагностика + прогресс
    ├── lesson-generator/   теория + задания + ключ ответов
    ├── answer-evaluator/   рубрика и evaluation.json
    ├── lesson-checks/      проверка файловых заданий (код, Docker, конфиги)
    └── gamify-progress/    движок progress.json + рендер дашборда
subjects/<slug>/     отдельная папка на тему, например computer-networks
```

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

Никогда не редактируйте `subjects/*/progress.json` и `dashboard.html` вручную. Оба файла принадлежат скрипту. `dashboard.html` хранит данные внутри себя, поэтому открывается по `file://` без сервера.

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
