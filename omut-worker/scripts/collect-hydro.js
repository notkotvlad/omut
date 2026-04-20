#!/usr/bin/env node
/**
 * collect-hydro.js — сборщик данных гидропостов Казгидромета
 *
 * Источник: ecodata.kz:3838/app_dg_map_ru/ (Shiny + Leaflet)
 * Метод: Puppeteer открывает страницу, ждёт загрузки Shiny-карты,
 *        затем читает данные прямо из window.Shiny.shinyapp.$values.map.x.calls
 *        (вызов addAwesomeMarkers содержит попапы со всеми 442 постами сразу).
 *
 * Структура попапа:
 *   <название поста>  <дата>
 *   Опасный уровень, см     <число>
 *   Фактический уровень, см <число>
 *   Фактический расход, м³/с <число>
 *   Температура воды,С      <число>
 *
 * Переменные окружения:
 *   CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN  — для записи в KV
 *   PUPPETEER_EXECUTABLE  — путь к Chrome (если не в PATH)
 *   DRY_RUN=1             — только логи, без записи в KV
 */

import 'dotenv/config';
import puppeteer from 'puppeteer';

const CF_ACCOUNT_ID      = process.env.CF_ACCOUNT_ID;
const CF_KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const CF_API_TOKEN       = process.env.CF_API_TOKEN;
const DRY_RUN            = process.env.DRY_RUN === '1';
const HYDRO_MAP_URL      = process.env.HYDRO_MAP_URL || 'http://ecodata.kz:3838/app_dg_map_ru/';

// 9 постов Алматинской области — имена точно как на карте
const TARGET_POSTS = [
  { post_id: 'kaskelyen-ustye',          name: 'Р.Каскелен - устье' },
  { post_id: 'kapchagai-vdhr-kapshagai', name: 'Вдхр. Капшагайское \u2013 г. Капшагай' },
  { post_id: 'kapchagai-vdhr-karashoki', name: 'Вдхр. Капшагайское \u2013 МС Карашокы' },
  { post_id: 'kurti-leninski-most',      name: 'Р. Курты \u2013 база клх. им. Ленина (Ленинский мост)' },
  { post_id: 'ili-kapchagai-uroch',      name: 'Р. Иле - уроч. Капчагай' },
  { post_id: 'ili-ushzharma',            name: 'Р. Иле- с. Ушжарма' },
  { post_id: 'ili-suminka-6km',          name: 'Р. Иле, пр. Суминка - 6 км ниже истока' },
  { post_id: 'ili-nizhe-zhideli-1km',    name: 'Р. Иле \u20131 км ниже ответвления рук. Жидели' },
  { post_id: 'ili-zhideli-16km',         name: 'Р. Иле. рук. Жидели \u2013 16 км ниже истока' },
];

function log(msg)  { console.log(`[hydro-collect] ${new Date().toISOString()}  ${msg}`); }
function warn(msg) { console.warn(`[hydro-collect] WARN  ${msg}`); }

// ─── Puppeteer ────────────────────────────────────────────────────────────────

async function collectFromShiny() {
  log(`Открываем Shiny-карту: ${HYDRO_MAP_URL}`);

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=ru'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('OmutHydroCollect/2.0 (+not.kot.vlad@gmail.com)');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru,en;q=0.8' });

    // Shiny держит постоянный SockJS/WebSocket — waitUntil никогда не сработает.
    // Просто открываем страницу и игнорируем таймаут навигации;
    // реальное ожидание данных — ниже, в waitForFunction.
    try {
      await page.goto(HYDRO_MAP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    } catch (e) {
      warn(`page.goto: ${e.message} — продолжаем, ждём Shiny через waitForFunction`);
    }

    // Ждём пока Shiny загрузит карту и вызовет addAwesomeMarkers
    log('Ждём загрузки Shiny-карты...');
    await page.waitForFunction(
      () => {
        const calls = window.Shiny?.shinyapp?.$values?.map?.x?.calls;
        return Array.isArray(calls) && calls.some(c => c.method === 'addAwesomeMarkers');
      },
      { timeout: 45_000, polling: 1000 }
    );
    log('Карта загружена. Извлекаем данные...');

    // Извлекаем данные прямо из объекта Shiny
    const raw = await page.evaluate((targets) => {
      const calls = window.Shiny?.shinyapp?.$values?.map?.x?.calls || [];
      const mc = calls.find(c => c.method === 'addAwesomeMarkers');
      if (!mc) return [];

      const lats   = mc.args[0];
      const lngs   = mc.args[1];
      const popups = mc.args[6];

      const results = [];
      for (let i = 0; i < lats.length; i++) {
        const p = String(popups?.[i] || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const matchedTarget = targets.find(t => p.includes(t.name));
        if (!matchedTarget) continue;

        const n  = s => s ? parseFloat(s) : null;
        results.push({
          post_id:         matchedTarget.post_id,
          kazhydromet_name: matchedTarget.name,
          lat:             lats[i],
          lng:             lngs[i],
          date:            p.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
          water_temp:      n(p.match(/Температура воды,С\s+([\d.]+)/)?.[1]),
          water_level_cm:  n(p.match(/Фактический уровень, см\s+([\d.]+)/)?.[1]),
          flow_m3s:        n(p.match(/Фактический расход, м\u00b3\/с\s+([\d.]+)/)?.[1]),
          danger_level_cm: n(p.match(/Опасный уровень, см\s+([\d.]+)/)?.[1]),
        });
      }
      return results;
    }, TARGET_POSTS);

    log(`Найдено постов: ${raw.length}/${TARGET_POSTS.length}`);
    for (const r of raw) {
      log(`  ✓ ${r.post_id}: temp=${r.water_temp ?? '—'}°C  level=${r.water_level_cm ?? '—'}cm  flow=${r.flow_m3s ?? '—'}м³/с  (${r.date})`);
    }

    const missing = TARGET_POSTS.filter(t => !raw.find(r => r.post_id === t.post_id));
    for (const m of missing) {
      warn(`  ✗ Не найден: ${m.post_id} (${m.name})`);
    }

    return raw;
  } finally {
    await browser.close();
  }
}

// ─── Cloudflare KV ────────────────────────────────────────────────────────────

async function kvPut(key, value) {
  if (DRY_RUN) { log(`[DRY_RUN] KV PUT ${key} = ${JSON.stringify(value).slice(0,120)}`); return; }
  if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) throw new Error('CF_ переменные не заданы');

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`KV PUT ${key} → HTTP ${res.status}: ${await res.text().catch(()=>'')}`);
}

async function kvGet(key) {
  if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID || !CF_API_TOKEN) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` } });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function appendLevelHistory(postId, levelCm, measuredAt) {
  if (levelCm == null) return;
  const key = `hydro:level-history:${postId}`;
  let history = DRY_RUN ? [] : (await kvGet(key) || []);
  history.push({ t: measuredAt, level_cm: levelCm });
  if (history.length > 90) history = history.slice(-90);
  await kvPut(key, history);
  if (!DRY_RUN) log(`  → история уровня обновлена: ${key} (${history.length} точек)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('=== Запуск сборщика гидропостов ===');
  if (DRY_RUN) log('(DRY_RUN — KV не пишем)');

  const records = await collectFromShiny();

  if (!records.length) {
    warn('Нет данных. Завершаем.');
    process.exit(1);
  }

  const measuredAt = new Date().toISOString();
  let written = 0;

  for (const r of records) {
    const snapshot = {
      post_id:        r.post_id,
      post_name:      r.kazhydromet_name,
      lat:            r.lat,
      lng:            r.lng,
      water_temp:     r.water_temp,
      water_level_cm: r.water_level_cm,
      flow_m3s:       r.flow_m3s,
      danger_level_cm: r.danger_level_cm,
      measured_at:    r.date ? `${r.date}T12:00:00+05:00` : measuredAt,
      collected_at:   measuredAt,
      source:         'ecodata.kz:3838/app_dg_map_ru/',
    };
    try {
      await kvPut(`hydro:snapshot:${r.post_id}`, snapshot);
      await appendLevelHistory(r.post_id, r.water_level_cm, snapshot.measured_at);
      written++;
    } catch (e) {
      warn(`Ошибка KV для ${r.post_id}: ${e.message}`);
    }
  }

  log(`=== Готово: ${written}/${records.length} постов записано в KV ===`);
}

main().catch(e => { console.error('[hydro-collect] FATAL:', e); process.exit(1); });
