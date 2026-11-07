// Public catalog metadata only. Album covers remain linked to the provider.
const cache = new Map();
const pending = new Map();
const norm = text => String(text || '').normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s\p{P}\p{S}]+/gu,'');
const cut = (text,n=180) => String(text||'').slice(0,n);
const searchHeader = {'User-Agent':'Moabom/2 (https://github.com/sumin003/ALEPH_My_App_Project)',Accept:'application/json'};

async function json(url,headers={}) {
  const res=await fetch(url,{headers,signal:AbortSignal.timeout(7500)});
  if(!res.ok) throw Error('Catalog unavailable');
  return res.json();
}
async function recordings(term) {
  const url=new URL('https://musicbrainz.org/ws/2/recording/');
  url.search=new URLSearchParams({query:term,fmt:'json',limit:35,dismax:true});
  const data=await json(url,searchHeader);
  return (data.recordings||[]).filter(x=>x.title&&x.id).map(x=>{
    const release=x.releases?.[0];
    const artist=(x['artist-credit']||[]).map(a=>typeof a==='string'?a:(a.name||a.artist?.name||'')+(a.joinphrase||'')).join('');
    return {id:x.id,title:cut(x.title),artist:cut(artist),album:cut(release?.title),year:cut(release?.date,4),poster:'',source:'MusicBrainz',link:'https://musicbrainz.org/recording/'+x.id};
  });
}
async function apple(term,country) {
  const url=new URL('https://itunes.apple.com/search');
  url.search=new URLSearchParams({term,country,entity:'song',media:'music',limit:40});
  const data=await json(url);
  return (data.results||[]).filter(x=>x.trackId&&x.kind==='song'&&x.trackName).map(x=>{
    const art=x.artworkUrl100||'';
    return {id:'apple:'+x.trackId,title:cut(x.trackName),artist:cut(x.artistName),album:cut(x.collectionName),year:cut(x.releaseDate,4),
      poster:/^https:\/\/[^/]+\.mzstatic\.com\//i.test(art)?art.replace(/100x100bb\./,'300x300bb.'):'',
      source:'Apple Music',link:x.trackViewUrl||x.collectionViewUrl||''};
  });
}
function relevance(item,query) {
  const title=norm(item.title), artist=norm(item.artist), key=norm(query);
  if(title===key) return 100;
  if(artist===key) return 95;
  if([title+artist,artist+title].includes(key)) return 98;
  if(title.startsWith(key)) return 85;
  const both=title+artist+norm(item.album);
  if(query.split(/\s+/).every(t=>both.includes(norm(t)))) return 70;
  // Providers can match a Korean alias and return the international artist name.
  return 10;
}
async function search(query) {
  const tasks=[recordings(query),apple(query,'US')];
  if(/[가-힣]/.test(query)) tasks.push(apple(query,'KR'));
  const sources=await Promise.allSettled(tasks);
  const available=sources.filter(s=>s.status==='fulfilled');
  if(!available.length) throw Error('음악 검색처에 연결할 수 없어요.');
  const merged=new Map();
  for(const entry of available.flatMap(s=>s.value)){
    const key=norm(entry.title)+'|'+norm(entry.artist)+'|'+norm(entry.album);
    const previous=merged.get(key);
    if(!previous || (!previous.poster && entry.poster)) merged.set(key,entry);
  }
  const results=[...merged.values()].sort((a,b)=>relevance(b,query)-relevance(a,query)||Number(!!b.poster)-Number(!!a.poster)).slice(0,35);
  if(!results.length && available.length!==sources.length) throw Error('일부 음악 검색처의 응답이 늦어요. 잠시 후 다시 검색해 주세요.');
  return {results,partial:available.length!==sources.length};
}
export default async function handler(req,res) {
  if(req.method!=='GET')return res.status(405).json({error:'GET 요청만 가능해요.'});
  const q=String(req.query?.q||'').trim().replace(/\s+/g,' ');
  if(!q||q.length>100)return res.status(400).json({error:'검색어는 1~100자로 입력해 주세요.'});
  const key=q.normalize('NFKC').toLocaleLowerCase('ko');
  try {
    const stored=cache.get(key);
    if(stored && stored.until>Date.now())return res.status(200).json(stored.data);
    if(!pending.has(key))pending.set(key,search(q).finally(()=>pending.delete(key)));
    const data=await pending.get(key);
    if(cache.size>=120)cache.delete(cache.keys().next().value);
    cache.set(key,{until:Date.now()+(data.partial?30000:300000),data});
    res.setHeader('Cache-Control',data.partial?'private, max-age=20':'public, max-age=60, s-maxage=300');
    return res.status(200).json(data);
  } catch {
    res.setHeader('Cache-Control','no-store');
    return res.status(502).json({error:'음악 검색처에 연결하지 못했어요. 다시 검색하거나 직접 입력하세요.',results:[]});
  }
}
