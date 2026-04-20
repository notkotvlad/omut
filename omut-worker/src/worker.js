// Cloudflare Worker — прокси для сервиса Omut.
// Эндпоинты:
//   GET /health                — короткий JSON со статусом
//   GET /api/v1/weather?lat=.&lng=.
//   GET /api/v1/stations       — справочник станций (для отладки / админки)
//   GET /api/v1/hydroposts     — справочник гидропостов
//   OPTIONS *                  — CORS preflight
//
// Реализация: см. модули в ./lib/*.

import stationsData from './data/stations.js';
import hydropostsData from './data/hydroposts.js';
import regionsData from './data/regions.js';

import { corsHeaders, jsonResponse, errorResponse, preflight } from './lib/cors.js';
import { nearest } from './lib/haversine.js';
import { cached, PREFIX, stale } from './lib/cache.js';
import { fetchKazhydrometFacts } from './lib/kazhydromet-facts.js';
import { fetchKazhydrometNowcast } from './lib/kazhydromet-nowcast.js';
import { fetchHydroFromKV } from './lib/ecodata-hydro.js';
import { fetchSynop } from './lib/ogimet.js';
import { buildResponse } from './lib/normalizer.js';
import { discoverStations } from './lib/kazhydromet-stations.js';
import { runHydroCollection } from './lib/shiny-hydro-cron.js';

const TTL = {
  nowcast: 30 * 60,     // 30 минут
  facts: 3 * 60 * 60,   // 3 часа
  hydro: 12 * 60 * 60,  // 12 часов — посты обновляются раз в сутки
  synop: 60 * 60,       // 1 час
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return preflight(request, env);
    if (request.method !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Only GET supported', { status: 405, env, req: request });
    }

    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        return jsonResponse({
          ok: true,
          service: 'omut-worker',
          time: new Date().toISOString(),
          endpoints: [
            '/api/v1/weather?lat=...&lng=...',
            '/api/v1/weather?lat=...&lng=...&hydropost_id=<post_id>',
            '/api/v1/stations',
            '/api/v1/hydroposts',
            '/api/v1/hydro/snapshot?post_id=<post_id>',
            '/api/v1/hydro/history?post_id=<post_id>',
            '/health',
          ],
          kazhydromet_disabled: env.DISABLE_KAZHYDROMET === '1',
        }, { env, req: request, cacheControl: 'public, max-age=60' });
      }

      if (url.pathname === '/api/v1/stations') {
        return jsonResponse(
          { ok: true, regions: regionsData.regions, stations: stationsData.stations },
          { env, req: request, cacheControl: 'public, max-age=3600' },
        );
      }

      if (url.pathname === '/api/v1/hydroposts') {
        return jsonResponse(
          { ok: true, hydroposts: hydropostsData.hydroposts, default_mapping: hydropostsData.default_mapping },
          { env, req: request, cacheControl: 'public, max-age=3600' },
        );
      }

      if (url.pathname === '/api/v1/weather') {
        return await handleWeather(url, env, ctx, request);
      }

      // История уровня воды для конкретного гидропоста (для алгоритма прогнозов)
      // GET /api/v1/hydro/history?post_id=kapchagai-vdhr-kapshagai
      if (url.pathname === '/api/v1/hydro/history') {
        const postId = url.searchParams.get('post_id');
        if (!postId) {
          return errorResponse('BAD_REQUEST', 'post_id обязателен', { status: 400, env, req: request });
        }
        const post = hydropostsData.hydroposts.find(h => h.post_id === postId);
        if (!post) {
          return errorResponse('NOT_FOUND', `Гидропост '${postId}' не найден в справочнике`, { status: 404, env, req: request });
        }
        const history = env.OMUT_CACHE
          ? await env.OMUT_CACHE.get(`hydro:level-history:${postId}`, 'json').catch(() => null)
          : null;
        return jsonResponse(
          { ok: true, post_id: postId, post_name: post.name, history: history || [] },
          { env, req: request, cacheControl: 'public, max-age=600' },
        );
      }

      // Снапшот (текущие данные) гидропоста
      // GET /api/v1/hydro/snapshot?post_id=kapchagai-vdhr-kapshagai
      if (url.pathname === '/api/v1/hydro/snapshot') {
        const postId = url.searchParams.get('post_id');
        if (!postId) {
          return errorResponse('BAD_REQUEST', 'post_id обязателен', { status: 400, env, req: request });
        }
        const snapshot = env.OMUT_CACHE
          ? await env.OMUT_CACHE.get(`hydro:snapshot:${postId}`, 'json').catch(() => null)
          : null;
        return jsonResponse(
          { ok: true, post_id: postId, snapshot: snapshot || null },
          { env, req: request, cacheControl: 'public, max-age=300' },
        );
      }

      if (url.pathname === '/api/v1/admin/discover-stations') {
        const regionId = Number(url.searchParams.get('region_id'));
        const debug = url.searchParams.get('debug') === '1';
        const withNames = url.searchParams.get('names') === '1';
        if (!Number.isFinite(regionId)) {
          return errorResponse('BAD_REQUEST', 'region_id обязателен, например 6 (Алматы)', { status: 400, env, req: request });
        }
        try {
          const data = await discoverStations({ region_id: regionId, email: env.CONTACT_EMAIL, debug, withNames });
          return jsonResponse({ ok: true, ...data }, { env, req: request, cacheControl: (debug || withNames) ? 'no-store' : 'public, max-age=3600' });
        } catch (e) {
          return errorResponse('DISCOVER_FAIL', e.message || 'discover failed', { env, req: request });
        }
      }

      return errorResponse('NOT_FOUND', `Unknown path: ${url.pathname}`, { status: 404, env, req: request });
    } catch (err) {
      return errorResponse('INTERNAL', err.message || 'internal error', { env, req: request });
    }
  },

  // Cron Trigger: сбор данных гидропостов с ecodata.kz:3838 через SockJS.
  // Расписание задаётся в wrangler.toml → [triggers] crons.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runHydroCollection(env));
  },
};

async function handleWeather(url, env, ctx, request) {
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return errorResponse('INVALID_COORDS', 'lat/lng parameters are required and must be finite', { status: 400, env, req: request });
  }

  // Явное указание станции: station_id+region_id. Если оба заданы — используем напрямую, haversine не подбирает.
  const pinnedStationId = (() => {
    const s = url.searchParams.get('station_id');
    if (s == null || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  })();
  const pinnedRegionId = (() => {
    const r = url.searchParams.get('region_id');
    if (r == null || r === '') return null;
    const n = Number(r);
    return Number.isFinite(n) ? n : null;
  })();

  const kv = env.OMUT_CACHE;
  const email = env.CONTACT_EMAIL;

  // 1. Подобрать станцию: либо явно запрошенную, либо ближайшую (верифицированные приоритетны)
  let stationHit = null;
  let pinnedStation = null;
  if (pinnedStationId != null) {
    pinnedStation = stationsData.stations.find(s =>
      s.station_id === pinnedStationId && (pinnedRegionId == null || s.region_id === pinnedRegionId)
    ) || null;
    if (pinnedStation) {
      // Возвращаем синтетический "hit" с расстоянием между точкой и выбранной станцией
      const { haversineKm } = (() => {
        // inlined для избежания циклического импорта: фактическое вычисление уже есть в haversine.js,
        // но здесь достаточно простейшего варианта
        const R = 6371;
        const toRad = d => (d * Math.PI) / 180;
        return {
          haversineKm: (a, b, c, d) => {
            const dLat = toRad(c - a);
            const dLng = toRad(d - b);
            const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2;
            return 2 * R * Math.asin(Math.sqrt(x));
          },
        };
      })();
      stationHit = {
        item: pinnedStation,
        distanceKm: (pinnedStation.lat != null && pinnedStation.lng != null)
          ? haversineKm(lat, lng, pinnedStation.lat, pinnedStation.lng)
          : null,
      };
    }
  }
  if (!stationHit) {
    const verifiedStations = stationsData.stations.filter(s => s.verified && s.station_id != null);
    const allStations = stationsData.stations.filter(s => s.station_id != null);
    stationHit = nearest(lat, lng, verifiedStations) || nearest(lat, lng, allStations);
  }

  // Явное указание гидропоста: ?hydropost_id=<post_id>
  // Если указан — тянем реальные данные (water_temp + water_level) из KV.
  // Если НЕ указан — авто-nearest используется только для показа ближайшего поста
  // в ответе, но данные о температуре воды НЕ подгружаются (старая логика).
  const pinnedHydropostId = url.searchParams.get('hydropost_id') || null;
  const pinnedHydropost = pinnedHydropostId
    ? (hydropostsData.hydroposts.find(h => h.post_id === pinnedHydropostId) || null)
    : null;

  // Ближайший пост — только для информационного поля в ответе (name, distance)
  const autoHydroHit = nearest(lat, lng, hydropostsData.hydroposts, { maxKm: 150 });

  // Какой пост реально используется: явный или авто (для location-поля)
  const activeHydroHit = pinnedHydropost
    ? { item: pinnedHydropost, distanceKm: null }
    : autoHydroHit;

  const synopHit = nearest(lat, lng, stationsData.synop_fallback?.stations || []);

  const location = {
    lat, lng,
    station: stationHit?.item?.name || null,
    station_id: stationHit?.item?.station_id ?? null,
    station_region_id: stationHit?.item?.region_id ?? null,
    station_distance_km: stationHit?.distanceKm != null ? round1(stationHit.distanceKm) : null,
    station_pinned: pinnedStation != null,
    hydropost: activeHydroHit?.item?.name || null,
    hydropost_id: activeHydroHit?.item?.post_id || null,
    hydropost_distance_km: activeHydroHit?.distanceKm != null ? round1(activeHydroHit.distanceKm) : null,
    hydropost_pinned: pinnedHydropost != null,
    synop_wmo: synopHit?.item?.wmo || null,
  };

  const skipKazhydromet = env.DISABLE_KAZHYDROMET === '1';

  // 2. Параллельно идём за всеми источниками
  const factsP = !skipKazhydromet && stationHit
    ? cached(
        kv,
        PREFIX.facts + `${location.station_region_id}:${location.station_id}`,
        TTL.facts,
        () => fetchKazhydrometFacts({
          region_id: location.station_region_id,
          station_id: location.station_id,
          name: location.station,
          email,
        }),
      ).catch(async err => ({ error: err.message, fallback: await stale(kv, PREFIX.facts + `${location.station_region_id}:${location.station_id}`) }))
    : Promise.resolve(null);

  const nowcastP = !skipKazhydromet && stationHit
    ? cached(
        kv,
        PREFIX.nowcast + `${location.station_region_id}:${location.station_id}`,
        TTL.nowcast,
        () => fetchKazhydrometNowcast({
          region_id: location.station_region_id,
          point_id: location.station_id,
          email,
        }),
      ).catch(async err => ({ error: err.message, fallback: await stale(kv, PREFIX.nowcast + `${location.station_region_id}:${location.station_id}`) }))
    : Promise.resolve(null);

  // Данные из KV тянем ТОЛЬКО для явно указанного поста.
  // При авто-nearest данные не загружаем — чтобы не показывать температуру воды
  // чужого водоёма как «текущую» для запрашиваемой точки.
  const hydroP = pinnedHydropost
    ? fetchHydroFromKV(kv, pinnedHydropost.post_id).catch(() => null)
    : Promise.resolve(null);

  const synopP = synopHit
    ? cached(
        kv,
        PREFIX.synop + synopHit.item.wmo,
        TTL.synop,
        () => fetchSynop({ wmo: synopHit.item.wmo, email }),
      ).catch(async err => ({ error: err.message, fallback: await stale(kv, PREFIX.synop + synopHit.item.wmo) }))
    : Promise.resolve(null);

  const [facts, nowcast, hydro, synop] = await Promise.all([factsP, nowcastP, hydroP, synopP]);

  // 3. Извлекаем value из обёртки { value, cached, fetched_at } или из { error, fallback }
  const unwrap = w => {
    if (!w) return null;
    if (w.value) return w.value;
    if (w.fallback?.value) return { ...w.fallback.value, _stale: true };
    return null;
  };

  const response = buildResponse({
    location,
    facts: unwrap(facts),
    nowcast: unwrap(nowcast),
    hydro: unwrap({ value: hydro }), // hydro уже нормализованный или null
    synop: unwrap(synop),
  });

  // 4. Клиентский cache-control — 5 минут в браузере, 5 минут в edge
  return jsonResponse(response, {
    env, req: request,
    cacheControl: 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
  });
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
