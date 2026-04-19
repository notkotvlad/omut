# omut-worker

Cloudflare Worker–прокси для сервиса [Omut](../index.html) (планировщик рыбалки). Склеивает:

- **Казгидромет** (kazhydromet.kz) — скрейп публичных страниц с прогнозами по станциям
- **ecodata.kz** гидропосты — температура, уровень и расход воды (Shiny-приложение, данные подтягиваются из KV-снапшотов)
- **OGIMET** — SYNOP-наблюдения WMO-станций (резерв фактической погоды)

и отдаёт фронту единый JSON по контракту `/api/v1/weather?lat=...&lng=...`. Если прокси недоступен — фронт автоматически откатывается на Open-Meteo / MET Norway и продолжает работать. См. `index.html`: функция `запроситьПогодуСРезервом()`.

---

## Структура проекта

```
omut-worker/
├── wrangler.toml              — конфиг Cloudflare Workers
├── package.json
├── data/
│   ├── regions.json           — справочник ID регионов Казгидромета
│   ├── stations.json          — метеостанции + SYNOP fallback (haversine-подбор)
│   └── hydroposts.json        — гидропосты (+ явный маппинг 4 дефолтных локаций)
├── src/
│   ├── worker.js              — entrypoint + router
│   ├── data/*.js              — JS-обёртки над JSON (чтобы обойти import-assertions)
│   └── lib/
│       ├── cors.js            — CORS + стандартные ответы
│       ├── haversine.js       — геоутилиты
│       ├── cache.js           — KV-кеш со stale-while-error
│       ├── html-utils.js      — find/strip без cheerio
│       ├── kazhydromet-facts.js    — парсер 7-дневного прогноза
│       ├── kazhydromet-nowcast.js  — парсер наукастинга 1–6 ч (WIP)
│       ├── ecodata-hydro.js   — читалка гидро-снапшотов из KV
│       ├── ogimet.js          — SYNOP-парсер
│       └── normalizer.js      — склейка в единую схему
└── README.md                  — этот файл
```

---

## Контракт `/api/v1/weather`

```http
GET /api/v1/weather?lat=43.9114&lng=77.1203
→ 200 application/json
```

```jsonc
{
  "ok": true,
  "location": {
    "lat": 43.9114, "lng": 77.1203,
    "station": "Алматы АМЦ", "station_id": 149, "station_region_id": 6,
    "station_distance_km": 77.0,
    "hydropost": "р. Или — с. Капшагай", "hydropost_id": "ili-kapchagai",
    "hydropost_distance_km": 3.5,
    "synop_wmo": 36974
  },
  "sources": {
    "meteo":  "kazhydromet",  // или "ogimet" / "none"
    "hydro":  "kazhydromet",
    "facts":  "kazhydromet",
    "nowcast": "kazhydromet",
    "forecast_daily": "kazhydromet"
  },
  "fetched_at": "2026-04-17T12:30:00+05:00",
  "current": {
    "temp_air": 14.2, "wind_ms": 3.8, "wind_deg": 240,
    "pressure_hpa": 1018, "precip_mm": 0,
    "obs_time": "2026-04-17T12:00:00Z",
    "source": "ogimet", "wmo": 36870
  },
  "hydro": {
    "post_id": "ili-kapchagai",
    "post_name": "р. Или — с. Капшагай",
    "water_body": "река Или",
    "water_temp": 11.5, "water_level_cm": 342, "flow_m3s": 285,
    "measured_at": "2026-04-17T12:00:00+05:00",
    "source": "ecodata.kz"
  },
  "nowcast_1h": [ { "time_local": "13:00", "temp_air": 15.1, ... } ],
  "forecast_daily": [
    { "date": "2026-04-17",
      "night": { "temp_c": {"min":5,"max":10}, "wind_ms": {"min":3,"max":8}, "wind_deg":135, "description":"..." },
      "day":   { "temp_c": {"min":18,"max":23}, "wind_ms": {"min":9,"max":14}, "wind_deg":270, "description":"..." }
    }
  ],
  "raw": { "facts_note": null, "nowcast_note": null }
}
```

Любое поле может быть `null` — клиент обязан это обрабатывать. При частичном сбое источника возвращается 200 с `sources.*: "none"` и соответствующим `raw.*_note`.

Остальные эндпоинты:

- `GET /health` — liveness, возвращает конфиг Worker
- `GET /api/v1/stations` — все метеостанции из `stations.json`
- `GET /api/v1/hydroposts` — все гидропосты из `hydroposts.json`

---

## Деплой

### Предусловия

- Cloudflare-аккаунт с включённым Workers (Free-план достаточен: 100k запросов/день).
- Node ≥ 18, `npm install -g wrangler`.
- Авторизация: `wrangler login`.

### Шаги

```bash
cd omut-worker
npm install

# 1. Создаём KV-неймспейс для кеша
wrangler kv namespace create OMUT_CACHE
wrangler kv namespace create OMUT_CACHE --preview
# Скопировать id/preview_id в wrangler.toml (REPLACE_AFTER_...)

# 2. Локальный dev (обращается к живому Казгидромету, поэтому нужен интернет)
wrangler dev --remote
# → http://127.0.0.1:8787/api/v1/weather?lat=43.9114&lng=77.1203

# 3. Деплой в production
wrangler deploy
# → https://omut-worker.<your-account>.workers.dev
```

### Подключение к фронту

1. Открыть приложение Omut в браузере.
2. Настройки (⚙️) → вкладка «Источники».
3. В поле «URL прокси-воркера» указать выданный адрес (например `https://omut-worker.me.workers.dev`).
4. «Сохранить и перезагрузить данные». Перезагружать страницу не требуется.

В карточке «Прогноз на сейчас» рядом с названием места появится бейдж `🛰️ Гибрид` (золотистого цвета), а ниже — карточка «Гидрология» (если для локации есть привязанный пост).

### Собственный домен (опционально)

Раскомментировать блок `routes` в `wrangler.toml`, добавить зону в Cloudflare, выполнить `wrangler deploy`.

---

## Настройка кешей

| Категория   | TTL в KV | Заголовок Cache-Control |
|-------------|----------|-------------------------|
| Наукастинг  | 30 мин   | `public, max-age=300, s-maxage=300, stale-while-revalidate=600` |
| 7-дневный прогноз | 3 часа   | то же |
| Гидропосты  | 12 часов | то же (+ длинный TTL в KV) |
| OGIMET      | 1 час    | то же |

При падении источника работает `stale`-режим: прокси возвращает последнюю удачно полученную запись из KV, пометив `_stale: true` внутри `raw`.

---

## Гидропосты: стратегия извлечения

ecodata.kz:3838/app_dg_map_ru — это **R/Shiny-приложение**, данные там подгружаются через WebSocket (`/session/<sid>/dataobj/...`), и сам HTML не содержит таблиц со значениями. Обычный `fetch()` бесполезен.

Рекомендуемые подходы (от лучшего к худшему):

1. **Cloudflare Browser Rendering API** — запустить headless Chromium прямо из Worker, раз в 6–12 часов рендерить страницу, извлекать таблицу/popups, складывать в KV под ключ `hydro:snapshot:<post_id>`.
   Документация: <https://developers.cloudflare.com/browser-rendering/>.
2. **Отдельный cron-воркер на Render.com / Fly.io** с Puppeteer. Он по расписанию бросает JSON в тот же KV через Cloudflare API.
3. **Ручной экспорт** — скачать CSV с ecodata.kz руками, залить в KV командой `wrangler kv key put`.

Пока сборщик не подключен, `fetchHydroFromKV` возвращает `null`, и фронт корректно скрывает карточку «Гидрология».

Формат снапшота (см. `src/lib/ecodata-hydro.js`):

```json
{
  "post_id": "ili-kapchagai",
  "post_name": "р. Или — с. Капшагай",
  "water_body": "река Или",
  "water_temp": 11.5,
  "water_level_cm": 342,
  "flow_m3s": 285,
  "measured_at": "2026-04-17T12:00:00+05:00"
}
```

---

## Наукастинг

Парсер `kazhydromet-nowcast.js` — **прототипный**. URL туристического наукастинга устроен как `/ru/weather/touristic_city_6_hours/{region_id}/{touristic_point_id}`, но `touristic_point_id` не совпадает с обычным `station_id` и на этапе ресёрча 2026-04-17 его полный маппинг собрать не удалось — страница показывает выбор точки маршрута, а итоговый ID подставляется JavaScript-ом.

Что нужно сделать перед включением этого источника в прод:

1. Зайти на <https://www.kazhydromet.kz/ru/weather/touristic_cities_by_region/6> (Алматинская обл.).
2. Открыть DevTools → Network, выбрать точку, скопировать URL, получить её `touristic_point_id`.
3. Добавить mapping в `data/stations.json` (новое поле `touristic_point_id`).
4. Проверить `parseKazhydrometNowcast` на реальной разметке — уточнить регулярку таблицы.

До этого Worker просто вернёт `nowcast_1h: []` с пояснением в `raw.nowcast_note`, а фронт воспользуется Open-Meteo hourly (что полностью соответствует таблице приоритетов из брифинга: Open-Meteo — основной источник для прогноза 2–7 дней).

---

## Расширение справочника `stations.json`

Worker автоматически выбирает **ближайшую** из всех станций в радиусе, отдавая приоритет `verified: true`. Чтобы добавить новую станцию:

1. На <https://www.kazhydromet.kz/ru/weather/in_city_7_days/{region_id}/0> выбрать нужный город в выпадашке.
2. Скопировать из URL `{region_id}` и `{station_id}`.
3. Добавить запись в `data/stations.json` и обновить `src/data/stations.js` (пересобрать одной командой):

```bash
cd omut-worker
node -e "const fs=require('fs'); for (const f of ['stations','hydroposts','regions']) { const j=fs.readFileSync('data/'+f+'.json','utf8'); fs.writeFileSync('src/data/'+f+'.js','export default '+j+';\n'); }"
```

4. `wrangler deploy`.

Координаты станций можно взять из <https://www.wmo-wdq.com/> или Wikidata (ищите по названию и WMO-индексу).

---

## Этическое и юридическое

- Скрейп публичных страниц Казгидромета — серая зона. Worker ставит `User-Agent` с контактным email (`CONTACT_EMAIL` в `wrangler.toml → [vars]`), уважает `robots.txt` (если потребуется — проверяйте вручную).
- Если РГП «Казгидромет» пришлёт требование прекратить скрейп — выставить `DISABLE_KAZHYDROMET="1"` в `wrangler.toml`, сделать `wrangler deploy`. Worker тут же перестанет ходить в kazhydromet.kz и будет отдавать только OGIMET + гидропосты.
- В UI приложения добавлен дисклеймер: «Данные предоставлены РГП Казгидромет, Open-Meteo, MET Norway» (см. настройки → Источники).
- Частота запросов ограничена кешем: одна страница Казгидромета не чаще 1 раза в 3 часа на станцию.

---

## Мониторинг

```bash
# Живые логи
wrangler tail

# Метрики — в UI Cloudflare Workers Dashboard
```

Рекомендуется настроить Logpush на R2 и алерт на:

- > 20% HTTP 5xx за 15 минут;
- > 10% неудачных запросов к kazhydromet.kz за час (можно извлечь из текста лога).

---

## Локальный smoke-тест

```bash
cd omut-worker
node _test.mjs
```

Проверяет haversine, парсер Казгидромета и декодер OGIMET на синтетических данных. Не ходит в интернет.

---

## Что НЕ входит в MVP

- Авторизация пользователей / синхронизация между устройствами — сервис остаётся локальным (`localStorage`).
- Исторические данные > 48 часов назад — Worker их не хранит, при необходимости используйте Open-Meteo historical API напрямую.
- Прогноз > 7 дней — берётся из Open-Meteo daily (подтянется фронтом вне зависимости от Worker).
- Платный договор с Казгидрометом — отдельный бизнес-трек.

---

## Лицензия

MIT или проприетарная — уточните у владельца репозитория.
