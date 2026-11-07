// TMDB image gallery via Vercel. Token never leaves the server.
export default async function handler(req, res) {
  const type = req.query?.type === 'movie' ? 'movie' : 'tv';
  const id = String(req.query?.id || '');
  if (!/^[1-9][0-9]{0,9}$/.test(id)) return res.status(400).json({ error: 'Invalid media ID', posters: [] });
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) return res.status(503).json({ error: 'TMDB_NOT_CONFIGURED', posters: [] });
  try {
    const url = new URL('https://api.themoviedb.org/3/' + type + '/' + id + '/images');
    url.searchParams.set('include_image_language', 'ko,en,null');
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return res.status(502).json({ error: 'TMDB image fetch failed', posters: [] });
    const data = await response.json();
    const posters = (data.posters || []).filter(x => /^\/[A-Za-z0-9_.-]+\.(jpg|png|webp)$/.test(x.file_path)).slice(0, 40).map(x => ({
      file_path: x.file_path, language: x.iso_639_1 || null
    }));
    return res.status(200).json({ posters });
  } catch {
    return res.status(502).json({ error: 'Gallery unavailable', posters: [] });
  }
}
