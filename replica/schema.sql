-- Reference schema for an optional future cloud sync (Postgres).
-- The app itself stores the same model on the tablet in IndexedDB (src/db.ts).
-- Single shop: shop_id on every row so a second location can be added later.
-- Access rule (if synced via Supabase): RLS "shop_id = auth.jwt()->>'shop_id'" on every table.

create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null, tel text, email text, address text,
  units text not null default 'mi' check (units in ('mi','km')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null, tel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on customers (shop_id, name);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  year int, make text, model text, engine text, plate text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, vin)
);
create index on vehicles (shop_id, plate);

create table scans (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  report_id text not null,
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  customer_id uuid references customers(id) on delete set null,
  odometer int, odometer_unit text check (odometer_unit in ('mi','km')),
  technician text, ro_number text, adapter_name text, protocol text,
  mil_on boolean, notes text,
  status text not null default 'complete' check (status in ('running','complete','failed')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, report_id)
);
create index on scans (shop_id, started_at desc);
create index on scans (vehicle_id);
create index on scans (customer_id);

create table scan_systems (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  system text not null, ecu text,
  status text not null check (status in ('ok','fault','no_response')),
  dtc_count int not null default 0
);
create index on scan_systems (scan_id);

create table scan_dtcs (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references scans(id) on delete cascade,
  ecu text, code text not null check (code ~ '^[PCBU][0-3][0-9A-F]{3}$'),
  description text,
  status text not null check (status in ('confirmed','pending','permanent'))
);
create index on scan_dtcs (scan_id);
create index on scan_dtcs (code);

create table scan_readiness (
  scan_id uuid not null references scans(id) on delete cascade,
  monitor text not null, supported boolean not null, complete boolean not null,
  primary key (scan_id, monitor)
);
