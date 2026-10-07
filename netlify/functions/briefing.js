// netlify/functions/briefing.js
// Newsletter-Anmeldung "BC Briefing" mit eigenem Double-Opt-In (SEO/GEO, 06.10.2026, Andreas-Go).
// Brevos DOI-Endpunkt verlangt eine in der Brevo-Oberflaeche angelegte DOI-Vorlage; per API ist sie nicht
// anlegbar. Darum: eigener, zustandsloser Ablauf ueber die Transaktions-API (derselbe Versandweg wie lead.js).
//   1) POST {action:'subscribe'}  -> Turnstile + Einwilligung pruefen, Bestaetigungsmail mit signiertem Link senden.
//      Es wird NICHTS gespeichert und KEINE Mail an Andreas gesendet.
//   2) Link /briefing/?c=TOKEN    -> Seite zeigt Button "Bestaetigen" (Mail-Scanner koennen so nicht still bestaetigen).
//   3) POST {action:'confirm'}    -> Token pruefen (HMAC, 7 Tage) -> Kontakt in Brevo-Liste "BC Briefing" (id 11),
//      Attribute SPRACHE + DOI_ANGEFORDERT + DOI_BESTAETIGT (Nachweis).
// Env: BREVO_API_KEY, CLOUDFLARE_TURNSTILE_SECRET (beide schon in den BC-Site-Settings). Der Signaturschluessel
// wird aus BREVO_API_KEY abgeleitet; kein zusaetzliches Secret.

const crypto = require('crypto');

const LIST_ID = 11;
const SENDER = { email: 'hello@banskoconcierge.com', name: 'Bansko Concierge' };  // Brevo-Sender id 4, verifiziert 07.10.2026 (Andreas: nur hello@)
const REPLY_TO = { email: 'hello@banskoconcierge.com', name: 'Bansko Concierge' };
const BASE = 'https://banskoconcierge.com/briefing/';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(obj),
});

const key = () => crypto.createHash('sha256').update('bc-briefing-doi|' + (process.env.BREVO_API_KEY || '')).digest();
const b64 = (s) => Buffer.from(s).toString('base64url');
function sign(payload) {
  const p = b64(JSON.stringify(payload));
  return p + '.' + crypto.createHmac('sha256', key()).update(p).digest('base64url');
}
function verify(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const good = crypto.createHmac('sha256', key()).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!p.e || !p.t || Date.now() - p.t > MAX_AGE_MS) return null;
    return p;
  } catch (e) { return null; }
}

async function verifyTurnstile(token, ip) {
  if (!token) return 'fail';
  try {
    const body = new URLSearchParams();
    body.append('secret', process.env.CLOUDFLARE_TURNSTILE_SECRET || '');
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    if (!res.ok) return 'error';
    const j = JSON.parse(await res.text());
    return j.success === true ? 'pass' : 'fail';
  } catch (e) {
    return 'error';
  }
}

function parseBody(event) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

const FOOT = {
  en: 'Bansko Concierge &middot; PEAK CARE EDPK, ul. Stragite 8, Bansko, Bulgaria &middot; <a href="https://banskoconcierge.com/privacy.html" style="color:#E8D5B0">Privacy</a>',
  de: 'Bansko Concierge &middot; PEAK CARE EDPK, ul. Stragite 8, Bansko, Bulgarien &middot; <a href="https://banskoconcierge.com/privacy.html" style="color:#E8D5B0">Datenschutz</a>',
  bg: 'Bansko Concierge &middot; PEAK CARE EDPK, ул. Страгите 8, Банско, България &middot; <a href="https://banskoconcierge.com/privacy.html" style="color:#E8D5B0">Поверителност</a>',
};
const MAIL = {
  en: ['Please confirm your subscription - Bansko Concierge Briefing', 'Please confirm your subscription',
    'Thank you for your interest in the Bansko Concierge Briefing: property and investment in Bulgaria, written for buyers, investors and clients.',
    'Confirm subscription',
    'If you did not request this, simply ignore this message. No subscription is made until you confirm. You can unsubscribe at any time.'],
  de: ['Bitte bestätigen Sie Ihre Anmeldung - Bansko Concierge Briefing', 'Bitte bestätigen Sie Ihre Anmeldung',
    'Vielen Dank für Ihr Interesse am Bansko Concierge Briefing: Immobilien und Investment in Bulgarien, für Käufer, Investoren und Klienten.',
    'Anmeldung bestätigen',
    'Falls Sie diese Anmeldung nicht veranlasst haben, ignorieren Sie diese Nachricht einfach. Ohne Ihre Bestätigung erfolgt keine Anmeldung. Sie können sich jederzeit abmelden.'],
  bg: ['Моля, потвърдете абонамента си - Bansko Concierge Briefing', 'Моля, потвърдете абонамента си',
    'Благодарим Ви за интереса към Bansko Concierge Briefing: имоти и инвестиции в България, за купувачи, инвеститори и клиенти.',
    'Потвърждаване на абонамента',
    'Ако не сте поискали това, просто игнорирайте съобщението. Без Вашето потвърждение абонамент не се създава. Можете да се отпишете по всяко време.'],
};
function mailHtml(lg, url) {
  const [, h, p, btn, small] = MAIL[lg];
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#F9F5EC;font-family:Georgia,serif;color:#0B1F33">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">' +
    '<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:4px solid #C9A84C"><tr><td style="padding:32px 36px">' +
    '<p style="margin:0 0 6px;font:12px Arial,sans-serif;letter-spacing:2px;color:#C9A84C">BANSKO CONCIERGE</p>' +
    '<h1 style="margin:0 0 18px;font-size:24px;font-weight:normal">' + h + '</h1>' +
    '<p style="margin:0 0 24px;font-size:16px;line-height:1.55">' + p + '</p>' +
    '<p style="margin:0 0 28px"><a href="' + url + '" style="background:#0B1F33;color:#F9F5EC;text-decoration:none;padding:14px 28px;font:15px Arial,sans-serif;display:inline-block">' + btn + '</a></p>' +
    '<p style="margin:0;font:13px/1.5 Arial,sans-serif;color:#555">' + small + '</p>' +
    '</td></tr><tr><td style="padding:16px 36px;background:#0B1F33;font:11px/1.5 Arial,sans-serif;color:#d9d3c3">' + FOOT[lg] + '</td></tr></table></td></tr></table></body></html>';
}

const brevo = (path, method, body) => fetch('https://api.brevo.com/v3' + path, {
  method,
  headers: { 'api-key': process.env.BREVO_API_KEY || '', 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });
  const data = parseBody(event);

  // ---- Schritt 3: Bestaetigung ----
  if (data.action === 'confirm') {
    const p = verify(data.token);
    if (!p) return json(400, { ok: false, error: 'token' });
    const issue = ['de', 'en'].includes(p.i) ? p.i : 'en';
    try {
      const res = await brevo('/contacts', 'POST', {
        email: p.e, listIds: [LIST_ID], updateEnabled: true,
        attributes: { SPRACHE: issue, DOI_ANGEFORDERT: new Date(p.t).toISOString(), DOI_BESTAETIGT: new Date().toISOString() },
      });
      if (res.ok || res.status === 204) return json(200, { ok: true, lang: p.l });
      console.error('briefing confirm rejected', res.status, (await res.text()).slice(0, 300));
    } catch (e) { console.error('briefing confirm threw', (e && e.message) || String(e)); }
    return json(502, { ok: false, error: 'send' });
  }

  // ---- Schritt 1: Anmeldung anfordern ----
  if (data.website) return json(200, { ok: true });   // Honeypot: stiller Erfolg, nichts senden

  const email = String(data.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json(400, { ok: false, error: 'email' });
  if (data.consent !== true) return json(400, { ok: false, error: 'consent' });

  const ip = (event.headers && (event.headers['cf-connecting-ip'] || event.headers['x-forwarded-for'])) || '';
  const verdict = await verifyTurnstile(data.token, ip);
  if (verdict !== 'pass') return json(400, { ok: false, error: verdict === 'error' ? 'captcha-unavailable' : 'captcha' });

  const ui = ['bg', 'en', 'de'].includes(data.ui) ? data.ui : 'en';      // Sprache der Bestaetigungsmail
  const issue = ['de', 'en'].includes(data.issue) ? data.issue : 'en';   // gewuenschte Sprache des Briefings
  const url = BASE + '?c=' + sign({ e: email, i: issue, l: ui, t: Date.now() });

  try {
    const res = await brevo('/smtp/email', 'POST', {
      sender: SENDER, replyTo: REPLY_TO, to: [{ email }],
      subject: MAIL[ui][0], htmlContent: mailHtml(ui, url),
    });
    if (res.ok) return json(200, { ok: true });
    console.error('briefing DOI mail rejected', res.status, (await res.text()).slice(0, 300));
  } catch (e) { console.error('briefing DOI mail threw', (e && e.message) || String(e)); }
  return json(502, { ok: false, error: 'send' });
};
