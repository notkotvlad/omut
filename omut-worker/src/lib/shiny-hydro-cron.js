// Сборщик данных гидропостов через прямое WebSocket-подключение к Shiny SockJS.
// Запускается из scheduled() handler воркера по Cron Trigger.
//
// Shiny (R) использует SockJS для передачи реактивных данных клиенту.
// После подключения сервер отправляет конфиг, затем первый flush со всеми outputs —
// в том числе вызов addAwesomeMarkers с попапами всех 442 постов.
// Нам нужен именно этот flush; браузер для этого не нужен.
//
// SockJS WebSocket URL: ws://ecodata.kz:3838/app_dg_map_ru/sockjs/<server>/<session>/websocket
// Shiny init message:   ["0\n{\"method\":\"init\",\"data\":{}}"]

import hydropostsData from '../data/hydroposts.js';

// Cloudflare Workers требует http:// (не ws://) — fetch сам делает Upgrade: websocket
const SOCKJS_WS_BASE = 'http://ecodata.kz:3838/app_dg_map_ru/sockjs';
const FETCH_TIMEOUT_MS   = 8_000;  // если порт недоступен — узнаем быстро
const COLLECT_TIMEOUT_MS = 20_000; // общий таймаут ожидания данных Shiny

const TARGET_POSTS = hydropostsData.hydroposts.map(h => ({
  post_id: h.post_id,
  name:    h.kazhydromet_name,
}));

function log(msg)  { console.log(`[hydro-cron] ${new Date().toISOString()}  ${msg}`); }
function warn(msg) { console.warn(`[hydro-cron] WARN  ${msg}`); }

// ─── SockJS / Shiny ───────────────────────────────────────────────────────────

function rndServer()  { return String(Math.floor(Math.random() * 999)).padStart(3, '0'); }
function rndSession() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Подключается к Shiny SockJS, дожидается первого flush с данными карты,
 * возвращает сырые записи постов.
 */
async function collectFromSockJS() {
  const server  = rndServer();
  const session = rndSession();
  const wsUrl   = `${SOCKJS_WS_BASE}/${server}/${session}/websocket`;

  log(`SockJS → ${wsUrl}`);

  // Cloudflare Workers: исходящий WebSocket через fetch() с Upgrade.
  // AbortController нужен чтобы не висеть вечно если порт недоступен.
  const abort = new AbortController();
  const fetchTimer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(wsUrl, {
      signal: abort.signal,
      headers: {
        'Upgrade':               'websocket',
        'Connection':            'Upgrade',
        'Sec-WebSocket-Version': '13',
        'User-Agent':            'OmutHydroCollect/3.0 (+not.kot.vlad@gmail.com)',
      },
    });
  } finally {
    clearTimeout(fetchTimer);
  }

  if (resp.status !== 101) {
    throw new Error(`WebSocket upgrade failed: HTTP ${resp.status}`);
  }

  const ws = resp.webSocket;
  ws.accept();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error(`Timeout ${COLLECT_TIMEOUT_MS}ms: данные Shiny не получены`));
    }, COLLECT_TIMEOUT_MS);

    ws.addEventListener('message', event => {
      const frame = String(event.data);

      // SockJS open → посылаем Shiny init
      if (frame === 'o') {
        const init = JSON.stringify([`0\n${JSON.stringify({ method: 'init', data: {} })}`]);
        ws.send(init);
        return;
      }

      if (frame === 'h') return; // heartbeat

      if (frame.startsWith('a')) {
        let frames;
        try { frames = JSON.parse(frame.slice(1)); } catch { return; }

        for (const msgStr of frames) {
          let msg;
          try { msg = JSON.parse(msgStr); } catch { continue; }

          // Ищем первый flush с данными карты
          if (msg.values?.map?.x?.calls) {
            clearTimeout(timer);
            try { ws.close(); } catch (_) {}
            try {
              resolve(parseMarkers(msg.values.map.x.calls));
            } catch (e) {
              reject(e);
            }
            return;
          }
        }
        return;
      }

      if (frame.startsWith('c')) {
        clearTimeout(timer);
        reject(new Error(`SockJS closed early: ${frame}`));
      }
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket error'));
    });
  });
}

// ─── Парсинг маркеров Leaflet ─────────────────────────────────────────────────

function parseMarkers(calls) {
  const mc = calls.find(c => c.method === 'addAwesomeMarkers');
  if (!mc) throw new Error('addAwesomeMarkers call not found in Shiny flush');

  const lats   = mc.args[0];
  const lngs   = mc.args[1];
  const popups = mc.args[6];

  const results = [];
  const n = s => (s != null ? parseFloat(s) : null);

  for (let i = 0; i < lats.length; i++) {
    const p = String(popups?.[i] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const target = TARGET_POSTS.find(t => p.includes(t.name));
    if (!target) continue;

    results.push({
      post_id:          target.post_id,
      kazhydromet_name: target.name,
      lat:              lats[i],
      lng:              lngs[i],
      date:             p.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
      water_temp:       n(p.match(/Температура воды,С\s+([\d.]+)/)?.[1]),
      water_level_cm:   n(p.match(/Фактический уровень, см\s+([\d.]+)/)?.[1]),
      flow_m3s:         n(p.match(/Фактический расход, м\u00b3\/с\s+([\d.]+)/)?.[1]),
      danger_level_cm:  n(p.match(/Опасный уровень, см\s+([\d.]+)/)?.[1]),
    });
  }

  return results;
}

// ─── KV ───────────────────────────────────────────────────────────────────────

async function appendLevelHistory(kv, postId, levelCm, measuredAt) {
  if (levelCm == null) return;
  const key = `hydro:level-history:${postId}`;
  let history = await kv.get(key, 'json').catch(() => null) || [];
  history.push({ t: measuredAt, level_cm: levelCm });
  if (history.length > 90) history = history.slice(-90);
  await kv.put(key, JSON.stringify(history));
}

// ─── Точка входа ──────────────────────────────────────────────────────────────

/**
 * Запускает полный цикл сборки: SockJS → парсинг → запись в KV.
 * Вызывается из scheduled() handler.
 *
 * @param {object} env  — Cloudflare Worker env (должен содержать OMUT_CACHE)
 * @returns {Promise<{ok:boolean, written?:number, total?:number, error?:string}>}
 */
export async function runHydroCollection(env) {
  log('=== Запуск сборщика гидропостов (SockJS) ===');

  const kv = env.OMUT_CACHE;
  if (!kv) {
    warn('OMUT_CACHE KV не настроен — пропускаем');
    return { ok: false, error: 'no KV' };
  }

  let records;
  try {
    records = await collectFromSockJS();
  } catch (e) {
    warn(`Ошибка сборки: ${e.message}`);
    return { ok: false, error: e.message };
  }

  log(`Найдено постов: ${records.length}/${TARGET_POSTS.length}`);

  const missing = TARGET_POSTS.filter(t => !records.find(r => r.post_id === t.post_id));
  for (const m of missing) warn(`  ✗ Не найден: ${m.post_id} (${m.name})`);

  const measuredAt = new Date().toISOString();
  let written = 0;

  for (const r of records) {
    const snapshot = {
      post_id:         r.post_id,
      post_name:       r.kazhydromet_name,
      lat:             r.lat,
      lng:             r.lng,
      water_temp:      r.water_temp,
      water_level_cm:  r.water_level_cm,
      flow_m3s:        r.flow_m3s,
      danger_level_cm: r.danger_level_cm,
      measured_at:     r.date ? `${r.date}T12:00:00+05:00` : measuredAt,
      collected_at:    measuredAt,
      source:          'ecodata.kz:3838/app_dg_map_ru/',
    };
    try {
      await kv.put(`hydro:snapshot:${r.post_id}`, JSON.stringify(snapshot));
      await appendLevelHistory(kv, r.post_id, r.water_level_cm, snapshot.measured_at);
      log(`  ✓ ${r.post_id}: temp=${r.water_temp ?? '—'}°C  level=${r.water_level_cm ?? '—'}cm  flow=${r.flow_m3s ?? '—'}м³/с`);
      written++;
    } catch (e) {
      warn(`Ошибка KV для ${r.post_id}: ${e.message}`);
    }
  }

  log(`=== Готово: ${written}/${records.length} постов записано в KV ===`);
  return { ok: true, written, total: records.length };
}
