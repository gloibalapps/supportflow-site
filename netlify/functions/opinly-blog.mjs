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
    body: `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description || '')}"><link rel="canonical" href="${esc(canonical)}"><meta name="robots" content="index, follow, max-image-preview:large"><meta property="og:site_name" content="SupportFlow™"><meta property="og:type" content="${esc(ogType)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description || '')}"><meta property="og:url" content="${esc(canonical)}">${headImage}${articleMeta}${jsonLd ? `<script type="application/ld+json">${json(jsonLd)}</script>` : ''}<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet"><style>${styles}</style><script async src="https://static.opinly.ai/p.js" data-key="pk-pVWKMw6xUXs-YzPdRZqZLUbtqJIuabWyzvBWFKY"></script></head><body><header><a class="brand" href="/">NDIS <span>SupportFlow</span></a><nav><a href="/blog">Blog</a><a href="/">Home</a></nav></header>${body}<footer><strong>SupportFlow™</strong><span>Built in South Australia</span><div><a href="/blog">Blog</a> · <a href="/privacy">Privacy Policy</a></div><small>Independent admin tool, not affiliated with or endorsed by the NDIA or NDIS.<br>General information only, not tax or legal advice.</small></footer></body></html>`
  };
}

const styles = `:root{--ink:#12140E;--paper:#F2EFE4;--brass:#C8913A;--muted:#74786d;--line:#dedbcf}*{box-sizing:border-box}body{margin:0;background:#f7f5ee;color:#1b1d18;font-family:'Instrument Sans',system-ui,sans-serif;line-height:1.65}a{color:inherit}header{height:72px;padding:0 max(22px,calc((100vw - 1120px)/2));display:flex;align-items:center;justify-content:space-between;background:var(--ink);color:var(--paper);position:sticky;top:0;z-index:10}.brand{text-decoration:none;font-weight:600;letter-spacing:.02em}.brand span{color:var(--brass)}nav{display:flex;gap:22px}nav a{text-decoration:none;font-size:14px}.wrap{max-width:900px;margin:0 auto;padding:64px 24px 90px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:#8a6328;font-size:12px;font-weight:600}.hero h1,.post h1{font-family:'Fraunces',serif;font-weight:400;line-height:1.08;color:var(--ink);font-size:clamp(40px,7vw,68px);margin:10px 0 18px}.lede{font-size:19px;color:#5f6359;max-width:720px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:44px}.card{background:white;border:1px solid var(--line);border-radius:18px;padding:25px;text-decoration:none;display:block}.card:hover{border-color:#c9a56c}.card h2{font-family:'Fraunces',serif;font-size:28px;line-height:1.15;margin:8px 0 10px}.card p{color:#65695f;margin:0}.date{font-size:13px;color:#85897f}.pager{display:flex;justify-content:center;margin-top:34px}.button{display:inline-block;background:var(--ink);color:var(--paper);padding:11px 18px;border-radius:999px;text-decoration:none}.post{max-width:780px}.post .meta{color:#777b70;margin-bottom:34px}.content{font-size:17px}.content h2,.content h3{font-family:'Fraunces',serif;font-weight:500;line-height:1.2;margin-top:2em}.content h2{font-size:34px}.content h3{font-size:26px}.content img{max-width:100%;height:auto;border-radius:14px}.content a{color:#7c561e}.content blockquote{border-left:3px solid var(--brass);margin-left:0;padding-left:20px;color:#5e6258}.content table{width:100%;border-collapse:collapse;display:block;overflow:auto}.content th,.content td{border:1px solid var(--line);padding:9px 12px}.back{display:inline-block;margin-bottom:25px;color:#6f542a}.error{text-align:center;padding:90px 24px}footer{background:var(--ink);color:var(--paper);padding:42px max(22px,calc((100vw - 1120px)/2));display:grid;gap:8px}footer span,footer small{color:#a7aa9e}footer a{color:#d5b47c}@media(max-width:680px){.grid{grid-template-columns:1fr}.wrap{padding-top:42px}.hero h1,.post h1{font-size:42px}}`;

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
