# Anweisung an die Claude-Code-Desktop-App: Memory-Export & Sync

**Zweck:** Diesen Inhalt einmalig (und danach bei jeder Änderung) ausführen, damit
die Cloud-Session (Claude Code on the web) **denselben Wissensstand** hat wie die
lokale Desktop-App. Es darf kein Informationsgefälle zwischen beiden Umgebungen geben.

**Warum das nötig ist:** Die Cloud-Session läuft in einem isolierten Container, der
nur das **Git-Repository** sieht. Lokale Desktop-Memory (`~/.claude/CLAUDE.md`,
`CLAUDE.local.md`, lokale Settings) liegt auf der Festplatte des Nutzers und ist in
der Cloud unsichtbar. **Nur committete Dateien sind in beiden Umgebungen verfügbar.**

---

## Teil A — Einmaliger Export (jetzt ausführen)

> **So benutzt du diese Datei:** Öffne die Claude-Code-Desktop-App in diesem
> Projektordner und gib ihr den folgenden Prompt (Block kopieren & einfügen).

```
Lies die Datei DESKTOP-SYNC-INSTRUCTIONS.md in diesem Repo und führe Teil A
vollständig aus. Konsolidiere meine lokale Memory wie dort beschrieben in die
committete CLAUDE.md, ohne Secrets zu committen, und pushe auf main.
```

Die Desktop-App soll dann folgende Schritte ausführen:

1. **Globale User-Memory einlesen:** `~/.claude/CLAUDE.md`.
   - Alle projektrelevanten Instruktionen, Präferenzen und Konventionen daraus in den
     Abschnitt **„Persönliche Präferenzen & projektübergreifende Instruktionen"** der
     committeten `CLAUDE.md` übertragen.
   - Rein private, projektfremde Inhalte (z. B. Dinge zu anderen Projekten) **nicht**
     committen.

2. **Lokale Projekt-Memory einlesen:** `CLAUDE.local.md` (falls vorhanden).
   - Inhalte, die beide Umgebungen brauchen → in `CLAUDE.md` einpflegen.
   - Echte Geheimnisse/private Notizen → in `CLAUDE.local.md` belassen (bleibt
     gitignored). In `CLAUDE.md` höchstens als Platzhalter erwähnen.

3. **Settings konsolidieren:** `~/.claude/settings.json` und `.claude/settings.json`.
   - **Nicht-geheime** Konfiguration (Permissions-Allowlist, Hooks, Output-Style,
     bevorzugtes Modell) in eine committete **`.claude/settings.json`** schreiben.
   - **Secrets** (Tokens, Keys, Passwörter) bleiben in Umgebungsvariablen / Netlify —
     niemals in committete Dateien.

4. **Slash-Commands & Subagents:** Falls eigene unter `~/.claude/commands/`,
   `.claude/commands/`, `.claude/agents/` existieren und im Projekt nützlich sind →
   in committete Dateien unter `.claude/` ablegen.

5. **MCP-Server-Konfiguration:** Falls projektspezifische MCP-Server genutzt werden →
   in eine committete **`.mcp.json`** schreiben (nur Endpunkte/Namen, **keine**
   Auth-Tokens).

6. **Commit & Push:**
   ```
   git add CLAUDE.md .claude/ .mcp.json
   git commit -m "Sync: Desktop-Memory in committete Projektdateien übernommen"
   git push origin main
   ```

7. **Bestätigen:** Kurz auflisten, welche Inhalte übernommen und welche bewusst
   *nicht* committet wurden (mit Begründung, z. B. „enthält Token").

---

## Teil B — Dauerhafte Regel (ab jetzt immer)

Damit es **nie wieder** ein Gefälle gibt, gilt für die Desktop-App ab sofort:

- **Jede dauerhafte Instruktion, Präferenz, Konvention oder Architektur-Entscheidung**
  wird in die committete `CLAUDE.md` (oder die passende Datei unter `.claude/`)
  geschrieben **und gepusht** — nicht nur in lokale Memory abgelegt.
- **Vor Arbeitsbeginn** in jeder Umgebung: `git pull origin main`, damit der neueste
  Stand der `CLAUDE.md` vorliegt.
- **Secrets niemals committen** — nur Name + Speicherort referenzieren.
- Diese Regel ist auch in `CLAUDE.md` unter „Memory-Sync: Cloud ↔ Desktop" verankert
  und wird damit von beiden Umgebungen automatisch gelesen.

---

## Was die Cloud-Session braucht (Checkliste für „kein Info-Verlust")

| Inhalt | Quelle (Desktop, lokal) | Ziel (committed, beide sehen es) |
|---|---|---|
| Persönliche/globale Instruktionen | `~/.claude/CLAUDE.md` | Abschnitt in `CLAUDE.md` |
| Projekt-spezifische private Notizen | `CLAUDE.local.md` | `CLAUDE.md` (wenn teilbar) |
| Permissions / Hooks / Modell | `~/.claude/settings.json`, `.claude/settings.json` | `.claude/settings.json` (ohne Secrets) |
| Eigene Slash-Commands / Subagents | `~/.claude/commands`, `.claude/agents` | `.claude/commands`, `.claude/agents` |
| MCP-Server | lokale MCP-Config | `.mcp.json` (ohne Tokens) |
| Secrets/Tokens | lokal / Keychain | **bleiben außerhalb von Git** (Env / Netlify) |

Sobald Teil A gelaufen ist, hat die Cloud-Session über `git pull` automatisch
denselben Stand — verlustfrei.
