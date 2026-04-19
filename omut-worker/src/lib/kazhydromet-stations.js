// Скрапер справочника станций Казгидромета.
//   1) Тянем главные страницы региона и собираем station_id из href /ru/weather/in_city_7_days/{region_id}/{id}.
//   2) Если в HTML есть массив myCities = [...] — берём имена из него.
//   3) Иначе (или с ?names=1) — параллельно открываем страницу каждой станции
//      и берём имя из <title> или <h1>.
//   ?debug=1 возвращает фрагмент HTML вокруг "myCities" для анализа.

const KAZHYDROMET_BASE = 'https://www.kazhydromet.kz';
const NAMES_CONCURRENCY = 6;

async function fetchPage(url, email) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': `omut-worker/1.0 (+${email || 'no-contact'})`,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru,en;q=0.8',
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Kazhydromet HTTP ${r.status} for ${url}`);
  return text;
}

// Регекс расширен: var/let/const опциональны, не требуем `;` в конце,
// массив матчим жадно до последнего `]` перед закрывающим контекстом.
function extractMyCities(html) {
  const re = /(?:var|let|const)?\s*myCities\s*=\s*(\[[\s\S]*?\])\s*[;,\n)]/;
  const m = re.exec(html);
  if (!m) return null;
  const raw = m[1];
  let arr = null;
  try { arr = JSON.parse(raw); } catch { /* */ }
  if (!arr) {
    try {
      const soft = raw
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
        .replace(/,\s*(\]|\})/g, '$1');
      arr = JSON.parse(soft);
    } catch { /* */ }
  }
  if (!Array.isArray(arr)) return null;
  return arr
    .map(c => ({
      station_id: Number(c.ID ?? c.id ?? c.city_id ?? c.value),
      name: String(c.name ?? c.Name ?? c.title ?? c.label ?? '').trim(),
    }))
    .filter(c => Number.isFinite(c.station_id) && c.name);
}

function extractStationIdsFromHrefs(html, region_id) {
  const re = new RegExp(`/ru/weather/in_city_7_days/${region_id}/(\\d+)`, 'g');
  const ids = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

// Имя станции с её страницы — обычно лежит в <title>...</title>
function cleanTitleName(raw) {
  let t = String(raw || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  // "Прогноз погоды в городе XXX на ближайшие 7 дней" → "XXX"
  const m = /Прогноз\s+погоды\s+в\s+городе\s+([\s\S]+?)\s+на\s+ближайши[ех]\s+\d+\s+дн/iu.exec(t);
  if (m) return m[1].trim();
  // Альтернативно режем хвост "- Прогноз ..." / "| Казгидромет"
  t = t.replace(/\s*[-–—|]\s*(прогноз|погода|казгидромет)[\s\S]*$/iu, '').trim();
  return t || null;
}
function extractStationName(html) {
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (t) {
    const name = cleanTitleName(t[1]);
    if (name) return name;
  }
  const h = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h) {
    const name = cleanTitleName(h[1]);
    if (name) return name;
  }
  return null;
}

// Глобальный словарь cities = { 6: [{ID,name},...], 22: [...] } — лежит прямо в HTML.
// Если найдём — избежим 58+ отдельных запросов за именами.
function extractGlobalCities(html, region_id) {
  // Ищем объявление, допускающее несколько форматов
  const re = /(?:var|let|const)\s+cities\s*=\s*(\{[\s\S]*?\})\s*;/;
  const m = re.exec(html);
  if (!m) return null;
  const raw = m[1];
  let obj = null;
  try { obj = JSON.parse(raw); } catch { /* */ }
  if (!obj) {
    try {
      const soft = raw
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
        .replace(/,\s*(\]|\})/g, '$1');
      obj = JSON.parse(soft);
    } catch { /* */ }
  }
  if (!obj || typeof obj !== 'object') return null;
  const arr = obj[region_id] || obj[String(region_id)];
  if (!Array.isArray(arr)) return null;
  return arr
    .map(c => ({
      station_id: Number(c.ID ?? c.id ?? c.city_id ?? c.value),
      name: String(c.name ?? c.Name ?? c.title ?? c.label ?? '').trim(),
    }))
    .filter(c => Number.isFinite(c.station_id) && c.name);
}

async function fetchNames(region_id, ids, email) {
  const out = new Map();
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const idx = i++;
      const id = ids[idx];
      const url = `${KAZHYDROMET_BASE}/ru/weather/in_city_7_days/${region_id}/${id}`;
      try {
        const html = await fetchPage(url, email);
        const name = extractStationName(html);
        if (name) out.set(id, name);
      } catch { /* skip */ }
    }
  }
  const workers = Array.from({ length: Math.min(NAMES_CONCURRENCY, ids.length) }, worker);
  await Promise.all(workers);
  return out;
}

export async function discoverStations({ region_id, email, debug = false, withNames = false }) {
  if (!Number.isFinite(region_id)) throw new Error('region_id должен быть числом');

  const urls = [
    `${KAZHYDROMET_BASE}/ru/weather/in_city_7_days/${region_id}/0`,
    `${KAZHYDROMET_BASE}/ru/weather/in_city_7_days/${region_id}/149`,
    `${KAZHYDROMET_BASE}/ru/weather/in_city_7_days/${region_id}`,
  ];

  const pagesInfo = [];
  let bestCities = null;
  let bestUrl = urls[0];
  const hrefIds = new Set();

  for (const u of urls) {
    try {
      const html = await fetchPage(u, email);
      const cities = extractGlobalCities(html, region_id) || extractMyCities(html);
      extractStationIdsFromHrefs(html, region_id).forEach(id => hrefIds.add(id));
      let myCitiesContext = null;
      if (debug) {
        const idx = html.indexOf('myCities');
        if (idx >= 0) {
          myCitiesContext = html.slice(Math.max(0, idx - 200), idx + 1200);
        }
      }
      pagesInfo.push({
        url: u,
        html_length: html.length,
        my_cities_found: !!cities,
        my_cities_count: cities ? cities.length : 0,
        my_cities_sample: cities ? cities.slice(0, 5) : null,
        ...(debug && myCitiesContext != null ? { my_cities_context: myCitiesContext } : {}),
      });
      if (cities && (!bestCities || cities.length > bestCities.length)) {
        bestCities = cities;
        bestUrl = u;
      }
    } catch (e) {
      pagesInfo.push({ url: u, error: e.message });
    }
  }

  let stations = [];
  if (bestCities && bestCities.length > 0) {
    const seen = new Set();
    for (const c of bestCities) {
      if (seen.has(c.station_id)) continue;
      seen.add(c.station_id);
      stations.push(c);
    }
    // Дополним href-ID, которых нет в myCities
    for (const id of hrefIds) {
      if (!seen.has(id)) {
        seen.add(id);
        stations.push({ station_id: id, name: `Станция #${id}` });
      }
    }
  } else if (hrefIds.size > 0) {
    stations = [...hrefIds].map(id => ({ station_id: id, name: `Станция #${id}` }));
  }

  // Опционально (?names=1) — подтянем имена со страниц станций
  let namedCount = 0;
  if (withNames && stations.length > 0) {
    const idsToName = stations.map(s => s.station_id);
    const names = await fetchNames(region_id, idsToName, email);
    for (const s of stations) {
      const n = names.get(s.station_id);
      if (n) { s.name = n; namedCount++; }
    }
  }

  stations.sort((a, b) => a.station_id - b.station_id);

  const result = {
    region_id,
    count: stations.length,
    named_count: namedCount,
    stations,
    source_url: bestUrl,
    fetched_at: new Date().toISOString(),
  };

  if (debug) {
    result.debug = {
      pages: pagesInfo,
      href_ids_count: hrefIds.size,
      href_ids: [...hrefIds],
    };
  }

  return result;
}
