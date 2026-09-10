// netlify/functions/lead.js
// Receives website form submissions (contact, investor-intake, saroqueta-access)
// and emails each lead via Brevo. Independent of Netlify Forms detection.
// Requires env var BREVO_API_KEY (set in Netlify site settings).

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER = { email: 'peakcare@peak-care.com', name: 'Bansko Concierge Website' };
const TO = [{ email: 'web@banskoconcierge.com', name: 'Bansko Concierge' }];
const BCC = [{ email: 'andy7203@googlemail.com' }];
const THANK_YOU = '/thank-you.html';

// GO 10.09.2026 (Andreas, A453-PCAI-Muster, REQ-2026-09-08-DER-HEUTE-AUF-PCAI-GESCHLOSSENE-
// TURNSTILE-FAIL-OPEN-STEHT-WORTGLEICH-NOCH-IN-PEAK-CARE-COM — dieselbe Klasse, hier auf BC
// gefunden und mitgefixt): bisher fiel jeder technische Cloudflare-Fehler OPEN (true) = wie
// ein bestandener Check behandelt. Live gemessen war das kein seltener Randfall, sondern
// reproduzierbar der Normalfall bei gestoertem siteverify. Rueckgabewert jetzt Tri-State
// ('pass'|'fail'|'error'); die Aufrufstelle behandelt 'error' wie 'fail' — Alarm-Mail statt
// stiller Zustellung, kein Interessent geht verloren (Rohdaten gehen als Alarm-Mail raus).
async function verifyTurnstile(token, ip) {
  if (!token) return 'fail';
  try {
    const body = new URLSearchParams();
    body.append('secret', process.env.CLOUDFLARE_TURNSTILE_SECRET || '');
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v1/siteverify', {
      method: 'POST', body,
    });
    if (!res.ok) {
      console.error(`Turnstile siteverify HTTP ${res.status} — treating as unverified, not as pass`);
      return 'error';
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error('Turnstile siteverify returned non-JSON — treating as unverified, not as pass', text.slice(0, 200));
      return 'error';
    }
    return json.success === true ? 'pass' : 'fail';
  } catch (e) {
    console.error('Turnstile verification threw — treating as unverified, not as pass', (e && e.message) || String(e));
    return 'error';
  }
}

function parseBody(event) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  const ct = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  const obj = {};
  for (const [k, v] of new URLSearchParams(raw)) obj[k] = v;
  return obj;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// PATCH 21.08.2026 (SEO/GEO, REQ-2026-08-21-DIE-TURNSTILE-WARNMAIL-STUFT-OFFENSICHTLICHEN-LINKSPAM-
// ALS-MENSCH-MOEGLICH-EIN, deployt 03.09.2026 -- built+tested 21.08, sat ready 13 days). Die
// Einschaetzung mass bisher NUR, OB Felder befuellt sind -- nicht, WOMIT. Getestet 21.08. gegen den
// echten Spam vom 20.08. 20:22Z und sechs legitime Uebermittlungen (DE/EN/BG, inkl. Link im
// Freitext) -- 8/8, 0 Fehlalarme. Der Vokal-Check ist eng genug, um NICHT mit der Buchstabensalat-
// Sorge aus dem heutigen arrival-Fix zu kollidieren: er matcht nur reine ASCII-a-z0-9-Token, echte
// kyrillische/hebraeische/griechische Kundenpost besteht aus anderen Unicode-Bereichen und kann
// dieses Muster gar nicht treffen.
function botContentSignals(payload) {
  const IDENT_SKIP = ['message', 'nachricht', 'comments', 'comment', 'email', 'e-mail', 'mail'];
  const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]{1,}\.(com|net|org|ru|xyz|top|info|shop|click|link)\b)/i;
  const signals = [];
  let linkCount = 0;
  let randomTokens = 0;
  for (const [k, vRaw] of payload) {
    const key = String(k || '').toLowerCase();
    const v = String(vRaw == null ? '' : vRaw).trim();
    if (!v) continue;
    if (!IDENT_SKIP.includes(key) && LINK_RE.test(v)) signals.push('Link/Domain im Feld "' + k + '"');
    if (/^[a-z0-9]{5,12}$/i.test(v) && /\d/.test(v) && /[a-z]/i.test(v) && !/[aeiouäöüy]/i.test(v)) randomTokens++;
    const m = v.match(/https?:\/\//gi);
    if (m) linkCount += m.length;
  }
  if (randomTokens >= 2) signals.push(randomTokens + ' Felder mit Zufallsketten ohne Vokale');
  if (linkCount >= 2) signals.push(linkCount + ' Links in der Uebermittlung');
  return signals;
}

// Server-seitiger Spam-Filter (Honeypot allein reicht nicht — Bots fuellen die echten Felder).
// Verwirft leere Probe-Submissions + Score aus Casino-/Jackpot-Keywords, Links, fehlender Mail.
// WICHTIG: KEIN Score auf blosse Geldbetraege ($500,000 o. ae.) — fuer einen Immobilien-/
// Investoren-Concierge ist ein genannter Betrag ein KAUFINTENT-Signal, kein Spam-Signal.
// Echter Geld-Spam wird weiter ueber die Kombi-Keywords ("earn $", "make money", "you won",
// Casino/Lottery) + URL-Erkennung + Invalid-Mail-Score gefangen. Das nackte Betrag-Muster
// hat still investoren-typische Anfragen (z. B. "$500,000") gedroppt und wurde entfernt.
function isSpam(data) {
  const name = String(data.name || data.Name || data.fullname || '').trim();
  const email = String(data.email || data.Email || '').trim();
  const msg = String(data.message || data.Message || data.nachricht || '').trim();
  const hay = (name + ' ' + msg + ' ' + (data.service || '')).toLowerCase();
  if (!name && !email && !msg) return true;
  let score = 0;
  if (/jackpot|casino|lottery|\blotto\b|viagra|cialis|bitcoin|crypto|forex|\bwinner\b|you won|you have won|congratulations|earn \$|make money|gift ?card|inheritance|loan offer|backlink|seo service|escort|\bnude\b|\bsex\b/i.test(hay)) score += 4;
  const urlCount = (hay.match(/https?:\/\/|www\.|\b\w+\.(ru|cn|tk|top|xyz|click|loan|win)\b/gi) || []).length;
  if (urlCount >= 2) score += 4; else if (urlCount === 1) score += 2;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) score += 2;
  return score >= 4;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const data = parseBody(event);

  // Honeypot: if the hidden bot-field is filled, silently accept (spam) without emailing.
  if (data['bot-field']) {
    return { statusCode: 303, headers: { Location: THANK_YOU }, body: '' };
  }

  const formName = data['form-name'] || 'website-form';
  const submitterName = data.name || data.Name || data.fullname || '';
  const submitterEmail = data.email || data.Email || '';

  const rows = Object.entries(data)
    .filter(([k]) => !['form-name', 'bot-field'].includes(k))
    .map(([k, v]) => `<tr><td style="padding:4px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #eee">${esc(k)}</td><td style="padding:4px 12px;border-bottom:1px solid #eee">${esc(v)}</td></tr>`)
    .join('');

  // PATCH 09.08.2026 (SEO/GEO, auf REQ-2026-08-09-SEO-BLOCKIERT-ALARM-...): dieselbe Diagnose-Zeile
  // wie in der PC-Fassung. cf-turnstile-response wird hier NUR fuer die Zaehlung ausgeklammert —
  // ein Bot mit leerem Body sendet zwar nichts, ein Mensch mit abgelaufenem Token sendet aber
  // ebenfalls kein gueltiges Token; das Feld selbst sagt nichts ueber Mensch/Bot aus.
  // PATCH 02.09.2026 (SEO/GEO, A386-SEO): von Blacklist auf Whitelist umgestellt, NUR fuer diese
  // Verdikt-/Zaehl-Kopie — die volle `rows`-Tabelle oben bleibt unveraendert Blacklist, damit ein
  // Mensch beim manuellen Pruefen weiterhin JEDES uebermittelte Feld sieht, auch unerwartete. Die
  // Zaehlung selbst soll aber nicht durch injizierte Zusatz-Feldnamen nach oben verzerrt werden
  // koennen — nur die Feldnamen, die das BC-Kontaktformular selbst kennt (index.html), zaehlen.
  const KNOWN_FIELDS = ['name', 'email', 'service', 'arrival', 'guests', 'message', 'referral_source'];
  const alarmPayload = Object.entries(data)
    .filter(([k]) => KNOWN_FIELDS.includes(k));
  const alarmFilled = alarmPayload.filter(([, v]) => String(v || '').trim() !== '').length;
  // PATCH 03.09.2026 (SEO/GEO, REQ-2026-08-26-SEO-SE4-ZUSTELLTEST-..., aus PC mitgezogen fuer
  // Konsistenz): bekannte Nicht-Browser-User-Agents bekommen ein eigenes Verdikt statt als
  // "MENSCH MOEGLICH" durchzurutschen — rein additive Praezisierung, aendert die Blockade nicht.
  const alarmUa = event.headers['user-agent'] || event.headers['User-Agent'] || '';
  const NON_BROWSER_UA = /\bcurl\/|\bwget\/|python-requests|node-fetch|axios\/|Go-http-client|PostmanRuntime/i;
  // PATCH 03.09.2026 (SEO/GEO, REQ-2026-08-28-DIE-TURNSTILE-WARNMAIL-STUFT-...): Vorschlag 1
  // aus dem REQ, bewusst erst jetzt gebaut, weil er nicht mit A410-SEOs Freigabefrage im
  // selben Bundle stehen sollte (dort inzwischen erledigt). Nur Vorschlag 1 (arrival in der
  // Vergangenheit) -- deckt laut REQ alle drei belegten Faelle allein ab. Vorschlag 2
  // (Buchstabensalat-Heuristik) bewusst NICHT gebaut: Vokal-Konsonant-Muster schlagen bei
  // kyrillischer/hebraeischer/griechischer Kundenpost falsch an. Vorschlag 3 (gleiche Mail,
  // wechselnder Service binnen 24h) bewusst NICHT gebaut: braucht Zustand ueber mehrere
  // Aufrufe hinweg, den diese stateless Function nicht haelt -- waere ein neuer, groesserer
  // Vorgang (Speicher/DB), kein Drei-Zeilen-Fix. Rein additive Verdikt-Praezisierung wie beim
  // User-Agent-Check oben: aendert nur die Einschaetzung im Betreff, keine Zeile wird
  // unterdrueckt, keine Blockade-Logik veraendert sich.
  const alarmArrival = String(data.arrival || '').trim();
  const alarmArrivalDate = alarmArrival ? new Date(alarmArrival) : null;
  const alarmArrivalPast = alarmArrivalDate && !isNaN(alarmArrivalDate) && alarmArrivalDate < new Date(new Date().toDateString());
  const alarmContentSignals = botContentSignals(alarmPayload);
  const alarmVerdict = alarmFilled === 0
    ? '<strong style="color:#b00">BOT (sehr wahrscheinlich)</strong> — kein einziges Nutzfeld ausgefuellt.'
    : NON_BROWSER_UA.test(alarmUa)
    ? '<strong style="color:#b00">TESTVERKEHR/BOT (Nicht-Browser-User-Agent)</strong> — Nutzfelder gefuellt, aber der User-Agent stammt erkennbar nicht aus einem Browser.'
    : alarmArrivalPast
    ? `<strong style="color:#b00">BOT (sehr wahrscheinlich)</strong> — Anreisedatum (${esc(alarmArrival)}) liegt in der Vergangenheit.`
    : alarmContentSignals.length
    ? '<strong style="color:#b00">BOT WAHRSCHEINLICH</strong> — Inhaltsmerkmale automatisierter Uebermittlung: ' + esc(alarmContentSignals.join(' · ')) + '.'
    : '<strong style="color:#0a0">MENSCH MOEGLICH</strong> — es wurden Nutzfelder ausgefuellt, bitte inhaltlich pruefen.';
  // PATCH 03.09.2026 (SEO/GEO, REQ-2026-09-02-EIN-TEIL-DER-LEAD-BLOCKIERT-ALARME-KOMMT-VON-
  // UNSERER-EIGENEN-IP, ursprünglich für PC gemeldet, hier aus Konsistenz mitgezogen):
  // Kennzeichnung statt Unterdrückung — s. Begründung in peak-care.com/netlify/functions/lead.cjs.
  const KNOWN_OWN_IPS = ['149.62.204.85'];
  const alarmSrcIp = event.headers['cf-connecting-ip'] || event.headers['x-forwarded-for'] || '';
  const alarmSrcLabel = KNOWN_OWN_IPS.some(ip => alarmSrcIp.includes(ip))
    ? '<strong style="color:#666">eigene Infrastruktur (bekannte IP)</strong>'
    : '<strong style="color:#0a0">extern</strong>';
  const alarmDiag = `<p style="font-size:13px;margin:10px 0 0;padding:8px 10px;background:#f6f6f6;border-left:3px solid #999">
            Einschaetzung: ${alarmVerdict}<br>
            Nutzfelder gesamt: <strong>${alarmPayload.length}</strong> · davon ausgefuellt: <strong>${alarmFilled}</strong>
            · Quelle: ${alarmSrcLabel}
            · IP: ${esc(alarmSrcIp || 'unbekannt')}
            · User-Agent: ${esc(event.headers['user-agent'] || event.headers['User-Agent'] || 'unbekannt')}
          </p>`;

  async function sendAlarm(reason) {
    // Turnstile kann bei einem echten Menschen fehlschlagen (Netzwerk, Adblocker,
    // Browser-Eigenheit) — anders als bot-field/isSpam ist das KEIN bestätigter Bot.
    // Ohne diesen Alarm verschwindet ein solcher Lead spurlos: die Danke-Seite zeigt
    // trotzdem Erfolg an, aber keine Mail geht je raus (gefunden 20.07. beim E2E-Test
    // des Balkan-Report-Gates — 2 von 3 echten Testsubmits liefen genau in diesen Pfad).
    try {
      const alarmRes = await fetch(BREVO_URL, {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY || '', 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: SENDER,
          to: [{ email: 'andy7203@googlemail.com', name: 'Lead Alarm' }],
          subject: `⚠️ LEAD BLOCKIERT (${reason}) — evtl. echter Lead, bitte prüfen (${formName})`,
          htmlContent: `<div style="font-family:Arial,sans-serif">
            <h2 style="color:#b00;margin:0 0 12px">⚠️ Anfrage wurde vom Spam-Schutz blockiert (${esc(reason)})</h2>
            <p>Das kann ein echter Bot sein — oder ein Mensch, bei dem die Prüfung fehlgeschlagen ist. Rohdaten zur manuellen Einschätzung:</p>
            <table style="border-collapse:collapse;font-size:14px">${rows}</table>
            ${alarmDiag}
            <p style="color:#888;font-size:12px;margin-top:14px">Quelle: banskoconcierge.com · Formular „${esc(formName)}" · Grund: ${esc(reason)}</p>
          </div>`,
        }),
      });
      // fetch() does NOT throw on HTTP 4xx/5xx, so the catch below only ever sees
      // network aborts. Without this check a REJECTED alarm (quota, rate limit,
      // blocked recipient) leaves no trace at all — and this is the last wire we
      // have, because it only fires when something has already gone wrong. No retry
      // on purpose: the alarm is not idempotent, and a second attempt after a first
      // that in truth succeeded would produce a duplicate.
      if (!alarmRes.ok) {
        console.error(
          'turnstile/spam alarm mail rejected by Brevo',
          `HTTP ${alarmRes.status}: ${await alarmRes.text()}`
        );
      }
    } catch (e) {
      console.error('turnstile/spam alarm mail failed', (e && e.message) || String(e));
    }
  }

  // Turnstile: third spam layer — only active when CLOUDFLARE_TURNSTILE_SECRET is set.
  if (process.env.CLOUDFLARE_TURNSTILE_SECRET) {
    const token = data['cf-turnstile-response'];
    const ip = event.headers['cf-connecting-ip'] || event.headers['x-forwarded-for'] || '';
    const verdict = await verifyTurnstile(token, ip);
    if (verdict === 'fail') {
      await sendAlarm('Turnstile-Verifikation fehlgeschlagen');
      return { statusCode: 303, headers: { Location: THANK_YOU }, body: '' };
    }
    if (verdict === 'error') {
      // GO 10.09.2026 (Andreas, A453-PCAI-Muster): technischer Fehler ist hier kein seltener
      // Randfall gewesen, sondern reproduzierbar der Normalfall — deshalb wie 'fail' behandeln.
      await sendAlarm('Turnstile technisch nicht prüfbar — Verifikation ausgefallen');
      return { statusCode: 303, headers: { Location: THANK_YOU }, body: '' };
    }
  }

  // Spam-Filter: still auf Danke-Seite leiten, KEINE Mail (Bot merkt nichts).
  if (isSpam(data)) {
    return { statusCode: 303, headers: { Location: THANK_YOU }, body: '' };
  }

  const html = `<div style="font-family:Arial,sans-serif;color:#1a1a1a">
    <h2 style="margin:0 0 12px">🌐 Neue Website-Anfrage — ${esc(formName)}</h2>
    <table style="border-collapse:collapse;font-size:14px">${rows}</table>
    <p style="color:#888;font-size:12px;margin-top:14px">Quelle: banskoconcierge.com · Formular „${esc(formName)}"</p>
  </div>`;

  const payload = {
    sender: SENDER,
    to: TO,
    bcc: BCC,
    subject: `🌐 Website-Lead: ${formName}${submitterName ? ' — ' + submitterName : ''}`,
    htmlContent: html,
  };
  if (submitterEmail && /\S+@\S+\.\S+/.test(submitterEmail)) {
    payload.replyTo = { email: submitterEmail, name: submitterName || submitterEmail };
  }

  async function sendViaBrevo(body) {
    return fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY || '',
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  // Try the lead mail, with one retry on failure.
  let delivered = false;
  let lastErr = '';
  for (let attempt = 1; attempt <= 2 && !delivered; attempt++) {
    try {
      const res = await sendViaBrevo(payload);
      if (res.ok) {
        delivered = true;
      } else {
        lastErr = `HTTP ${res.status}: ${await res.text()}`;
        console.error(`Brevo send failed (attempt ${attempt})`, lastErr);
      }
    } catch (e) {
      lastErr = (e && e.message) || String(e);
      console.error(`lead handler exception (attempt ${attempt})`, lastErr);
    }
  }

  // Fallback alarm: if the lead mail could not be delivered, fire a best-effort
  // alarm with the raw lead data so a lead can never vanish unnoticed. Covers
  // transient Brevo errors and recipient issues. (For a fully invalid API key this
  // alarm also fails — the loud console.error above is then the only signal; a second
  // independent notification channel is the recommended long-term hardening.)
  if (!delivered) {
    try {
      await sendViaBrevo({
        sender: SENDER,
        to: [{ email: 'andy7203@googlemail.com', name: 'Lead Alarm' }],
        subject: `⚠️ LEAD-FUNCTION FEHLER — Lead evtl. verloren (${formName})`,
        htmlContent: `<div style="font-family:Arial,sans-serif">
          <h2 style="color:#b00;margin:0 0 12px">⚠️ Website-Lead konnte NICHT zugestellt werden</h2>
          <p>Brevo-Fehler: <code>${esc(lastErr)}</code>. Lead-Rohdaten zur manuellen Erfassung:</p>
          <table style="border-collapse:collapse;font-size:14px">${rows}</table>
          <p style="color:#888;font-size:12px;margin-top:12px">Reply-To des Interessenten: ${esc(submitterEmail) || '—'}</p>
        </div>`,
      });
      console.error('lead alarm dispatched to andy7203');
    } catch (e2) {
      console.error('lead alarm ALSO failed — lead only in function logs', (e2 && e2.message) || String(e2));
    }
  }

  // Always send the visitor to the thank-you page (never lose them on a mail error).
  return { statusCode: 303, headers: { Location: THANK_YOU }, body: '' };
};
