// Trotuar Liber – configurare (opțional).
// Poți lăsa câmpurile goale: aplicația le cere la prima pornire și le ține doar în browser.
// Cheia de aici este cheia PUBLICĂ (anon / publishable) – e făcută să stea în browser; securitatea vine din login + RLS.
// NU pune aici cheia Anthropic sau cheia service_role.
window.TL_CONFIG = {
  supabaseUrl: "",       // ex. "https://abcd1234.supabase.co"
  supabaseAnonKey: "",   // Project Settings → API Keys → anon / publishable
  functionName: "analiza"
};
