---
name: lesson-checks
description: Проверяет файловые задания (код, Dockerfile, docker compose, конфиги) детерминированными командами и пишет checks-result.json. Используй, когда урок требует файлов, а не текстового ответа.
---

# Проверка файловых заданий

Текстовые ответы проверяет `evaluator`. Файлы проверяет этот скилл: команды запускаются в папке урока и дают объективный результат.

## Структура урока с файлами

```text
subjects/<slug>/lessons/lesson_<N>/
├── theory.md
├── tasks.md
├── answer-key.md
├── checks.json          # что и как проверять
├── work/                # сюда пишет ученик
│   ├── solution.js
│   ├── Dockerfile
│   └── compose.yaml
├── answers.md           # текстовые ответы, если есть
├── checks-result.json   # создаётся скриптом
└── evaluation.json      # создаётся оценщиком
```

`work/` — территория ученика. Учитель и оценщик не должны её менять.

## Формат checks.json

```json
{
  "lesson": 1,
  "checks": [
    {
      "id": "compose-valid",
      "title": "docker compose config проходит",
      "type": "static",
      "command": "docker compose -f work/compose.yaml config --quiet",
      "timeout_seconds": 60,
      "required": true
    },
    {
      "id": "service-web",
      "title": "есть сервис web с образом nginx",
      "type": "static",
      "command": "node ../../../../.opencode/skills/lesson-checks/scripts/assert.mjs --file work/compose.yaml --yaml-path services.web.image --equals nginx:alpine",
      "required": true
    },
    {
      "id": "app-starts",
      "title": "приложение отвечает 200",
      "type": "run",
      "command": "docker compose -f work/compose.yaml up -d --build && node ../../../../.opencode/skills/lesson-checks/scripts/assert.mjs --http http://localhost:8080 --status 200",
      "teardown": "docker compose -f work/compose.yaml down -v",
      "timeout_seconds": 180,
      "required": false
    }
  ]
}
```

Поля:

| Поле | Обязательно | Смысл |
| --- | --- | --- |
| `id` | да | уникальное имя проверки |
| `title` | нет | человекочитаемое название |
| `type` | да | `static` (не запускает контейнеры и сервисы) или `run` (поднимает контейнеры, сборку, сервер) |
| `command` | да | команда оболочки, выполняется в папке урока |
| `teardown` | нет | очистка после `run`-проверки |
| `timeout_seconds` | нет | по умолчанию 60 |
| `required` | нет | по умолчанию `true` |
| `weight` | нет | для будущего взвешивания |

## Запуск

```sh
# Посмотреть список проверок (колонки: id, тип, required, teardown, название)
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson subjects/<slug>/lessons/lesson_1 --list

# Выполнить только статические проверки (безопасно, по умолчанию)
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson subjects/<slug>/lessons/lesson_1

# Выполнить всё, включая docker/сборку/тесты
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson subjects/<slug>/lessons/lesson_1 --allow-exec

# Одна проверка
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson ... --allow-exec --only app-starts
```

Результат — `checks-result.json` со статусом:

- `passed` — все обязательные проверки прошли;
- `failed` — хотя бы одна обязательная упала;
- `incomplete` — обязательная `run`-проверка пропущена без `--allow-exec`.

Коды выхода: `0` — passed, `1` — failed, `2` — incomplete, `3` — ошибка конфигурации.

## Правила

- `run`-проверки выполняются только с явным `--allow-exec`: они запускают Docker, сборку и тесты.
- Всегда указывай `teardown` для `run`, чтобы не оставлять контейнеры и процессы.
- Проверки должны быть идемпотентными и не зависеть от сети, если это возможно.
- Не проверяй стиль кода регулярками; для этого используй линтер.
- Если задание требует файл, но `checks.json` нет — урок считается неполным, а не «сданным на словах».
- Итоговая оценка: `evaluation.json` (`score`, рубрика) + `checks-result.json` (гейт). Урок сдан, только если `score >= 7` и `status === "passed"`.

## Хелпер assert.mjs

`scripts/assert.mjs` — маленькие проверки без внешних зависимостей:

```sh
node assert.mjs --exists work/solution.js
node assert.mjs --file work/solution.js --contains "module.exports"
node assert.mjs --file work/compose.yaml --yaml-path services.web.image --equals nginx:alpine
node assert.mjs --file work/data.json --json-path items.0.id --equals 42
node assert.mjs --http http://localhost:8080/health --status 200
node assert.mjs --command "node work/solution.js" --exit 0 --stdout-contains OK
```

Все проверки печатают понятную причину падения и возвращают код 1 при провале.
