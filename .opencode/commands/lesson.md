---
description: Следующий урок по текущему плану
agent: study-orchestrator
---

Выдай следующий урок по предмету: $ARGUMENTS

1. Прочитай `subjects/<slug>/progress.json` и `plan.md`.
2. Если предыдущий урок не сдан — не переходи дальше, а предложи доработку.
3. Вызови `teacher` для `lessons/lesson_N/`:
   - всегда: `theory.md`, `tasks.md`, `answer-key.md`;
   - если тема практическая (код, Dockerfile, docker compose, SQL, конфиг, скрипт) — ещё `checks.json`, `work/` и `work/README.md`.
   Практическую тему нельзя оформить как «опишите словами»: задание должно проверяться файлами.
4. Проверь `checks.json`: список проверок не пустой, и каждой `type: run` задан `teardown`:

```sh
node .opencode/skills/lesson-checks/scripts/check.mjs --lesson subjects/<slug>/lessons/lesson_N --list
```

Если `teardown` нет — верни урок учителю на доработку, не показывай ученику.

5. Покажи теорию и задания, ключ ответов не раскрывай. Скажи, какие проверки будут запущены и что именно они проверяют.
6. Если урок файловый — объясни, куда класть работу: `subjects/<slug>/lessons/lesson_N/work/`, и как проверить локально (из `work/README.md`).
7. Напомни, как отправить работу: `/check` (текстовые ответы — сообщением, файлы — просто сохранить в `work/`).
