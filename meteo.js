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
            err.code = json && json.code ? String(json.code) : '';
            err.detail = detail;
            throw err;
        }
        return json;
    }

    /**
     * Traduit une erreur du portail Météo-France (passerelle WSO2) en message utile.
     * 900901 = jeton invalide ou expiré ; 900908 / 403 = application non abonnée à cette API ;
     * 900800 / 429 = quota dépassé.
     */
    function messageErreurMeteoFrance(err, nomApi) {
        const code = String(err.code || '');
        const s = err.status;
        if (code === '900901' || s === 401) {
            return `${nomApi} : clé invalide ou expirée (code 900901). Un « token » généré sur le portail ne dure qu'1 heure : génère plutôt une « API Key » en lui donnant une longue durée de validité.`;
        }
        if (code === '900908' || code === '900910' || s === 403) {
            return `${nomApi} : ton application n'est pas abonnée à cette API sur le portail Météo-France (code ${code || s}).`;
        }
        if (code === '900800' || code === '900802' || s === 429) {
            return `${nomApi} : quota de requêtes dépassé, réessaie dans une minute.`;
        }
        if (s === 404) return `${nomApi} : station ou ressource introuvable (404). Vérifie le n° de station.`;
        return `${nomApi} : ${err.message}`;
    }

    const MF_BASE = 'https://public-api.meteofrance.fr/public/';

    async function previsions(lat, lon, heures) {
        const variables = 'temperature_2m,relative_humidity_2m,cloud_cover,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation,weather_code';
        const url = `https://api.open-meteo.com/v1/meteofrance?latitude=${lat}&longitude=${lon}` +
            `&hourly=${variables}&forecast_hours=${(heures || 12) + 1}&timezone=Europe%2FParis`;
        const r = await fetch(url);
        return lirePrevisions(await lireJson(r, 'Prévisions Open-Meteo'));
    }

    async function meteoFranceObs(station, cle) {
        if (!cle) throw new Error('Clé Météo-France manquante (Paramètres météo).');
        const base = MF_BASE + 'DPObs/v1/station/';
        const entetes = { apikey: cle, accept: 'application/json' };
        try {
            const r = await fetch(`${base}infrahoraire-6m?id_station=${encodeURIComponent(station)}&format=json`, { headers: entetes });
            const res = lireMeteoFranceObs(await lireJson(r, 'Météo-France'));
            if (res && res.t !== null) return res;
        } catch (e) {
            if (e.status === 401 || e.status === 403 || e.status === 429) throw new Error(messageErreurMeteoFrance(e, 'Observation Météo-France'));
        }
        // Repli sur l'observation horaire
        try {
            const r2 = await fetch(`${base}horaire?id_station=${encodeURIComponent(station)}&format=json`, { headers: entetes });
            return lireMeteoFranceObs(await lireJson(r2, 'Météo-France (horaire)'));
        } catch (e) {
            throw new Error(messageErreurMeteoFrance(e, 'Observation Météo-France'));
        }
    }

    /** Teste séparément les deux API Météo-France utilisées par l'application. */
    async function testerMeteoFrance(cle, station) {
        const res = { obs: null, clim: null };
        try {
            const o = await meteoFranceObs(station, cle);
            res.obs = { ok: !!(o && o.t !== null), message: o && o.t !== null ? `${o.t.toFixed(1).replace('.', ',')} °C à ${o.date ? o.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '?'}` : 'réponse sans température' };
        } catch (e) {
            res.obs = { ok: false, message: e.message };
        }
        try {
            const r = await fetch(`${MF_BASE}DPClim/v1/information-station?id-station=${encodeURIComponent(station)}`, { headers: { apikey: cle, accept: 'application/json' } });
            const info = await lireJson(r, 'Climatologie');
            const nom = Array.isArray(info) && info[0] ? (info[0].nom || info[0].nomUsuel || '') : '';
            res.clim = { ok: true, message: nom ? `accès OK (${nom})` : 'accès OK' };
        } catch (e) {
            res.clim = { ok: false, message: messageErreurMeteoFrance(e, 'Climatologie Météo-France') };
        }
        return res;
    }

    // ---------- Données climatologiques horaires (DPClim) ----------

    /** Lit le CSV horaire DPClim (séparateur « ; », décimales « , », DATE = AAAAMMJJHH en UTC). */
    function lireCsvDPClim(texte) {
        const lignes = String(texte || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
        if (lignes.length < 2) return [];
        const sep = lignes[0].includes(';') ? ';' : ',';
        const nettoyer = (v) => String(v === undefined ? '' : v).trim().replace(/^"|"$/g, '');
        const entetes = lignes[0].split(sep).map((h) => nettoyer(h).toUpperCase());
        const idx = (...noms) => { for (const n of noms) { const i = entetes.indexOf(n); if (i !== -1) return i; } return -1; };
        const iDate = idx('DATE', 'AAAAMMJJHH');
        if (iDate === -1) return [];
        const col = {
            t: idx('T'), tn: idx('TN'), tx: idx('TX'), td: idx('TD'), u: idx('U'),
            rr: idx('RR1'), ff: idx('FF'), dd: idx('DD'), fxi: idx('FXI3S', 'FXI', 'FXY'),
            glo: idx('GLO'), n: idx('N', 'NEB'), pmer: idx('PMER'), ins: idx('INS')
        };
        const nombre = (cells, i) => {
            if (i === -1) return null;
            const v = nettoyer(cells[i]).replace(',', '.');
            if (v === '' || v.toLowerCase() === 'mq') return null;
            const n = Number(v);
            return isFinite(n) ? n : null;
        };
        const rows = [];
        for (const ligne of lignes.slice(1)) {
            const c = ligne.split(sep);
            const d = nettoyer(c[iDate]).replace(/\D/g, '');
            if (d.length < 10) continue;
            const ts = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10));
            const celsius = (v) => (v === null ? null : (v > 100 ? v - 273.15 : v));
            const glo = nombre(c, col.glo);
            const n = nombre(c, col.n);
            const ff = nombre(c, col.ff);
            const fxi = nombre(c, col.fxi);
            rows.push({
                ts,
                t: celsius(nombre(c, col.t)), tn: celsius(nombre(c, col.tn)), tx: celsius(nombre(c, col.tx)), td: celsius(nombre(c, col.td)),
                u: nombre(c, col.u), rr: nombre(c, col.rr),
                ff: ff === null ? null : ff * 3.6, rafale: fxi === null ? null : fxi * 3.6, dd: nombre(c, col.dd),
                // GLO : énergie horaire en J/cm² -> irradiance moyenne en W/m²
                solar: glo === null ? null : glo * 10000 / 3600,
                n: n !== null && n >= 0 && n <= 8 ? n : null,
                pmer: nombre(c, col.pmer), ins: nombre(c, col.ins)
            });
        }
        rows.sort((a, b) => a.ts - b.ts);
        return rows;
    }

    const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
    const isoSansMs = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

    /** Commande DPClim horaire pour une station, puis récupération du fichier (asynchrone côté Météo-France). */
    async function dpclimHoraire(station, debut, fin, cle, surProgression) {
        if (!cle) throw new Error('Clé Météo-France manquante (Paramètres météo).');
        const entetes = { apikey: cle, accept: 'application/json' };
        const url = `${MF_BASE}DPClim/v1/commande-station/horaire?id-station=${encodeURIComponent(station)}` +
            `&date-deb-periode=${encodeURIComponent(isoSansMs(debut))}&date-fin-periode=${encodeURIComponent(isoSansMs(fin))}`;
        let idCommande;
        try {
            const r = await fetch(url, { headers: entetes });
            const json = await lireJson(r, 'Commande climatologique');
            idCommande = json && json.elaboreProduitAvecDemandeResponse && json.elaboreProduitAvecDemandeResponse.return;
        } catch (e) {
            throw new Error(messageErreurMeteoFrance(e, 'Climatologie Météo-France'));
        }
        if (!idCommande) throw new Error('Météo-France n\'a pas renvoyé de numéro de commande.');
        for (let essai = 0; essai < 25; essai++) {
            if (surProgression) surProgression(essai);
            const r = await fetch(`${MF_BASE}DPClim/v1/commande/fichier?id-cmde=${encodeURIComponent(idCommande)}`, { headers: entetes });
            if ((r.status === 200 || r.status === 201)) {
                const texte = await r.text();
                if (texte.trim()) return lireCsvDPClim(texte);
            } else if (r.status !== 204 && r.status !== 202) {
                const err = new Error(`Fichier climatologique : erreur ${r.status}`);
                err.status = r.status;
                throw new Error(messageErreurMeteoFrance(err, 'Climatologie Météo-France'));
            }
            await attendre(2000);
        }
        throw new Error('Commande Météo-France toujours en préparation : réessaie dans quelques minutes.');
    }

    // ---------- Résumé météo d'une campagne et comparabilité ----------

    const moyenne = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const somme = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) : null; };
    const maxi = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined && isFinite(x)); return v.length ? Math.max(...v) : null; };
    const mini = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined && isFinite(x)); return v.length ? Math.min(...v) : null; };

    // Date locale (Europe/Paris sur l'appareil) au format AAAA-MM-JJ
    const jourLocal = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const decalerJour = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return jourLocal(d.getTime()); };

    /** Fenêtre à commander pour une campagne : J-3 00:00 -> J 23:00, heure locale. */
    function fenetreCampagne(dateIso) {
        return { debut: new Date(decalerJour(dateIso, -3) + 'T00:00:00'), fin: new Date(dateIso + 'T23:00:00') };
    }

    /**
     * Résumé météo d'une campagne à partir des heures DPClim (J-3 -> J).
     * hMin / hMax : première et dernière heure de mesure (« HH:MM »), pour la plage de la campagne.
     * Seuils chaleur : moyennes sur 3 jours des Tn et Tx (repère indicatif canicule Nord : 18 / 33 °C).
     */
    function resumerCampagne(rows, dateIso, hMin, hMax) {
        if (!rows || !rows.length) return null;
        const heure = (ts) => new Date(ts).getHours();
        const parJour = (iso) => rows.filter((r) => jourLocal(r.ts) === iso);
        const jour = parJour(dateIso);
        const h0 = hMin ? parseInt(hMin, 10) : 9;
        const h1 = hMax ? Math.min(23, parseInt(hMax, 10) + (hMax.slice(3) !== '00' ? 1 : 0)) : 17;
        const plage = jour.filter((r) => heure(r.ts) >= h0 && heure(r.ts) <= h1);
        const debutJour = new Date(dateIso + 'T00:00:00').getTime();
        const avant72 = rows.filter((r) => r.ts < debutJour && r.ts >= debutJour - 72 * 3600 * 1000);
        const txJour = (iso) => { const j = parJour(iso); return maxi(j.map((r) => (r.tx !== null ? r.tx : r.t))); };
        const tnJour = (iso) => { const j = parJour(iso); return mini(j.map((r) => (r.tn !== null ? r.tn : r.t))); };
        const jPrec = [-3, -2, -1].map((n) => decalerJour(dateIso, n));
        const j3 = [-2, -1, 0].map((n) => decalerJour(dateIso, n));
        const tn3 = moyenne(j3.map(tnJour));
        const tx3 = moyenne(j3.map(txJour));
        const r = {
            date: dateIso,
            heures: jour.length,
            plage: `${String(h0).padStart(2, '0')}h–${String(h1).padStart(2, '0')}h`,
            txJ: txJour(dateIso), tnJ: tnJour(dateIso),
            tPlage: moyenne(plage.map((x) => x.t)),
            huPlage: moyenne(plage.map((x) => x.u)),
            solarPlage: moyenne(plage.map((x) => x.solar)),
            nebPlage: moyenne(plage.map((x) => x.n)),
            ventPlage: moyenne(plage.map((x) => x.ff)),
            rafaleJ: maxi(jour.map((x) => x.rafale)),
            pluieJ: somme(jour.map((x) => x.rr)),
            pluie72: somme(avant72.map((x) => x.rr)),
            tx3avant: moyenne(jPrec.map(txJour)),
            tn3avant: moyenne(jPrec.map(tnJour)),
            tn3, tx3
        };
        r.radiative = r.solarPlage !== null ? (r.solarPlage >= 400 && (r.nebPlage === null || r.nebPlage <= 4) && (r.ventPlage === null || r.ventPlage <= 20)) : null;
        r.solHumide = r.pluie72 !== null ? r.pluie72 >= 5 : null;
        r.chaleur = tn3 !== null && tx3 !== null ? (tn3 >= 18 && tx3 >= 33) : null;
        return r;
    }

    // Critères de comparabilité : écart toléré au-delà duquel le critère vaut 0
    const CRITERES_COMPARABILITE = [
        { cle: 'txJ', nom: 'T max du jour', unite: '°C', tol: 4 },
        { cle: 'tPlage', nom: 'T air pendant les mesures', unite: '°C', tol: 3 },
        { cle: 'solarPlage', nom: 'Rayonnement pendant les mesures', unite: 'W/m²', tol: 150 },
        { cle: 'nebPlage', nom: 'Nébulosité pendant les mesures', unite: 'octas', tol: 3 },
        { cle: 'ventPlage', nom: 'Vent pendant les mesures', unite: 'km/h', tol: 8 },
        { cle: 'pluie72', nom: 'Pluie des 72 h précédentes', unite: 'mm', tol: 5 },
        { cle: 'tx3avant', nom: 'T max moyenne des 3 jours précédents', unite: '°C', tol: 4 }
    ];

    function scoreComparabilite(a, b) {
        if (!a || !b) return null;
        const details = [];
        for (const c of CRITERES_COMPARABILITE) {
            if (a[c.cle] === null || a[c.cle] === undefined || b[c.cle] === null || b[c.cle] === undefined) continue;
            const ecart = Math.abs(a[c.cle] - b[c.cle]);
            details.push({ ...c, ecart, score: Math.max(0, 1 - ecart / c.tol) });
        }
        if (details.length < 3) return null;
        return { score: Math.round(100 * details.reduce((s, d) => s + d.score, 0) / details.length), details };
    }

    /** Température de référence interpolée (linéaire) à un instant donné (ms). */
    function temperatureA(rows, ts) {
        if (!rows || !rows.length) return null;
        let avant = null, apres = null;
        for (const r of rows) {
            if (r.t === null) continue;
            if (r.ts <= ts) avant = r;
            if (r.ts >= ts) { apres = r; break; }
        }
        if (avant && apres) {
            if (apres.ts === avant.ts) return avant.t;
            if (apres.ts - avant.ts > 3 * 3600 * 1000) return null;
            return avant.t + (apres.t - avant.t) * (ts - avant.ts) / (apres.ts - avant.ts);
        }
        const proche = avant || apres;
        return proche && Math.abs(proche.ts - ts) <= 3600 * 1000 ? proche.t : null;
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

    /** Aperçu masqué d'une clé (longueur + 4 premiers et 4 derniers caractères) pour vérifier une saisie. */
    function apercuCle(cle) {
        const c = String(cle || '');
        if (!c) return 'vide';
        if (c.length <= 10) return `${c.length} caractères`;
        return `${c.length} caractères : ${c.slice(0, 4)}…${c.slice(-4)}`;
    }

    /**
     * Test WeatherLink : liste des stations. En cas de refus (401), réessaie avec clé et secret inversés
     * (erreur de saisie fréquente) et le signale.
     */
    async function testerWeatherLink(reglages, jeton, cleAnon, relaisParDefaut) {
        try {
            return { stations: await weatherLinkStations(reglages, jeton, cleAnon, relaisParDefaut), inverses: false };
        } catch (e) {
            if (!/erreur 401/.test(e.message)) throw e;
            const inverse = Object.assign({}, reglages, { wlApiKey: reglages.wlApiSecret, wlApiSecret: reglages.wlApiKey });
            try {
                return { stations: await weatherLinkStations(inverse, jeton, cleAnon, relaisParDefaut), inverses: true };
            } catch (e2) {
                throw new Error('WeatherLink refuse la clé et le secret (401 « Invalid authentication credentials »), même inversés. ' +
                    `Clé saisie : ${apercuCle(reglages.wlApiKey)} ; secret : ${apercuCle(reglages.wlApiSecret)}. ` +
                    'Compare-les avec ceux de ton autre programme ou génère une nouvelle paire sur weatherlink.com > Account.');
            }
        }
    }

    global.Meteo = {
        lireReglages, ecrireReglages, effacerCles, REGLAGES_DEFAUT,
        lireWeatherLinkActuel, lireWeatherLinkStations, lireMeteoFranceObs, lirePrevisions,
        previsions, meteoFranceObs, weatherLinkStations, weatherLinkActuel, testerWeatherLink, testerMeteoFrance,
        lireCsvDPClim, dpclimHoraire, fenetreCampagne, resumerCampagne, scoreComparabilite, CRITERES_COMPARABILITE,
        temperatureA, messageErreurMeteoFrance, apercuCle, jourLocal, decalerJour,
        directionTexte, temps,
        conv: { fVersC, mphVersKmh, msVersKmh, inHgVersHpa, kelvinOuCelsius, paOuHpa }
    };
})(typeof window !== 'undefined' ? window : globalThis);
