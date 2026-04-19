export default {
  "_comment_1": "Справочник гидрологических постов Казгидромета. Данные с ecodata.kz:3838/app_dg_map_ru/ (Shiny-приложение).",
  "_comment_2": "post_id в рамках ecodata.kz обычно неочевиден (Shiny генерирует сессионные ID), поэтому мы идентифицируем пост по 'slug' (имя водоёма + привязка) + координатам.",
  "_comment_3": "TODO (этап 2): headless-парсер ecodata.kz через Cloudflare Browser Rendering API или Puppeteer — см. README, раздел 'Гидропосты: стратегия извлечения'.",
  "source": "manual-seed 2026-04-17 (координаты из открытых источников, списки постов по публикациям Казгидромета)",
  "version": 1,
  "hydroposts": [
    {
      "post_id": "ili-kapchagai",
      "name": "р. Или — с. Капшагай",
      "water_body": "река Или",
      "lat": 43.876,
      "lng": 77.069,
      "type": "river",
      "parameters": ["water_temp", "water_level", "flow"],
      "update_schedule": "daily-12:00-local",
      "verified": false,
      "notes": "Ключевой пост для Капчагайского вдхр и р. Или. TODO: подтвердить точные координаты и имя"
    },
    {
      "post_id": "ili-dubun",
      "name": "р. Или — с. Дубун",
      "water_body": "река Или",
      "lat": 44.150,
      "lng": 77.583,
      "type": "river",
      "parameters": ["water_temp", "water_level", "flow"],
      "update_schedule": "daily-12:00-local",
      "verified": false,
      "notes": "Нижнее течение Или, после плотины"
    },
    {
      "post_id": "kapchagai-vdhr",
      "name": "Капчагайское вдхр. — с. Шенгельды",
      "water_body": "Капчагайское водохранилище",
      "lat": 43.858,
      "lng": 77.300,
      "type": "reservoir",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily-12:00-local",
      "verified": false,
      "notes": "Водомерный пост на водохранилище"
    },
    {
      "post_id": "bolshaya-almatinka-almaty",
      "name": "р. Большая Алматинка — г. Алматы",
      "water_body": "река Большая Алматинка",
      "lat": 43.200,
      "lng": 76.920,
      "type": "river",
      "parameters": ["water_temp", "water_level", "flow"],
      "update_schedule": "daily-12:00-local",
      "verified": false,
      "notes": "В пределах Алматы"
    },
    {
      "post_id": "malaya-almatinka-medeu",
      "name": "р. Малая Алматинка — ур. Медеу",
      "water_body": "река Малая Алматинка",
      "lat": 43.160,
      "lng": 77.054,
      "type": "river",
      "parameters": ["water_level", "flow"],
      "update_schedule": "daily-12:00-local",
      "verified": false,
      "notes": "Горный участок в верховьях"
    },
    {
      "post_id": "kurti-vdhr",
      "name": "Куртинское вдхр.",
      "water_body": "Куртинское водохранилище",
      "lat": 43.870,
      "lng": 76.334,
      "type": "reservoir",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily-12:00-local",
      "verified": false,
      "notes": "TODO: подтвердить наличие поста"
    },
    {
      "post_id": "charyn-sarytogay",
      "name": "р. Чарын — ур. Сарытогай",
      "water_body": "река Чарын",
      "lat": 43.360,
      "lng": 78.983,
      "type": "river",
      "parameters": ["water_temp", "water_level", "flow"],
      "update_schedule": "daily-12:00-local",
      "verified": false
    },
    {
      "post_id": "karatal-ushtobe",
      "name": "р. Каратал — г. Уштобе",
      "water_body": "река Каратал",
      "lat": 45.264,
      "lng": 77.972,
      "type": "river",
      "parameters": ["water_temp", "water_level", "flow"],
      "update_schedule": "daily-12:00-local",
      "verified": false,
      "notes": "Область Жетісу"
    }
  ],
  "default_mapping": {
    "_comment": "Явная привязка 4 дефолтных локаций Omut к гидропостам (при недоборе через haversine).",
    "kapchagay": { "lat": 43.9114, "lng": 77.1203, "hydropost_id": "ili-kapchagai", "station_id": 149 },
    "ili": { "lat": 43.9311, "lng": 77.0816, "hydropost_id": "ili-kapchagai", "station_id": 149 },
    "kurti": { "lat": 43.8702, "lng": 76.3343, "hydropost_id": "kurti-vdhr", "station_id": 149 },
    "almatinka": { "lat": 43.7438, "lng": 77.1014, "hydropost_id": "bolshaya-almatinka-almaty", "station_id": 149 }
  }
}
;
