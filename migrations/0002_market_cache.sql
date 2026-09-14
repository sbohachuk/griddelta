-- Persistent cache of energy market quotes so past days are not re-fetched from EEX / Energy-Charts.
CREATE TABLE IF NOT EXISTS market_zone_quotes (
  trade_date date NOT NULL,
  zone_id text NOT NULL,
  spot double precision,
  day_futures double precision,
  week_futures double precision,
  weekend_futures double precision,
  month_futures double precision,
  day_trade_date date,
  week_trade_date date,
  weekend_trade_date date,
  month_trade_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, zone_id)
);

CREATE INDEX IF NOT EXISTS market_zone_quotes_date_idx ON market_zone_quotes (trade_date);

CREATE TABLE IF NOT EXISTS market_eu_ua (
  trade_date date NOT NULL PRIMARY KEY,
  eu_avg double precision,
  ua_rdn_eur double precision,
  ua_rdn_uah double precision,
  delta_pct double precision,
  eur_uah double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);
