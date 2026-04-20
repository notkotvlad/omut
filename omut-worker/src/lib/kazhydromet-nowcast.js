// Парсер наукастинга Казгидромета: /ru/weather/touristic_city_6_hours/{point_id}/...
//
// ВАЖНО: в отличие от /in_city_7_days, URL-схема туристического наукастинга использует
// ОТДЕЛЬНЫЙ touristic_point_id, а не (region_id, station_id). На шаге 2026-04-17 мне
// не удалось замапить ID туристических пунктов через навигацию — страница показывает
// только выбор области, затем выбор точки маршрута, и итоговый ID — внутренний.
//
// Эта модель ПРОТОТИПНАЯ: предполагает что на URL вида
// /ru/weather/touristic_city_6_hours/{region_id}/{point_id} будет отрендерена таблица с
// почасовыми значениями (температура, ветер, давление, осадки). При реальном деплое
// этот парсер следует адаптировать под фактическую разметку (регулярки ниже
// универсальные, но могут потребовать уточнения).
//
// Если наукастинг не удаётся распарсить — Worker делает fallback на Open-Meteo hourly.

import { blockText } from './html-utils.js';

const UA = (email) => `OmutWeatherBot/0.1 (+https://omut.example; ${email || 'contact@example.com'})`;

/**
 * @param {{ region_id:number, point_id:number, email?:string, fetchImpl?:typeof fetch }} opts
 */
export async function fetchKazhydrometNowcast({ region_id, point_id, email, fetchImpl }) {
  const f = fetchImpl || fetch;
  const url = `https://www.kazhydromet.kz/ru/weather/touristic_city_6_hours/${region_id}/${point_id}`;
  const r = await f(url, {
    headers: {
      'User-Agent': UA(email),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru',
    },
  });
  if (!r.ok) throw new Error(`Kazhydromet nowcast HTTP ${r.status}`);
  const html = await r.text();
  return parseKazhydrometNowcast(html, { url });
}

/**
 * Пытаемся вытащить таблицу с колонками: Время | Температура | Ветер | Давление | Осадки.
 * Формат заранее неизвестен — в 2026-04-17 таблицы на странице отсутствовали (данные
 * подгружаются JS или рендерятся только при выборе конкретной точки). Оставляем функцию
 * структурной: если таблица НЕ найдена — возвращаем пустой массив и Worker фолбэчится.
 */
export function parseKazhydrometNowcast(html, meta = {}) {
  const rows = [];
  // Ищем любую таблицу с числами и °C
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const t of tables) {
    const trs = t.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => blockText(m[1]));
      if (cells.length < 3) continue;

      // Эвристика: распознаём время в первой ячейке
      const timeCell = cells[0];
      if (!/\d{1,2}:\d{2}|\d{1,2}-\d{1,2}\s*ч/i.test(timeCell)) continue;

      const row = { time_local: parseTime(timeCell) };
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i];
        if (/°C|температура/i.test(c)) row.temp_air = parseNumber(c);
        else if (/м\/с|ветер/i.test(c)) row.wind_ms = parseNumber(c);
        else if (/мб|hpa|мм рт|давление/i.test(c)) row.pressure_hpa = parseNumber(c);
        else if (/мм|осадк/i.test(c)) row.precip_mm = parseNumber(c);
        else {
          const num = parseNumber(c);
          if (num != null && row.temp_air == null) row.temp_air = num;
        }
      }
      if (row.time_local) rows.push(row);
    }
  }

  return {
    source_url: meta.url,
    parsed_at: new Date().toISOString(),
    nowcast_1h: rows.slice(0, 6),
    raw_note: rows.length === 0
      ? 'Таблица наукастинга не найдена в HTML. Вероятно, контент подгружается динамически или touristic_point_id неверен. См. README, раздел "Наукастинг".'
      : null,
  };
}

function parseTime(txt) {
  const m = txt.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function parseNumber(txt) {
  const m = String(txt).replace(',', '.').match(/[+\-]?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
