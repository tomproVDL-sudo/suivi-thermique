/*
 * meteo.js — Accès aux sources météo pour Suivi Thermique
 *
 *  - Prévisions : Open-Meteo, modèles Météo-France (AROME / ARPEGE), sans clé.
 *  - Observation Météo-France (ex. Lille-Lesquin) : API « Données d'observation » (DPObs),
 *    clé API saisie sur l'appareil (en-tête « apikey »). Appel direct depuis le navigateur.
 *  - Stations WeatherLink des écoles : API v2. WeatherLink refuse les appels directs depuis
 *    un navigateur (pas de CORS) : on passe par le relais Supabase « weatherlink-relais »,
 *    qui transmet la requête sans rien stocker. Les clés restent sur l'appareil et sont
 *    envoyées à chaque appel.
 *
 * Aucune clé n'est écrite dans ce fichier ni dans le dépôt GitHub.
 */
(function (global) {
    'use strict';

    // ---------- Réglages stockés sur l'appareil uniquement ----------
    const CLE_STOCKAGE = 'meteo_reglages_appareil';
    const REGLAGES_DEFAUT = {
        wlApiKey: '',
        wlApiSecret: '',
        mfApiKey: '',
        mfStation: '59343001',          // Lille-Lesquin (à confirmer via « Tester »)
        mfStationNom: 'Lille-Lesquin',
        relaisUrl: '',                  // vide = <SUPABASE_URL>/functions/v1/weatherlink-relais
        bandeauVisible: true,
        bandeauDeplie: false,
        stationChoisie: ''              // 'MF' ou 'WL:<id>'
    };

    function lireReglages() {
        try {
            const brut = localStorage.getItem(CLE_STOCKAGE);
            return Object.assign({}, REGLAGES_DEFAUT, brut ? JSON.parse(brut) : {});
        } catch (e) {
            return Object.assign({}, REGLAGES_DEFAUT);
        }
    }

    function ecrireReglages(r) {
        try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(r)); } catch (e) { /* stockage plein ou bloqué */ }
    }

    function effacerCles() {
        const r = lireReglages();
        r.wlApiKey = ''; r.wlApiSecret = ''; r.mfApiKey = '';
        ecrireReglages(r);
        return r;
    }

    // ---------- Conversions ----------
    const estNombre = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
    const num = (v) => (estNombre(v) ? Number(v) : null);
    const fVersC = (f) => (estNombre(f) ? (Number(f) - 32) * 5 / 9 : null);
    const mphVersKmh = (v) => (estNombre(v) ? Number(v) * 1.609344 : null);
    const msVersKmh = (v) => (estNombre(v) ? Number(v) * 3.6 : null);
    const inHgVersHpa = (v) => (estNombre(v) ? Number(v) * 33.8639 : null);
    const pouceVersMm = (v) => (estNombre(v) ? Number(v) * 25.4 : null);
    // Météo-France DPObs fournit les températures en kelvin
    const kelvinOuCelsius = (t) => {
        if (!estNombre(t)) return null;
        const x = Number(t);
        return x > 150 ? x - 273.15 : x;
    };
    // Pression : Pa -> hPa si nécessaire
    const paOuHpa = (p) => {
        if (!estNombre(p)) return null;
        const x = Number(p);
        return x > 2000 ? x / 100 : x;
    };

    function premier(...valeurs) {
        for (const v of valeurs) if (estNombre(v)) return Number(v);
        return null;
    }

    const POINTS_CARDINAUX = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
    function directionTexte(deg) {
        if (!estNombre(deg)) return '';
        return POINTS_CARDINAUX[Math.round(((Number(deg) % 360) + 360) % 360 / 22.5) % 16];
    }

    // Codes WMO (Open-Meteo) -> pictogramme + libellé
    function temps(code) {
        const c = Number(code);
        if (c === 0) return { icone: '☀️', texte: 'Ciel clair' };
        if (c === 1) return { icone: '🌤️', texte: 'Peu nuageux' };
        if (c === 2) return { icone: '⛅', texte: 'Partiellement nuageux' };
        if (c === 3) return { icone: '☁️', texte: 'Couvert' };
        if (c === 45 || c === 48) return { icone: '🌫️', texte: 'Brouillard' };
        if (c >= 51 && c <= 57) return { icone: '🌦️', texte: 'Bruine' };
        if (c >= 61 && c <= 67) return { icone: '🌧️', texte: 'Pluie' };
        if (c >= 71 && c <= 77) return { icone: '🌨️', texte: 'Neige' };
        if (c >= 80 && c <= 82) return { icone: '🌦️', texte: 'Averses' };
        if (c >= 85 && c <= 86) return { icone: '🌨️', texte: 'Averses de neige' };
        if (c >= 95) return { icone: '⛈️', texte: 'Orage' };
        return { icone: '·', texte: '' };
    }

    // ---------- Lecteurs (fonctions pures, testables) ----------

    /**
     * WeatherLink v2 /current/{station}. Les noms de champs varient selon le matériel
     * (WeatherLink Live, Console, Vantage Connect…) : on essaie les variantes connues.
     * Unités WeatherLink : °F, mph, inHg ; pluie disponible en mm.
     */
    function lireWeatherLinkActuel(json) {
        const enregistrements = [];
        for (const capteur of (json && json.sensors) || []) {
            for (const d of capteur.data || []) enregistrements.push(d);
        }
        // Priorité aux enregistrements « extérieurs » (vent ou température extérieure présents)
        enregistrements.sort((a, b) => score(b) - score(a));
        function score(d) {
            let s = 0;
            if ('wind_speed_last' in d || 'wind_speed' in d) s += 2;
            if ('temp' in d || 'temp_out' in d) s += 1;
            return s;
        }
        const champ = (...noms) => {
            for (const d of enregistrements) {
                for (const n of noms) if (estNombre(d[n])) return Number(d[n]);
            }
            return null;
        };

        const ts = enregistrements.reduce((m, d) => (estNombre(d.ts) && Number(d.ts) > m ? Number(d.ts) : m), 0);
        const pluieJourMm = champ('rainfall_daily_mm', 'rainfall_day_mm', 'rain_day_mm');
        const pluieJourIn = champ('rainfall_daily_in', 'rainfall_day_in', 'rain_day_in');
        const intensiteMm = champ('rain_rate_last_mm', 'rain_rate_mm', 'rain_rate_hi_mm');
        const intensiteIn = champ('rain_rate_last_in', 'rain_rate_in');

        return {
            source: 'WeatherLink',
            date: ts ? new Date(ts * 1000) : null,
            t: fVersC(champ('temp', 'temp_out', 'temp_last')),
            hr: champ('hum', 'hum_out', 'hum_last'),
            td: fVersC(champ('dew_point', 'dew_point_out')),
            vent: mphVersKmh(champ('wind_speed_avg_last_1_min', 'wind_speed_last', 'wind_speed', 'wind_speed_avg_last_2_min')),
            ventMoy10: mphVersKmh(champ('wind_speed_avg_last_10_min', 'wind_speed_10_min_avg')),
            rafale: mphVersKmh(champ('wind_speed_hi_last_10_min', 'wind_gust_10_min', 'wind_speed_hi_last_2_min')),
            ventDir: champ('wind_dir_last', 'wind_dir', 'wind_dir_scalar_avg_last_1_min'),
            pluieJour: pluieJourMm !== null ? pluieJourMm : pouceVersMm(pluieJourIn),
            pluieIntensite: intensiteMm !== null ? intensiteMm : pouceVersMm(intensiteIn),
            rayonnement: champ('solar_rad'),
            uv: champ('uv_index'),
            pression: inHgVersHpa(champ('bar_sea_level', 'bar', 'bar_absolute')),
            wbgt: fVersC(champ('wbgt'))
        };
    }

    /** Liste des stations WeatherLink du compte (/v2/stations) */
    function lireWeatherLinkStations(json) {
        return ((json && json.stations) || []).map((s) => ({
            id: String(s.station_id),
            uuid: s.station_id_uuid || '',
            nom: s.station_name || ('Station ' + s.station_id),
            ville: s.city || ''
        }));
    }

    /**
     * Météo-France DPObs (/station/infrahoraire-6m ou /station/horaire, format=json).
     * Températures en kelvin, vent en m/s, pression en Pa. Heures en UTC (ISO).
     */
    function lireMeteoFranceObs(json) {
        let obs = Array.isArray(json) ? json : (json && Array.isArray(json.features) ? json.features.map((f) => f.properties) : [json]);
        obs = obs.filter(Boolean);
        if (obs.length === 0) return null;
        obs.sort((a, b) => String(b.validity_time || '').localeCompare(String(a.validity_time || '')));
        const o = obs[0];
        return {
            source: 'Météo-France',
            date: o.validity_time ? new Date(o.validity_time) : null,
            t: kelvinOuCelsius(o.t),
            hr: num(o.u),
            td: kelvinOuCelsius(o.td),
            vent: msVersKmh(premier(o.ff)),
            ventMoy10: null,
            rafale: msVersKmh(premier(o.fxi10, o.fxi, o.fxy)),
            ventDir: premier(o.dd),
            pluieJour: null,
            pluiePeriode: premier(o.rr_per, o.rr1),
            pluieIntensite: null,
            rayonnement: null,
            uv: null,
            pression: paOuHpa(premier(o.pres, o.pmer)),
            nebulosite: num(o.n),
            wbgt: null
        };
    }

    /** Open-Meteo (endpoint meteofrance), réponse « hourly » -> tableau d'heures */
    function lirePrevisions(json, maintenant) {
        const h = json && json.hourly;
        if (!h || !Array.isArray(h.time)) return [];
        const ref = maintenant ? new Date(maintenant) : new Date();
        ref.setMinutes(0, 0, 0);
        const lignes = h.time.map((iso, i) => ({
            iso,
            heure: iso.slice(11, 16),
            t: num(h.temperature_2m && h.temperature_2m[i]),
            hr: num(h.relative_humidity_2m && h.relative_humidity_2m[i]),
            nuages: num(h.cloud_cover && h.cloud_cover[i]),
            pluie: num(h.precipitation && h.precipitation[i]),
            vent: num(h.wind_speed_10m && h.wind_speed_10m[i]),
            rafale: num(h.wind_gusts_10m && h.wind_gusts_10m[i]),
            ventDir: num(h.wind_direction_10m && h.wind_direction_10m[i]),
            rayonnement: num(h.shortwave_radiation && h.shortwave_radiation[i]),
            code: num(h.weather_code && h.weather_code[i])
        }));
        // L'API renvoie l'heure locale (timezone=Europe/Paris) sans décalage : comparaison sur la chaîne
        const pad = (n) => String(n).padStart(2, '0');
        const refIso = `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}T${pad(ref.getHours())}:00`;
        return lignes.filter((l) => l.iso >= refIso);
    }

    // ---------- Appels réseau ----------

    async function lireJson(reponse, contexte) {
        const texte = await reponse.text();
        let json = null;
        try { json = texte ? JSON.parse(texte) : null; } catch (e) { /* pas du JSON */ }
        if (!reponse.ok) {
            const detail = (json && (json.message || json.error || json.description)) || texte.slice(0, 160);
            const err = new Error(`${contexte} : erreur ${reponse.status}${detail ? ' – ' + detail : ''}`);
            err.status = reponse.status;
            throw err;
        }
        return json;
    }

    async function previsions(lat, lon, heures) {
        const variables = 'temperature_2m,relative_humidity_2m,cloud_cover,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation,weather_code';
        const url = `https://api.open-meteo.com/v1/meteofrance?latitude=${lat}&longitude=${lon}` +
            `&hourly=${variables}&forecast_hours=${(heures || 12) + 1}&timezone=Europe%2FParis`;
        const r = await fetch(url);
        return lirePrevisions(await lireJson(r, 'Prévisions Open-Meteo'));
    }

    async function meteoFranceObs(station, cle) {
        if (!cle) throw new Error('Clé Météo-France manquante (Paramètres météo).');
        const base = 'https://public-api.meteofrance.fr/public/DPObs/v1/station/';
        const entetes = { apikey: cle, accept: 'application/json' };
        try {
            const r = await fetch(`${base}infrahoraire-6m?id_station=${encodeURIComponent(station)}&format=json`, { headers: entetes });
            const res = lireMeteoFranceObs(await lireJson(r, 'Météo-France'));
            if (res && res.t !== null) return res;
        } catch (e) {
            if (e.status === 401 || e.status === 403) throw new Error('Clé Météo-France refusée (vérifie la clé et l\'abonnement à l\'API « Données d\'observation »).');
        }
        // Repli sur l'observation horaire
        const r2 = await fetch(`${base}horaire?id_station=${encodeURIComponent(station)}&format=json`, { headers: entetes });
        return lireMeteoFranceObs(await lireJson(r2, 'Météo-France (horaire)'));
    }

    async function appelWeatherLink(chemin, reglages, jetonSession, cleAnon, relaisParDefaut, parametres) {
        if (!reglages.wlApiKey || !reglages.wlApiSecret) throw new Error('Clé ou secret WeatherLink manquant (Paramètres météo).');
        if (!jetonSession) throw new Error('Connecte-toi pour utiliser le relais WeatherLink.');
        const relais = reglages.relaisUrl || relaisParDefaut;
        const qs = new URLSearchParams(Object.assign({ path: chemin }, parametres || {}));
        let r;
        try {
            r = await fetch(`${relais}?${qs.toString()}`, {
                headers: {
                    Authorization: 'Bearer ' + jetonSession,
                    apikey: cleAnon,
                    'x-wl-key': reglages.wlApiKey,
                    'x-wl-secret': reglages.wlApiSecret
                }
            });
        } catch (e) {
            throw new Error('Relais WeatherLink injoignable : la fonction « weatherlink-relais » est-elle déployée sur Supabase ?');
        }
        if (r.status === 404) throw new Error('Relais WeatherLink introuvable (404) : fonction non déployée ou mauvaise adresse.');
        return lireJson(r, 'WeatherLink');
    }

    async function weatherLinkStations(reglages, jeton, cleAnon, relaisParDefaut) {
        return lireWeatherLinkStations(await appelWeatherLink('stations', reglages, jeton, cleAnon, relaisParDefaut));
    }

    async function weatherLinkActuel(stationId, reglages, jeton, cleAnon, relaisParDefaut) {
        const json = await appelWeatherLink('current/' + stationId, reglages, jeton, cleAnon, relaisParDefaut);
        const res = lireWeatherLinkActuel(json);
        res.brut = json;
        return res;
    }

    global.Meteo = {
        lireReglages, ecrireReglages, effacerCles, REGLAGES_DEFAUT,
        lireWeatherLinkActuel, lireWeatherLinkStations, lireMeteoFranceObs, lirePrevisions,
        previsions, meteoFranceObs, weatherLinkStations, weatherLinkActuel,
        directionTexte, temps,
        conv: { fVersC, mphVersKmh, msVersKmh, inHgVersHpa, kelvinOuCelsius, paOuHpa }
    };
})(typeof window !== 'undefined' ? window : globalThis);
