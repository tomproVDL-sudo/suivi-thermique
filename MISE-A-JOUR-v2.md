# Mise à jour 2.0.0 – Suivi thermique

## Ce qui change

- **Plus aucune perte de mesures** : chaque mesure est d'abord enregistrée sur l'appareil, puis envoyée au serveur dès que possible (compteur ⏳ en haut). L'ancienne version effaçait les mesures locales à chaque mise à jour : c'est supprimé.
- **Connexion obligatoire pour le serveur** (e-mail + mot de passe Supabase). Sans connexion, l'application fonctionne en local.
- **Bandeau météo** au-dessus des onglets : station de l'école (WeatherLink) ou Lille-Lesquin (Météo-France), prévisions AROME des 12 prochaines heures. Repliable, masquable, choix de la station.
- **Paramètres météo & clés** : clés WeatherLink et Météo-France enregistrées **uniquement sur l'appareil** (ni GitHub, ni Supabase).
- Heure de mesure modifiable, pression en hPa, import Excel corrigé (tous les onglets, pas de doublons), heures des CSV Météo-France converties de UTC en heure locale, fenêtre « Établissements & points » adaptée au téléphone, fonctionnement hors ligne fiable, bibliothèques figées.

## Ordre de mise en service

### 0. Sauvegarde (recommandé)
Sur chaque téléphone qui a servi hors ligne : ☰ > Exporter Excel, avant la mise à jour.

### 1. Supabase : créer ton compte
1. Authentication > Users > **Add user** > e-mail + mot de passe (cocher « Auto Confirm User »).
2. Authentication > Sign In / Providers : **désactiver « Allow new users to sign up »**.

### 2. GitHub : remplacer les fichiers
- Remplacer : `index.html`, `sw.js`, `manifest.json`
- Ajouter : `meteo.js`, `iconTherm512.png`, le dossier `supabase/` (aucun secret dedans)
- **Ne pas modifier `version.json`** : les téléphones encore sur l'ancienne version le lisent, et s'il changeait ils effaceraient leurs mesures locales.

### 3. Première ouverture
Ouvrir l'application avec du réseau. Elle se recharge une fois toute seule et affiche **v2.0.0**. Si ce n'est pas le cas, la fermer complètement et la rouvrir.
Puis ☰ > **Se connecter**. Le voyant passe à **CLOUD** ; les éventuelles mesures locales jamais envoyées partent automatiquement.

Sur iPhone, l'application installée sur l'écran d'accueil a son propre stockage, séparé de Safari : connexion et clés se saisissent dans l'application installée.

### 4. Supabase : protéger les données
Une fois la connexion vérifiée sur au moins un appareil : SQL Editor > coller `supabase/securite.sql` > Run.
Les trois tables doivent afficher `rowsecurity = true`. Advisors > Security Advisor ne doit plus signaler « RLS disabled ».

### 5. Supabase : déployer le relais WeatherLink
WeatherLink refuse les appels depuis un navigateur ; ce relais transmet la demande sans rien enregistrer.
- Edge Functions > **Deploy a new function** > **Via Editor** > nom : `weatherlink-relais` > coller `supabase/functions/weatherlink-relais/index.ts` > Deploy.
- Laisser l'option **Verify JWT** activée.
- (Ou en ligne de commande : `supabase functions deploy weatherlink-relais`.)

### 6. Clés et stations (sur chaque appareil)
☰ > **Paramètres météo & clés**
- WeatherLink : API Key + API Secret (weatherlink.com > Account > Generate v2 Key) > **Tester et lister mes stations** > noter les ID.
- Météo-France : sur portail-api.meteofrance.fr, créer une application, l'abonner à « Données d'observation » (et « Données climatologiques » pour la suite), générer une clé de type API Key > la coller > **Tester**. Station par défaut : 59343001 (Lille-Lesquin).

☰ > **Établissements & points** : saisir l'ID WeatherLink de chaque école > Enregistrer.

## En cas de souci
- Bandeau « Relais WeatherLink introuvable » : étape 5 non faite ou nom de fonction différent.
- « Connecte-toi pour utiliser le relais » : le relais n'accepte que les utilisateurs connectés.
- Plus rien ne se synchronise après l'étape 4 : vérifier qu'on est bien connecté (voyant CLOUD).
