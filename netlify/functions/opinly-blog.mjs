import { createOpinlyClient } from '@opinly/backend';
import { renderToHtml, buildMetadata, buildBlogPostingJsonLd } from '@opinly/shared';

const SITE_URL = 'https://supportflow.work';
const config = {
  imagesPrefix: '/images',
  siteUrl: SITE_URL,
  blogPrefix: '/blog',
  siteName: 'SupportFlow™',
};

const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');

function shell({ title, description, canonical, ogType = 'website', ogImage, publishedTime, modifiedTime, jsonLd, body, status = 200 }) {
  const headImage = ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : '';
  const articleMeta = ogType === 'article' ? `${publishedTime ? `<meta property="article:published_time" content="${esc(publishedTime)}">` : ''}${modifiedTime ? `<meta property="article:modified_time" content="${esc(modifiedTime)}">` : ''}` : '';
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description || '')}"><link rel="canonical" href="${esc(canonical)}"><meta name="robots" content="index, follow, max-image-preview:large"><meta property="og:site_name" content="SupportFlow™"><meta property="og:type" content="${esc(ogType)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description || '')}"><meta property="og:url" content="${esc(canonical)}">${headImage}${articleMeta}${jsonLd ? `<script type="application/ld+json">${json(jsonLd)}</script>` : ''}<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet"><style>${styles}</style><script async src="https://static.opinly.ai/p.js" data-key="pk-pVWKMw6xUXs-YzPdRZqZLUbtqJIuabWyzvBWFKY"></script></head><body><header><a class="brand" href="/"><div class="seal">S</div><div class="wordmark">SupportFlow</div></a><nav><a href="/blog">Blog</a><a href="/ndis-support-worker-invoice-template">Invoice Guide</a><a href="/pricing">Pricing</a><a class="navcta" href="/app">Open App</a></nav></header>${body}<footer><div class="footer-row"><strong>SupportFlow™ &mdash; Built in South Australia</strong><div class="footer-links"><a href="/blog">Blog</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Use</a></div></div><small>Independent admin tool, not affiliated with or endorsed by the NDIA or NDIS. General information only, not tax or legal advice.</small></footer></body></html>`
  };
}

const styles = `:root{--ink:#12140E;--ink-2:#1A1D15;--ink-3:#22261C;--brass:#C8913A;--brass-lift:#E0A83F;--paper:#F2EFE4;--muted:#8B8E82;--muted-2:#9A9D90;--line:#2A2D23;--good:#5E9E77}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--ink);color:var(--paper);font-family:'Instrument Sans',ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.65}
a{color:inherit}
/* ── header ── */
header{height:72px;padding:0 max(22px,calc((100vw - 1120px)/2));display:flex;align-items:center;justify-content:space-between;background:rgba(18,20,14,.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10}
.brand{text-decoration:none;display:flex;align-items:center;gap:11px}
.seal{width:32px;height:32px;border-radius:9px;background:linear-gradient(148deg,var(--brass-lift),var(--brass));display:grid;place-items:center;font-family:'Fraunces',serif;font-size:16px;color:#14150F}
.wordmark{font-size:12.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);font-weight:600}
nav{display:flex;align-items:center;gap:22px}
nav a{text-decoration:none;font-size:13.5px;color:var(--muted);transition:color .16s}
nav a:hover{color:var(--brass-lift)}
.navcta{padding:9px 18px;font-size:13px;font-weight:600;border-radius:11px;background:var(--brass);color:#14150F!important;transition:background .16s}
.navcta:hover{background:var(--brass-lift)!important}
/* ── content ── */
.wrap{max-width:900px;margin:0 auto;padding:clamp(48px,7vw,80px) 24px clamp(60px,9vw,100px)}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--brass);font-size:12px;font-weight:600;margin-bottom:14px}
.hero h1,.post h1{font-family:'Fraunces',Georgia,serif;font-weight:300;line-height:1.06;color:var(--paper);font-size:clamp(38px,6vw,64px);margin:10px 0 18px;letter-spacing:-.03em}
.lede{font-size:18px;color:var(--muted);max-width:640px;line-height:1.65}
/* ── card grid ── */
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:clamp(36px,5vw,52px)}
.card{background:var(--ink-2);border:1px solid var(--line);border-radius:18px;padding:26px;text-decoration:none;display:block;transition:border-color .18s}
.card:hover{border-color:rgba(200,145,58,.55)}
.card h2{font-family:'Fraunces',Georgia,serif;font-size:24px;line-height:1.18;margin:10px 0 10px;font-weight:400;color:var(--paper)}
.card p{color:var(--muted);margin:0;font-size:14px;line-height:1.65}
.date{font-size:12px;color:var(--muted-2)}
/* ── pager ── */
.pager{display:flex;justify-content:center;margin-top:clamp(28px,4vw,42px)}
.button{display:inline-block;background:var(--ink-2);border:1px solid var(--line);color:var(--paper);padding:12px 22px;border-radius:11px;text-decoration:none;font-size:14px;font-weight:600;transition:border-color .18s}
.button:hover{border-color:var(--brass)}
/* ── post ── */
.post{max-width:780px}
.post .meta{color:var(--muted-2);margin-bottom:clamp(24px,4vw,36px);font-size:13px}
.back{display:inline-flex;align-items:center;gap:7px;margin-bottom:28px;color:var(--brass);text-decoration:none;font-size:14px;font-weight:600}
.back:hover{color:var(--brass-lift)}
.content{font-size:17px;color:var(--paper);line-height:1.72}
.content h2,.content h3{font-family:'Fraunces',Georgia,serif;font-weight:400;line-height:1.18;margin-top:2em;color:var(--paper)}
.content h2{font-size:32px}
.content h3{font-size:24px}
.content p{color:var(--muted-2);margin:1em 0}
.content p:first-of-type{color:var(--muted)}
.content img{max-width:100%;height:auto;border-radius:14px;border:1px solid var(--line)}
.content a{color:var(--brass-lift);text-underline-offset:3px}
.content blockquote{border-left:3px solid var(--brass);margin-left:0;padding-left:20px;color:var(--muted)}
.content table{width:100%;border-collapse:collapse;display:block;overflow:auto}
.content th,.content td{border:1px solid var(--line);padding:9px 12px;font-size:15px}
.content th{background:var(--ink-2);color:var(--paper)}
.content td{color:var(--muted-2)}
/* ── error ── */
.error{text-align:center;padding:90px 24px}
.error h1{font-family:'Fraunces',serif;font-weight:300;font-size:clamp(36px,6vw,56px);margin-bottom:14px}
.error p{color:var(--muted);margin-bottom:28px}
.error a{display:inline-block;padding:13px 24px;background:var(--brass);color:#14150F;font-weight:700;border-radius:11px;text-decoration:none}
/* ── footer ── */
footer{background:var(--ink-2);border-top:1px solid var(--line);padding:clamp(30px,4vw,42px) max(22px,calc((100vw - 1120px)/2));display:flex;flex-direction:column;gap:14px}
.footer-row{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
footer strong{color:var(--muted);font-weight:600;font-size:13px}
.footer-links{display:flex;gap:18px;flex-wrap:wrap}
.footer-links a{color:var(--brass);text-decoration:none;font-size:13px;font-weight:600}
.footer-links a:hover{color:var(--brass-lift)}
footer small{color:var(--muted-2);font-size:12px;line-height:1.65}
@media(max-width:680px){.grid{grid-template-columns:1fr}.wrap{padding-top:40px}.hero h1,.post h1{font-size:40px}nav .navcta{display:none}}`;

function dateLabel(v) {
  if (!v) return '';
  try { return new Intl.DateTimeFormat('en-AU', { day:'numeric', month:'long', year:'numeric' }).format(new Date(v)); } catch { return ''; }
}

export async function handler(event) {
  let opinly;
  try {
    opinly = createOpinlyClient({
      apiKey: process.env.OPINLY_API_KEY || process.env.VITE_OPINLY_API_KEY,
      site: config,
    });
  } catch (e) {
    return shell({ title:'Blog unavailable | SupportFlow™', description:'SupportFlow™ blog', canonical:`${SITE_URL}/blog`, body:`<main class="error"><h1>Blog unavailable</h1><p>The blog connection has not been configured yet.</p><a class="button" href="/">Return home</a></main>`, status:503 });
  }

  const slug = (event.queryStringParameters?.slug || '').replace(/^\/+|\/+$/g, '');
  try {
    if (!slug) {
      const cursor = event.queryStringParameters?.cursor || undefined;
      const list = await opinly.posts({ limit: 12, ...(cursor ? { cursor } : {}) });
      const cards = (list.data || []).map(p => `<a class="card" href="/blog/${encodeURIComponent(p.slug)}"><span class="date">${esc(dateLabel(p.firstPublishedAt || p.publishedAt))}</span><h2>${esc(p.title)}</h2><p>${esc(p.description || '')}</p></a>`).join('');
      const next = list.next_cursor ? `<div class="pager"><a class="button" href="/blog?cursor=${encodeURIComponent(list.next_cursor)}">More articles</a></div>` : '';
      return shell({ title:'NDIS Support Worker Blog | SupportFlow', description:'Practical guides for independent Australian NDIS support workers covering admin, records, invoicing, notes, kilometres and running your support-work business.', canonical:`${SITE_URL}/blog`, body:`<main class="wrap hero"><div class="eyebrow">SupportFlow resources</div><h1>Support worker guides</h1><p class="lede">Practical information for independent Australian NDIS support workers.</p>${cards ? `<section class="grid" aria-label="Blog articles">${cards}</section>${next}` : `<section class="error"><h2>No articles yet</h2><p>New SupportFlow resources will appear here when published.</p></section>`}</main>` });
    }

    if (slug.includes('/')) return shell({ title:'Page not found | SupportFlow™', description:'Page not found', canonical:`${SITE_URL}/blog`, body:`<main class="error"><h1>Page not found</h1><a class="button" href="/blog">Back to blog</a></main>`, status:404 });
    const post = await opinly.post(slug);
    if (!post) return shell({ title:'Article not found | SupportFlow™', description:'Article not found', canonical:`${SITE_URL}/blog/${encodeURIComponent(slug)}`, body:`<main class="error"><h1>Article not found</h1><a class="button" href="/blog">Back to blog</a></main>`, status:404 });

    const resolved = { type: 'post', data: post };
    const meta = buildMetadata(resolved, config);
    const structured = buildBlogPostingJsonLd(post, config);
    const content = renderToHtml(post.content, { config });
    const canonical = meta.canonicalUrl || `${SITE_URL}/blog/${encodeURIComponent(post.slug)}`;
    return shell({
      title: meta.title || post.metaTitle || `${post.title} | SupportFlow™`,
      description: meta.description || post.metaDescription || post.description || '',
      canonical,
      ogType: meta.ogType || 'article',
      ogImage: meta.ogImage,
      publishedTime: meta.publishedTime || post.firstPublishedAt,
      modifiedTime: meta.modifiedTime || post.modifiedAt,
      jsonLd: structured,
      body:`<main class="wrap post"><a class="back" href="/blog">← All articles</a><article><div class="eyebrow">SupportFlow guide</div><h1>${esc(post.title)}</h1><div class="meta">${esc(dateLabel(post.firstPublishedAt))}${post.author?.name ? ` · ${esc(post.author.name)}` : ''}</div><div class="content">${content}</div></article></main>`
    });
  } catch (e) {
    console.error('Opinly blog error', e);
    return shell({ title:'Blog temporarily unavailable | SupportFlow™', description:'SupportFlow™ blog', canonical:`${SITE_URL}/blog${slug ? `/${encodeURIComponent(slug)}` : ''}`, body:`<main class="error"><h1>Temporarily unavailable</h1><p>We couldn't load the blog right now. Please try again shortly.</p><a class="button" href="/">Return home</a></main>`, status:500 });
  }
}
