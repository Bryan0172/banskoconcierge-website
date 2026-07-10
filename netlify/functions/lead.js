// netlify/functions/lead.js
// Receives website form submissions (contact, investor-intake, saroqueta-access)
// and emails each lead via Brevo. Independent of Netlify Forms detection.
// Requires env var BREVO_API_KEY (set in Netlify site settings).

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER = { email: 'peakcare@peak-care.com', name: 'Bansko Concierge Website' };
const TO = [{ email: 'web@banskoconcierge.com', name: 'Bansko Concierge' }];
const BCC = [{ email: 'andy7203@googlemail.com' }];
const THANK_YOU = '/thank-you.html';

// Cloudflare Turnstile server-side verification (third spam layer after honeypot + isSpam).
// Only active when CLOUDFLARE_TURNSTILE_SECRET is set in Netlify env — backwards-compatible.
// Fails OPEN on any technical error (bad/empty Cloudflare response, network issue): a
// verification-service hiccup must never crash the function or silently swallow a real
// lead — honeypot + isSpam remain as the other two spam layers either way.
async function verifyTurnstile(token, ip) {
  if (!token) return false;
  try {
    const body = new URLSearchParams();
    body.append('secret', process.env.CLOUDFLARE_TURNSTILE_SECRET || '');
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v1/siteverify', {
      method: 'POST', body,
    });
    if (!res.ok) {
      console.error(`Turnstile siteverify HTTP ${res.status} — failing open`);
      return true;
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error('Turnstile siteverify returned non-JSON — failing open', text.slice(0, 200));
      return true;
    }
    return json.success === true;
  } catch (e) {
    console.error('Turnstile verification threw — failing open to avoid losing a lead', (e && e.message) || String(e));
    return true;
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

  // Turnstile: third spam layer — only active when CLOUDFLARE_TURNSTILE_SECRET is set.
  if (process.env.CLOUDFLARE_TURNSTILE_SECRET) {
    const token = data['cf-turnstile-response'];
    const ip = event.headers['cf-connecting-ip'] || event.headers['x-forwarded-for'] || '';
    if (!await verifyTurnstile(token, ip)) {
      return { statusCode: 303, headers: { Location: THANK_YOU }, body: '' };
    }
  }

  // Spam-Filter: still auf Danke-Seite leiten, KEINE Mail (Bot merkt nichts).
  if (isSpam(data)) {
    return { statusCode: 303, headers: { Location: THANK_YOU }, body: '' };
  }

  const formName = data['form-name'] || 'website-form';
  const submitterName = data.name || data.Name || data.fullname || '';
  const submitterEmail = data.email || data.Email || '';

  const rows = Object.entries(data)
    .filter(([k]) => !['form-name', 'bot-field'].includes(k))
    .map(([k, v]) => `<tr><td style="padding:4px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #eee">${esc(k)}</td><td style="padding:4px 12px;border-bottom:1px solid #eee">${esc(v)}</td></tr>`)
    .join('');

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
