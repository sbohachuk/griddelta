# GridDelta

Подобові EEX Base-ф’ючерси (Day / Week / Weekend / Month) проти day-ahead споту Energy-Charts. Дельти EUR/MWh і %, порівняння EU vs UA (РДН), розріз **Дні / Декади** зі знижками −30/−20/−10% у € та ₴.

## Запуск

```bash
npm install
npm run dev
```

Додаток: [http://localhost:8080](http://localhost:8080)

## Можливості

- **Розріз звіту:** Дні | Декади
- Spot (Energy-Charts) · Day-архів EEX (до поставки) · Week · Weekend · Month
- Δ day / week / month у € і %
- EU середня + UA РДН (UAH→EUR через NBU) і дельта %
- Декади: середні SPOT/DAY/WEEK + знижки 30/20/10% у EUR і UAH
- Експорт Excel

## Зони

DE, AT, FR, CZ, HU, SK, RO, PL, BG

## Стек

TanStack Start · React · Vite · Tailwind · Recharts
