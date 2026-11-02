# Trotuar Liber – varianta GitHub Pages + Supabase

Unealtă personală: fotografiezi o problemă pe trotuar în București. Claude o verifică după NP 051-2012, NP 068-02 și Legea 448/2006. Aplicația detectează sectorul din GPS și redactează sesizarea către instituția competentă.

## Cum e protejată

| Ce | Cum |
|---|---|
| Cheia Anthropic | Stă doar în Supabase, ca secret al funcției `analiza`. Nu ajunge niciodată în browser sau pe GitHub |
| Accesul în aplicație | Login cu e-mail + parolă. Înscrierile publice sunt dezactivate, iar contul îl creezi tu din Supabase |
| Analiza AI | Doar e-mailurile din `ALLOWED_EMAILS`, doar de pe adresa ta (`ALLOWED_ORIGIN`), max. `DAILY_LIMIT` analize pe zi, o imagine JPEG sub 5 MB |
| Registrul | RLS: fiecare utilizator vede și modifică doar rândurile lui |
| Pozele | Spațiu de stocare **privat**, doar în folderul tău, afișate prin linkuri semnate valabile 1 oră |
| Pagina | Content-Security-Policy: scripturi doar din fișierele proprii, conexiuni doar către Supabase; fără indexare în motoarele de căutare |
| Cheia din `config.js` / din browser | Este cheia **publică** (anon/publishable), făcută să stea în browser. Fără login nu deschide nimic |

## Instalare (~20 minute, o singură dată)

### 1. Supabase – proiectul
1. Pe [supabase.com](https://supabase.com), **New project**. Regiunea: **Frankfurt (eu-central-1)**, ca datele să rămână în UE.
2. **SQL Editor** → **New query** → lipește tot conținutul din `supabase/schema.sql` → **Run**.

### 2. Supabase – contul tău
1. **Authentication → Sign In / Providers**: dezactivează **Allow new users to sign up**.
2. **Authentication → Users → Add user → Create new user**: e-mailul tău + o parolă puternică, cu **Auto Confirm User** bifat.
3. (Opțional, recomandat) **Authentication → Multi-Factor**: activează TOTP.

### 3. Supabase – funcția de analiză
1. **Edge Functions → Deploy a new function → Via Editor**. Numele: `analiza`.
2. Șterge codul exemplu, lipește tot conținutul din `supabase/functions/analiza/index.ts` și apasă **Deploy**.
3. **Edge Functions → Secrets** (sau **Project Settings → Edge Functions**), adaugă:

| Nume | Valoare |
|---|---|
| `ANTHROPIC_API_KEY` | cheia ta de pe console.anthropic.com |
| `ALLOWED_EMAILS` | e-mailul tău (mai multe, separate prin virgulă) |
| `ALLOWED_ORIGIN` | adresa GitHub Pages **fără cale**, ex. `https://numele-tau.github.io` |
| `DAILY_LIMIT` | ex. `30` |
| `MODEL` | (opțional) implicit `claude-sonnet-5-5` |
| `SERVICE_KEY` | doar dacă proiectul nu mai are cheia veche `service_role`: cheia `sb_secret_...` |

Lasă **Verify JWT** activ. Dacă analiza dă eroare 401 deși ești logat, dezactivează-l; funcția verifică oricum utilizatorul.

### 4. Anthropic – limita de cheltuieli
Pe console.anthropic.com: creează o cheie **dedicată** acestei aplicații. Din **Billing → Limits**, pune o limită lunară mică (ex. 10 $). Dacă cheia ar scăpa vreodată, paguba e plafonată.

### 5. GitHub Pages
1. Creează un repository nou, ex. `trotuar-liber`, și încarcă **toate** fișierele din acest folder (**Add file → Upload files**, inclusiv `.nojekyll`).
2. **Settings → Pages → Build and deployment**: Source = **Deploy from a branch**, Branch = `main` / `/ (root)` → **Save**.
3. După 1–2 minute, aplicația e la `https://numele-tau.github.io/trotuar-liber/`.

Repository public sau privat? Codul nu conține niciun secret, deci **public e sigur**. GitHub Pages dintr-un repository privat cere abonament GitHub Pro. Dacă vrei codul privat gratuit, alternativa e Cloudflare Pages, conectat la repo-ul privat.

### 6. Prima pornire
Deschizi adresa, introduci URL-ul proiectului Supabase și cheia publică (**Project Settings → API Keys**: `anon` sau `publishable`), apoi e-mailul și parola. Le poți scrie și în `config.js`, ca să nu le mai ceară.

### 7. Ca aplicație pe Windows (opțional)
Rulează `windows/Instaleaza Trotuar Liber.bat`. Cere adresa GitHub Pages și pune pe Desktop o scurtătură care deschide aplicația în fereastră proprie.

Pe telefon: deschide adresa în browser → meniu → **Adaugă pe ecranul principal**.

## Întreținere
- **Pauza Supabase**: pe planul gratuit, proiectul se oprește după 7 zile fără activitate. Îl repornești din dashboard (**Restore project**); datele rămân.
- **Backup**: în fila Registru, **Exportă registrul** salvează un fișier JSON.
- **Adresele instituțiilor**: verifică-le din când în când. Sunt în `app.js`, la `INST`.
- **Normativele**: extrasele folosite la analiză sunt în `app.js`, la `NORME`.

## Fișiere
- `index.html`, `app.js` – aplicația (aceeași ca varianta din Claude)
- `shim.js` – login, registru, poze, analiză prin Supabase; în Claude nu face nimic
- `config.js` – setări opționale (doar cheia publică)
- `supabase/schema.sql` – tabelele, regulile de acces, spațiul privat pentru poze
- `supabase/functions/analiza/index.ts` – funcția care ține cheia Anthropic
- `windows/Instaleaza Trotuar Liber.bat` – scurtătură pe Desktop
