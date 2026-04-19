// OGIMET — резерв для фактических SYNOP-наблюдений.
// API: https://www.ogimet.com/cgi-bin/getsynop?begin=YYYYMMDDHH&end=YYYYMMDDHH&block=36
//
// block=36 — первые две цифры WMO-индекса (36 = Казахстан).
// Ответ — CSV, где каждая строка представляет собой SYNOP-сообщение.
// Пример строки:
//   36870,202604171200,,AAXX 17124 36870 32970 62808 ...
//
// Мы вытаскиваем из 5-значных групп следующие поля:
//   1sTTT   — температура воздуха (например, 10106 = 10.6°C со знаком)
//   2TdTdTd — точка росы (игнорируем для рыбалки)
//   3PPPP   — давление на уровне станции
//   4PPPP   — давление, приведённое к морю
//   ddff    — ветер (направление в десятках градусов, скорость в узлах или м/с по YY)
//   Nddff   — облачность + ветер
//
// Полный декодер SYNOP большой и нам не нужен. Делаем "достаточный" парсер — ветер, температура,
// давление, осадки. Остальное оставляем как есть.

const UA = (email) => `OmutWeatherBot/0.1 (+https://omut.example; ${email || 'contact@example.com'})`;

/**
 * @param {{ wmo:number, hoursBack?:number, email?:string, fetchImpl?:typeof fetch }} opts
 */
export async function fetchSynop({ wmo, hoursBack = 24, email, fetchImpl }) {
  const f = fetchImpl || fetch;
  const now = new Date();
  const begin = formatDt(new Date(now.getTime() - hoursBack * 3600 * 1000));
  const end = formatDt(now);
  const block = String(wmo).slice(0, 2);
  const url = `https://www.ogimet.com/cgi-bin/getsynop?begin=${begin}&end=${end}&block=${block}&state=Kazakhstan`;
  const r = await f(url, { headers: { 'User-Agent': UA(email), 'Accept': 'text/csv,text/plain' } });
  if (!r.ok) throw new Error(`OGIMET HTTP ${r.status}`);
  const csv = await r.text();
  return parseSynopCsv(csv, wmo);
}

function formatDt(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  return `${y}${m}${day}${h}`;
}

export function parseSynopCsv(csv, wanted_wmo) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const matches = [];
  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length < 4) continue;
    const wmo = cols[0];
    if (String(wmo) !== String(wanted_wmo)) continue;
    const ts = cols[1]; // YYYYMMDDHHmm
    const synop = cols.slice(3).join(',');
    const parsed = decodeSynop(synop);
    if (parsed) {
      parsed.observed_at = tsToIso(ts);
      parsed.wmo = Number(wmo);
      matches.push(parsed);
    }
  }
  // возвращаем САМОЕ свежее наблюдение + массив
  matches.sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1));
  return {
    latest: matches[0] || null,
    history: matches,
    source: 'ogimet',
    parsed_at: new Date().toISOString(),
  };
}

/**
 * Упрощённый декодер SYNOP AAXX — вытаскиваем wind (Nddff), 1sTTT, 3PPPP, 4PPPP, осадки (6RRRtR).
 */
function decodeSynop(raw) {
  const parts = String(raw).trim().split(/\s+/);
  const result = { raw };
  // пропускаем AAXX DDHHi IIiii
  let i = 0;
  if (parts[i] === 'AAXX') i += 1;
  if (/^\d{5}$/.test(parts[i])) i += 1; // DDHHi
  if (/^\d{5}$/.test(parts[i])) i += 1; // IIiii

  // Nddff
  if (parts[i] && /^\d{5}$/.test(parts[i])) {
    const g = parts[i];
    const dd = Number(g.slice(1, 3)); // в десятках градусов
    const ff = Number(g.slice(3, 5));
    result.wind_deg = dd * 10;
    result.wind_ms = ff; // если iw в YYGGiw = 3 или 4, то узлы; для Казахстана обычно 0/1 (м/с)
    i += 1;
  }

  for (; i < parts.length; i++) {
    const g = parts[i];
    if (!/^[0-9]{5}$/.test(g)) continue;
    const indicator = g[0];
    if (indicator === '1') {
      // 1sTTT — температура воздуха (s=0 положительная, 1 отрицательная), TTT в десятых градуса
      const sign = g[1] === '1' ? -1 : 1;
      const t = Number(g.slice(2)) / 10;
      result.temp_air = sign * t;
    } else if (indicator === '3') {
      // 3PPPP — давление на уровне станции в десятых мб (9000 прибавляется если меньше 5000)
      const p = Number(g.slice(1));
      result.pressure_station_hpa = p < 5000 ? 900 + p / 10 : p / 10;
    } else if (indicator === '4') {
      // 4PPPP — давление, приведённое к морю
      const p = Number(g.slice(1));
      result.pressure_msl_hpa = p < 5000 ? 900 + p / 10 : p / 10;
    } else if (indicator === '6') {
      // 6RRRtR — осадки в мм (RRR)
      const rrr = Number(g.slice(1, 4));
      if (rrr < 990) result.precip_mm = rrr;
      else if (rrr === 990) result.precip_mm = 0; // следы
    }
  }
  return Object.keys(result).length > 1 ? result : null;
}

function tsToIso(ts) {
  // "202604171200" -> "2026-04-17T12:00:00Z"
  if (!/^\d{12}$/.test(ts)) return null;
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:00Z`;
}
