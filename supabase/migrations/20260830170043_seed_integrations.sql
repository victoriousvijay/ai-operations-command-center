-- Seed default integration rows so the dashboard's Integrations panel
-- reflects the two external systems this project integrates with, without
-- requiring a manual setup step. Purely descriptive metadata — no
-- credentials. base_url is left null for gohighlevel since GHL_API_BASE_URL
-- is a fixed, verified constant (see .env.example), not a per-deployment
-- value worth duplicating here.
insert into integrations (name, provider, status) values
  ('n8n-primary', 'n8n', 'active'),
  ('gohighlevel-main', 'gohighlevel', 'active');
