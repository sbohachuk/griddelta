# GridDelta

EEX Base futures (Day / Week / Weekend / Month) vs Energy-Charts day-ahead spot.  
Δ EUR/MWh & %, EU vs UA (RDN), report modes **Days / Decades**, discount −30/−20/−10% in € and ₴.

## Run (desktop & mobile browser)

```bash
npm install
npm run dev
```

Open: http://localhost:8080

Works in mobile browser (responsive layout: stacked cards, horizontal scroll tables, touch-friendly zone chips). For phone testing use your LAN IP from the Vite “Network” line, or deploy (Vercel etc.).

## Features

- Default range: full current calendar month
- Modes: **Дні** | **Декади**
- Charts: zone (Spot/Day/Week/Month + UA) · overview all countries with on/off toggles
- Dates labeled with ISO week: `09-14 · W37`
- Fetch order: Spot → Day → Month → Week/Weekend (retries + forward-fill)
- Excel export

## Zones

DE, AT, FR, CZ, HU, SK, RO, PL, BG (+ UA RDN)

## Stack

TanStack Start · React · Vite · Tailwind · Recharts
