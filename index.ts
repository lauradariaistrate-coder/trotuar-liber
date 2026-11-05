// Trotuar Liber – funcția „analiza” (Supabase Edge Function, Deno)
// Primește {prompt, images:[base64 jpeg]} de la aplicație, verifică utilizatorul,
// aplică limitele și trimite cererea la API-ul Anthropic. Cheia nu părăsește serverul.
//
// Secrete (Project Settings → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   cheia ta Anthropic (obligatoriu)
//   ALLOWED_EMAILS      (opțional) e-mailuri care pot analiza oricum, separate prin virgulă.
//                       Ceilalți pot analiza doar după ce administratorul îi aprobă în aplicație (tabelul tl_members).
//   ALLOWED_ORIGIN      adresa aplicației, ex. https://numele-tau.github.io (obligatoriu)
//   DAILY_LIMIT         câte analize pe zi pentru un utilizator (implicit 30)
//   MODEL               modelul Claude (implicit claude-haiku-5-5 – cel mai ieftin; pentru analiză mai fină: claude-sonnet-5-5)
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
// Formularul pe care modelul e obligat să-l completeze: rezultatul e mereu JSON valid,
// indiferent de ghilimelele românești sau de rândurile noi din texte.
const S = (description: string) => ({ type: "string", description });
const RAPORT_TOOL = {
  name: "raport",
  description: "Completează raportul de analiză normativă a fotografiei.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["neconform", "posibil_neconform", "conform", "imagine_neclara"] },
      rezumat: S("1-2 propoziții"),
      tip_spatiu: { type: "string", enum: ["trotuar", "trecere_pietoni", "statie_transport", "parcare", "alee", "intersectie", "altul"] },
      probleme: { type: "array", items: { type: "object", properties: {
        titlu: S("scurt"), constatare: S("ce se vede, cu valori estimate"), cerinta: S("ce cere norma, cu valoarea"),
        referinta: S("ex. NP 051-2012, IV.2.4 (7)"),
        gravitate: { type: "string", enum: ["ridicata", "medie", "scazuta"] },
        certitudine: { type: "string", enum: ["sigur", "probabil", "de_verificat"] },
      }, required: ["titlu", "constatare", "cerinta", "referinta", "gravitate", "certitudine"] } },
      de_masurat: { type: "array", items: { type: "string" } },
      responsabil: { type: "string", enum: ["primarie_sector", "politia_locala", "pmb", "operator_retea"] },
      responsabil_secundar: { type: ["string", "null"], enum: ["primarie_sector", "politia_locala", "pmb", "operator_retea", null] },
      motiv_responsabil: S("o propoziție"),
      adresa_vizibila: { type: ["string", "null"] },
      descriere_sesizare: S("3-6 propoziții, persoana I"),
      solicitari: { type: "array", items: { type: "string" } },
      zone_private: { type: "array", description: "TOATE fețele de persoane și numerele de înmatriculare vizibile, coordonate relative 0–1 (x,y = colț stânga-sus)", items: { type: "object", properties: {
        tip: { type: "string", enum: ["fata", "numar"] }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" },
      }, required: ["tip", "x", "y", "w", "h"] } },
    },
    required: ["verdict", "rezumat", "tip_spatiu", "probleme", "de_masurat", "responsabil", "motiv_responsabil", "descriere_sesizare", "solicitari", "zone_private"],
  },
};

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
  let ok = !!user?.email && allowed.includes(String(user.email).toLowerCase());
  if (!ok && user?.id) { // cont aprobat de administrator în aplicație
    const mr = await fetch(env("SUPABASE_URL") + "/rest/v1/tl_members?select=status&user_id=eq." + user.id, { headers: svcHeaders() });
    if (mr.ok) { const rows = await mr.json(); ok = rows?.[0]?.status === "approved"; }
  }
  if (!ok) return json({ error: "Cont fără drept de analiză (neaprobat încă)" }, 403, h);

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
  if (!cr.ok) {
    const detail = (await cr.text().catch(() => "")).slice(0, 200);
    return json({ error: `Contorul de utilizare nu răspunde (${cr.status}: ${detail})` }, 500, h);
  }
  const used = Number(await cr.json());
  if (used > limit) return json({ error: `Ai atins limita de ${limit} analize pe zi` }, 429, h);

  // 4. Cererea către Anthropic.
  // Partea fixă a promptului (rol + extrasele din normative) e pusă PRIMA și marcată pentru cache:
  // dacă faci mai multe analize la rând (în 5 minute), ea costă ~10% la cererile următoare.
  const MARK = "CONTEXT DE LA UTILIZATOR:";
  const cut = prompt.indexOf(MARK);
  const fixed = cut > 0 ? prompt.slice(0, cut) : "";
  const variable = cut > 0 ? prompt.slice(cut) : prompt;
  const content: unknown[] = [];
  if (fixed) content.push({ type: "text", text: fixed, cache_control: { type: "ephemeral" } });
  content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: images[0] } });
  content.push({ type: "text", text: "Imaginea de mai sus este fotografia de analizat.\n\n" + variable + "\n\nCompletează rezultatul prin instrumentul „raport”, concis." });
  const ar = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("MODEL", "claude-haiku-5-5"),
      max_tokens: 8000, // plafon; se plătesc doar tokenii generați efectiv
      tools: [RAPORT_TOOL],
      tool_choice: { type: "tool", name: "raport" },
      messages: [{ role: "user", content }],
    }),
  });
  const aj = await ar.json().catch(() => ({}));
  if (!ar.ok) {
    const status = ar.status === 429 ? 429 : 502;
    return json({ error: aj?.error?.message ?? ("Anthropic " + ar.status) }, status, h);
  }
  const tool = (aj.content ?? []).find((c: { type: string; name?: string }) => c.type === "tool_use" && c.name === "raport");
  const text = tool ? JSON.stringify(tool.input) : (aj.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  const stop = aj.stop_reason ?? "";
  if (!text.trim()) {
    const types = (aj.content ?? []).map((c: { type: string }) => c.type).join(",") || "nimic";
    return json({ error: `Modelul nu a scris text (stop: ${stop}; conținut: ${types})` }, 502, h);
  }
  return json({ text, stop, used, limit, usage: aj.usage ?? null }, 200, h);
});
