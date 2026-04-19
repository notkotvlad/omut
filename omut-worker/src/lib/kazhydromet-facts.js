// Парсер страницы /ru/weather/in_city_7_days/{region_id}/{station_id}
// Из живого скрейпа 2026-04-17 HTML-структура подтверждена:
//   <div class="forecastPage-days">
//     <div class="forecastPage-day">
//       <div class="forecastPage-day__date">12.04.2026</div>
//       <div class="forecastPage-day__info">
//         <div class="forecastPage-day__column"> … Ночью: +5+10 … юго-восточный … 9-14 м/с … </div>
//         <div class="forecastPage-day__column"> … День: +20+25 … </div>
//       </div>
//     </div>
//   </div>
//
// Данные — региональные (с диапазонами), поэтому это 'точность официального прогноза',
// а не пункта. Для точечных текущих наблюдений см. kazhydromet-nowcast + OGIMET.

import { findBlocks, blockText } from './html-utils.js';

const UA = (email) => `OmutWeatherBot/0.1 (+https://omut.example; ${email || 'contact@example.com'})`;

/**
 * @param {{ region_id:number, station_id:number, name?:string, email?:string, fetchImpl?:typeof fetch }} opts
 */
export async function fetchKazhydrometFacts({ region_id, station_id, name, email, fetchImpl }) {
  const f = fetchImpl || fetch;
  const url = `https://www.kazhydromet.kz/ru/weather/in_city_7_days/${region_id}/${station_id}`;
  const r = await f(url, {
    headers: {
      'User-Agent': UA(email),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru,en;q=0.8',
    },
  });
  if (!r.ok) throw new Error(`Kazhydromet facts HTTP ${r.status}`);
  const html = await r.text();
  return parseKazhydrometFacts(html, { station_name: name, url });
}

export function parseKazhydrometFacts(html, meta = {}) {
  const daysHtml = findBlocks(html, 'forecastPage-day');
  const days = daysHtml.map(blockHtml => {
    const text = blockText(blockHtml);
    return parseDay(text);
  }).filter(Boolean);

  // Текущая погода = "дневной" столбец ближайшего дня — грубая оценка.
  // В брифе для фактов предпочтительнее OGIMET/наукастинг, здесь только fallback.
  const today = days[0] || null;
  const current = today ? currentFromToday(today) : null;

  return {
    source_url: meta.url,
    station_name: meta.station_name || null,
    parsed_at: new Date().toISOString(),
    current,
    forecast_daily: days,
  };
}

function parseDay(text) {
  // text: "12.04.2026\nНочью:\n+5+10 ...\nюго-восточный\nСкорость ветра:\n9-14 м/с\nДень:\n+20+25 ..."
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const dateLine = lines.find(l => /^\d{2}\.\d{2}\.\d{4}$/.test(l));
  if (!dateLine) return null;

  const isoDate = toIso(dateLine);
  const night = extractColumn(lines, 'Ночью');
  const day = extractColumn(lines, 'День');

  return {
    date: isoDate,
    night,
    day,
    weather_description: (day?.description || night?.description || null),
  };
}

function extractColumn(lines, prefix) {
  // берём блок строк начиная с "prefix:" до следующего "День:"/"Ночью:"
  const idx = lines.findIndex(l => l.startsWith(`${prefix}:`) || l === `${prefix}:`);
  if (idx < 0) return null;
  const stop = lines.findIndex((l, i) => i > idx && (l.startsWith('Ночью:') || l.startsWith('День:')));
  const slice = stop > 0 ? lines.slice(idx, stop) : lines.slice(idx);

  const tempLine = slice.find(l => /^[+\-]?\d+/.test(l)) || '';
  const temp = parseTempRange(tempLine);

  const windDirLine = slice.find(l => /(северный|южный|восточный|западный)/i.test(l));
  const windDir = windDirLine ? normalizeWindDir(windDirLine) : null;

  const windSpeedIdx = slice.findIndex(l => /^Скорость ветра:/i.test(l));
  const windSpeedLine = windSpeedIdx >= 0 ? slice[windSpeedIdx + 1] || slice[windSpeedIdx].replace(/^Скорость ветра:/i, '').trim() : '';
  const windMs = parseRangeNumber(windSpeedLine);

  // описание = всё что не температура/ветер
  const description = slice.slice(1)
    .filter(l => l !== tempLine && l !== windDirLine && !/^Скорость ветра:/i.test(l) && l !== windSpeedLine)
    .join(' ').replace(/\s+/g, ' ').trim();

  return {
    temp_c: temp,           // { min, max }
    wind_dir_text: windDir,
    wind_deg: windDir ? windDirToDeg(windDir) : null,
    wind_ms: windMs,        // { min, max }
    description: description || null,
  };
}

function parseTempRange(line) {
  // форматы: "+5+10", "+20+25", "+2 °C", "-3-7"
  if (!line) return null;
  const m = line.match(/([+\-]?\d+)\s*([+\-]?\d+)?/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] != null ? Number(m[2]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function parseRangeNumber(line) {
  if (!line) return null;
  const m = line.match(/(\d+)\s*[\-–]\s*(\d+)/);
  if (m) return { min: +m[1], max: +m[2] };
  const single = line.match(/(\d+)/);
  return single ? { min: +single[1], max: +single[1] } : null;
}

function normalizeWindDir(raw) {
  return String(raw).toLowerCase().replace(/ветер/g, '').trim();
}

// Словесное направление → градусы (откуда дует)
const DIRMAP = {
  'северный': 0, 'северо-восточный': 45, 'восточный': 90, 'юго-восточный': 135,
  'южный': 180, 'юго-западный': 225, 'западный': 270, 'северо-западный': 315,
};
function windDirToDeg(txt) {
  const key = Object.keys(DIRMAP).find(k => txt.includes(k));
  return key != null ? DIRMAP[key] : null;
}

function toIso(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('.');
  return `${y}-${m}-${d}`;
}

function currentFromToday(today) {
  // Сейчас = берём "День" если сейчас день, иначе "Ночь". Очень грубо — для UI-отображения.
  const hour = new Date().getUTCHours() + 5; // Алма-Ата UTC+5
  const isDaytime = hour >= 7 && hour < 21;
  const col = (isDaytime ? today.day : today.night) || today.day || today.night;
  if (!col) return null;
  return {
    temp_air_min: col.temp_c?.min ?? null,
    temp_air_max: col.temp_c?.max ?? null,
    temp_air: col.temp_c ? Math.round((col.temp_c.min + col.temp_c.max) / 2) : null,
    wind_ms_min: col.wind_ms?.min ?? null,
    wind_ms_max: col.wind_ms?.max ?? null,
    wind_ms: col.wind_ms ? (col.wind_ms.min + col.wind_ms.max) / 2 : null,
    wind_deg: col.wind_deg ?? null,
    description: col.description,
  };
}
