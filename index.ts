// Trotuar Liber – funcția „analiza” (Supabase Edge Function, Deno)
// Primește {prompt, images:[base64 jpeg]} de la aplicație, verifică utilizatorul,
// aplică limitele și trimite cererea la API-ul Anthropic. Cheia nu părăsește serverul.
//
// Secrete (Project Settings → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   cheia ta Anthropic (obligatoriu)
//   ALLOWED_EMAILS      e-mailurile care au voie să folosească analiza, separate prin virgulă (obligatoriu)
//   ALLOWED_ORIGIN      adresa aplicației, ex. https://numele-tau.github.io (obligatoriu)
//   DAILY_LIMIT         câte analize pe zi pentru un utilizator (implicit 30)
//   MODEL               modelul Claude (implicit claude-sonnet-5-5)
// SUPABASE_URL, SUPABASE_ANON_KEY și SUPABASE_SERVICE_ROLE_KEY sunt puse automat de Supabase.
// Dacă proiectul folosește doar cheile noi (sb_secret_...), adaugă secretul SERVICE_KEY cu cheia secretă.

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const ORIGINS = env("ALLOWED_ORIGIN").split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
const MAX_IMAGE_B64 = 7_000_000;   // ~5 MB de imagine
const MAX_PROMPT = 60_000;         // caractere

function cors(origin: string | null) {
  const ok = origin && ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGINS[0] ?? "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function svcHeaders(): Record<string, string> {
  const k = env("SERVICE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  const h: Record<string, string> = { apikey: k, "Content-Type": "application/json" };
  if (k.split(".").length === 3) h.Authorization = "Bearer " + k; // cheie JWT (vechea service_role)
  return h;
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "Metodă nepermisă" }, 405, h);
  if (!origin || !ORIGINS.includes(origin)) return json({ error: "Origine nepermisă" }, 403, h);

  // 1. Cine cere? Tokenul de login se verifică la Supabase Auth.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Neautentificat" }, 401, h);
  const pub = env("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
  const ur = await fetch(env("SUPABASE_URL") + "/auth/v1/user", { headers: { Authorization: auth, apikey: pub } });
  if (!ur.ok) return json({ error: "Sesiune invalidă" }, 401, h);
  const user = await ur.json();
  const allowed = env("ALLOWED_EMAILS").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  if (!user?.email || !allowed.includes(String(user.email).toLowerCase())) return json({ error: "Cont fără drept de analiză" }, 403, h);

  // 2. Ce trimite? Dimensiuni limitate, o singură imagine JPEG.
  let body: { prompt?: string; images?: string[] };
  try { body = await req.json(); } catch { return json({ error: "Cerere invalidă" }, 400, h); }
  const prompt = String(body.prompt ?? "");
  const images = Array.isArray(body.images) ? body.images.slice(0, 1) : [];
  if (!prompt || prompt.length > MAX_PROMPT) return json({ error: "Text lipsă sau prea lung" }, 400, h);
  if (images.length !== 1 || typeof images[0] !== "string" || images[0].length > MAX_IMAGE_B64) return json({ error: "Este nevoie de o singură imagine, sub 5 MB" }, 413, h);
  if (!images[0].startsWith("/9j/")) return json({ error: "Imaginea trebuie să fie JPEG" }, 400, h);

  // 3. Limita zilnică (contor în baza de date, accesibil doar cu cheia de serviciu).
  const limit = parseInt(env("DAILY_LIMIT", "30"), 10) || 30;
  const cr = await fetch(env("SUPABASE_URL") + "/rest/v1/rpc/tl_bump_usage", {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify({ p_owner: user.id }),
  });
  if (!cr.ok) return json({ error: "Contorul de utilizare nu răspunde" }, 500, h);
  const used = Number(await cr.json());
  if (used > limit) return json({ error: `Ai atins limita de ${limit} analize pe zi` }, 429, h);

  // 4. Cererea către Anthropic.
  const ar = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("MODEL", "claude-sonnet-5-5"),
      max_tokens: 4096,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: images[0] } },
        { type: "text", text: prompt + "\n\nRăspunsul tău va fi citit automat: scrie doar obiectul JSON cerut." },
      ] }],
    }),
  });
  const aj = await ar.json().catch(() => ({}));
  if (!ar.ok) {
    const status = ar.status === 429 ? 429 : 502;
    return json({ error: aj?.error?.message ?? ("Anthropic " + ar.status) }, status, h);
  }
  const text = (aj.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  return json({ text, used, limit }, 200, h);
});
