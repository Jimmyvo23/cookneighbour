-- T-030 seed (reference data). Applied automatically by `supabase start` / `supabase db reset`.
-- Demo accounts, chefs and dishes are created by scripts/seed.ts (they need Supabase Auth).
--
-- postal_prefixes: GTA forward sortation areas (first 3 characters of a postal code), assumption A-1.
-- lat/lng are APPROXIMATE area centres (rounded, from public map knowledge, not an official dataset).
-- They only drive straight-line (haversine) distance in the prototype; do not use them for anything
-- that needs precision. Cuisines have no table: they are free text on chefs and dishes (contract).
-- scripts/seed.ts reads the tuples below to load the same rows into a hosted project, so keep one
-- tuple per line in the form ('L5B', 'City', lat, lng).

insert into public.postal_prefixes (prefix, city, lat, lng) values
  -- Mississauga (L4T to L5W)
  ('L4T', 'Mississauga', 43.7040, -79.6360),
  ('L4V', 'Mississauga', 43.7010, -79.6050),
  ('L4W', 'Mississauga', 43.6410, -79.6170),
  ('L4X', 'Mississauga', 43.6035, -79.5690),
  ('L4Y', 'Mississauga', 43.6100, -79.5890),
  ('L4Z', 'Mississauga', 43.6200, -79.6350),
  ('L5A', 'Mississauga', 43.5800, -79.6000),
  ('L5B', 'Mississauga', 43.5920, -79.6420),
  ('L5C', 'Mississauga', 43.5720, -79.6540),
  ('L5E', 'Mississauga', 43.5800, -79.5600),
  ('L5G', 'Mississauga', 43.5560, -79.5780),
  ('L5H', 'Mississauga', 43.5480, -79.6050),
  ('L5J', 'Mississauga', 43.5120, -79.6290),
  ('L5K', 'Mississauga', 43.5190, -79.6560),
  ('L5L', 'Mississauga', 43.5400, -79.6700),
  ('L5M', 'Mississauga', 43.5700, -79.7100),
  ('L5N', 'Mississauga', 43.5950, -79.7400),
  ('L5P', 'Mississauga', 43.6900, -79.6200),
  ('L5R', 'Mississauga', 43.6150, -79.6500),
  ('L5S', 'Mississauga', 43.7150, -79.6700),
  ('L5T', 'Mississauga', 43.6900, -79.6900),
  ('L5V', 'Mississauga', 43.6050, -79.6950),
  ('L5W', 'Mississauga', 43.6420, -79.7170),
  -- Toronto
  ('M1B', 'Toronto', 43.8060, -79.1940),
  ('M2N', 'Toronto', 43.7690, -79.4090),
  ('M3C', 'Toronto', 43.7250, -79.3400),
  ('M4K', 'Toronto', 43.6790, -79.3520),
  ('M4M', 'Toronto', 43.6590, -79.3400),
  ('M5H', 'Toronto', 43.6500, -79.3840),
  ('M5V', 'Toronto', 43.6400, -79.3990),
  ('M6H', 'Toronto', 43.6690, -79.4380),
  ('M9W', 'Toronto', 43.7060, -79.5960),
  -- Brampton
  ('L6P', 'Brampton', 43.7900, -79.6900),
  ('L6R', 'Brampton', 43.7370, -79.7270),
  ('L6S', 'Brampton', 43.7260, -79.7000),
  ('L6T', 'Brampton', 43.7100, -79.7000),
  ('L6V', 'Brampton', 43.6900, -79.7600),
  ('L6W', 'Brampton', 43.6990, -79.7200),
  ('L6X', 'Brampton', 43.6700, -79.7900),
  ('L6Y', 'Brampton', 43.6450, -79.7500),
  ('L6Z', 'Brampton', 43.7150, -79.7900),
  -- Oakville
  ('L6H', 'Oakville', 43.4750, -79.7000),
  ('L6J', 'Oakville', 43.4400, -79.6700),
  ('L6K', 'Oakville', 43.4400, -79.6900),
  ('L6L', 'Oakville', 43.4100, -79.7200),
  ('L6M', 'Oakville', 43.4300, -79.7600),
  -- Markham
  ('L3P', 'Markham', 43.8760, -79.2600),
  ('L3R', 'Markham', 43.8450, -79.3300),
  ('L3S', 'Markham', 43.8400, -79.2600),
  ('L6B', 'Markham', 43.8800, -79.2300),
  ('L6C', 'Markham', 43.8900, -79.3300),
  ('L6E', 'Markham', 43.9000, -79.2600),
  -- Vaughan
  ('L4H', 'Vaughan', 43.8300, -79.5700),
  ('L4J', 'Vaughan', 43.8000, -79.4700),
  ('L4K', 'Vaughan', 43.8100, -79.5100),
  ('L4L', 'Vaughan', 43.7800, -79.5700),
  ('L6A', 'Vaughan', 43.8500, -79.5000),
  -- Richmond Hill
  ('L4B', 'Richmond Hill', 43.8500, -79.3900),
  ('L4C', 'Richmond Hill', 43.8800, -79.4300),
  ('L4E', 'Richmond Hill', 43.9400, -79.4500),
  ('L4S', 'Richmond Hill', 43.8800, -79.4000)
on conflict (prefix) do update
  set city = excluded.city, lat = excluded.lat, lng = excluded.lng;
