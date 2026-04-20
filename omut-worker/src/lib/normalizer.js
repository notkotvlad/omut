// Склейка данных от Казгидромета / ecodata / OGIMET в единый контракт /api/v1/weather.
// См. omut-worker/README.md и брифинг пользователя — этот контракт потребляет index.html.

/**
 * @param {object} parts
 * @param {object} parts.location    — { lat, lng, station, station_id, hydropost, hydropost_id, hydropost_pinned }
 * @param {object} [parts.facts]     — результат parseKazhydrometFacts
 * @param {object} [parts.nowcast]   — результат parseKazhydrometNowcast
 * @param {object} [parts.hydro]     — результат fetchHydroFromKV (только когда hydropost_pinned=true)
 * @param {object} [parts.synop]     — результат fetchSynop
 */
export function buildResponse(parts) {
  const now = new Date().toISOString();
  const { location, facts, nowcast, hydro, synop } = parts;

  const current = chooseCurrent({ facts, synop });
  const nowcast_1h = nowcast?.nowcast_1h?.length ? nowcast.nowcast_1h : [];

  // water_temp — только из явно пиннингованного гидропоста (location.hydropost_pinned).
  // При авто-nearest поле отсутствует (null): чужой водоём не подставляем.
  const waterTemp = (location.hydropost_pinned && hydro?.water_temp != null)
    ? hydro.water_temp
    : null;

  if (current && waterTemp !== null) {
    current.water_temp = waterTemp;
    current.water_temp_source = 'kazhydromet-hydropost';
  }

  const sources = {
    meteo: current?.source || 'none',
    hydro: hydro ? 'kazhydromet' : 'none',
    water_temp: waterTemp !== null ? 'kazhydromet-hydropost' : 'none',
    facts: facts ? 'kazhydromet' : (synop ? 'ogimet' : 'none'),
    nowcast: nowcast_1h.length ? 'kazhydromet' : 'none',
    forecast_daily: facts ? 'kazhydromet' : 'none',
  };

  return {
    ok: true,
    location,
    sources,
    fetched_at: now,
    current,
    // hydro содержит полный снапшот поста (water_level_cm, water_temp, measured_at).
    // Присутствует только если hydropost_pinned=true.
    hydro: hydro || null,
    nowcast_1h,
    forecast_daily: facts?.forecast_daily || [],
    raw: {
      // для дебага, клиент может игнорировать
      facts_note: facts ? null : 'Казгидромет факты не получены',
      nowcast_note: nowcast?.raw_note || null,
      hydro_note: !location.hydropost_pinned
        ? 'Укажите ?hydropost_id=<post_id> для получения фактической температуры воды с гидропоста.'
        : null,
    },
  };
}

function chooseCurrent({ facts, synop }) {
  // Приоритет: OGIMET (реальные наблюдения WMO) > Казгидромет факты (диапазоны)
  if (synop?.latest) {
    const l = synop.latest;
    return {
      temp_air: l.temp_air ?? null,
      wind_ms: l.wind_ms ?? null,
      wind_deg: l.wind_deg ?? null,
      // Предпочитаем давление на уровне станции (реальное) — клиент сам знает высоту точки.
      // pressure_msl_hpa оставляем как запасной вариант если станционного нет.
      pressure_hpa: l.pressure_station_hpa ?? l.pressure_msl_hpa ?? null,
      pressure_is_station: l.pressure_station_hpa != null,
      precip_mm: l.precip_mm ?? null,
      obs_time: l.observed_at,
      source: 'ogimet',
      wmo: l.wmo,
    };
  }
  if (facts?.current) {
    const c = facts.current;
    return {
      temp_air: c.temp_air,
      temp_air_min: c.temp_air_min,
      temp_air_max: c.temp_air_max,
      wind_ms: c.wind_ms,
      wind_ms_min: c.wind_ms_min,
      wind_ms_max: c.wind_ms_max,
      wind_deg: c.wind_deg,
      pressure_hpa: null,
      precip_mm: null,
      description: c.description,
      obs_time: null,
      source: 'kazhydromet',
    };
  }
  return null;
}
