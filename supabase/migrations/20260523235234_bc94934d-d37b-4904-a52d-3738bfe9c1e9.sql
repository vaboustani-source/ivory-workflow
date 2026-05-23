
CREATE TABLE IF NOT EXISTS public._b3_test_results (
  scenario text PRIMARY KEY, result jsonb, captured_at timestamptz DEFAULT now()
);
TRUNCATE public._b3_test_results;

INSERT INTO public._b3_test_results(scenario, result)
SELECT 'ISABELLA (no fees)',
  public._b3_test_add('382056d1-2f62-4df3-aa17-255a51105428'::uuid,
    'B3 test add — extra album', 120000,
    '15f705ca-8003-467d-8b38-48b1795a6ba3'::uuid);

INSERT INTO public._b3_test_results(scenario, result)
SELECT 'SOPHIA (fees baked)',
  public._b3_test_add('af5a4623-c1cb-467d-b6de-7509e3a2ee6f'::uuid,
    'B3 test add — extra hour', 120000,
    '15f705ca-8003-467d-8b38-48b1795a6ba3'::uuid);
