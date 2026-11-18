// Supabase Edge Function : weatherlink-relais
//
// Relais « de passage » vers l'API WeatherLink v2, nécessaire car WeatherLink
// refuse les appels directs depuis un navigateur (pas d'en-têtes CORS).
//
// - Ne stocke RIEN : la clé et le secret WeatherLink arrivent de l'appareil à chaque
//   appel (en-têtes x-wl-key / x-wl-secret) et sont seulement transmis à WeatherLink.
// - Ne journalise ni les clés ni les réponses.
// - Réservé aux utilisateurs connectés de l'application (jeton « authenticated »).
//   Laisser l'option « Verify JWT » ACTIVÉE dans Supabase (valeur par défaut) :
//   c'est Supabase qui vérifie la signature du jeton avant d'appeler cette fonction.
// - N'accepte que trois chemins WeatherLink : stations, current/<id>, historic/<id>.

const ORIGINES_AUTORISEES = [
  "https://tomprovdl-sudo.github.io",
];

function entetesCors(origine: string | null): Record<string, string> {
  const autorisee = origine && ORIGINES_AUTORISEES.includes(origine) ? origine : ORIGINES_AUTORISEES[0];
  return {
    "Access-Control-Allow-Origin": autorisee,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-wl-key, x-wl-secret",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function reponseJson(corps: unknown, statut: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function roleDuJeton(entete: string | null): string {
  try {
    const jeton = (entete ?? "").replace(/^Bearer\s+/i, "");
    let charge = jeton.split(".")[1] ?? "";
    charge = charge.replace(/-/g, "+").replace(/_/g, "/");
    while (charge.length % 4) charge += "=";
    return JSON.parse(atob(charge)).role ?? "";
  } catch {
    return "";
  }
}

const CHEMIN_VALIDE = /^(stations|current\/[A-Za-z0-9-]{1,64}|historic\/[A-Za-z0-9-]{1,64})$/;

Deno.serve(async (req: Request) => {
  const cors = entetesCors(req.headers.get("origin"));

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return reponseJson({ error: "Méthode non autorisée" }, 405, cors);

  if (roleDuJeton(req.headers.get("authorization")) !== "authenticated") {
    return reponseJson({ error: "Connexion requise" }, 401, cors);
  }

  const url = new URL(req.url);
  const chemin = url.searchParams.get("path") ?? "";
  if (!CHEMIN_VALIDE.test(chemin)) return reponseJson({ error: "Chemin non autorisé" }, 400, cors);

  const cle = req.headers.get("x-wl-key") ?? "";
  const secret = req.headers.get("x-wl-secret") ?? "";
  if (!cle || !secret) return reponseJson({ error: "Clé ou secret WeatherLink manquant" }, 400, cors);

  const cible = new URL(`https://api.weatherlink.com/v2/${chemin}`);
  cible.searchParams.set("api-key", cle);
  for (const p of ["start-timestamp", "end-timestamp"]) {
    const v = url.searchParams.get(p);
    if (v && /^\d{1,12}$/.test(v)) cible.searchParams.set(p, v);
  }

  try {
    const r = await fetch(cible.toString(), { headers: { "X-Api-Secret": secret, "Accept": "application/json" } });
    const corps = await r.text();
    return new Response(corps, {
      status: r.status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (_e) {
    return reponseJson({ error: "WeatherLink injoignable" }, 502, cors);
  }
});
