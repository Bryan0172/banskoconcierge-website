/**
 * Bansko Concierge – Arvow Webhook Handler
 * ─────────────────────────────────────────
 * Receives a POST from Arvow when a new article is published.
 * Creates the article HTML, pushes it to GitHub, and updates posts.json.
 * Netlify auto-deploys from GitHub → article is live in ~60 seconds.
 *
 * Required Netlify environment variables:
 *   GITHUB_TOKEN  – Personal Access Token with repo write access
 *   GITHUB_REPO   – e.g. "Bryan0172/banskoconcierge-website"
 *   ARVOW_SECRET  – Optional: secret key to validate webhook source
 */

const GITHUB_API = 'https://api.github.com';
const BRANCH     = 'main';

// ── GitHub helper ────────────────────────────────────────────────────────────

async function githubRequest(path, method, body, token, repo) {
  const url = `${GITHUB_API}/repos/${repo}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function getFileSHA(path, token, repo) {
  try {
    const data = await githubRequest(`/contents/${path}?ref=${BRANCH}`, 'GET', null, token, repo);
    return data.sha;
  } catch {
    return null; // file does not exist yet
  }
}

async function pushFile(filePath, content, commitMsg, token, repo) {
  const sha = await getFileSHA(filePath, token, repo);
  const body = {
    message: commitMsg,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  return githubRequest(`/contents/${filePath}`, 'PUT', body, token, repo);
}

// ── Slug generator ───────────────────────────────────────────────────────────

function toSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// ── Article HTML template ────────────────────────────────────────────────────

function buildArticleHTML({ slug, title, content, metadescription, thumbnail, thumbnail_alt_text, keyword_seed, publishDate }) {
  const canonicalUrl = `https://www.banskoconcierge.com/blog/${slug}.html`;
  const heroImg = thumbnail
    ? `<img src="${thumbnail}" alt="${thumbnail_alt_text || title}" style="width:100%;height:320px;object-fit:cover;display:block;">`
    : `<div style="width:100%;height:240px;background:linear-gradient(135deg,#0d1b3e 0%,#1a3a6e 50%,#0A0E27 100%);display:flex;align-items:center;justify-content:center;font-size:3rem;">✦</div>`;

  const dateFormatted = new Date(publishDate).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} | Bansko Concierge</title>
  <meta name="description" content="${metadescription || ''}"/>
  <meta property="og:title" content="${title}"/>
  <meta property="og:description" content="${metadescription || ''}"/>
  ${thumbnail ? `<meta property="og:image" content="${thumbnail}"/>` : ''}
  <meta property="og:url" content="${canonicalUrl}"/>
  <link rel="canonical" href="${canonicalUrl}"/>
  <meta name="theme-color" content="#0A0E27"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet"/>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Article","headline":"${title.replace(/"/g,'&quot;')}","description":"${(metadescription||'').replace(/"/g,'&quot;')}","author":{"@type":"Person","name":"Andreas Donner"},"publisher":{"@type":"Organization","name":"Bansko Concierge VIP","url":"https://www.banskoconcierge.com"},"datePublished":"${publishDate}","url":"${canonicalUrl}"}
  </script>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--navy:#0A0E27;--navy-mid:#141830;--navy-lt:#1E2340;--gold:#C9A96E;--gold-lt:#E8D5B0;--white:#F8F6F0;--grey:#9A9A9A;--font-sans:'Inter',sans-serif;--font-serif:'Playfair Display',serif;--radius:4px;--transition:0.35s ease;--max-w:1200px}
    html{scroll-behavior:smooth;font-size:16px}
    body{font-family:var(--font-sans);background:var(--navy);color:var(--white);line-height:1.6;overflow-x:hidden}
    a{color:inherit;text-decoration:none}
    img{display:block;max-width:100%}
    ul{list-style:none}
    .container{max-width:var(--max-w);margin:0 auto;padding:0 24px}
    .btn{display:inline-flex;align-items:center;gap:10px;padding:14px 28px;border:1px solid var(--gold);border-radius:var(--radius);font-size:13px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;transition:var(--transition);cursor:pointer}
    .btn--gold{background:var(--gold);color:var(--navy)}.btn--gold:hover{background:var(--gold-lt)}
    .btn--outline{color:var(--white)}.btn--outline:hover{background:rgba(201,169,110,0.1)}
    .divider{width:48px;height:1px;background:var(--gold);margin:24px 0}
    .label{font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);margin-bottom:16px;display:block}
    /* NAV */
    .nav{position:fixed;top:0;left:0;right:0;z-index:1000;padding:20px 0;transition:background var(--transition),padding var(--transition)}
    .nav.scrolled{background:rgba(10,14,39,0.95);backdrop-filter:blur(12px);padding:14px 0;border-bottom:1px solid rgba(201,169,110,0.15)}
    .nav__inner{display:flex;align-items:center;justify-content:space-between}
    .nav__logo{display:flex;flex-direction:column;gap:2px}
    .nav__logo-main{font-family:var(--font-serif);font-size:1.25rem;font-weight:600;color:var(--white)}
    .nav__logo-sub{font-size:9px;letter-spacing:0.22em;text-transform:uppercase;color:var(--gold)}
    .nav__links{display:flex;align-items:center;gap:36px}
    .nav__links a{font-size:13px;letter-spacing:0.04em;color:rgba(248,246,240,0.8);transition:color var(--transition)}
    .nav__links a:hover,.nav__links a.active{color:var(--gold)}
    .nav__cta{display:flex;align-items:center;gap:12px}
    .nav__wa{display:flex;align-items:center;gap:8px;padding:10px 20px;background:var(--gold);border-radius:var(--radius);font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--navy);transition:var(--transition)}
    .nav__wa:hover{background:var(--gold-lt)}
    .nav__hamburger{display:none;flex-direction:column;gap:5px;background:none;border:none;cursor:pointer;padding:4px}
    .nav__hamburger span{display:block;width:24px;height:1.5px;background:var(--white)}
    .nav__mobile{position:fixed;inset:0;background:var(--navy);z-index:1100;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;transform:translateX(100%);transition:transform 0.4s ease}
    .nav__mobile.open{transform:translateX(0)}
    .nav__mobile a{font-family:var(--font-serif);font-size:2rem;color:var(--white);transition:color var(--transition)}
    .nav__mobile a:hover{color:var(--gold)}
    .nav__mobile-close{position:absolute;top:24px;right:24px;background:none;border:none;color:var(--white);font-size:1.5rem;cursor:pointer}
    .nav__mobile-wa{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:var(--gold);border-radius:var(--radius);font-size:14px;font-weight:600;color:var(--navy)!important;letter-spacing:0.08em;text-transform:uppercase;margin-top:8px}
    /* ARTICLE HERO */
    .article-hero{padding:140px 0 64px;background:var(--navy-mid);border-bottom:1px solid rgba(201,169,110,0.12)}
    .article-hero__inner{max-width:780px}
    .article-hero__cat{font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);margin-bottom:20px;display:flex;align-items:center;gap:16px}
    .article-hero__cat a{color:var(--gold);opacity:0.7}
    .article-hero__cat a:hover{opacity:1}
    .article-hero__cat span{opacity:0.4}
    .article-hero__title{font-family:var(--font-serif);font-size:clamp(2rem,4vw,3.2rem);font-weight:400;line-height:1.2;margin-bottom:24px}
    .article-hero__meta{display:flex;align-items:center;gap:24px;font-size:12px;color:rgba(248,246,240,0.4);letter-spacing:0.04em;flex-wrap:wrap}
    .article-hero__author{display:flex;align-items:center;gap:10px}
    .article-hero__avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--gold),#8a6a3a);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:var(--navy);flex-shrink:0}
    /* ARTICLE BODY */
    .article-layout{display:grid;grid-template-columns:1fr 320px;gap:64px;padding:72px 0 120px;align-items:start}
    .article-body{max-width:720px}
    .article-body h2{font-family:var(--font-serif);font-size:1.8rem;font-weight:400;margin:48px 0 16px;color:var(--white)}
    .article-body h3{font-family:var(--font-serif);font-size:1.35rem;font-weight:400;margin:32px 0 12px;color:var(--gold-lt)}
    .article-body p{font-size:1rem;line-height:1.8;color:rgba(248,246,240,0.85);margin-bottom:20px}
    .article-body ul,.article-body ol{margin:16px 0 24px;padding-left:0}
    .article-body li{font-size:1rem;line-height:1.7;color:rgba(248,246,240,0.8);margin-bottom:8px;padding-left:20px;position:relative}
    .article-body ul li::before{content:'–';position:absolute;left:0;color:var(--gold)}
    .article-body ol{counter-reset:list}
    .article-body ol li{counter-increment:list}
    .article-body ol li::before{content:counter(list) '.';color:var(--gold);font-weight:600}
    .article-body a{color:var(--gold);text-decoration:underline;text-underline-offset:3px}
    .article-body a:hover{color:var(--gold-lt)}
    .article-body strong{color:var(--white);font-weight:600}
    .article-body table{width:100%;border-collapse:collapse;margin:28px 0;font-size:0.9rem}
    .article-body table th{background:var(--navy-lt);color:var(--gold);font-size:11px;letter-spacing:0.1em;text-transform:uppercase;padding:12px 14px;text-align:left;border-bottom:1px solid rgba(201,169,110,0.2)}
    .article-body table td{padding:12px 14px;border-bottom:1px solid rgba(201,169,110,0.07);color:rgba(248,246,240,0.8);vertical-align:top}
    .article-body table tr:nth-child(even) td{background:rgba(30,35,64,0.4)}
    .article-body blockquote{border-left:3px solid var(--gold);padding:20px 28px;margin:36px 0;background:rgba(201,169,110,0.06);border-radius:0 var(--radius) var(--radius) 0}
    .article-body blockquote p{font-family:var(--font-serif);font-size:1.15rem;line-height:1.6;color:var(--gold-lt);font-style:italic;margin:0}
    .article-body img{width:100%;border-radius:var(--radius);margin:24px 0}
    /* SIDEBAR */
    .article-sidebar{position:sticky;top:100px}
    .sidebar-card{background:var(--navy-lt);border:1px solid rgba(201,169,110,0.15);border-radius:var(--radius);padding:28px;margin-bottom:24px}
    .sidebar-card__title{font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--gold);margin-bottom:16px}
    .sidebar-cta{background:linear-gradient(135deg,var(--navy-lt),rgba(201,169,110,0.08));border:1px solid rgba(201,169,110,0.25);border-radius:var(--radius);padding:28px;text-align:center}
    .sidebar-cta h4{font-family:var(--font-serif);font-size:1.1rem;margin-bottom:10px}
    .sidebar-cta p{font-size:0.8rem;color:var(--grey);margin-bottom:20px;line-height:1.6}
    .sidebar-cta .btn{width:100%;justify-content:center;font-size:12px;padding:12px 20px}
    /* FOOTER */
    .footer{background:var(--navy-mid);border-top:1px solid rgba(201,169,110,0.12);padding:60px 0 40px}
    .footer__bottom{border-top:1px solid rgba(201,169,110,0.1);padding-top:28px;display:flex;justify-content:space-between;align-items:center;margin-top:40px}
    .footer__copy{font-size:0.8rem;color:rgba(248,246,240,0.3)}
    .footer__legal{display:flex;gap:24px}
    .footer__legal a{font-size:0.8rem;color:rgba(248,246,240,0.3)}
    .footer__legal a:hover{color:var(--white)}
    .footer__back{font-size:0.875rem;color:rgba(248,246,240,0.5);transition:color var(--transition)}
    .footer__back:hover{color:var(--gold)}
    /* WA STICKY */
    .wa-sticky{position:fixed;bottom:28px;right:28px;z-index:900;border-radius:50%;box-shadow:0 4px 20px rgba(0,0,0,0.35);transition:var(--transition)}
    .wa-sticky__btn{width:56px;height:56px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center}
    .wa-sticky:hover{box-shadow:0 6px 32px rgba(37,211,102,0.55)}
    @media(max-width:1024px){.nav__links{display:none}.nav__hamburger{display:flex}.nav__wa{display:none}.article-layout{grid-template-columns:1fr}.article-sidebar{position:static}}
    @media(max-width:768px){.article-hero{padding:120px 0 48px}.footer__bottom{flex-direction:column;gap:16px;text-align:center}}
  </style>
</head>
<body>
  <nav class="nav" id="nav">
    <div class="container">
      <div class="nav__inner">
        <a href="/" class="nav__logo"><span class="nav__logo-main">Bansko Concierge</span><span class="nav__logo-sub">VIP · Balkan Corridor</span></a>
        <ul class="nav__links">
          <li><a href="/#services">Services</a></li>
          <li><a href="/#packages">Packages</a></li>
          <li><a href="/#coverage">Coverage</a></li>
          <li><a href="/blog.html" class="active">Blog</a></li>
          <li><a href="/#contact">Contact</a></li>
        </ul>
        <div class="nav__cta">
          <a href="https://wa.me/359895762785" target="_blank" rel="noopener" class="nav__wa">WhatsApp</a>
          <button class="nav__hamburger" id="hamburger"><span></span><span></span><span></span></button>
        </div>
      </div>
    </div>
  </nav>
  <div class="nav__mobile" id="mobileMenu">
    <button class="nav__mobile-close" id="mobileClose">✕</button>
    <a href="/#services" onclick="closeMobileMenu()">Services</a>
    <a href="/#packages" onclick="closeMobileMenu()">Packages</a>
    <a href="/#coverage" onclick="closeMobileMenu()">Coverage</a>
    <a href="/blog.html" onclick="closeMobileMenu()">Blog</a>
    <a href="/#contact" onclick="closeMobileMenu()">Contact</a>
    <a href="https://wa.me/359895762785" target="_blank" class="nav__mobile-wa">WhatsApp us</a>
  </div>

  <header class="article-hero">
    <div class="container">
      <div class="article-hero__inner">
        <div class="article-hero__cat"><a href="/blog.html">Blog</a><span>/</span><span>Article</span></div>
        <h1 class="article-hero__title">${title}</h1>
        <div class="article-hero__meta">
          <div class="article-hero__author"><div class="article-hero__avatar">AD</div><span>Andreas Donner</span></div>
          <span>·</span><span>${dateFormatted}</span><span>·</span><span>Bansko Concierge VIP</span>
        </div>
      </div>
    </div>
  </header>

  <div class="container">
    <div class="article-layout">
      <article class="article-body">
        ${heroImg}
        ${content}
        <div style="margin-top:48px;background:var(--navy-lt);border:1px solid rgba(201,169,110,0.2);border-radius:4px;padding:28px 32px;">
          <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--gold);margin-bottom:12px;">Plan Your Balkan Experience</div>
          <p style="font-size:0.9rem;color:rgba(248,246,240,0.75);margin-bottom:20px;">Ready to experience the Balkans in style? Contact Bansko Concierge VIP directly — available 24/7 via WhatsApp.</p>
          <a href="https://wa.me/359895762785?text=Hello%2C%20I%20read%20your%20article%20and%20would%20like%20to%20enquire." target="_blank" class="btn btn--gold" style="font-size:13px;">WhatsApp +359 895 762 785</a>
        </div>
      </article>
      <aside class="article-sidebar">
        <div class="sidebar-cta">
          <h4>Book Your Experience</h4>
          <p>Private transfers, bespoke experiences and white-glove concierge across the Balkans.</p>
          <a href="https://wa.me/359895762785?text=Hello%2C%20I%20read%20your%20article%20and%20would%20like%20to%20enquire." target="_blank" class="btn btn--gold">WhatsApp Now</a>
          <p style="margin-top:12px;font-size:0.75rem;">+359 895 762 785</p>
        </div>
      </aside>
    </div>
  </div>

  <footer class="footer">
    <div class="container">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;padding-bottom:28px;border-bottom:1px solid rgba(201,169,110,0.1);">
        <div><div style="font-family:var(--font-serif);font-size:1.1rem;margin-bottom:4px;">Bansko Concierge VIP</div><div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);">The Balkan Corridor</div></div>
        <a href="/blog.html" class="footer__back">← Back to Blog</a>
      </div>
      <div class="footer__bottom">
        <div class="footer__copy">© 2026 Bansko Concierge VIP. All rights reserved.</div>
        <div class="footer__legal">
          <a href="https://sites.google.com/peak-care.com/legalimprint/startseite" target="_blank">Legal Imprint</a>
          <a href="https://sites.google.com/peak-care.com/privacy-policy/startseite" target="_blank">Privacy Policy</a>
        </div>
      </div>
    </div>
  </footer>

  <a href="https://wa.me/359895762785" target="_blank" rel="noopener" class="wa-sticky">
    <div class="wa-sticky__btn"><svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></div>
  </a>

  <script>
    const nav=document.getElementById('nav');
    window.addEventListener('scroll',()=>{nav.classList.toggle('scrolled',window.scrollY>60)},{passive:true});
    const hamburger=document.getElementById('hamburger');
    const mobileMenu=document.getElementById('mobileMenu');
    const mobileClose=document.getElementById('mobileClose');
    hamburger.addEventListener('click',()=>{mobileMenu.classList.add('open');document.body.style.overflow='hidden'});
    function closeMobileMenu(){mobileMenu.classList.remove('open');document.body.style.overflow=''}
    mobileClose.addEventListener('click',closeMobileMenu);
  </script>
</body>
</html>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO  = process.env.GITHUB_REPO || 'Bryan0172/banskoconcierge-website';
  const ARVOW_SECRET = process.env.ARVOW_SECRET; // optional

  if (!GITHUB_TOKEN) {
    console.error('GITHUB_TOKEN env var missing');
    return { statusCode: 500, body: 'Server misconfiguration' };
  }

  // Optional secret validation
  if (ARVOW_SECRET) {
    const incomingSecret = event.headers['x-arvow-secret'] || event.headers['authorization'];
    if (!incomingSecret || !incomingSecret.includes(ARVOW_SECRET)) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { title, content, content_markdown, thumbnail, thumbnail_alt_text, metadescription, keyword_seed, language_code } = payload;

  if (!title || !content) {
    return { statusCode: 400, body: 'Missing required fields: title, content' };
  }

  const slug        = toSlug(title);
  const publishDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filePath    = `blog/${slug}.html`;

  try {
    // 1. Build and push the article HTML
    const articleHTML = buildArticleHTML({
      slug, title, content, metadescription,
      thumbnail, thumbnail_alt_text, keyword_seed, publishDate,
    });

    await pushFile(
      filePath,
      articleHTML,
      `Add blog article: ${title.substring(0, 60)}`,
      GITHUB_TOKEN,
      GITHUB_REPO
    );

    // 2. Update posts.json
    let posts = [];
    try {
      const postsData = await githubRequest(`/contents/posts.json?ref=${BRANCH}`, 'GET', null, GITHUB_TOKEN, GITHUB_REPO);
      posts = JSON.parse(Buffer.from(postsData.content, 'base64').toString('utf8'));
    } catch {
      posts = [];
    }

    // Avoid duplicates
    const existing = posts.findIndex(p => p.slug === slug);
    const newEntry = {
      slug,
      title,
      excerpt: metadescription || content.replace(/<[^>]+>/g, '').substring(0, 160) + '…',
      category: keyword_seed ? keyword_seed.charAt(0).toUpperCase() + keyword_seed.slice(1) : 'Travel',
      emoji: '✦',
      gradient: 'linear-gradient(135deg,#0d1b3e 0%,#1a3a6e 50%,#0A0E27 100%)',
      date: publishDate,
      readTime: `${Math.max(3, Math.round(content.replace(/<[^>]+>/g, '').split(' ').length / 200))} min read`,
      thumbnail: thumbnail || null,
      featured: posts.length === 0,
    };

    if (existing >= 0) {
      posts[existing] = newEntry;
    } else {
      posts.unshift(newEntry); // newest first
    }

    await pushFile(
      'posts.json',
      JSON.stringify(posts, null, 2),
      `Update posts.json: add "${title.substring(0, 50)}"`,
      GITHUB_TOKEN,
      GITHUB_REPO
    );

    console.log(`✅ Published: /blog/${slug}.html`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, slug, url: `https://www.banskoconcierge.com/blog/${slug}.html` }),
    };

  } catch (err) {
    console.error('Webhook error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
