// netlify/functions/lead.js
// Receives website form submissions (contact, investor-intake, saroqueta-access)
// and emails each lead via Brevo. Independent of Netlify Forms detection.
// Requires env var BREVO_API_KEY (set in Netlify site settings).

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER = { email: 'peakcare@peak-care.com', name: 'Bansko Concierge Website' };
const TO = [{ email: 'web@banskoconcierge.com', name: 'Bansko Concierge' }];
const BCC = [{ email: 'andy7203@googlemail.com' }];
const THANK_YOU = '/thank-you.html';

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
