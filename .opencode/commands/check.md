---
description: Проверить ответы и файлы на текущий урок
agent: study-orchestrator
---

Проверь работу ученика: $ARGUMENTS

1. Определи активный предмет по последнему изменённому `subjects/*/progress.json`, если предмет не указан.
2. Прочитай `progress.json` → `current_lesson`.
3. Если в сообщении есть текстовые ответы — сохрани их без правок в `lessons/lesson_N/answers.md`.
4. Если у урока есть `checks.json` — проверь файлы ученика из `lessons/lesson_N/work/`:

```sh
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson subjects/<slug>/lessons/lesson_N
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson subjects/<slug>/lessons/lesson_N --allow-exec
```

`--allow-exec` нужен, если в `checks.json` есть обязательные `type: run` (Docker, сборка, тесты). Без флага такие проверки дают `incomplete`, а не «сдано».

5. Если есть `answers.md` — вызови `evaluator` с путями к `tasks.md`, `answer-key.md`, `answers.md` и `checks-result.json`. Оценщик пишет `evaluation.json`.
6. Итог считай по двум условиям:
   - есть `answers.md` → `evaluation.json.score >= 7`;
   - есть `checks.json` → `checks-result.json.status === "passed"`.
   Если хотя бы одно условие не выполнено — урок не сдан.
7. Дальше:
   - сдан текстовый урок — `complete --score <score>` из `evaluation.json`;
   - сдан файловый урок — `complete --checks subjects/<slug>/lessons/lesson_N/checks-result.json`, оценку не подставляй вручную;
   - не сдан — `attempt` (для файлового — тоже с `--checks`), покажи вывод упавших проверок (`stderr`/`stdout` из `checks-result.json`) и наводящие вопросы из `evaluation.json`, ключ не раскрывай;
   - провал по файлам — скажи, какой именно файл и какое условие не выполнены, и что исправить. Сам `work/` не правь.
8. После `complete` перегенерируй дашборд и покажи награды. Не меняй оценку оценщика и не засчитывай урок «на словах», если проверки не проходили.
