export default {
  "_comment": "Справочник гидрологических постов Казгидромета — Алматинская область. Источник: интерактивная карта kazhydromet.kz/ru/gidrologia. Сбор данных: scripts/collect-hydro.js → KV 'hydro:snapshot:<post_id>'.",
  "source": "manual-seed 2026-04-20 (имена — точно с карты Казгидромета; координаты — приближённые, verified:false до подтверждения из API)",
  "version": 2,
  "hydroposts": [
    {
      "post_id": "kaskelyen-ustye",
      "kazhydromet_name": "Р.Каскелен - устье",
      "name": "р. Каскелен — устье",
      "water_body": "река Каскелен",
      "lat": 43.822,
      "lng": 76.742,
      "type": "river",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Устье р. Каскелен при впадении в Капшагайское вдхр. Координаты приближённые."
    },
    {
      "post_id": "kapchagai-vdhr-kapshagai",
      "kazhydromet_name": "Вдхр. Капшагайское – г. Капшагай",
      "name": "Вдхр. Капшагайское — г. Капшагай",
      "water_body": "Капшагайское водохранилище",
      "lat": 43.884,
      "lng": 77.069,
      "type": "reservoir",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Водомерный пост на северном участке водохранилища, у г. Капшагай."
    },
    {
      "post_id": "kapchagai-vdhr-karashoki",
      "kazhydromet_name": "Вдхр. Капшагайское – МС Карашокы",
      "name": "Вдхр. Капшагайское — МС Карашокы",
      "water_body": "Капшагайское водохранилище",
      "lat": 43.618,
      "lng": 77.270,
      "type": "reservoir",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Метеостанция Карашокы — восточный берег водохранилища."
    },
    {
      "post_id": "kurti-leninski-most",
      "kazhydromet_name": "Р. Курты – база клх. им. Ленина (Ленинский мост)",
      "name": "р. Курты — Ленинский мост",
      "water_body": "река Курты",
      "lat": 43.872,
      "lng": 76.334,
      "type": "river",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Пост на р. Курты у базы колхоза им. Ленина (Ленинский мост). Западный приток вдхр."
    },
    {
      "post_id": "ili-kapchagai-uroch",
      "kazhydromet_name": "Р. Иле - уроч. Капчагай",
      "name": "р. Или — уроч. Капчагай",
      "water_body": "река Или",
      "lat": 43.762,
      "lng": 76.965,
      "type": "river",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Пост выше плотины Капшагайской ГЭС. Ключевой пост входа в водохранилище."
    },
    {
      "post_id": "ili-ushzharma",
      "kazhydromet_name": "Р. Иле- с. Ушжарма",
      "name": "р. Или — с. Ушжарма",
      "water_body": "река Или",
      "lat": 44.178,
      "lng": 77.594,
      "type": "river",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Пост ниже плотины Капшагайской ГЭС, с. Ушжарма."
    },
    {
      "post_id": "ili-suminka-6km",
      "kazhydromet_name": "Р. Иле, пр. Суминка - 6 км ниже истока",
      "name": "р. Или, пр. Суминка — 6 км ниже истока",
      "water_body": "река Или (проток Суминка)",
      "lat": 44.302,
      "lng": 77.891,
      "type": "river",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Проток Суминка — рукав р. Или."
    },
    {
      "post_id": "ili-nizhe-zhideli-1km",
      "kazhydromet_name": "Р. Иле –1 км ниже ответвления рук. Жидели",
      "name": "р. Или — 1 км ниже отв. рук. Жидели",
      "water_body": "река Или",
      "lat": 44.531,
      "lng": 78.205,
      "type": "river",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Главное русло Или на 1 км ниже места ответвления рукава Жидели."
    },
    {
      "post_id": "ili-zhideli-16km",
      "kazhydromet_name": "Р. Иле. рук. Жидели – 16 км ниже истока",
      "name": "р. Или, рук. Жидели — 16 км ниже истока",
      "water_body": "река Или (рукав Жидели)",
      "lat": 44.463,
      "lng": 78.374,
      "type": "river",
      "parameters": ["water_temp", "water_level"],
      "update_schedule": "daily",
      "verified": false,
      "notes": "Рукав Жидели — дельтовый рукав р. Или."
    }
  ],
  "default_mapping": {
    "_comment": "Явная привязка ключевых локаций Omut к гидропостам (используется при явном hydropost_id запросе).",
    "kapchagay": {
      "lat": 43.8870, "lng": 77.0690,
      "hydropost_id": "kapchagai-vdhr-kapshagai",
      "station_id": 149
    },
    "kapchagay-karashoki": {
      "lat": 43.6180, "lng": 77.2700,
      "hydropost_id": "kapchagai-vdhr-karashoki",
      "station_id": 149
    },
    "ili": {
      "lat": 43.7620, "lng": 76.9650,
      "hydropost_id": "ili-kapchagai-uroch",
      "station_id": 149
    },
    "ili-downstream": {
      "lat": 44.1780, "lng": 77.5940,
      "hydropost_id": "ili-ushzharma",
      "station_id": 149
    },
    "kurti": {
      "lat": 43.8720, "lng": 76.3340,
      "hydropost_id": "kurti-leninski-most",
      "station_id": 149
    },
    "kaskelyen": {
      "lat": 43.8220, "lng": 76.7420,
      "hydropost_id": "kaskelyen-ustye",
      "station_id": 149
    }
  }
};
