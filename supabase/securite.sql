-- =====================================================================
-- Suivi thermique : réserver les données aux utilisateurs connectés
-- À exécuter dans Supabase > SQL Editor, APRÈS avoir :
--   1. déployé la nouvelle version de l'application (avec l'écran de connexion),
--   2. créé ton compte : Authentication > Users > Add user (e-mail + mot de passe),
--   3. désactivé les inscriptions : Authentication > Sign In / Providers >
--      « Allow new users to sign up » = désactivé
--      (sinon n'importe qui pourrait créer un compte « connecté »),
--   4. vérifié que tu arrives à te connecter dans l'application.
-- =====================================================================

-- 1) Activer la protection par lignes (RLS) sur les trois tables
alter table public.campagne_surface enable row level security;
alter table public.campagne_air      enable row level security;
alter table public.etablissements    enable row level security;

-- 2) Supprimer d'éventuelles anciennes règles ouvertes à tous (à adapter si les noms diffèrent :
--    voir Authentication > Policies)
-- drop policy if exists "Enable read access for all users" on public.campagne_surface;

-- 3) N'autoriser que les utilisateurs connectés (lecture + écriture)
drop policy if exists "membres connectes" on public.campagne_surface;
drop policy if exists "membres connectes" on public.campagne_air;
drop policy if exists "membres connectes" on public.etablissements;

create policy "membres connectes" on public.campagne_surface
  for all to authenticated using (true) with check (true);

create policy "membres connectes" on public.campagne_air
  for all to authenticated using (true) with check (true);

create policy "membres connectes" on public.etablissements
  for all to authenticated using (true) with check (true);

-- 4) Vérification : les trois lignes doivent afficher rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('campagne_surface', 'campagne_air', 'etablissements');

-- Ensuite : Advisors > Security Advisor ne doit plus signaler « RLS disabled in public ».
