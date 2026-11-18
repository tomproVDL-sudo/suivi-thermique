# Mise à jour 2.1.0 – Suivi thermique

À déposer sur GitHub par-dessus la 2.0.0 : `index.html`, `meteo.js`, `sw.js` (ne toujours pas modifier `version.json`). Rien à refaire dans Supabase.

## Connexions API

### WeatherLink : « 401 Invalid authentication credentials »
Ce message vient de **WeatherLink**, pas du relais : le relais fonctionne et a bien transmis la demande, mais WeatherLink a refusé la clé ou le secret reçus. Ton autre programme utilise exactement la même méthode (clé en paramètre `api-key`, secret dans l'en-tête `X-Api-Secret`). C'est donc la saisie qui diffère.

- Le bouton **Tester et lister mes stations** réessaie automatiquement avec la clé et le secret **inversés** ; si ça passe, il corrige les champs (clique ensuite sur « Enregistrer »).
- Sous les champs, un aperçu (longueur, 4 premiers et 4 derniers caractères) permet de comparer avec les valeurs de l'autre programme sans les afficher en clair.
- Les ID des stations Davis des deux écoles sont préremplis : 149569 (Thierry Launay) et 183318 (Jean Jacques Rousseau).

### Météo-France : « Clé refusée »
Le portail renvoie le code 900901 quand la clé est **invalide ou expirée**. Un « token » généré sur le portail ne dure qu'**1 heure** : c'est très probablement ce qui s'est passé. Il faut :

1. sur portail-api.meteofrance.fr, vérifier que ton application est abonnée à **« Données d'observation »** (bandeau) **et** à **« Données climatologiques »** (comparaison) ;
2. générer une **API Key** (pas un token) avec une **longue durée de validité** (exprimée en secondes, par exemple plusieurs années) ;
3. la coller dans ☰ > Paramètres météo & clés > **Tester les deux API** : chaque API affiche son propre résultat (clé expirée, API non souscrite, quota…).

Si l'observation n'est pas accessible, le bandeau affiche l'heure en cours du modèle AROME, marquée « (modèle) ».

## Comparaison des campagnes (onglet Comparer)

1. **Campagnes et météo de Lille-Lesquin** : chaque campagne (école + date) avec sa phase (avant travaux / chantier / après) et, après « Charger la météo manquante » :
   - Tx du jour ;
   - température, rayonnement, nébulosité et vent **pendant les mesures** ;
   - pluie du jour et des 72 h précédentes ;
   - Tx moyenne des 3 jours précédents ;
   - repères ☀️ journée radiative · 💧 sol humidifié · 🔥 seuils de chaleur.
   
   Données climatologiques horaires Météo-France (même API que ton autre programme), gardées sur l'appareil.
2. **Quelles campagnes peut-on comparer ?** Score de comparabilité 0-100, meilleures paires avant / après de la même école (bouton « Comparer »), matrice des campagnes cochées.
3. **Comparer les campagnes cochées** (2 à 8) :
   - axe horaire continu ;
   - moyenne des points par demi-heure, tous les points, ou un point ;
   - valeurs mesurées ou **écart à la température de Lille-Lesquin au même instant** (neutralise la météo du jour) ;
   - tableau de synthèse par campagne.
4. L'ancien import manuel de CSV Météo-France reste disponible, replié en bas.

Dates du projet utilisées pour les phases (modifiables en tête de la section « COMPARAISON DES CAMPAGNES » du code) : début des travaux le 01/07/2025, revégétalisation à partir du 01/09/2025.
