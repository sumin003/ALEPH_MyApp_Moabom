// Vercel Serverless Function. Keep TMDB_READ_TOKEN in Vercel environment variables only.
export default async function handler(req, res) {
  const q = String(req.query?.q || '').trim();
  const type = req.query?.type === 'movie' ? 'movie' : 'tv';
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600');
  if (!q || q.length > 100) return res.status(400).json({ error: 'Invalid search query', results: [] });
  const page = Number(req.query?.page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) return res.status(400).json({error:'Invalid page',results:[]});
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) return res.status(503).json({ error: 'TMDB_NOT_CONFIGURED', results: [] });
  try {
    const url = new URL('https://api.themoviedb.org/3/search/' + type);
    url.searchParams.set('query', q);
    url.searchParams.set('language', 'ko-KR');
    url.searchParams.set('include_adult', 'false');
    url.searchParams.set('page', String(page));
    const upstream = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) return res.status(502).json({ error: 'TMDB search failed', results: [] });
    const data = await upstream.json();
    const results = (data.results || []).slice(0, 20).map(x => ({
      id: x.id, title: x.title, name: x.name, original_name: x.original_name,
      poster_path: x.poster_path, release_date: x.release_date, first_air_date: x.first_air_date,
      overview: String(x.overview || '').slice(0, 1600), genre_ids: (x.genre_ids || []).slice(0, 8),
      original_title: x.original_title, original_language: x.original_language
    }));
    return res.status(200).json({ results, page, total_pages:Math.min(500,Number(data.total_pages)||1) });
  } catch {
    return res.status(502).json({ error: 'Upstream unavailable', results: [] });
  }
}
