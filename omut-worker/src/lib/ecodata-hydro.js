// Извлечение данных гидропостов с ecodata.kz:3838/app_dg_map_ru
//
// ecodata.kz — это Shiny-приложение (R). Данные подгружаются через WebSocket
// (/session/<sid>/dataobj/...) и/или динамические JSON-эндпоинты. Сам HTML индекс
// содержит только каркас — ни таблиц, ни значений температур/уровней.
//
// Стратегия извлечения (в порядке убывания надёжности):
//   1) Cloudflare Browser Rendering API (headless chromium) — раз в 6–12 часов
//      рендерит страницу, собирает таблицу/popups, результат складывает в KV.
//      См. https://developers.cloudflare.com/browser-rendering/
//   2) Отдельный cron-воркер на Render.com с Puppeteer + скрипт, бросающий JSON
//      в тот же KV.
//   3) В крайнем случае: ручной экспорт CSV с ecodata.kz и подписание в KV
//      через `wrangler kv key put`.
//
// В этом модуле реализовано:
//   * fetchHydroFromKV(hydropostId) — читает последний снапшот из KV
//     (ключ "v1:hy:<post_id>") и возвращает нормализованный объект.
//   * scheduleHydroRefresh — stub для будущего cron-триггера.
//
// До подключения реального сборщика функция возвращает null, и Worker корректно
// отдаёт "hydro: null" с комментарием "нет данных".

/**
 * @param {KVNamespace | undefined} kv
 * @param {string} postId
 * @returns {Promise<null | {
 *   post_id: string,
 *   post_name: string,
 *   water_body: string,
 *   water_temp: number|null,
 *   water_level_cm: number|null,
 *   flow_m3s: number|null,
 *   measured_at: string,
 *   source: 'ecodata.kz'
 * }>}
 */
export async function fetchHydroFromKV(kv, postId) {
  if (!kv) return null;
  const raw = await kv.get(`hydro:snapshot:${postId}`, 'json');
  if (!raw) return null;
  return normalize(raw);
}

function normalize(raw) {
  return {
    post_id: raw.post_id,
    post_name: raw.post_name,
    water_body: raw.water_body,
    water_temp: nullable(raw.water_temp),
    water_level_cm: nullable(raw.water_level_cm),
    flow_m3s: nullable(raw.flow_m3s),
    measured_at: raw.measured_at,
    source: 'ecodata.kz',
  };
}

function nullable(v) {
  if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return null;
  return typeof v === 'number' ? v : Number(v);
}

/**
 * Формат снапшота, который cron-процесс должен складывать в KV:
 *   key: `hydro:snapshot:<post_id>`
 *   value (JSON):
 *   {
 *     "post_id": "ili-kapchagai",
 *     "post_name": "р. Или — с. Капшагай",
 *     "water_body": "река Или",
 *     "water_temp": 11.5,
 *     "water_level_cm": 342,
 *     "flow_m3s": 285,
 *     "measured_at": "2026-04-17T12:00:00+05:00"
 *   }
 * TTL: 24–48 часов (данные обновляются раз в сутки).
 */
export const SCHEMA_EXAMPLE = Object.freeze({
  post_id: 'ili-kapchagai',
  post_name: 'р. Или — с. Капшагай',
  water_body: 'река Или',
  water_temp: 11.5,
  water_level_cm: 342,
  flow_m3s: 285,
  measured_at: '2026-04-17T12:00:00+05:00',
});
