-- Pump Analyzer: Supabase Schema
-- Run this in your Supabase SQL editor

-- ============================================================
-- predictions: stores every Claude analysis snapshot
-- ============================================================
create table if not exists predictions (
  id uuid default gen_random_uuid() primary key,
  mint text not null,
  created_at timestamptz default now(),

  -- Snapshot data at time of analysis
  snapshot_timestamp bigint,
  market_cap_at_analysis numeric,
  age_seconds integer,
  name text,
  symbol text,
  social_count integer,
  total_holders integer,
  dev_holding_pct numeric,
  bundle_detected boolean,
  bundle_confidence integer,
  rug_risk_score integer,
  bonding_curve_pct numeric,
  is_migrated boolean,
  volume_1h numeric,
  buy_sell_ratio numeric,

  -- Prediction output from Claude
  estimated_peak_mc numeric,
  peak_mc_low numeric,
  peak_mc_high numeric,
  prob_100k integer,
  prob_250k integer,
  prob_500k integer,
  prob_1m integer,
  prob_5m integer,
  prob_10m integer,
  dip_likely boolean,
  dip_depth_pct integer,
  risk_score integer,
  rug_probability integer,
  bundle_impact text,
  recommended_entry_mc numeric,
  recommended_exit_mc numeric,
  pnl_conservative numeric,
  pnl_moderate numeric,
  pnl_aggressive numeric,
  flags text[],
  momentum text,
  stage text,
  reasoning text,

  -- Outcome tracking (filled in later)
  actual_peak_mc numeric,           -- filled after coin plays out
  outcome_recorded_at timestamptz,  -- when you recorded the outcome
  prediction_accurate boolean,      -- was estimated_peak_mc within 50% of actual?
  notes text                        -- manual notes on why prediction was off
);

-- ============================================================
-- Indexes for common queries
-- ============================================================
create index if not exists predictions_mint_idx on predictions(mint);
create index if not exists predictions_created_at_idx on predictions(created_at desc);
create index if not exists predictions_stage_idx on predictions(stage);

-- ============================================================
-- watched_coins: track which coins you're actively monitoring
-- ============================================================
create table if not exists watched_coins (
  mint text primary key,
  name text,
  symbol text,
  added_at timestamptz default now(),
  is_active boolean default true,
  last_analyzed_at timestamptz
);

-- ============================================================
-- Enable Row Level Security (safe defaults)
-- ============================================================
alter table predictions enable row level security;
alter table watched_coins enable row level security;

-- Allow all operations for now (tighten when publishing)
create policy "allow_all_predictions" on predictions for all using (true) with check (true);
create policy "allow_all_watched" on watched_coins for all using (true) with check (true);
