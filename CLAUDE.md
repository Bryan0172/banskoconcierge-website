# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Marketing website for **Bansko Concierge VIP** — a luxury concierge / travel /
property-services business operating across the Balkans ("the Balkan Corridor"),
based in Bansko, Bulgaria. It is a **static, hand-written HTML site** deployed on
Netlify. There is **no framework, no bundler, and no build step** — Netlify
publishes the repository root as-is (`publish = "."` in `netlify.toml`).

The only JavaScript that runs in a Node environment is the single Netlify
Function in `netlify/functions/`.

## Commands

There is no root `package.json`, no test suite, and no linter. "Building" means
committing HTML and letting Netlify deploy.

- **Local preview**: open any `.html` file directly in a browser, or run a static
  server from the repo root (e.g. `python3 -m http.server 8000`). Note that clean
  URLs and `.html`→clean redirects (see below) are Netlify-only — locally you must
  navigate to the actual `.html` files.
- **Deploy**: push to `main`. Netlify auto-deploys (~60s). There is no staging step.
- **Netlify Function deps**: the function has its own `netlify/functions/package.json`
  (Node ≥ 18). It currently uses only the built-in `fetch`, so no `npm install` is needed.

## Architecture & conventions

### Self-contained pages
Every page is a **standalone `.html` file with its own inline `<style>` and inline
`<script>`**. There are no shared CSS or JS files. The design system (navy/gold
palette, `Inter` + `Playfair Display` fonts, `.nav`/`.btn`/`.footer`/WhatsApp-sticky
components) is **duplicated via copy-paste** into each page's `:root` CSS variables and
markup. When changing shared visuals (colors, nav, footer, fonts), the change must be
replicated across pages — there is no single source of truth for styling.

Shared design tokens (kept identical across files):
`--navy:#0A0E27`, `--navy-mid:#141830`, `--navy-lt:#1E2340`, `--gold:#C9A96E`,
`--gold-lt:#E8D5B0`, `--white:#F8F6F0`, `--font-serif:'Playfair Display'`,
`--font-sans:'Inter'`.

### Page types
- **`index.html`** — homepage (very large; ~900 KB single file).
- **Service pages** (root): `private-mobility`, `private-dining`, `local-support`,
  `owner-care-bulgaria`, `investor-support`, `property-risk-check-bulgaria`,
  `relocation-bulgaria-orientation`, `outdoor-experiences-bulgaria`,
  `car-import-registration-bulgaria`, `vip-airport-transfer`, `private-chef-spa`, etc.
- **Country pages** (root): `bulgaria`, `serbia`, `greece`, `croatia`, `romania`,
  `montenegro`, `north-macedonia`, `albania`.
- **`blog.html`** — blog index. **Renders client-side** by `fetch('/posts.json')`
  and building cards in JS; it does not list articles statically.
- **`blog/*.html`** — individual article pages (static files).

### Blog system & `posts.json`
`posts.json` is the **source of truth for the blog index** — an array of post objects
(`slug`, `title`, `excerpt`, `category`, `emoji`, `gradient`, `date`, `readTime`,
`featured`, optional `thumbnail`). `blog.html` fetches it, sorts newest-first, and
renders the first entry as the featured card. Article cards link to
`/blog/${slug}.html`. To add a blog post manually you must create
`blog/<slug>.html` **and** add a matching entry to `posts.json`.

### Automated publishing — `netlify/functions/arvow-webhook.js`
This is the one piece of real backend logic. It receives a `POST` from the external
**Arvow** content service when an article is published, then:
1. generates the article HTML from an **inline template inside the function** (its own
   copy of the nav/styles/footer), and
2. uses the **GitHub Contents API** to commit the new `blog/<slug>.html` and an updated
   `posts.json` directly to the `main` branch — which triggers a Netlify redeploy.

Key facts:
- Target branch is hard-coded: `const BRANCH = 'main';`.
- Required env vars (set in Netlify, not in repo): `GITHUB_TOKEN` (repo write),
  `GITHUB_REPO` (default `Bryan0172/banskoconcierge-website`), optional `ARVOW_SECRET`
  (validated via `x-arvow-secret`/`authorization` header).
- The article template here is a **separate copy** of the site styling — if you change
  the article look-and-feel, update both this function's template and existing
  `blog/*.html` files.

### URL routing — `netlify.toml` (important)
The site uses **clean URLs** (no `.html`). This is enforced entirely in `netlify.toml`,
and adding a page is a two-rule pattern:
- a **200 rewrite** `/<page>` → `/<page>.html` (serves clean URL), and
- a **301 redirect** `/<page>.html` → `/<page>` (canonicalizes away the `.html`).

Internal links across the site use the **clean form** (`href="/owner-care-bulgaria"`),
**except** blog cards and the webhook template, which link to `/blog/<slug>.html`.

`netlify.toml` also contains:
- **Permanent 301s for repositioned services** (e.g. `/vip-airport-transfer` →
  `/private-mobility`, `/private-chef-spa` → `/private-dining`). Preserve these when
  renaming pages — they protect existing SEO/links.
- **"Phantom URL" 301s** (`/home`, `/startseite`, `/_/view`, `/http:/*`, etc.) cleaning
  up junk URLs Google discovered. Leave them.
- **Security headers** applied to `/*`: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, plus
  CORS for `/.netlify/functions/*` and cache headers for `posts.json`.

**When adding a new page, also:** add both redirect rules to `netlify.toml` and add the
URL to `sitemap.xml` (both are maintained by hand).

### SEO files (maintained manually)
- **`sitemap.xml`** — hand-maintained; uses the bare `banskoconcierge.com` host.
- **`robots.txt`** — allows all, disallows `/netlify/`, points to the `www.` sitemap.
- **`seo-keywords.json`** — editorial keyword queue for the blog. Entries carry
  `status: pending|used` and a `slug`. Its `meta.notes` encodes the **content
  positioning rule: "LUXURY ONLY — no budget/price comparisons. No competitor options.
  Contact CTA only."** Follow this when writing/editing marketing or blog copy.

## Content & copy conventions
- **Primary CTA everywhere is WhatsApp**: `https://wa.me/359895762785`
  (displayed as **+359 895 762 785**). This number appears in ~all pages — keep it
  consistent if it ever changes.
- Blog articles are authored under the byline **Andreas Donner**. Note prior history
  corrected false biographical claims about him (see commit
  `0dfde0d`) — **be factually accurate** in bios and claims; do not invent credentials,
  years of experience, or statistics.
- Legal/Privacy links point to external Google Sites pages.

## Memory-Sync: Cloud ↔ Desktop (verbindlich)

Diese Datei ist die **einzige Quelle der Wahrheit für dauerhafte Instruktionen,
Präferenzen und Entscheidungen**. Sie wird von **beiden** Umgebungen automatisch
gelesen — der Claude-Code-Desktop-App (lokal) und Claude Code on the web (Cloud-
Container). Lokale, nicht-committete Memory der Desktop-App
(`~/.claude/CLAUDE.md`, `CLAUDE.local.md`, lokale Settings) ist in der Cloud
**nicht sichtbar**. Damit zwischen den beiden Umgebungen kein Informationsgefälle
entsteht, gilt:

1. **Alles Dauerhafte gehört in committete Dateien.** Sobald eine projektrelevante
   Instruktion, Präferenz, Konvention oder Entscheidung getroffen wird, wird sie in
   diese `CLAUDE.md` (oder eine andere committete Datei unter `.claude/`)
   geschrieben und gepusht — **nicht** nur in lokale Memory abgelegt.
2. **Niemals Secrets committen.** Tokens, API-Keys, Passwörter (`GITHUB_TOKEN`,
   `ARVOW_SECRET`, Netlify-Keys usw.) gehören in Umgebungsvariablen / Netlify, nie
   in `CLAUDE.md`, Code oder Commits. In committeten Dateien wird nur auf ihren
   *Namen* und *Speicherort* verwiesen.
3. **Was wohin gehört:**
   - Projektregeln & geteilte Präferenzen → diese `CLAUDE.md` (committed, gepusht).
   - Rein private/lokale Notizen → `CLAUDE.local.md` (gitignored, bleibt lokal).
     *Achtung:* solche Inhalte sind in der Cloud nicht verfügbar — nur hierher
     einfügen, wenn beide Seiten sie brauchen.
   - Permissions, Hooks, Slash-Commands, Subagents, MCP-Config → committete Dateien
     unter `.claude/` bzw. `.mcp.json` (ohne Secrets).
4. **Nach Übernahme von Desktop-Memory** wird der Inhalt hier strukturiert
   eingepflegt, committet und auf `main` gepusht; danach `git pull` in der jeweils
   anderen Umgebung → beide Seiten sind synchron.

Die Schritt-für-Schritt-Anweisung für den initialen Export aus der Desktop-App
liegt in **`DESKTOP-SYNC-INSTRUCTIONS.md`**.

### Persönliche Präferenzen & projektübergreifende Instruktionen

<!-- Exportiert aus Desktop-App am 2026-06-07 via DESKTOP-SYNC-INSTRUCTIONS.md Teil A -->

**Nutzer:** Andreas Donner — Inhaber Peak Care EDPK, Bansko Bulgaria
**Sprache:** Antworten immer auf Deutsch, außer wenn der Nutzer explizit Englisch oder Bulgarisch wünscht.

**Grundregeln (gelten projektübergreifend):**
- Kein Auto-Post, kein Auto-Publish — jede Veröffentlichung erfordert manuelle Freigabe durch Andreas
- Keine Mehrwertsteuer ausweisen — Peak Care EDPK ist Kleinunternehmer (Art. 96 Abs. 1 ZDDS Bulgarien)
- **Cloud-Speicher ausschließlich Google Drive** — auf Desktop **und** Handy. **Kein OneDrive.**
  Alle Arbeitsdateien werden in Google Drive abgelegt/gesucht (nicht in lokalen
  OneDrive-Pfaden wie `C:\Users\...\OneDrive\...`). Projektordner-Struktur in Drive:
  `ChatGpt_Orchestrator/<Projektname>/`.
- Angebote nur auf Basis Vor-Ort-Besichtigung erstellen

**Marken-Übersicht (nicht vermischen):**
- **Bansko Concierge** — Immobilien-Concierge & Owner Management, Bansko/Balkans (dieses Repo)
- **Peak Care EDPK** — Bautechnische Prüfung & Projektbegleitung, Bulgarien
- **Peak Care AI** — KI-Compliance für Hotels (EU AI Act)

**Kontext Bansko Concierge Website:**
- Primäre CTA: WhatsApp `+359 895 762 785` — konsistent auf allen Seiten
- Zielgruppe: Remote-Eigentümer, europäische Expats & Investoren in Bulgarien
- Ton: professionell, vertrauenswürdig, kein VIP-Luxus-Bragging
- Blog-Autor: Andreas Donner — keine erfundenen Credentials oder Statistiken

## Git & deployment workflow
- `main` is the production branch — pushing to it deploys live. Be deliberate about
  what lands there.
- The Arvow webhook also commits directly to `main`, so `main` receives both
  human and automated commits (article additions + `posts.json` updates).
- Commit messages in this repo are descriptive and often prefixed by intent
  (e.g. `SEO:`, `Fix:`, `Add ...`); match that style.
