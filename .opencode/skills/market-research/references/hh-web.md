# Разметка hh.ru: что откуда берётся

Проверено на живом сайте 08.11.2026 с российского IP.

## Почему не API

| Запрос | Без токена |
| --- | --- |
| `api.hh.ru/vacancies` | **403** `{"errors":[{"type":"forbidden"}]}` |
| `api.hh.ru/vacancies/{id}` | **403** |
| `api.hh.ru/employers/{id}` | **403** |
| `api.hh.ru/professional_roles` | 200 |
| `api.hh.ru/areas/{id}` | 200 |
| `api.hh.ru/dictionaries` | 200 |
| `api.hh.ru/suggests/skill_set?text=…` | 200 |

Публичный поиск вакансий закрыт с апреля 2026, ключи выдают преимущественно работодателям после модерации приложения. Справочники остались открытыми — этим пользуемся для id ролей и регионов.

## Страница поиска

```
GET https://hh.ru/search/vacancy?items_on_page=100&page=0&enable_snippets=true
    &professional_role=156&area=1&work_format=REMOTE&order_by=relevance
```

Ответ — обычный HTML, данные внутри:

```html
<template id="HH-Lux-InitialState">{ ... JSON ... }</template>
```

Значения экранированы как HTML-entities: `&#34;` вместо `"`, `&amp;` вместо `&`. Поэтому сначала декодируем, потом `JSON.parse`. Headless-браузер не нужен.

### Полезные поля

```
vacancySearchResult.totalResults        — сколько всего нашлось
vacancySearchResult.vacancies[]         — список на странице
vacancySearchResult.paging.pages[]      — номера страниц, для проверки «есть ли следующая»
vacancySearchResult.criteria            — какие фильтры реально применились
```

Элемент `vacancies[]`:

| Поле | Пример | Примечание |
| --- | --- | --- |
| `vacancyId` | `139095845` | ключ дедупликации |
| `name` | `SQL-разработчик` | |
| `company.visibleName` / `.name` | `АРК` | `visibleName` точнее |
| `area.name`, `area.@id` | `Москва`, `1` | |
| `compensation` | `{from, to, currencyCode, gross}` или `{noCompensation: {}}` | зарплата есть не всегда |
| `publicationTime.@timestamp` | Unix-секунды | свежесть режем сами: `date_from` в URL игнорируется |
| `workExperience` | `noExperience`, `between1And3`, `between3And6`, `moreThan6` | |
| `workFormats` | `{"workFormatsElement": ["REMOTE","HYBRID"]}` | вложенная обёртка, нужен unwrap |
| `professionalRoleIds` | `{"professionalRoleId": [156]}` | тоже обёртка |
| `snippet.req` / `snippet.resp` | обрезанный текст с `…` | только при `enable_snippets=true` |

Флаг `enable_snippets=true` даёт `snippet.req` почти у всех вакансий (327 из 328 в проверке). Это самый дешёвый способ понять требования: один запрос на 100 вакансий вместо 100 карточек.

## Карточка вакансии

```
GET https://hh.ru/vacancy/{id}
```

Тот же `<template id="HH-Lux-InitialState">`, но данные в `vacancyView.vacancyFull.vacancy`:

| Поле | Примечание |
| --- | --- |
| `description` | HTML, 1–5 КБ, обязанности и требования |
| `keySkills` | массив строк; заполнен примерно у 75% вакансий |
| `workExperience`, `compensation`, `area`, `workFormats` | как в поиске |
| `publicationTimeIso` | уже ISO-строка |

Время: 20 карточек за ~4.5 с при паузе 800–1500 мс, все ответы 200.

## Границы

| Ограничение | Факт |
| --- | --- |
| Потолок выдачи | `page=19` работает, `page=20` → **404**. Максимум 2000 позиций на запрос |
| `items_on_page` | до 100 |
| `date_from`, `date_to` | игнорируются в HTML-поиске; фильтруй по `publicationTime` сам |
| `skill` в URL | игнорируется; навыки считаем сами из карточек |
| `only_with_salary=true` | работает |
| `area=1`, `area=2` | работают, несколько значений суммируются |
| `experience`, `work_format`, `professional_role` | работают |
| Капча / 429 | возможны при жадном сборе; поэтому пауза 800–1500 мс и `--max-seconds` |
| VPN | сайт отдаёт заглушку `vpncheeck`; скрипт распознаёт её и выходит с кодом 2 |

## UA и robots.txt

`robots.txt` закрывает `/vacancy/*` для именованных AI-ботов: `GPTBot`, `ClaudeBot`, `Claude-Web`, `PerplexityBot`, `CCBot`, `OAI-SearchBot`, `ChatGPT-User`. Для `*` запретов на `/vacancy/` нет.

Поэтому UA честный и не маскируется под браузер: `openlearn-market/0.1 (educational learning project)`. Запросы идут редко (пауза 800–1500 мс), карточки тянутся только по явному `--details`, снапшот кэшируется на `--fresh-days`.

## Соглашение dev.hh.ru

- п. 3.3: материалы можно использовать для тематики сайта, включая «получение информации о рынке труда»;
- п. 4.6: запрещено передавать полученные данные сторонним сервисам.

Отсюда правило проекта: `market.json` лежит локально в `subjects/<slug>/`, наружу уходят только агрегаты из `market.md`, чужие карточки вакансий не публикуются.

## Если разметка изменилась

Скрипт выходит с кодом `3` и сообщением, какой селектор не найден. Порядок починки:

1. Открой страницу в браузере (`browser.tabs.open`), проверь, есть ли ещё `HH-Lux-InitialState`.
2. Если имя шаблона другое — поправь `STATE_RE` в `scripts/lib/parse.mjs`.
3. Если данные переехали в другой ключ — поправь `parseSearchPage` / `parseVacancyPage`.
4. Сними новую фикстуру и прогони тесты:

```sh
node .opencode/skills/market-research/scripts/record-fixtures.mjs --role 156 --area 1
node --test test/market.test.mjs
```

Фикстуры хранятся сжатыми (`.html.gz`): страница выдачи весит 1.3 МБ, в git это лишнее.
