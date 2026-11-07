'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const KINDS = {drama:'드라마', movie:'영화', music:'음악', pair:'음악과 장면'};
  const STORAGE_KEY = 'moabom-guest-records-v1';
  const config = window.APP_CONFIG || {};
  const client = window.supabase?.createClient && config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY) : null;
  let user = null, records = [], publicRecords = [], viewDate = new Date(), calendarKind = 'all', selectedKind = 'drama', editingId = null, activeFilter = 'all', selectedDate = null, currentDetail = null, selectedTmdb = null, collectionMode = 'entries', authMode = 'login', publicFilter = 'all';
  let readSequence = 0, publicSequence = 0, authSequence = 0, songSequence = 0;
  let publicPage = 0, publicMore = false, editingVersion = null, draftId = null, editorOwner = null;
  let selectedSearch = null, catalogPage = 1, catalogItems = [], catalogMore = false;
  const table = () => client.from('taste_journal_records');
  const publicFeed = () => client.from('taste_journal_public_feed');
  const PRIVATE_MOMENT_BUCKET='moabom-private-moments';
  const accountNickname = value => String(value||'').trim().replace(/\s+/g,' ').slice(0,18);
  function setNicknameBadge(){
    const nickname=accountNickname(user?.user_metadata?.nickname);
    $('userBadge').textContent=user?'':'방문자';
    $('userBadge').classList.toggle('hidden',Boolean(user));
    $('profileButton').classList.toggle('hidden',!user);
    $('profileDisplayName').textContent=nickname||'닉네임 설정';
    $('authButton').classList.toggle('hidden',Boolean(user));
    if(!user)closeAccountMenu();
  }
  function closeAccountMenu(){
    $('accountMenu').classList.add('hidden');
    $('profileButton').setAttribute('aria-expanded','false');
  }
  function toggleAccountMenu(){
    if(!user)return;
    const opening=$('accountMenu').classList.contains('hidden');
    $('accountMenu').classList.toggle('hidden',!opening);
    $('profileButton').setAttribute('aria-expanded',String(opening));
  }
  function openNicknameProfile(){
    if(!user)return openAuth('login');
    closeAccountMenu();
    $('profileNickname').value=accountNickname(user.user_metadata?.nickname);
    $('profileFeedback').textContent='';
    showDialog('profileDialog');
    $('profileNickname').focus();
  }
  async function saveNicknameProfile(event){
    event.preventDefault();
    const owner=user?.id;
    if(!owner||!client)return;
    const nickname=accountNickname($('profileNickname').value);
    if(!nickname || nickname.length>18){$('profileFeedback').textContent='닉네임을 1~18자로 입력해 주세요.';return;}
    $('profileSave').disabled=true;
    try{
      const {data,error}=await client.auth.updateUser({data:{nickname}});
      if(error)throw error;
      if(user?.id!==owner)return;
      user=data?.user||user;
      setNicknameBadge();
      closeDialog('profileDialog');
      toast('닉네임이 저장됐어요.');
    }catch(error){$('profileFeedback').textContent='저장할 수 없어요: '+String(error.message||error);}
    finally{$('profileSave').disabled=false;}
  }
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = () => localDate(new Date());
  const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const photo = s => {
    const v=String(s||'');
    if(/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(v) && v.length<=140000)return v;
    try{const u=new URL(v);return u.protocol==='https:'&&u.username===''&&u.password==='' ? u.href : '';}catch{return '';}
  };
  const publicPhoto = url => photo(url) ? `<img src="${safe(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : '';
  const stars = value => { const n=Math.min(5,Math.max(0,Math.trunc(Number(value)||0)));return n ? `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5-n)}</span>` : '<span class="no-stars">별점 없음</span>'; };
  const getMedia = r => typeof r.media === 'object' && r.media ? r.media : {};
  const getTitle = r => getMedia(r).title || '제목 없음';
  const toast = message => {const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),3500);};
  function getGuest(){try{const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');return Array.isArray(data)?data:[];}catch{return [];}}
  function getLegacyGuestCount(){return getGuest().length;}
  async function ownRows(owner) {
    const rows = [];
    // Stable secondary order also distinguishes rows written at the same timestamp.
    for (let page = 0; ; page++) {
      if (user?.id !== owner) throw Error('로그인 계정이 변경됐어요.');
      const start = page * 100;
      const {data, error} = await table().select('*').eq('user_id', owner)
        .order('created_at', {ascending:false}).order('id').range(start, start + 99);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 100) return rows;
    }
  }
  async function loadRecords() {
    const seq = ++readSequence, owner = user?.id;
    if (!owner || !client) { records = []; render(); return; }
    try {
      const items = await ownRows(owner);
      if (seq === readSequence && owner === user?.id) { records = items; render(); }
    } catch (error) { if (seq === readSequence) toast('내 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  }
  const publicFields = 'id,kind,media,song,record_date,rating,scene,reason,review,is_public,created_at';
  async function loadPublic(append = false) {
    const seq = ++publicSequence, page = append === true ? publicPage + 1 : 0;
    if (!page) { publicRecords = []; $('publicCount').textContent = ''; $('publicRecords').textContent = '공개 기록을 불러오는 중…'; }
    $('morePublic').classList.add('hidden');
    try {
      if (!client) throw Error();
      let query = publicFeed().select(publicFields, {count:'exact'}).eq('is_public', true);
      if (publicFilter !== 'all') query = query.eq('kind', publicFilter);
      const term = $('publicSearch').value.trim().slice(0,120);
      if (term) {
        const escaped = term.replace(/[\\%_]/g, c => '\\' + c);
        const pattern = '"%' + escaped.replaceAll('\\','\\\\').replaceAll('"','\\"') + '%"';
        query = query.or(['media->>title','media->>subtitle','media->>artist','song->>title','song->>artist','review','scene','reason']
          .map(field => field + '.ilike.' + pattern).join(','));
      }
      const sort = {rating:'rating',dateDesc:'record_date',recent:'created_at'}[$('publicSort').value] || 'created_at';
      const {data,error,count} = await query.order(sort,{ascending:false}).order('id').range(page*24,page*24+23);
      if (seq !== publicSequence) return;
      if (error) throw error;
      publicPage = page;
      publicRecords = [...new Map([...(page ? publicRecords : []), ...data].map(r => [r.id,r])).values()];
      publicMore = (page + 1)*24 < count;
      $('publicCount').textContent = '공개 기록 ' + count + '개';
      renderPublic();
    } catch {
      if (seq !== publicSequence) return;
      if (!page) $('publicRecords').innerHTML = '<div class="empty-state"><h3>공개 기록을 불러오지 못했어요</h3><p>새로고침으로 다시 시도해 주세요.</p></div>';
      else { $('morePublic').classList.remove('hidden'); toast('다음 기록을 불러오지 못했어요.'); }
    }
  }

  // Compatibility: legacy records keep a single record_date; the extra values
  // live inside the existing media JSON object (no database migration required).
  function watchDates(r) {
    const end=String(r?.media?.watch_end||r?.record_date||'');
    const start=String(r?.media?.watch_start||end);
    return {start:start&&start<=end?start:end,end};
  }
  function recordOnDate(r,date) {
    const {start,end}=watchDates(r);
    return !!start && start<=date && date<=end;
  }
  function watchDateLabel(r) {
    const {start,end}=watchDates(r);
    return start&&end&&start!==end?start+' ~ '+end:end;
  }
  function dramaWatchLabel(r) {
    if (r.kind!=='drama') return '';
    const m=getMedia(r),round=Number(m.watch_round);
    if(!Number.isInteger(round)||round<1)return '';
    const prefix='정주행 '+round+'회차';
    if(m.episode_mode==='all')return prefix+' · 전편 감상';
    const start=Number(m.episode_start),end=Number(m.episode_end);
    if(Number.isInteger(start)&&Number.isInteger(end)&&start>0&&end>=start)
      return prefix+' · '+start+'화'+(start===end?'':'~'+end+'화');
    return prefix;
  }
  function updateWatchDateMode(){
    const multi=$('recordDateMode').value==='range';
    $('recordDateSingle').classList.toggle('hidden',multi);
    $('recordDateRange').classList.toggle('hidden',!multi);
    $('recordDate').required=!multi;
    $('recordDateStart').required=multi;
    $('recordDateEnd').required=multi;
    $('recordDateHelp').textContent=multi?'시작일부터 종료일까지 달력에 표시돼요.':'기록을 남긴 하루가 달력에 표시돼요.';
  }
  function updateDramaEpisodeMode(){
    const isDrama=selectedKind==='drama';
    $('dramaWatchFields').classList.toggle('hidden',!isDrama);
    const showRange=isDrama&&$('dramaEpisodeMode').value==='range';
    $('dramaEpisodeRange').classList.toggle('hidden',!showRange);
    $('dramaEpisodeStart').required=showRange;
    $('dramaEpisodeEnd').required=showRange;
    $('dramaEpisodeHelp').textContent=showRange?'예: 정주행 2회차 · 3화~6화':'전편 정주행을 선택하면 모든 화를 감상한 것으로 기록돼요.';
  }
  function miniCard(r) {
    const symbol = r.kind==='music'?'note':r.kind==='movie'?'film':'book';
    const fallback = '<svg class="icon" aria-hidden="true"><use href="#i-'+symbol+'"/></svg>';
    return '<button type="button" class="mini-record" data-id="'+safe(r.id)+'"><span class="mini-cover">'+fallback+publicPhoto(getMedia(r).poster)+'</span><span><strong>'+safe(getTitle(r))+'</strong><small>'+safe(KINDS[r.kind])+' · '+safe(watchDateLabel(r))+(r.rating?' · ★ '+Number(r.rating):'')+'</small></span></button>';
  }
  function render(){
    renderCalendar();
    $('recentRecords').innerHTML = records.length ? records.slice(0,3).map(miniCard).join('') :
      '<div class="rail-empty"><p>아직 남긴 기록이 없어요.</p><button type="button" class="text-link" data-first>첫 기록 남기기 →</button></div>';
    renderCollection();
    if(!$('gardenView').classList.contains('hidden'))renderGarden();
    if(!$('rewatchView').classList.contains('hidden'))renderRewatches();
    if(!$('photocardView').classList.contains('hidden'))syncPhotoCardOptions();
    if(!$('connectionsView').classList.contains('hidden'))renderConnections();
    if($('calendarSearch').value.trim())searchMyCalendarRecords();
  }
  function renderCalendar(){
    const year=viewDate.getFullYear(),month=viewDate.getMonth();
    const monthStart=`${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd=`${year}-${String(month+1).padStart(2,'0')}-${String(new Date(year,month+1,0).getDate()).padStart(2,'0')}`;
    const monthRecords=records.filter(r=>{const d=watchDates(r);return d.start<=monthEnd&&d.end>=monthStart;});
    $('railTotal').textContent=monthRecords.length;
    $('railDrama').textContent=monthRecords.filter(r=>r.kind==='drama').length;
    $('railMovie').textContent=monthRecords.filter(r=>r.kind==='movie').length;
    $('railMusic').textContent=monthRecords.filter(r=>r.kind==='music').length;
    $('railPair').textContent=monthRecords.filter(r=>r.kind==='pair').length;
    $('allTotal').textContent=records.length;
    $('railMonth').textContent=(month+1)+'월의 기록';
    const rated=monthRecords.filter(r=>Number(r.rating)>0);
    $('railRating').textContent=rated.length?(rated.reduce((sum,r)=>sum+Number(r.rating),0)/rated.length).toFixed(1):'—';
    $('monthLabel').textContent=`${year}년 ${month+1}월`;

    const first=(new Date(year,month,1)).getDay(),days=new Date(year,month+1,0).getDate();
    const total=Math.ceil((first+days)/7)*7;
    let html=['일','월','화','수','목','금','토'].map(d=>`<div class="weekday">${d}</div>`).join('');
    for(let i=0;i<total;i++){
      const day=i-first+1; if(day<1||day>days){html+='<div class="day-cell outside"></div>';continue;}
      const date = localDate(new Date(year,month,day));
      const hits = monthRecords.filter(r => recordOnDate(r,date) && (calendarKind === 'all' || r.kind === calendarKind));
      const covers = hits.slice(0,2).map(r => `<button type="button" class="day-poster ${r.kind==='music'?'music-cover':''}" data-id="${safe(r.id)}" aria-label="${safe(getTitle(r))} 감상 기록 열기" title="${safe(getTitle(r))}">${publicPhoto(getMedia(r).poster)}<span class="poster-fallback">${safe(getTitle(r).slice(0,7))}</span></button>`).join('');
      const more = hits.length > 1 ? `<button type="button" class="more-posters ${hits.length===2?'only-mobile':''}" data-daylist="${date}" aria-label="${date} 기록 ${hits.length}개 모두 보기"><span class="only-mobile">+${hits.length-1}개</span><span class="only-wide">+${hits.length-2}개</span></button>` : '';
      html += `<div class="day-cell ${date===today()?'is-today':''} ${i%7===0?'sun':i%7===6?'sat':''}" data-date="${date}"><div class="day-header"><button type="button" class="date-button" data-add="${date}" aria-label="${date} 기록 추가" ${date===today()?'aria-current="date"':''}>${day}</button></div><div class="day-posters poster-count-${Math.min(2,hits.length)}">${covers}${more}</div></div>`;
    }
    $('calendar').innerHTML=html;
  }
  function searchMyCalendarRecords() {
    const query=$('calendarSearch').value.trim().toLocaleLowerCase('ko');
    const results=$('calendarSearchResults');
    if(!query){results.classList.add('hidden');results.replaceChildren();return;}
    const found=records.filter(r=>containsQuery(r,query)).slice(0,8);
    results.innerHTML=found.length?found.map(r=>miniCard(r)).join(''):
      '<p class="calendar-no-results">일치하는 기록이 없어요. 새 기록을 추가해 보세요.</p>';
    results.classList.remove('hidden');
  }
  function showDay(date) {
    selectedDate = date;
    $('dayTitle').textContent = date + ' 감상 기록';
    $('dayRecords').innerHTML = records.filter(r => recordOnDate(r,date) && (calendarKind === 'all' || r.kind === calendarKind)).map(miniCard).join('');
    showDialog('dayDialog');
  }
  const kindMarker=r=>`<span class="kind-label">${KINDS[r.kind]||'기록'}</span>`;
  function card(r, readOnly=false){return `<button class="record-card" data-id="${safe(r.id)}" data-public="${readOnly?'1':'0'}"><div class="card-poster">${publicPhoto(getMedia(r).poster)}<div class="card-placeholder">✳</div>${kindMarker(r)}</div><div class="card-info"><span class="card-date">${safe(watchDateLabel(r))} ${r.is_public?'· 공개':'· 비공개'}</span><h3>${safe(getTitle(r))}</h3>${r.song?.title?'<div class="card-pair">♫ '+safe(r.song.title)+'</div>':''}${dramaWatchLabel(r)?'<div class="watch-summary">'+safe(dramaWatchLabel(r))+'</div>':''}<div class="card-rating">${stars(Number(r.rating))}</div>${Array.isArray(getMedia(r).tags)&&getMedia(r).tags.length?'<div class="card-tag">#'+safe(getMedia(r).tags.slice(0,2).join(' #'))+'</div>':''}<p>${safe(r.review||getMedia(r).subtitle||'기록한 순간을 다시 열어보세요.')}</p></div></button>`;}
  function renderCards(id,arr,readOnly=false){$(id).innerHTML=arr.length?arr.map(r=>card(r,readOnly)).join(''):`<div class="empty-state"><span>✳</span><h3>아직 기록이 없어요</h3><p>좋아하는 순간을 하나씩 채워보세요.</p></div>`;}
  function groupIdentity(r,kind){
    const m=getMedia(r);
    if(kind==='works')return String(m.tmdb_id ? 'tmdb:'+m.tmdb_type+':'+m.tmdb_id : 'title:'+(m.kind || (r.kind==='pair'?'drama':r.kind))+':'+String(m.title||'').trim().toLocaleLowerCase('ko'));
    const song=r.kind==='music'?m:r.song;
    return (song?.id||song?.musicbrainz_id||song?.apple_id) ? 'music:'+(song.id||song.musicbrainz_id||song.apple_id) : 'song:'+String(song?.title||'').trim().toLocaleLowerCase('ko')+':'+String(song?.artist||'').trim().toLocaleLowerCase('ko');
  }
  function groupCard(group,kind){
    const first=group.items[0],m=getMedia(first),song=first.kind==='music'?m:first.song;
    const title=kind==='works'?m.title:song?.title;
    const poster=kind==='works'?m.poster:song?.poster;
    const subtitle=kind==='works'?m.subtitle:song?.artist||song?.subtitle||'';
    return '<button type="button" class="group-card" data-groupid="'+safe(group.id)+'"><div class="group-cover">'+publicPhoto(poster)+'</div><div class="group-meta"><small>'+safe(subtitle)+'</small><strong>'+safe(title)+'</strong><span>'+group.items.length+'개의 기록 보기 →</span></div></button>';
  }
  let selectedGroupKey=null;
  function renderCollection(){
    const q=$('filterSearch').value.trim().toLocaleLowerCase('ko');
    const filtered=sortEntries(records.filter(r=>(activeFilter==='all'||r.kind===activeFilter)&&containsQuery(r,q)),$('recordSort').value);
    const grouped=collectionMode!=='entries';
    $('collectionRecords').classList.toggle('hidden',grouped);
    $('groupedRecords').classList.toggle('hidden',!grouped);
    if(!grouped){renderCards('collectionRecords',filtered);return;}
    const groups=new Map();
    for(const record of filtered){
      if(collectionMode==='works'&&record.kind==='music')continue;
      if(collectionMode==='songs'&&record.kind!=='music'&&!record.song?.title)continue;
      const id=groupIdentity(record,collectionMode);
      if(!groups.has(id))groups.set(id,{id,items:[]});
      groups.get(id).items.push(record);
    }
    const list=[...groups.values()];
    let html='<div class="group-grid">'+list.map(g=>groupCard(g,collectionMode)).join('')+'</div>';
    const selected=list.find(g=>g.id===selectedGroupKey);
    if(selected)html+='<section class="group-detail"><div class="group-detail-head"><h3>'+safe(collectionMode==='works'?getTitle(selected.items[0]):(selected.items[0].kind==='music'?getTitle(selected.items[0]):selected.items[0].song?.title))+' · 기록 '+selected.items.length+'개</h3><button type="button" class="outline-btn" data-group-close="1">접기</button></div><div class="record-grid">'+selected.items.map(r=>card(r)).join('')+'</div></section>';
    if(!list.length)html='<div class="empty-state"><span>✳</span><h3>아직 모아볼 기록이 없어요.</h3><p>작품과 음악을 기록하면 이곳에 함께 모여요.</p></div>';
    $('groupedRecords').innerHTML=html;
  }
  function containsQuery(r,q){const m=getMedia(r);return [m.title,m.subtitle,m.artist,...(Array.isArray(m.tags)?m.tags:[]),r.review,r.scene,r.reason,r.song?.title,r.song?.artist].some(v=>String(v||'').toLocaleLowerCase('ko').includes(q));}
  function sortEntries(arr,mode){
    const a=[...arr];
    if(mode==='dateAsc')return a.sort((x,y)=>String(x.record_date||'').localeCompare(String(y.record_date||'')));
    if(mode==='dateDesc')return a.sort((x,y)=>String(y.record_date||'').localeCompare(String(x.record_date||'')));
    if(mode==='rating')return a.sort((x,y)=>Number(y.rating||0)-Number(x.rating||0)||String(y.created_at||'').localeCompare(String(x.created_at||'')));
    if(mode==='oldest')return a.sort((x,y)=>String(x.created_at||'').localeCompare(String(y.created_at||'')));
    return a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));
  }

  // Recommendations use only the signed-in member's own loaded records and
  // publicly readable candidates. No personal taste data is shared or written.
  let recommendCandidates=[], recommendRanked=[], recommendPage=0, recommendSequence=0, recommendLoaded=false;
  const recommendationKey=r=>{
    const m=getMedia(r),type=r.kind==='pair'?(m.kind||'drama'):r.kind;
    return m.tmdb_id?'tmdb:'+type+':'+m.tmdb_id:
      type+':'+String(m.title||'').normalize('NFKC').toLocaleLowerCase('ko').trim();
  };
  function rankRecommendationCandidates(){
    const direction=$('recommendDirection').value;
    const workToMusic=direction==='workToMusic',musicToWork=direction==='musicToWork';
    const norm=v=>String(v||'').normalize('NFKC').trim().toLocaleLowerCase('ko');
    const known=new Set(records.map(recommendationKey));
    const knownSongs=new Set(records.flatMap(r=>r.kind==='music'?[getMedia(r)]:r.song?.title?[r.song]:[])
      .map(m=>norm(m.title)+':'+norm(m.artist)));
    const seen=new Set();
    const rated=records.filter(r=>Number(r.rating)>=4);
    const focused=rated.filter(r=>workToMusic?r.kind!=='music':musicToWork?r.kind==='music'||r.kind==='pair':true);
    const strong=focused.length?focused:rated;
    const kinds=new Map(),tags=new Map();
    for(const r of strong){
      const type=r.kind==='pair'?(getMedia(r).kind||'drama'):r.kind;
      kinds.set(type,(kinds.get(type)||0)+1);
      for(const raw of (Array.isArray(getMedia(r).tags)?getMedia(r).tags:[])){
        const tag=String(raw).trim().toLocaleLowerCase('ko');
        if(tag)tags.set(tag,(tags.get(tag)||0)+Math.max(1,Number(r.rating)-3));
      }
    }
    const kindFilter=$('recommendKind').value,regionFilter=$('recommendRegion').value;
    recommendRanked=recommendCandidates.filter(r=>{
      const targetKind=r.kind==='pair'&&workToMusic?'music':r.kind==='pair'?getMedia(r).kind||'drama':r.kind;
      if(!['drama','movie','music'].includes(targetKind))return false;
      if(workToMusic&&targetKind!=='music')return false;
      if(musicToWork&&targetKind==='music')return false;
      if(kindFilter!=='all'&&targetKind!==kindFilter)return false;
      const region=getMedia(r).region||'';
      if(regionFilter==='international'&&region!=='international')return false;
      if(regionFilter==='domestic'&&region!=='KR')return false;
      const target=r.kind==='pair'&&workToMusic?r.song:getMedia(r);
      if(!target?.title)return false;
      const id=r.kind==='pair'&&workToMusic?'song:'+norm(target.title)+':'+norm(target.artist):recommendationKey(r);
      if(!id||known.has(id)||seen.has(id))return false;
      if(targetKind==='music'&&knownSongs.has(norm(target.title)+':'+norm(target.artist)))return false;
      seen.add(id);
      return true;
    }).map(r=>{
      const targetKind=r.kind==='pair'&&workToMusic?'music':r.kind==='pair'?getMedia(r).kind||'drama':r.kind;
      const target=r.kind==='pair'&&workToMusic?r.song:getMedia(r);
      const matched=[...new Set((Array.isArray(getMedia(r).tags)?getMedia(r).tags:[])
        .filter(t=>tags.has(String(t).trim().toLocaleLowerCase('ko'))))];
      const bonus=matched.reduce((sum,t)=>sum+tags.get(String(t).trim().toLocaleLowerCase('ko'))*3,0);
      const directPair=r.kind==='pair'&&
        (workToMusic&&strong.some(s=>norm(getMedia(s).title)===norm(getMedia(r).title))||
         musicToWork&&strong.some(s=>norm(s.kind==='music'?getMedia(s).title:s.song?.title)===norm(r.song?.title)));
      const score=bonus+(directPair?15:0)+Math.min(5,kinds.get(targetKind)||0)*0.6+Number(r.rating||0)*0.3;
      const reason=directPair?'좋아한 콘텐츠와 직접 연결된 작품·음악이에요':matched.length?'좋아한 태그와 비슷해요: #'+matched.slice(0,2).join(' #'):
        kinds.has(targetKind)?'즐겨 기록한 '+(KINDS[targetKind]||'콘텐츠')+'에서 골랐어요':
        '공개 기록에서 발견한 새로운 콘텐츠';
      return {record:r,score,reason,title:target.title,poster:target.poster||getMedia(r).poster,targetKind};
    }).sort((a,b)=>b.score-a.score||Number(b.record.rating)-Number(a.record.rating)||
      String(a.title).localeCompare(String(b.title),'ko'));
    recommendPage=0;
    renderRecommendations();
  }
  function renderRecommendations(){
    const pageSize=9,start=recommendPage*pageSize;
    const list=recommendRanked.slice(start,start+pageSize);
    const target=$('recommendResults');
    if(!recommendRanked.length){
      target.innerHTML='<div class="empty-state"><h3>해당 조건의 추천이 없어요.</h3><p>추천 종류 또는 콘텐츠 지역을 바꿔보세요.</p></div>';
      $('recommendMore').classList.add('hidden');return;
    }
    const markup=list.map(({record:r,reason,title,poster,targetKind})=>
      '<button type="button" class="recommend-card" data-id="'+safe(r.id)+'" aria-label="'+safe(title)+' 공개 기록 읽기">'+
      '<span class="recommend-cover">'+publicPhoto(poster)+'<span class="recommend-cover-placeholder">✿</span></span>'+
      '<span class="recommend-info"><span class="recommend-kind">'+safe(KINDS[targetKind])+
      (getMedia(r).region==='international'?' · 해외':'')+'</span><strong>'+safe(title)+'</strong>'+
      '<small>'+safe(reason)+'</small><span class="recommend-card-rating">'+stars(Number(r.rating))+'</span></span></button>'
    ).join('');
    if(start===0)target.innerHTML=markup;else target.insertAdjacentHTML('beforeend',markup);
    $('recommendMore').classList.toggle('hidden',start+list.length>=recommendRanked.length);
  }
  async function loadRecommendations(force=false){
    const seq=++recommendSequence;
    $('recommendStatus').textContent='취향에 맞는 작품을 찾고 있어요…';
    try{
      if(!client)throw Error('서비스 연결 없음');
      if(force||!recommendLoaded){
        const list=[];
        for(let i=0;i<5;i++){
          const {data,error}=await publicFeed().select(publicFields).eq('is_public',true)
            .order('created_at',{ascending:false}).order('id').range(i*100,i*100+99);
          if(seq!==recommendSequence)return;
          if(error)throw error;
          list.push(...(data||[]));
          if(!data||data.length<100)break;
        }
        recommendCandidates=list;recommendLoaded=true;
      }
      if(seq!==recommendSequence)return;
      rankRecommendationCandidates();
      const rated=records.filter(r=>Number(r.rating)>=4).length;
      $('recommendStatus').textContent=rated?
        '내 높은 별점 기록 '+rated+'개를 참고해, 아직 기록하지 않은 콘텐츠 '+recommendRanked.length+'개를 골랐어요.':
        '높은 별점으로 기록한 작품이 아직 없어서 공개 기록의 태그와 별점을 바탕으로 '+recommendRanked.length+'개를 골랐어요.';
    }catch(error){
      if(seq!==recommendSequence)return;
      $('recommendStatus').textContent='추천 후보를 불러오지 못했어요. 새롭게 추천받기를 눌러 다시 시도해 주세요.';
      $('recommendResults').innerHTML='';
      $('recommendMore').classList.add('hidden');
    }
  }


  // Connections are derived from this member's records; never sent to the public feed.
  function renderConnections(){
    const canvas=$('connectionCanvas'),list=$('connectionList');
    if(!records.length){
      $('connectionStatus').textContent='아직 연결할 기록이 없어요.';
      canvas.innerHTML='<div class="empty-state"><h3>첫 기록이 곧 첫 연결이에요.</h3><p>드라마·영화·음악과 장면 기록을 남기면 여기에 이어져요.</p><button type="button" class="primary-btn" data-first>첫 기록 남기기</button></div>';
      list.replaceChildren();return;
    }
    const nodes=new Map(),edges=new Map();
    const ordered=[...records].sort((a,b)=>Number(b.kind==='pair')-Number(a.kind==='pair')||
      Number(b.rating||0)-Number(a.rating||0));
    const norm=x=>String(x||'').normalize('NFKC').trim().toLocaleLowerCase('ko');
    const add=(key,type,title,poster,record,tags)=>{
      if(!title)return null;
      if(!nodes.has(key))nodes.set(key,{key,type,title,poster,recordId:record.id,tags:new Set()});
      const item=nodes.get(key);
      for(const t of tags||[])if(norm(t))item.tags.add(norm(t));
      if(!item.poster && poster)item.poster=poster;
      return key;
    };
    for(const r of ordered){
      const m=getMedia(r),tags=Array.isArray(m.tags)?m.tags:[];
      let work=null,music=null;
      if(r.kind!=='music'){
        work=add('work:'+String(m.tmdb_id?m.tmdb_type+':'+m.tmdb_id:norm(m.title)), 'work',m.title,m.poster,r,tags);
      }else{
        music=add('song:'+norm(m.title)+':'+norm(m.artist),'song',m.title,m.poster,r,tags);
      }
      if(r.song?.title){
        music=add('song:'+norm(r.song.title)+':'+norm(r.song.artist),'song',r.song.title,r.song.poster,r,tags);
      }
      if(work&&music&&work!==music){
        const key=[work,music].sort().join('|');
        edges.set(key,{a:work,b:music,type:'direct',reason:'장면과 음악 연결'});
      }
    }
    const all=[...nodes.values()].slice(0,18);
    const available=new Set(all.map(n=>n.key));
    for(let i=0;i<all.length;i++)for(let k=i+1;k<all.length;k++){
      const a=all[i],b=all[k];
      if(a.type===b.type)continue;
      if(edges.has([a.key,b.key].sort().join('|')))continue;
      const common=[...a.tags].filter(t=>b.tags.has(t));
      if(!common.length)continue;
      const key=[a.key,b.key].sort().join('|');
      edges.set(key,{a:a.key,b:b.key,type:'feeling',reason:'공통 태그: #'+common.slice(0,2).join(' #')});
    }
    const workNodes=all.filter(n=>n.type==='work'),songNodes=all.filter(n=>n.type==='song');
    const positions=new Map();
    const place=(group,x)=>{
      group.forEach((n,i)=>{
        const count=group.length;
        const rows=Math.max(count,1);
        const y=rows===1?50:12+76*i/(rows-1);
        positions.set(n.key,{x,y});
      });
    };
    place(workNodes,31);place(songNodes,75);
    if(!songNodes.length)place(workNodes,50);
    const links=[...edges.values()].filter(e=>available.has(e.a)&&available.has(e.b)).slice(0,28);
    const lines=links.map(e=>{
      const a=positions.get(e.a),b=positions.get(e.b);
      return '<line x1="'+a.x*10+'" y1="'+a.y*6+'" x2="'+b.x*10+'" y2="'+b.y*6+
        '" class="connection-line '+(e.type==='direct'?'line-direct':'line-feeling')+'"/>';
    }).join('');
    const buttons=all.map(n=>{
      const pos=positions.get(n.key);
      return '<button type="button" class="connection-node '+(n.type==='song'?'is-song':'is-work')+
        '" style="left:'+pos.x+'%;top:'+pos.y+'%" data-connection-id="'+safe(n.recordId)+'"'+
        ' aria-label="'+safe(n.title)+' 기록 열기"><span class="connection-node-art">'+publicPhoto(n.poster)+
        '<span class="connection-node-fallback">✿</span></span><span class="connection-node-title">'+safe(n.title)+
        '</span><small>'+(n.type==='song'?'음악':'작품')+'</small></button>';
    }).join('');
    const graphHeight=Math.max(650,Math.max(workNodes.length,songNodes.length)*135);
    canvas.innerHTML='<div class="connection-map-inner" style="height:'+graphHeight+'px"><svg class="connection-wires" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">'+lines+'</svg>'+buttons+'</div>';
    list.innerHTML=links.length?'<h2>연결된 순간 '+links.length+'개</h2><div class="connection-links">'+links.map(e=>{
      const a=nodes.get(e.a),b=nodes.get(e.b);
      return '<div class="connection-list-row"><span>'+safe(a.title)+' <b>↔</b> '+safe(b.title)+'</span><small>'+safe(e.reason)+'</small></div>';
    }).join('')+'</div>':'<div class="empty-state"><p>아직 연결된 음악이나 공통 취향 태그가 없어요. 음악과 장면을 함께 기록하면 연결이 만들어집니다.</p></div>';
    $('connectionStatus').textContent='내 기록 '+records.length+'개에서 '+all.length+'개의 콘텐츠와 '+links.length+'개의 연결을 발견했어요.';
  }


  // Private scrapbook, drawers, capsules and future letters: saved with owner-scoped RLS.
  const SPACES_LABELS={moment:'순간 스크랩북',drawer:'마음 서랍',capsule:'취향 타임캡슐',letter:'미래의 나에게'};
  let spaceItems=[],spaceOwner=null,spaceKind='moment',editingSpaceId=null,spaceBusy=false,spaceReadSequence=0;
  let spaceImageRemoved=false,spaceImageObjectUrl=null;
  const isSpaceLocked=entry=>Boolean(entry&&['capsule','letter'].includes(entry.kind)&&entry.unlock_on&&entry.unlock_on>today());
  function clearSpaceObjectUrl(){
    if(spaceImageObjectUrl){URL.revokeObjectURL(spaceImageObjectUrl);spaceImageObjectUrl=null;}
  }
  function resetSpaceImageEditor(){
    clearSpaceObjectUrl();
    spaceImageRemoved=false;
    $('spaceImageFile').value='';
    $('spaceImageStatus').textContent='';
    $('spaceImagePreview').removeAttribute('src');
    $('spaceImagePreview').classList.add('hidden');
    $('spaceImageRemove').classList.add('hidden');
  }
  function refreshSpaceImagePreview(url){
    const u=photo(url);
    if(!u){$('spaceImagePreview').removeAttribute('src');$('spaceImagePreview').classList.add('hidden');}
    else{$('spaceImagePreview').src=u;$('spaceImagePreview').classList.remove('hidden');}
    $('spaceImageRemove').classList.toggle('hidden',!u&&!$('spaceImageFile').files?.length);
  }
  const spaceTable=()=>client.from('taste_journal_spaces');
  function changeSpaceKind(kind){
    spaceKind=SPACES_LABELS[kind]?kind:'moment';
    document.querySelectorAll('#spacesTabs [data-space-kind]').forEach(b=>b.classList.toggle('selected',b.dataset.spaceKind===spaceKind));
    const hints={moment:'기억에 남는 장면이나 한 줄을 사진과 함께 남길 수 있어요.',
      drawer:'위로·설렘·추억처럼 나만의 주제로 기록을 골라 모아둘 수 있어요.',
      capsule:'지금의 취향을 정한 날짜에 다시 열어보세요.',
      letter:'미래의 나에게 마음을 담은 편지를 남겨보세요.'};
    $('spacesHelper').textContent=hints[spaceKind];
    renderSpaces();
  }
  function populateSpaceRecordOptions(selectedIds=[]){
    const selected=new Set(selectedIds);
    const options=records.map(r=>'<option value="'+safe(r.id)+'"'+(selected.has(r.id)?' selected':'')+'>'+
      safe(getTitle(r))+' · '+safe(r.record_date)+'</option>').join('');
    $('spaceRecord').innerHTML='<option value="">연결하지 않음</option>'+options;
    $('spaceRecordChecks').innerHTML=records.length?records.map(r=>
      '<label><input type="checkbox" value="'+safe(r.id)+'"'+(selected.has(r.id)?' checked':'')+'><span>'+
      safe(getTitle(r))+' · '+safe(r.record_date)+'</span></label>').join(''):
      '<p>아직 담을 기록이 없어요. 먼저 작품이나 음악을 기록해 주세요.</p>';
  }
  function syncSpaceFormKind(){
    const k=$('spaceKind').value;
    $('spaceMomentFields').classList.toggle('hidden',k!=='moment');
    $('spaceDrawerFields').classList.toggle('hidden',k!=='drawer');
    $('spaceUnlockFields').classList.toggle('hidden',k!=='capsule'&&k!=='letter');
    $('spaceUnlock').required=k==='capsule'||k==='letter';
  }
  function openSpaceForm(entry=null){
    if(!user||!client){openAuth('login');toast('로그인 후 기억을 보관할 수 있어요.');return;}
    if(entry&&spaceOwner!==user.id)return;
    if(isSpaceLocked(entry)){
      toast('이 기억은 '+entry.unlock_on+'부터 다시 읽을 수 있어요.');
      return;
    }
    resetSpaceImageEditor();
    editingSpaceId=entry?.id||null;
    $('spaceDialogTitle').textContent=entry?'기억 수정하기':'새로운 기억 남기기';
    $('spaceKind').value=entry?.kind||spaceKind;
    $('spaceTitle').value=entry?.title||'';
    $('spaceBody').value=entry?.body||'';
    $('spaceImageUrl').value=entry?.media?.image_url||'';
    refreshSpaceImagePreview(entry?._signed_image_url||entry?.media?.image_url||'');
    const selected=Array.isArray(entry?.media?.record_ids)?entry.media.record_ids:
      entry?.media?.record_id?[entry.media.record_id]:[];
    populateSpaceRecordOptions(selected);
    if(entry?.media?.record_id)$('spaceRecord').value=entry.media.record_id;
    const future=new Date();future.setMonth(future.getMonth()+3);
    $('spaceUnlock').value=entry?.unlock_on||localDate(future);
    $('spaceDelete').classList.toggle('hidden',!entry);
    $('spaceFeedback').textContent='';
    syncSpaceFormKind();
    showDialog('spaceDialog');
  }
  function renderSpaces(){
    const box=$('spacesResults');
    if(!user||spaceOwner!==user.id){
      $('spacesStatus').textContent=user?'내 보관함을 불러오는 중…':'이곳은 본인만 열람할 수 있는 비공개 보관함이에요.';
      box.innerHTML=user?'<div class="empty-state"><p>내 보관함을 불러오고 있어요…</p></div>':'<div class="empty-state"><h3>로그인하고 나만의 기억을 모아보세요.</h3><button type="button" data-space-login class="primary-btn">로그인하기</button></div>';
      return;
    }
    const selected=spaceItems.filter(x=>x.kind===spaceKind);
    $('spacesStatus').textContent=SPACES_LABELS[spaceKind]+' '+selected.length+'개';
    if(!selected.length){
      box.innerHTML='<div class="empty-state"><h3>아직 담아둔 기억이 없어요.</h3><p>새로운 기억을 남기면 이곳에 차곡차곡 쌓여요.</p><button type="button" data-space-add class="primary-btn">첫 기억 남기기</button></div>';
      return;
    }
    box.innerHTML=selected.map(s=>{
      const locked=isSpaceLocked(s);
      const linkedIds=[...(Array.isArray(s.media?.record_ids)?s.media.record_ids:[]),
        ...(s.media?.record_id?[s.media.record_id]:[])];
      const unique=[...new Set(linkedIds)];
      const linked=unique.map(id=>records.find(r=>r.id===id)).filter(Boolean);
      const signedOrExternal=s._signed_image_url||s.media?.image_url;
      const image=!locked&&s.kind==='moment'&&photo(signedOrExternal)?
        '<img src="'+safe(photo(signedOrExternal))+'" alt="" loading="lazy" referrerpolicy="no-referrer">':'';
      return '<article class="space-card '+(locked?'space-locked':'')+'">'+
        (image?'<div class="space-card-photo">'+image+'</div>':'')+
        '<div class="space-card-body"><span class="space-card-kind">'+safe(SPACES_LABELS[s.kind])+'</span>'+
        '<h2>'+safe(s.title)+'</h2>'+
        (locked?'<p>✉ '+safe(s.unlock_on)+'에 다시 읽을 수 있어요.</p>':
          '<p>'+safe(String(s.body||'').slice(0,420))+'</p>')+
        (linked.length?'<div class="space-linked">'+linked.map(r=>
          '<button type="button" data-space-record="'+safe(r.id)+'">↗ '+safe(getTitle(r))+'</button>').join('')+'</div>':'')+
        '<div class="space-card-footer"><small>'+safe(s.created_at?.slice(0,10)||'')+'</small>'+
        (locked?'<span class="space-locked-notice">개봉 전 · 수정 불가</span>':'<button type="button" class="outline-btn" data-space-edit="'+safe(s.id)+'">수정 · 관리</button>')+'</div>'+
        '</div></article>';
    }).join('');
  }
  async function loadSpaces(){
    const seq=++spaceReadSequence,owner=user?.id;
    if(!owner||!client){spaceItems=[];spaceOwner=null;renderSpaces();return;}
    if(spaceOwner!==owner){spaceItems=[];spaceOwner=null;renderSpaces();}
    $('spacesStatus').textContent='기억을 불러오는 중…';
    try{
      const {data,error}=await spaceTable().select('id,user_id,kind,title,body,media,unlock_on,created_at')
        .eq('user_id',owner).order('created_at',{ascending:false}).limit(200);
      if(error)throw error;
      if(seq!==spaceReadSequence||user?.id!==owner)return;
      const entries=data||[];
      await Promise.all(entries.map(async entry=>{
        const path=entry.kind==='moment'?entry.media?.image_path:null;
        if(!path||!path.startsWith(owner+'/'))return;
        try{
          const {data:signature,error:sigError}=await client.storage.from(PRIVATE_MOMENT_BUCKET)
            .createSignedUrl(path,600);
          if(!sigError&&signature?.signedUrl)entry._signed_image_url=signature.signedUrl;
        }catch{}
      }));
      if(seq!==spaceReadSequence||user?.id!==owner)return;
      spaceOwner=owner;spaceItems=entries;renderSpaces();
    }catch(e){if(seq===spaceReadSequence&&user?.id===owner)$('spacesStatus').textContent='보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';}
  }
  async function saveSpace(e){
    e.preventDefault();
    if(spaceBusy||!user||!client)return;
    const owner=user.id,kind=$('spaceKind').value,title=$('spaceTitle').value.trim();
    if(!SPACES_LABELS[kind]||!title)return;
    const previous=editingSpaceId?spaceItems.find(s=>s.id===editingSpaceId):null;
    if(editingSpaceId&&(!previous||isSpaceLocked(previous))){
      $('spaceFeedback').textContent='지정한 날짜 전에는 이 기록을 수정할 수 없어요.';return;
    }
    const file=$('spaceImageFile').files?.[0]||null;
    if(file&&(file.size>5*1024*1024||!/^image\/(jpeg|png|webp)$/.test(file.type))){
      $('spaceFeedback').textContent='JPG·PNG·WebP 파일을 5MB 이하로 선택해 주세요.';return;
    }
    const image=$('spaceImageUrl').value.trim();
    if(kind==='moment'&&image&&!photo(image)){
      $('spaceFeedback').textContent='사진 주소는 정상적인 HTTPS 이미지 주소여야 해요.';return;
    }
    const recordIds=[...$('spaceRecordChecks').querySelectorAll('input:checked')].map(i=>i.value)
      .filter(id=>records.some(r=>r.id===id));
    const selected=$('spaceRecord').value;
    const previousPath=previous?.media?.image_path||null;
    const media=kind==='moment'?{record_id:records.some(r=>r.id===selected)?selected:null,
      image_url:spaceImageRemoved?'':photo(image)||'',image_path:(spaceImageRemoved||image)?null:previousPath}:
      kind==='drawer'?{record_ids:recordIds}:{};
    const unlock_on=kind==='capsule'||kind==='letter'?$('spaceUnlock').value:null;
    if((kind==='capsule'||kind==='letter')&&!unlock_on){
      $('spaceFeedback').textContent='다시 열 날짜를 선택해 주세요.';return;
    }
    const payload={user_id:owner,kind,title,body:$('spaceBody').value.trim().slice(0,5000),media,unlock_on,updated_at:new Date().toISOString()};
    spaceBusy=true;$('spaceSave').disabled=true;$('spaceFeedback').textContent='기억을 저장하는 중…';
    let newImagePath=null;
    try{
      if(kind==='moment'&&file){
        $('spaceFeedback').textContent='사진을 안전하게 업로드하고 있어요…';
        const dataUrl=await resizePoster(file);
        const content=await (await fetch(dataUrl)).blob();
        if(user?.id!==owner)throw Error('로그인 계정이 변경됐어요.');
        const imagePath=owner+'/'+crypto.randomUUID()+'.jpg';
        const {error:uploadError}=await client.storage.from(PRIVATE_MOMENT_BUCKET)
          .upload(imagePath,content,{contentType:'image/jpeg',upsert:false});
        if(uploadError)throw uploadError;
        newImagePath=imagePath;
        payload.media.image_path=imagePath;
        payload.media.image_url='';
      }
      if(user?.id!==owner)throw Error('로그인 계정이 변경됐어요.');
      $('spaceFeedback').textContent='기억을 저장하고 있어요…';
      const request=editingSpaceId?
        spaceTable().update(payload).eq('id',editingSpaceId).eq('user_id',owner).select('id'):
        spaceTable().insert(payload).select('id');
      const {data,error}=await request;
      if(error)throw error;
      if(!data?.length)throw new Error('저장할 수 있는 항목을 찾지 못했어요.');
      closeDialog('spaceDialog');
      resetSpaceImageEditor();
      if(user?.id===owner){
        changeSpaceKind(kind);await loadSpaces();toast('기억이 저장됐어요.');
      }
      if(previousPath&&previousPath!==payload.media.image_path&&previousPath.startsWith(owner+'/')){
        await client.storage.from(PRIVATE_MOMENT_BUCKET).remove([previousPath]);
      }
    }catch(error){
      if(newImagePath)await client.storage.from(PRIVATE_MOMENT_BUCKET).remove([newImagePath]);
      $('spaceFeedback').textContent='저장하지 못했어요: '+String(error.message||error);
    }finally{spaceBusy=false;$('spaceSave').disabled=false;}
  }
  async function deleteSpace(){
    if(spaceBusy||!editingSpaceId||!user||!client)return;
    if(!confirm('이 기억을 삭제할까요? 기존 감상 기록은 삭제되지 않습니다.'))return;
    const owner=user.id,previous=spaceItems.find(s=>s.id===editingSpaceId);
    if(isSpaceLocked(previous)){toast('개봉 전인 기억은 삭제하거나 수정할 수 없어요.');return;}
    spaceBusy=true;$('spaceDelete').disabled=true;
    try{
      const {data,error}=await spaceTable().delete().eq('id',editingSpaceId)
        .eq('user_id',owner).select('id');
      if(error)throw error;
      if(!data?.length)throw new Error('삭제할 항목이 없어요.');
      closeDialog('spaceDialog');editingSpaceId=null;
      resetSpaceImageEditor();
      if(user?.id===owner){await loadSpaces();toast('보관함의 기억을 삭제했어요.');}
      if(previous?.media?.image_path?.startsWith(owner+'/')){
        await client.storage.from(PRIVATE_MOMENT_BUCKET).remove([previous.media.image_path]);
      }
    }catch(error){$('spaceFeedback').textContent='삭제하지 못했어요: '+String(error.message||error);}
    finally{spaceBusy=false;$('spaceDelete').disabled=false;}
  }


  function renderGarden(){
    const current=today(),period=$('gardenPeriod').value;
    const rows=records.filter(r=>{
      if(period==='all')return true;
      const now=current.slice(0,period==='year'?4:7),dates=watchDates(r);
      return dates.start.slice(0,now.length)<=now&&dates.end.slice(0,now.length)>=now;
    })
      .sort((a,b)=>String(a.created_at||a.record_date).localeCompare(String(b.created_at||b.record_date))||String(a.id).localeCompare(String(b.id)));
    const maximum=16,visible=rows.slice(-maximum);
    $('gardenCount').textContent='피어난 기록 '+rows.length+'개'+(rows.length>maximum?' · 최근 '+maximum+'송이 표시':'');
    // One shared set of Bezier branches drives BOTH artwork and clickable blossoms.
    // This prevents floating blossoms or visually disconnected branch junctions.
    // Natural asymmetry: each branch starts in the main trunk and curves organically.
    // Approved, artist-rendered tree. The image stays intact so branches never separate.
    // Hotspots sit on existing painted blossoms and retain the original record dialog.
    const labels={drama:'드라마',movie:'영화',music:'음악',pair:'장면과 음악'};
    const blossomSites=[
      [44.506,12.315],[43.193,15.279],[30.477,26.226],[26.745,24.857],
      [18.936,47.434],[26.676,45.382],[17.208,47.320],[41.603,53.706],
      [42.778,54.960],[59.710,32.725],[56.047,33.295],[77.540,25.086],
      [78.853,27.708],[80.442,23.375],[64.271,60.547],[66.966,58.951]
    ];
    const flowers=visible.map((r,i)=>{
      const kind=labels[r.kind]?r.kind:'drama';
      const [x,y]=blossomSites[i];
      return '<button class="garden-tree-flower garden-image-hotspot kind-'+kind+
        '" type="button" data-garden-id="'+safe(r.id)+'" title="'+safe(getTitle(r))+
        '" style="left:'+x.toFixed(3)+'%;top:'+y.toFixed(3)+'%" aria-label="'+
        safe(labels[kind]+' '+getTitle(r)+' 기록 열기')+'"></button>';
    }).join('');
    const tree='<img class="garden-tree-art" src="assets/approved_cherry_tree.jpg?v=1" alt="분홍 벚꽃이 자연스럽게 피어난 포근한 비대칭 나무" loading="eager" decoding="async">';
    const legend='<div class="garden-tree-legend" aria-label="꽃 색상 안내"><span><i class="garden-dot garden-dot-drama"></i>드라마</span><span><i class="garden-dot garden-dot-movie"></i>영화</span><span><i class="garden-dot garden-dot-music"></i>음악</span><span><i class="garden-dot garden-dot-pair"></i>장면과 음악</span></div>';
    const empty=!rows.length?'<div class="garden-tree-empty"><strong>첫 번째 꽃을 피워볼까요?</strong><span>첫 감상을 기록하면 나뭇가지에 벚꽃이 피어요.</span><button type="button" data-first class="primary-btn">첫 기록 남기기</button></div>':'';
    $('gardenCanvas').innerHTML='<div class="garden-tree-stage"><div class="garden-tree-scene">'+tree+flowers+'</div>'+empty+'</div>'+legend;
  }
  const MOODS=[
    {id:'comfort',icon:'🌿',name:'위로가 필요해',tags:['위로','힐링','따뜻함','감동','가족']},
    {id:'excitement',icon:'🌷',name:'설레고 싶어',tags:['설렘','로맨스','청춘','사랑']},
    {id:'energy',icon:'✨',name:'신나고 싶어',tags:['즐거움','코미디','활기','에너지']},
    {id:'calm',icon:'☁️',name:'조용히 쉬고 싶어',tags:['잔잔함','평온','휴식','힐링']},
    {id:'memory',icon:'🍂',name:'추억에 잠기고 싶어',tags:['추억','향수','그리움','감성']},
    {id:'curious',icon:'🔎',name:'새로운 이야기가 궁금해',tags:['미스터리','반전','스릴러','추리']}
  ];
  let moodId='comfort',moodSequence=0;
  function renderMoodChoices(){
    $('moodChoices').innerHTML=MOODS.map(m=>'<button class="mood-option '+(m.id===moodId?'selected':'')+'" type="button" data-mood-id="'+m.id+'" aria-pressed="'+String(m.id===moodId)+'"><span>'+m.icon+'</span>'+safe(m.name)+'</button>').join('');
  }
  async function renderMood(force=false){
    renderMoodChoices();
    const seq=++moodSequence;
    if(!recommendLoaded||force){
      $('moodStatus').textContent='기분에 맞는 작품을 찾고 있어요…';
      await loadRecommendations(force);
    }
    if(seq!==moodSequence)return;
    const m=MOODS.find(x=>x.id===moodId)||MOODS[0];
    const kinds=[...document.querySelectorAll('[data-mood-kind]:checked')].map(e=>e.dataset.moodKind);
    if(!kinds.length){$('moodResults').replaceChildren();$('moodStatus').textContent='콘텐츠 종류를 선택해 주세요.';return;}
    const norm=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
    const liked=new Set(records.filter(r=>Number(r.rating)>=4).flatMap(r=>Array.isArray(getMedia(r).tags)?getMedia(r).tags:[]).map(norm));
    const known=new Set(records.map(recommendationKey));
    const ranked=recommendCandidates.flatMap(r=>{
      const kind=r.kind==='pair'?getMedia(r).kind||'drama':r.kind;
      if(!kinds.includes(kind)||known.has(recommendationKey(r)))return [];
      const tags=Array.isArray(getMedia(r).tags)?getMedia(r).tags.map(norm):[];
      const match=m.tags.filter(t=>tags.some(v=>v.includes(norm(t))||v&&norm(t).includes(v)));
      if(!match.length)return [];
      return [{r,kind,match,score:match.length*10+tags.filter(t=>liked.has(t)).length*3+Number(r.rating||0)}];
    }).sort((a,b)=>b.score-a.score);
    $('moodStatus').textContent=m.icon+' '+m.name+' · 추천 '+ranked.length+'개';
    $('moodResults').innerHTML=ranked.length?ranked.slice(0,18).map(({r,kind,match})=>
      '<button type="button" class="recommend-card" data-mood-record="'+safe(r.id)+'"><span class="recommend-cover">'+publicPhoto(getMedia(r).poster)+'<span class="recommend-cover-placeholder">✿</span></span><span class="recommend-info"><span class="recommend-kind">'+safe(KINDS[kind])+'</span><strong>'+safe(getTitle(r))+'</strong><small>기분 태그: #'+safe(match.slice(0,2).join(' #'))+'</small><span class="recommend-card-rating">'+stars(r.rating)+'</span></span></button>'
    ).join(''):'<div class="empty-state"><h3>추천을 찾지 못했어요.</h3><p>다른 기분을 골라보세요.</p></div>';
  }


  let rewatches=[],rewatchOwner=null,rewatchSequence=0;
  const sameRewatchSubject=(a,b)=>{
    if(!a||!b)return false;
    if(a.kind==='music'||b.kind==='music')return a.kind===b.kind&&groupIdentity(a,'songs')===groupIdentity(b,'songs');
    return groupIdentity(a,'works')===groupIdentity(b,'works');
  };
  function syncRewatchChoices(){
    const selected=$('rewatchOriginal').value,previous=$('rewatchNew').value;
    const original=records.find(r=>r.id===selected);
    const available=original?records.filter(r=>r.id!==original.id&&sameRewatchSubject(original,r)&&
      String(r.record_date)>=String(original.record_date)):[];
    $('rewatchNew').innerHTML='<option value="">'+(original?'다시 감상한 기록 선택':'먼저 첫 감상을 선택하세요')+'</option>'+
      available.sort((a,b)=>String(a.record_date).localeCompare(String(b.record_date)))
        .map(r=>'<option value="'+safe(r.id)+'">'+safe(getTitle(r))+' · '+safe(r.record_date)+'</option>').join('');
    if(available.some(r=>r.id===previous))$('rewatchNew').value=previous;
    else $('rewatchNew').value='';
  }
  function renderRewatches(){
    const previous=$('rewatchOriginal').value;
    const originals=[...records].sort((a,b)=>String(a.record_date).localeCompare(String(b.record_date)));
    $('rewatchOriginal').innerHTML='<option value="">처음 감상 선택</option>'+originals.map(r=>
      '<option value="'+safe(r.id)+'">'+safe(getTitle(r))+' · '+safe(r.record_date)+'</option>').join('');
    if(originals.some(r=>r.id===previous))$('rewatchOriginal').value=previous;
    syncRewatchChoices();
    const view=$('rewatchResults');
    if(!user){
      view.innerHTML='<div class="empty-state"><h3>로그인 후 사용할 수 있어요.</h3><p>나의 첫 감상과 다시 본 감상을 연결해 보세요.</p></div>';return;
    }
    if(rewatchOwner!==user.id){view.innerHTML='<div class="empty-state"><p>재감상 기록을 불러오는 중…</p></div>';return;}
    const cards=rewatches.map(link=>{
      const a=records.find(r=>r.id===link.original_record_id),b=records.find(r=>r.id===link.rewatch_record_id);
      if(!a||!b)return '';
      const tags=r=>(Array.isArray(getMedia(r).tags)?getMedia(r).tags:[]).slice(0,4).map(t=>'#'+t).join(' ');
      return '<article class="rewatch-card"><h2>'+safe(getTitle(a))+'</h2><div class="rewatch-compare">'+
        '<div><span class="section-kicker">처음 봄</span><strong>'+safe(a.record_date)+'</strong><span>'+stars(a.rating)+'</span><p>'+safe(a.review||'감상평 없음')+'</p><small>'+safe(tags(a))+'</small></div>'+
        '<div><span class="section-kicker">다시 봄</span><strong>'+safe(b.record_date)+'</strong><span>'+stars(b.rating)+'</span><p>'+safe(b.review||'감상평 없음')+'</p><small>'+safe(tags(b))+'</small></div></div>'+
        (link.change_note?'<p class="rewatch-change">'+safe(link.change_note)+'</p>':'')+
        '<div class="rewatch-actions"><button type="button" class="outline-btn" data-rewatch-detail="'+safe(b.id)+'">다시 봄 기록 보기</button><button type="button" class="outline-btn" data-rewatch-delete="'+safe(link.id)+'">연결 해제</button></div></article>';
    }).filter(Boolean);
    view.innerHTML=cards.length?cards.join(''):'<div class="empty-state"><h3>아직 다시 봄 기록이 없어요.</h3><p>같은 작품을 두 번 감상한 기록을 연결해 보세요.</p></div>';
  }
  async function loadRewatches(){
    const seq=++rewatchSequence,owner=user?.id;
    if(!owner||!client){rewatches=[];rewatchOwner=null;renderRewatches();return;}
    if(rewatchOwner!==owner){rewatches=[];rewatchOwner=null;}
    renderRewatches();
    try{
      const {data,error}=await client.from('taste_journal_rewatches').select('id,user_id,original_record_id,rewatch_record_id,change_note,created_at')
        .eq('user_id',owner).order('created_at',{ascending:false}).limit(200);
      if(error)throw error;
      if(seq!==rewatchSequence||user?.id!==owner)return;
      rewatches=data||[];rewatchOwner=owner;renderRewatches();
      $('rewatchStatus').textContent='연결된 재감상 '+rewatches.length+'개';
    }catch(error){if(seq===rewatchSequence)$('rewatchStatus').textContent='재감상 기록을 불러오지 못했어요: '+String(error.message||error);}
  }
  async function saveRewatch(event){
    event.preventDefault();
    if(!user||!client){openAuth('login');return;}
    const a=records.find(r=>r.id===$('rewatchOriginal').value);
    const b=records.find(r=>r.id===$('rewatchNew').value);
    if(!a||!b||a.id===b.id||!sameRewatchSubject(a,b)||String(a.record_date)>String(b.record_date)){
      $('rewatchStatus').textContent='같은 작품 또는 노래의 서로 다른 기록을 선택하고, 처음 감상이 더 이른 날짜인지 확인해 주세요.';return;
    }
    const owner=user.id;
    const payload={user_id:owner,original_record_id:a.id,rewatch_record_id:b.id,change_note:$('rewatchNote').value.trim()};
    $('rewatchStatus').textContent='연결하는 중…';
    const {error}=await client.from('taste_journal_rewatches').insert(payload);
    if(user?.id!==owner)return;
    if(error){$('rewatchStatus').textContent=error.code==='23505'?'이미 다시 봄에 연결한 기록이에요.':'연결하지 못했어요: '+String(error.message||error);return;}
    $('rewatchNote').value='';await loadRewatches();toast('다시 봄 기록을 연결했어요.');
  }
  async function deleteRewatch(id){
    if(!user||!confirm('재감상 연결만 해제할까요? 감상 기록은 그대로 남습니다.'))return;
    const owner=user.id;
    const {error}=await client.from('taste_journal_rewatches').delete().eq('id',id).eq('user_id',owner);
    if(user?.id!==owner)return;
    if(error){toast('연결을 해제하지 못했어요.');return;}
    await loadRewatches();
  }


  function cardSelectedRecord(){return records.find(r=>r.id===$('cardRecord').value);}
  function syncPhotoCardOptions(){
    const selected=$('cardRecord').value;
    $('cardRecord').innerHTML='<option value="">기록 선택</option>'+records.map(r=>
      '<option value="'+safe(r.id)+'"'+(selected===r.id?' selected':'')+'>'+safe(getTitle(r))+' · '+safe(r.record_date)+'</option>').join('');
    if(!selected&&records.length)$('cardRecord').value=records[0].id;
    renderPhotoCard();
  }
  function cardContextLine(r){
    const m=getMedia(r);
    if(r.kind==='pair')return '장면 × 음악 · '+String(r.song?.title||'')+(r.song?.artist?' · '+r.song.artist:'');
    if(r.kind==='music')return '음악 · '+String(m.artist||m.subtitle||'');
    return (KINDS[r.kind]||'나의 기록')+(m.subtitle?' · '+String(m.subtitle):'');
  }
  function cardCaptionText(r){return $('cardCaption').value.trim()||String(r?.review||r?.scene||'좋아했던 순간을 모아봄.').trim().slice(0,110);}
  function renderPhotoCard(){
    const r=cardSelectedRecord(),area=$('cardPreview');
    if(!r){
      area.innerHTML='<div class="empty-state"><h3>아직 선택한 기록이 없어요.</h3><p>나의 기록을 남기고 포토카드를 만들어 보세요.</p></div>';
      $('cardDownload').disabled=true;return;
    }
    $('cardDownload').disabled=false;
    const theme=$('cardTemplate').value;
    area.innerHTML='<div class="photocard-paper theme-'+theme+'"><span class="photocard-eyebrow">MOABOM · MY SPRING ARCHIVE</span>'+
      '<div class="photocard-cover">'+publicPhoto(getMedia(r).poster)+'<span>✿</span></div>'+
      '<h2>'+safe(getTitle(r))+'</h2><span class="photocard-context">'+safe(cardContextLine(r))+'</span><p>'+safe(cardCaptionText(r))+'</p>'+
      ($('cardShowRating').checked?'<strong>'+stars(r.rating)+'</strong>':'')+
      ($('cardShowDate').checked?'<small>'+safe(r.record_date)+'</small>':'')+
      '<span class="photocard-signature">모아봄 · 내가 모은 순간</span></div>';
  }
  function wrapCardText(ctx,text,x,y,maxWidth,lineHeight,maxLines){
    let line='',count=0;
    for(const word of [...String(text)]){
      if(ctx.measureText(line+word).width>maxWidth&&line){
        ctx.fillText(line,x,y+count*lineHeight);line=word;count++;
        if(count>=maxLines)return;
      }else line+=word;
    }
    if(line&&count<maxLines)ctx.fillText(line,x,y+count*lineHeight);
  }
  async function downloadPhotoCard(){
    const r=cardSelectedRecord();if(!r)return;
    $('cardDownload').disabled=true;$('cardStatus').textContent='포토카드를 그리는 중…';
    try{
      await document.fonts?.ready;
      const canvas=document.createElement('canvas');canvas.width=900;canvas.height=1200;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('이미지 제작을 지원하지 않는 브라우저예요.');
      const theme=$('cardTemplate').value;
      const backgrounds={spring:'#F5F4E9',letter:'#F8EAE6',archive:'#DEE9DE'};
      const ink=theme==='archive'?'#284934':'#405943';
      ctx.fillStyle=backgrounds[theme]||backgrounds.spring;ctx.fillRect(0,0,900,1200);
      ctx.strokeStyle='#D1C7B7';ctx.lineWidth=3;ctx.strokeRect(42,42,816,1116);
      ctx.textAlign='center';ctx.fillStyle='#AE7C6F';ctx.font='24px sans-serif';ctx.fillText('MOABOM · MY SPRING ARCHIVE',450,108);
      const pos={x:166,y:148,w:568,h:650};
      ctx.fillStyle='#D9E3D4';ctx.fillRect(pos.x,pos.y,pos.w,pos.h);
      const cover=photo(getMedia(r).poster);
      if(cover){
        try{
          const img=new Image();img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';img.src=cover;
          await img.decode();
          const scale=Math.max(pos.w/img.width,pos.h/img.height);
          const dw=img.width*scale,dh=img.height*scale;
          ctx.save();ctx.beginPath();ctx.rect(pos.x,pos.y,pos.w,pos.h);ctx.clip();
          ctx.drawImage(img,pos.x+(pos.w-dw)/2,pos.y+(pos.h-dh)/2,dw,dh);ctx.restore();
        }catch{
          ctx.fillStyle='#6F9370';ctx.font='100px sans-serif';ctx.fillText('✿',450,520);
          $('cardStatus').textContent='원본 이미지의 외부 접근이 제한돼 꽃 장식으로 대신했어요.';
        }
      }else{ctx.fillStyle='#6F9370';ctx.font='100px sans-serif';ctx.fillText('✿',450,520);}
      ctx.fillStyle=ink;ctx.font='bold 40px "Gowun Dodum", sans-serif';
      wrapCardText(ctx,getTitle(r),450,856,745,52,2);
      ctx.font='20px "Gowun Dodum", sans-serif';ctx.fillStyle='#9A6E67';
      wrapCardText(ctx,cardContextLine(r),450,964,725,27,2);
      ctx.font='25px "Gowun Dodum", sans-serif';ctx.fillStyle='#687D67';
      wrapCardText(ctx,cardCaptionText(r),450,1023,720,34,2);
      ctx.fillStyle='#AE796C';ctx.font='24px sans-serif';
      if($('cardShowRating').checked)ctx.fillText('★'.repeat(Math.max(0,Math.min(5,Math.trunc(Number(r.rating)||0)))),450,1105);
      if($('cardShowDate').checked){ctx.fillStyle=ink;ctx.fillText(String(r.record_date||''),450,1130);}
      ctx.textAlign='right';ctx.font='18px sans-serif';ctx.fillStyle='#718A72';ctx.fillText('COLLECT YOUR MOMENTS · MOABOM',828,1171);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw Error('PNG를 생성하지 못했어요.');
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download='moabom-card-'+String(r.record_date||today())+'.png';
      document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      $('cardStatus').textContent='PNG 포토카드가 생성됐어요.';
    }catch(error){$('cardStatus').textContent='포토카드를 만들지 못했어요: '+String(error.message||error);}
    finally{$('cardDownload').disabled=false;}
  }

  function renderPublic() {
    if (publicRecords.length) renderCards('publicRecords',publicRecords,true);
    else $('publicRecords').innerHTML='<div class="empty-state"><h3>표시할 공개 기록이 없어요</h3><p>다른 검색어나 종류를 선택해 보세요.</p></div>';
    $('morePublic').classList.toggle('hidden',!publicMore);
  }
  // Open one live, publicly readable entry without requiring a login.
  // The count and chosen row are queried from the same RLS-respecting feed.
  async function discoverPublicRecord(){
    const button=$('discoverPublic');
    if(button.disabled)return;
    button.disabled=true;
    const initial=button.textContent;
    button.textContent='찾는 중…';
    try{
      if(!client)throw Error('공개 기록 서비스에 연결할 수 없어요.');
      const {count,error:countError}=await publicFeed().select('id',{count:'exact',head:true}).eq('is_public',true);
      if(countError)throw countError;
      if(!count){toast('아직 공개 기록이 없어요.');return;}
      const offset=Math.floor(Math.random()*count);
      const {data,error}=await publicFeed().select('id').eq('is_public',true)
        .order('created_at',{ascending:false}).order('id').range(offset,offset);
      if(error)throw error;
      if(!data?.[0]?.id)throw Error('기록을 찾지 못했어요.');
      await openPublicDetail(data[0].id);
    }catch(error){
      toast('랜덤 기록을 열지 못했어요. 다시 시도해 주세요.');
    }finally{button.disabled=false;button.textContent=initial;}
  }
  async function openSharedRecord(){
    const id=new URLSearchParams(location.search).get('record');
    if(!id||!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)||!client)return;
    switchView('public');
    await openPublicDetail(id);
  }
  async function openPublicDetail(id) {
    const {data,error}=await publicFeed().select(publicFields).eq('id',id).eq('is_public',true).maybeSingle();
    if(error){toast('공개 기록을 확인할 수 없어요. 다시 열어 주세요.');return;}
    if(!data){toast('비공개이거나 삭제된 기록이에요.');await loadPublic();return;}
    openDetail(id,true,data);
  }
  async function shareCurrentRecord(){
    const record=currentDetail?.r;
    if(!record?.is_public){toast('공개로 설정한 기록만 공유할 수 있어요.');return;}
    const url=location.origin+location.pathname+'?record='+encodeURIComponent(record.id);
    try{await navigator.clipboard.writeText(url);toast('공개 기록 링크를 복사했어요.');}
    catch{window.prompt('공개 기록 주소를 복사해 주세요.',url);}
  }
  async function exportMyRecords(type){
    if(!user||!client){openAuth('login');return;}
    let all;
    const owner = user.id;
    try { all = await ownRows(owner); if (owner !== user?.id) return; }
    catch { toast('백업을 불러오지 못했어요. 다시 시도해 주세요.'); return; }
    if(!all.length){toast('아직 내보낼 기록이 없어요.');return;}
    const entries=sortEntries(all,'dateAsc');
    let contents,mime,ext;
    if(type==='json'){
      contents=JSON.stringify({app:'모아봄',version:1,exported_at:new Date().toISOString(),
        records:entries.map(r=>({kind:r.kind,media:r.media,song:r.song,record_date:r.record_date,
          rating:r.rating,scene:r.scene,reason:r.reason,review:r.review,is_public:r.is_public,created_at:r.created_at}))},null,2);
      mime='application/json;charset=utf-8';ext='json';
    } else {
      const headers=['감상 시작일','감상 종료일','분류','제목','정주행 회차','시청 화수','가수','앨범','별점','감상평','장면','연결 이유','연결 음악','연결 가수','공개 여부'];
      const escapeCell=value=>{
        let v=String(value??'');
        if(/^\s*[=+@-]/.test(v))v="'"+v;
        return '"'+v.replace(/"/g,'""')+'"';
      };
      const lines=entries.map(r=>{
        const m=getMedia(r);
        return [watchDates(r).start,watchDates(r).end,KINDS[r.kind]||r.kind,m.title,m.watch_round||'',dramaWatchLabel(r),m.artist,m.album,r.rating,
          r.review,r.scene,r.reason,r.song?.title,r.song?.artist,r.is_public?'공개':'비공개'];
      });
      contents='\uFEFF'+[headers,...lines].map(row=>row.map(escapeCell).join(',')).join('\r\n');
      mime='text/csv;charset=utf-8';ext='csv';
    }
    const blob=new Blob([contents],{type:mime}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='moabom-records-'+today()+'.'+ext;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    toast('내 기록 '+entries.length+'개를 내보냈어요.');
  }
  function switchView(name) {
    const group={rewatch:'collection',photocard:'collection',mood:'recommend',connections:'recommend'};
    const activeNav=group[name]||name;
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('hidden',v.id!==name+'View'));
    document.querySelectorAll('[data-view]').forEach(b=>{
      const active = b.dataset.view === activeNav;
      b.classList.toggle('active',active);
      if(active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.feature-tabs [data-target]').forEach(b=>{
      const active=b.dataset.target===name;
      b.classList.toggle('active',active);
      b.setAttribute('aria-pressed',String(active));
    });
    if (name==='public') loadPublic();
    if (name==='recommend') loadRecommendations();
    if (name==='connections') renderConnections();
    if (name==='spaces') loadSpaces();
    if (name==='garden') renderGarden();
    if (name==='mood') renderMood();
    if (name==='rewatch') loadRewatches();
    if (name==='photocard') syncPhotoCardOptions();
    window.scrollTo({top:0});
  }
  function showDialog(id){$(id).showModal();}
  function closeDialog(id){$(id).close();}
  function resetSearch() {
    searchSequence++; songSequence++;
    catalogPage=1; catalogItems=[]; catalogMore=false; selectedSearch=null;
    for (const id of ['searchResults','songSearchResults']) { $(id).replaceChildren(); $(id).classList.add('hidden'); }
  }
  function clearMedia() {
    resetSearch(); selectedTmdb=null;
    for (const id of ['mediaSearch','mediaTitle','mediaSubtitle','tmdbId','tmdbType','musicId','musicArtistInput','musicAlbumInput','musicLink','musicYoutubeUrl','posterUrl','mediaOverview','releaseDate']) $(id).value='';
    updatePreview(); renderOverview();
  }
  function setKind(kind) {
    if(selectedKind!==kind) clearMedia();
    selectedKind=kind;
    document.querySelectorAll('.kind-tab').forEach(b=>{
      const active=b.dataset.kind===kind;
      b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active));
    });
    const pair=kind==='pair';
    $('pairFields').classList.toggle('hidden',!pair); $('pairTypeField').classList.toggle('hidden',!pair);
    for (const id of ['scene','reason','songTitle']) $(id).required=pair;
    $('musicExtras').classList.toggle('hidden',kind!=='music');
    $('songYoutubeUrl').disabled=!pair; $('musicYoutubeUrl').disabled=kind!=='music';
    updateDramaEpisodeMode();
    $('mediaSearch').placeholder=kind==='music'?'노래 제목 또는 가수':(KINDS[pair?$('pairType').value:kind]+' 제목');
  }
  function updatePreview(){const el=$('coverPreview');el.innerHTML=publicPhoto(photo($('posterUrl').value))+'<span>✳</span>';}
  function paintStars(){
    const value=Number($('rating').value||0);
    document.querySelectorAll('#starRating [data-star]').forEach(b=>{
      const n=Number(b.dataset.star);b.textContent=n<=value?'★':'☆';
      b.classList.toggle('picked',n<=value);b.setAttribute('aria-pressed',String(n===value));
    });
    $('ratingLabel').textContent=value?value+'점 · 나의 별점':'별점을 남겨보세요';
  }
  function setPoster(url){
    const clean=photo(url);if(url && !clean){toast('올바른 이미지 주소가 아니에요.');return false;}
    $('posterUrl').value=clean;updatePreview();return true;
  }
  function choosePosterPane(name){
    for(const p of ['Tmdb','Upload','Link']){
      $('poster'+p+'Pane').classList.toggle('hidden',p!==name);
      $('posterTab'+p).classList.toggle('active',p===name);
    }
  }
  async function openPosterPicker(){
    choosePosterPane('Tmdb');$('posterGallery').innerHTML='';
    $('posterGalleryInfo').textContent=selectedTmdb?.id?'다른 포스터를 불러오는 중이에요…':'TMDB에서 작품을 선택하면 등록된 포스터를 볼 수 있어요.';
    $('posterCustomUrl').value=photo($('posterUrl').value).startsWith('https://')?$('posterUrl').value:'';
    showDialog('posterDialog');
    if(!selectedTmdb?.id)return;
    const selection=selectedTmdb;
    try{
      const res=await fetch('/api/posters?type='+encodeURIComponent(selectedTmdb.type)+'&id='+encodeURIComponent(selectedTmdb.id));
      if(!res.ok)throw Error('포스터를 가져오지 못했어요.');
      const data=await res.json();
      if(!$('posterDialog').open || selection!==selectedTmdb)return;
      const posters=(data.posters||[]).filter(p=>/^\/[a-zA-Z0-9_.-]+\.(jpg|png|webp)$/.test(p.file_path)).slice(0,36);
      $('posterGalleryInfo').textContent=posters.length?'마음에 드는 포스터를 선택하세요.':'다른 포스터가 등록되어 있지 않아요.';
      $('posterGallery').innerHTML=posters.map((p,i)=>'<button type="button" class="poster-choice" data-poster-index="'+i+'" aria-label="포스터 '+(i+1)+' 선택"><img loading="lazy" alt="" src="https://image.tmdb.org/t/p/w342'+p.file_path+'"></button>').join('');
      $('posterGallery').querySelectorAll('[data-poster-index]').forEach(b=>b.addEventListener('click',()=>{
        const p=posters[Number(b.dataset.posterIndex)];
        setPoster('https://image.tmdb.org/t/p/w500'+p.file_path);
        closeDialog('posterDialog');toast('새 포스터를 선택했어요 ✿');
      }));
    }catch{$('posterGalleryInfo').textContent='포스터를 가져오지 못했어요. 사진 업로드나 이미지 주소를 이용해 주세요.';}
  }
  async function resizePoster(file){
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>10*1024*1024)throw Error('JPG·PNG·WebP 이미지(10MB 이하)만 선택할 수 있어요.');
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      if(img.width*img.height>40000000)throw Error('이미지 크기가 너무 커요.');
      const scale=Math.min(1,480/img.width,720/img.height);
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      for(const quality of [.8,.65,.5,.35,.2]){
        const data=canvas.toDataURL('image/jpeg',quality);
        if(data.length<115000)return data;
      }
      throw Error('이미지가 너무 커서 저장할 수 없어요. 더 작은 사진을 선택해 주세요.');
    }finally{URL.revokeObjectURL(url);}
  }
  function renderOverview(){
    const overview=$('mediaOverview').value.trim();
    $('mediaOverviewPreview').classList.toggle('hidden',!overview);
    $('mediaOverviewPreview').textContent=overview;
  }
  function renderLinkedSong(){
    const title=$('songTitle').value.trim();
    const poster=photo($('songPoster').value);
    $('linkedSongPreview').classList.toggle('hidden',!title);
    $('linkedSongPreview').innerHTML=title?'<div class="linked-song-art">'+publicPhoto(poster)+'</div><div><strong>'+safe(title)+'</strong><small>'+safe($('songArtistInput').value)+'</small></div>':'';
  }
  async function searchLinkedSong(){
    const q=$('songSearch').value.trim(), seq=++songSequence;
    if(!q){toast('노래 제목이나 가수를 입력해 주세요.');return;}
    $('songSearchResults').classList.remove('hidden');
    $('songSearchResults').innerHTML='<div class="search-status">음악을 찾고 있어요…</div>';
    try{
      const results=(await musicSearch(q)).slice(0,35);
      if(seq!==songSequence)return;
      $('songSearchResults').innerHTML=results.length?results.map((r,i)=>'<button type="button" class="search-result" data-song-index="'+i+'"><div class="search-thumb">'+publicPhoto(r.poster)+'</div><div><strong>'+safe(r.title)+'</strong><small>'+safe(r.artist||'')+'</small></div><span>선택 ↗</span></button>').join(''):'<div class="search-status">검색 결과가 없어요. 음악 제목을 직접 입력할 수도 있어요.</div>';
      $('songSearchResults').querySelectorAll('[data-song-index]').forEach(btn=>btn.addEventListener('click',()=>{
        const r=results[Number(btn.dataset.songIndex)];
        $('songAlbum').value=r.album||'';$('songTitle').value=r.title;$('songId').value=r.id||'';
        $('songArtist').value=r.artist||'';$('songArtistInput').value=r.artist||'';$('songPoster').value=r.poster||'';$('songLink').value=r.link||'';
        $('songSearchResults').classList.add('hidden');renderLinkedSong();
      }));
    }catch(err){if(seq!==songSequence)return;$('songSearchResults').innerHTML='<div class="search-status">'+safe(err.message||'음악 검색에 실패했어요.')+' 직접 제목과 가수를 입력하고 유튜브 영상을 연결할 수 있어요.</div>';}
  }
  function openForm(date=today(),kind='drama',record=null){
    if(!user){openAuth('login');toast('기록은 로그인한 회원만 작성할 수 있어요.');return;}
    $('recordForm').reset();resetSearch();editingVersion=record?.version??null; draftId=record?.id||crypto.randomUUID();editorOwner=user.id;
    $('pairType').value=record?.media?.kind==='movie'||record?.media?.tmdb_type==='movie'?'movie':'drama';$('saveFeedback').textContent='';setKind(record?.kind||kind);selectedTmdb=record?.media?.tmdb_id?{id:record.media.tmdb_id,type:record.media.tmdb_type||'tv'}:null;$('tmdbId').value=selectedTmdb?.id||'';$('tmdbType').value=selectedTmdb?.type||'';$('searchResults').innerHTML='';$('searchResults').classList.add('hidden');editingId=record?.id||null;
    $('formTitle').textContent=record?'기록 수정하기':'새로운 취향 기록';$('deleteRecord').classList.toggle('hidden',!record);
    const storedDates=record?watchDates(record):{start:date,end:date};
    $('recordDate').value=storedDates.end||date;
    $('recordDateStart').value=storedDates.start||date;
    $('recordDateEnd').value=storedDates.end||date;
    $('recordDateMode').value=storedDates.start!==storedDates.end?'range':'single';
    updateWatchDateMode();
    $('dramaWatchRound').value=String(Math.max(1,Math.min(10,Number(record?.media?.watch_round)||1)));
    $('dramaEpisodeMode').value=record?.media?.episode_mode==='all'?'all':'range';
    $('dramaEpisodeStart').value=record?.media?.episode_start||'';
    $('dramaEpisodeEnd').value=record?.media?.episode_end||'';
    updateDramaEpisodeMode();
    $('mediaTitle').value=record?getTitle(record):'';$('mediaSubtitle').value=record?getMedia(record).subtitle||'':'';
    $('posterUrl').value=record?getMedia(record).poster||'':'';$('rating').value=record?.rating||'0';$('review').value=record?.review||'';$('recordTags').value=Array.isArray(record?.media?.tags)?record.media.tags.join(', '):'';
    $('musicId').value=record?.media?.musicbrainz_id||record?.media?.apple_id||'';
    $('musicArtist').value=record?.media?.artist||'';$('musicAlbum').value=record?.media?.album||'';$('musicArtistInput').value=record?.media?.artist||'';$('musicAlbumInput').value=record?.media?.album||'';$('musicYoutubeUrl').value=record?.media?.youtube_url||'';$('musicLink').value=record?.media?.link||'';
    $('releaseDate').value=record?.media?.release_date||'';$('songAlbum').value=record?.song?.album||'';$('mediaOverview').value=record?.media?.overview||'';renderOverview();
    $('songTitle').value=record?.song?.title||'';$('songId').value=record?.song?.id||'';
    $('songArtist').value=record?.song?.artist||'';$('songArtistInput').value=record?.song?.artist||'';$('songPoster').value=record?.song?.poster||'';$('songLink').value=record?.song?.link||'';$('songYoutubeUrl').value=record?.song?.youtube_url||'';
    $('connectionKind').value=record?.song?.relation||'association';
    $('scene').value=record?.scene||'';$('reason').value=record?.reason||'';renderLinkedSong();
    $('isPublic').checked=!!record?.is_public; $('isPublic').disabled=false; $('isPublic').closest('.toggle-line').querySelector('small').textContent='이 기록을 모두의 기록에 공개해요. 기본값은 비공개입니다.'; updatePreview();paintStars();showDialog('recordDialog');
  }
  function openDetail(id,isPublic,verified=null){
    const r=verified||(isPublic?publicRecords:records).find(x=>x.id===id);if(!r)return;
    currentDetail={r,isPublic};
    const media=getMedia(r),song=r.song;
    const relationLabels={association:'장면을 보면서 떠오른 노래',ost:'작품에 실제로 나온 노래',later:'노래를 듣다가 떠올린 장면'};
    const link=!isPublic && user ?'<div class="detail-browse">'+(r.kind==='music'?'':'<button type="button" class="outline-btn" data-jump="works">이 작품의 기록 더 보기</button>')+
      (song?.title||r.kind==='music'?'<button type="button" class="outline-btn" data-jump="songs">이 음악의 기록 더 보기</button>':'')+'</div>':'';
    $('detailContent').innerHTML=
      '<div class="detail-top"><div class="detail-cover">'+publicPhoto(media.poster)+'<span>✳</span></div><div><span class="section-kicker">'+safe(KINDS[r.kind]||'기록')+' · '+safe(watchDateLabel(r))+'</span><h2>'+safe(getTitle(r))+'</h2><p class="muted">'+safe([media.subtitle, media.release_date && !String(media.subtitle||'').includes(media.release_date) ? media.release_date : ''].filter(Boolean).join(' · '))+'</p><div>'+stars(Number(r.rating))+'</div><p class="visibility">'+(r.is_public?'◌ 공개 기록':'◉ 비공개 기록')+'</p></div></div>'+
      (dramaWatchLabel(r)?'<div class="detail-note"><strong>드라마 시청 기록</strong><p>'+safe(dramaWatchLabel(r))+'</p></div>':'')+
      (Array.isArray(media.tags)&&media.tags.length?'<div class="detail-tags">'+media.tags.map(t=>'<span>#'+safe(t)+'</span>').join('')+'</div>':'')+
      (media.overview?'<div class="detail-note"><strong>작품 소개</strong><p>'+safe(media.overview)+'</p></div>':'')+
      (r.kind==='music'&&youtubeUrl(media.youtube_url)?'<a class="source-link youtube-source" href="'+safe(youtubeUrl(media.youtube_url))+'" target="_blank" rel="noopener noreferrer">▶ 유튜브에서 영상 보기 ↗</a>':'')+
      (r.kind==='music'&&photo(media.link)?'<a class="source-link" href="'+safe(photo(media.link))+'" target="_blank" rel="noopener noreferrer">음악 정보 출처 보기 ↗</a>':'')+
      (song?.title?'<div class="detail-song"><div class="detail-song-art">'+publicPhoto(song.poster)+'</div><div><small>'+safe(relationLabels[song.relation]||'이 장면에 연결한 음악')+'</small><strong>'+safe(song.title)+'</strong><span>'+safe([song.artist,song.album].filter(Boolean).join(' · '))+'</span>'+(youtubeUrl(song.youtube_url)?'<a class="source-link youtube-source" href="'+safe(youtubeUrl(song.youtube_url))+'" target="_blank" rel="noopener noreferrer">▶ 유튜브에서 영상 보기 ↗</a>':'')+(photo(song.link)?'<a class="source-link" href="'+safe(photo(song.link))+'" target="_blank" rel="noopener noreferrer">음악 정보 출처 보기 ↗</a>':'')+'</div></div>':'')+
      (r.scene?'<div class="detail-note"><strong>기억하고 싶은 장면</strong><p>'+safe(r.scene)+'</p></div>':'')+
      (r.reason?'<div class="detail-note"><strong>이 노래를 고른 이유</strong><p>'+safe(r.reason)+'</p></div>':'')+
      '<div class="detail-note"><strong>나의 감상</strong><p>'+safe(r.review||'아직 감상평이 없어요.')+'</p></div>'+link;
    $('editFromDetail').classList.toggle('hidden',isPublic||!user||r.user_id!==user.id);
    $('shareRecord').classList.toggle('hidden',!r.is_public);
    showDialog('detailDialog');
  }
  function jumpToRelated(kind){
    const r=currentDetail?.r;if(!r||currentDetail?.isPublic)return;
    collectionMode=kind;selectedGroupKey=groupIdentity(r,kind);activeFilter='all';
    document.querySelectorAll('#collectionModes [data-group]').forEach(b=>b.classList.toggle('active',b.dataset.group===kind));
    document.querySelectorAll('#filters [data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter==='all'));
    $('filterSearch').value='';
    closeDialog('detailDialog');switchView('collection');
    renderCollection();
    $('groupedRecords').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function saveRecord(e){e.preventDefault();
    if(!user||!client){closeDialog('recordDialog');openAuth('login');toast('로그인 후 저장할 수 있어요.');return;}
    if (editorOwner!==user.id || $('saveRecord').disabled) return;
    const title=$('mediaTitle').value.trim();
    if(!title){toast('제목을 입력해 주세요.');return;}
    const mainYoutube=$('musicYoutubeUrl').value.trim(),linkedYoutube=$('songYoutubeUrl').value.trim();
    if(selectedKind==='music'&&mainYoutube&&!youtubeUrl(mainYoutube)){toast('유효한 유튜브 영상 주소를 입력해 주세요.');return;}
    if(selectedKind==='pair'&&linkedYoutube&&!youtubeUrl(linkedYoutube)){toast('연결한 유튜브 영상 주소를 확인해 주세요.');return;}
    if(selectedKind==='pair'&&!$('songTitle').value.trim()){toast('연결할 노래를 선택하거나 제목을 적어 주세요.');return;}
    const isMulti=$('recordDateMode').value==='range';
    const dateStart=isMulti?$('recordDateStart').value:$('recordDate').value;
    const dateEnd=isMulti?$('recordDateEnd').value:$('recordDate').value;
    if(!dateStart||!dateEnd||dateStart>dateEnd){
      $('saveFeedback').textContent='감상 시작일과 종료일을 올바르게 선택해 주세요.';
      return;
    }
    const numDays=Math.round((Date.parse(dateEnd+'T00:00:00Z')-Date.parse(dateStart+'T00:00:00Z'))/86400000)+1;
    if(numDays<1||numDays>366){
      $('saveFeedback').textContent='감상 기간은 최대 366일까지 선택할 수 있어요.';return;
    }
    const episodeMode=$('dramaEpisodeMode').value;
    const episodeStart=Number($('dramaEpisodeStart').value);
    const episodeEnd=Number($('dramaEpisodeEnd').value);
    if(selectedKind==='drama'&&episodeMode==='range'&&(
        !Number.isInteger(episodeStart)||!Number.isInteger(episodeEnd)||
        episodeStart<1||episodeEnd<episodeStart||episodeEnd>9999||
        !$('dramaEpisodeStart').value||!$('dramaEpisodeEnd').value)){
      $('saveFeedback').textContent='시작 화와 마지막 화를 올바르게 입력해 주세요. 예: 3화~6화.';
      return;
    }
    const existing=records.find(r=>r.id===editingId);
    // The existing Supabase constraints require media.kind, media.key,
    // and (for pairs) song.kind plus a scene and a reason.
    const mediaKind=selectedKind==='pair'?$('pairType').value:selectedKind;
    const stableKey=selectedKind==='music'&&$('musicId').value.trim()
      ? 'music:'+String($('musicId').value.trim())
      : $('tmdbId').value.trim()
        ? 'tmdb:'+mediaKind+':'+$('tmdbId').value.trim()
        : 'manual:'+mediaKind+':'+title.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g,' ').slice(0,195);
    if(selectedKind==='pair'&&(!$('scene').value.trim()||!$('reason').value.trim())){
      $('saveFeedback').textContent='음악과 장면 기록에는 장면 설명과 연결한 이유가 모두 필요해요.';
      $('scene').focus();return;
    }
    $('saveFeedback').textContent='';
    const tags=[...new Set($('recordTags').value.split(',').map(t=>t.trim().replace(/^#+/,'').replace(/\s+/g,' ').slice(0,24)).filter(Boolean))];
    if(tags.length>6){$('saveFeedback').textContent='태그는 최대 6개까지 저장할 수 있어요.';$('recordTags').focus();return;}
    const payload={kind:selectedKind,media:{key:stableKey.slice(0,220),kind:mediaKind,title,tags,release_date:$('releaseDate').value,subtitle:$('mediaSubtitle').value.trim(),poster:photo($('posterUrl').value.trim()),tmdb_id:Number($('tmdbId').value)||null,tmdb_type:$('tmdbType').value||null,apple_id:selectedKind==='music'?Number($('musicId').value)||null:null,musicbrainz_id:selectedKind==='music'?$('musicId').value.trim()||null:null,artist:selectedKind==='music'?$('musicArtistInput').value.trim():'',album:selectedKind==='music'?$('musicAlbumInput').value.trim():'',youtube_url:selectedKind==='music'?youtubeUrl(mainYoutube):'',link:selectedKind==='music'?photo($('musicLink').value):'',overview:$('mediaOverview').value.trim().slice(0,1600),
      watch_start:dateStart,watch_end:dateEnd,
      ...(selectedKind==='drama'?{
        watch_round:Number($('dramaWatchRound').value),
        episode_mode:episodeMode,
        episode_start:episodeMode==='range'?episodeStart:null,
        episode_end:episodeMode==='range'?episodeEnd:null
      }:{})},song:selectedKind==='pair'?{kind:'music',title:$('songTitle').value.trim(),id:$('songId').value.trim()||null,album:$('songAlbum').value.trim(),artist:$('songArtistInput').value.trim(),poster:photo($('songPoster').value),youtube_url:youtubeUrl(linkedYoutube),link:photo($('songLink').value),relation:$('connectionKind').value}:null,record_date:dateEnd,rating:Number($('rating').value),scene:selectedKind==='pair'?$('scene').value.trim():'',reason:selectedKind==='pair'?$('reason').value.trim():'',review:$('review').value.trim(),is_public:!!user && $('isPublic').checked};
    // Keep additional metadata on unmodified legacy selections.
    if (existing?.media?.title === title && existing.kind === selectedKind) payload.media = {...existing.media,...payload.media};
    if(selectedKind!=='drama'){
      delete payload.media.watch_round;
      delete payload.media.episode_mode;
      delete payload.media.episode_start;
      delete payload.media.episode_end;
    }
    if (payload.song && existing?.song?.title === payload.song.title) payload.song = {...existing.song,...payload.song};
    const button=$('saveRecord');button.disabled=true;button.textContent='저장 중…';
    try{
      let result;
      if(editingId) {
        result=await table().update(payload).eq('id',editingId).eq('user_id',user.id).eq('version',editingVersion).select('id').maybeSingle();
        if(!result.error && !result.data) throw Error('다른 창에서 변경되거나 삭제된 기록이에요. 닫고 다시 열어 최신 내용을 확인해 주세요.');
      } else {
        result=await table().insert({...payload,id:draftId,user_id:user.id}).select('id').single();
        if(result.error?.code==='23505') {
          const retry=await table().select('*').eq('id',draftId).eq('user_id',user.id).maybeSingle();
          const same=(a,b)=>a===b || (a && b && typeof a==='object' && typeof b==='object' && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>same(a[k],b[k])));
          if(!retry.error && retry.data && Object.entries(payload).every(([k,v])=>same(v,retry.data[k]))) result=retry;
        }
      }
      if(result.error)throw result.error;
      if(editorOwner!==user?.id) return;
      viewDate=new Date(payload.record_date+'T12:00:00');
      closeDialog('recordDialog');toast('감상 기록을 저장했어요.');await loadRecords();
      if(existing?.is_public || payload.is_public) await loadPublic();
    }catch(err){
      const message=err.code==='23514'?'제목·날짜·장면 등 필수 입력과 이미지 크기를 확인해 주세요.':
        err.code==='42501'?'내 계정의 기록만 수정할 수 있어요. 로그인 상태를 확인해 주세요.':
        /fetch|network/i.test(err.message||'')?'인터넷 연결을 확인한 뒤 다시 저장해 주세요.':err.message||'잠시 후 다시 시도해 주세요.';
      $('saveFeedback').textContent='저장하지 못했어요. '+message;
    }finally{button.disabled=false;button.textContent=editingId?'수정 저장':'기록 저장';}
  }
  async function deleteRecord(){if(!user||!client)return;if(!editingId||!confirm('이 기록을 삭제할까요? 삭제 후 되돌릴 수 없어요.'))return;
    try{const old=records.find(r=>r.id===editingId);if(user&&client){const {data,error}=await table().delete().eq('id',editingId).eq('user_id',user.id).eq('version',editingVersion).select('id').maybeSingle();if(error)throw error;if(!data)throw Error('다른 창에서 변경되었어요. 다시 열어 확인해 주세요.');}
      closeDialog('recordDialog');toast('기록을 삭제했어요.');await loadRecords();if(old?.is_public)await loadPublic();
    }catch(err){toast('삭제하지 못했어요: '+err.message);}
  }
  function setAuthMode(mode){
    authMode=mode;
    const signup=mode==='signup',reset=mode==='reset',update=mode==='update';
    $('signupNicknameLabel').classList.toggle('hidden',!signup);
    $('signupNickname').disabled=!signup;
    $('signupNickname').required=signup;
    $('authTitle').textContent=signup?'모아봄 회원가입':reset?'비밀번호 변경 링크 받기':update?'새 비밀번호 설정':'모아봄에 로그인';
    $('authDescription').textContent=signup?'계정을 만들고 나만의 기록을 모아보세요.':reset?'가입한 이메일로 비밀번호 변경 링크를 보내드릴게요.':update?'새로운 비밀번호를 입력해 주세요.':'내 감상을 안전하게 기록하고 언제든 다시 꺼내보세요.';
    $('passwordLabel').classList.toggle('hidden',reset);$('authPassword').required=!reset;
    $('authPassword').autocomplete=(signup||update)?'new-password':'current-password'; $('email').disabled=update; $('authPassword').disabled=reset; $('authPasswordConfirm').disabled=!(signup||update);
    $('confirmPasswordLabel').classList.toggle('hidden',!(signup||update));
    $('email').closest('label').classList.toggle('hidden',update);$('email').required=!update;
    $('authPasswordConfirm').required=signup||update;
    $('authSubmit').textContent=signup?'회원가입':reset?'변경 링크 받기':update?'비밀번호 변경하기':'로그인';
    document.querySelectorAll('[data-authmode]').forEach(b=>b.classList.toggle('active',b.dataset.authmode===mode));
    $('authMessage').textContent=signup?'닉네임, 이메일, 비밀번호를 입력해 가입해요. 이메일 확인 여부는 서비스 설정에 따릅니다.':reset?'메일함에서 비밀번호 변경 안내를 확인해 주세요.':update?'새 비밀번호를 설정하면 변경이 완료됩니다.':'기록은 회원만 작성할 수 있고, 공개 기록은 누구나 볼 수 있어요.';
  }
  function openAuth(mode='login'){setAuthMode(mode);showDialog('authDialog');}
  async function login(e){
    e.preventDefault();
    if(!client){$('authMessage').textContent='서버 연결이 준비되지 않았어요.';return;}
    const email=$('email').value.trim(),password=$('authPassword').value;
    const submit=$('authSubmit');submit.disabled=true;
    try{
      let response;
      if(authMode==='reset'){
        response=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
        if(response.error)throw response.error;
        $('authMessage').textContent='비밀번호 변경 안내를 이메일로 보냈어요.';return;
      }
      if(password.length<8){$('authMessage').textContent='비밀번호는 최소 8자 이상이어야 해요.';return;}
      if(authMode==='signup'||authMode==='update'){
        if(password!==$('authPasswordConfirm').value){$('authMessage').textContent='비밀번호가 일치하지 않아요.';return;}
        if(authMode==='update'){
          response=await client.auth.updateUser({password});
          if(response.error)throw response.error;
          $('authPassword').value='';$('authPasswordConfirm').value='';
          closeDialog('authDialog');toast('비밀번호를 변경했어요.');return;
        }
        const signupNickname=accountNickname($('signupNickname').value);
        if(!signupNickname){
          $('authMessage').textContent='회원가입할 때 사용할 닉네임을 입력해 주세요.';
          $('signupNickname').focus();
          return;
        }
        response=await client.auth.signUp({email,password,options:{
          emailRedirectTo:location.origin+location.pathname,
          data:{nickname:signupNickname}
        }});
        if(response.error)throw response.error;
        if(response.data?.session){
          $('authPassword').value='';$('authPasswordConfirm').value='';
          closeDialog('authDialog');await refreshAuth();toast('회원가입이 완료됐어요. 바로 기록을 남길 수 있어요.');
        }else{
          $('authMessage').textContent='계정이 만들어졌지만 아직 로그인할 수 없어요. 현재 서버에서 이메일 확인을 요구하고 있습니다. 서비스 관리자가 이메일 확인 설정을 변경해야 바로 가입할 수 있어요.';
        }
        return;
      }
      response=await client.auth.signInWithPassword({email,password});
      if(response.error)throw response.error;
      $('authPassword').value='';$('authPasswordConfirm').value='';
      closeDialog('authDialog');await refreshAuth();toast('로그인했어요.');
    }catch(error){$('authMessage').textContent='계정 요청을 완료하지 못했어요: '+String(error?.message||'잠시 후 다시 시도해 주세요.');}
    finally{submit.disabled=false;}
  }
  async function refreshAuth(){
    if(!client){user=null;records=[];render();return;}
    const authRequest=++authSequence;
    const {data,error}=await client.auth.getUser();
    if(authRequest!==authSequence)return;
    const previousId=user?.id;
    user=error?null:data.user||null;
    setNicknameBadge();
    $('authButton').querySelector('span').textContent='로그인';

    $('collectionAdd').textContent=user?'＋ 기록 추가':'＋ 로그인하고 기록하기';
    if(previousId!==user?.id) {
      for(const id of ['posterDialog','recordDialog','detailDialog','dayDialog','spaceDialog','profileDialog']) if($(id).open) closeDialog(id);
      resetSpaceImageEditor();
      spaceReadSequence++;spaceItems=[];spaceOwner=null;
      rewatchSequence++;rewatches=[];rewatchOwner=null;
      currentDetail=null; editorOwner=null; records=[]; render();
      await loadRecords();
    }
    if(user&&getLegacyGuestCount()>0&&!localStorage.getItem('moabom-guest-imported:'+user.id))$('guestImport').classList.remove('hidden');
    else $('guestImport').classList.add('hidden');
  }
  async function authClick(){
    if(user&&client){const {error}=await client.auth.signOut();if(error){toast('로그아웃하지 못했어요. 다시 시도해 주세요.');return;}await refreshAuth();toast('로그아웃했어요.');}
    else openAuth('login');
  }
  async function importGuestRecords(){
    if(!user||!client)return;
    const old=getGuest();if(!old.length)return;
    if(!confirm('이 브라우저에 남아 있는 이전 게스트 기록 '+old.length+'개를 내 계정에 복사할까요? 원본은 그대로 보관됩니다.'))return;
    const owner=user.id, button=$('guestImport');button.disabled=true;
    let success=0;
    try {
      for(const [index,r] of old.entries()) {
        if(user?.id!==owner)break;
        const kind=r.kind, m=r.media||{}, title=String(m.title||'').trim();
        if(!KINDS[kind]||!title)throw Error('제목이나 기록 종류가 없는 항목이 있어요.');
        const work=kind==='pair'?(m.kind==='movie'||m.tmdb_type==='movie'?'movie':'drama'):kind;
        // The same legacy entry always maps to the same UUID for this account.
        const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+'|guest|'+(r.id||index+'|'+r.record_date+'|'+title))));
        bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
        const hex=Array.from(bytes.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');
        const id=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
        const {error}=await table().insert({id,user_id:owner,kind,media:{...m,title,kind:work,key:m.key||('manual:'+work+':'+title).slice(0,220)},
          song:kind==='pair'&&r.song?{...r.song,kind:'music'}:null,record_date:r.record_date,
          rating:r.rating||0,scene:r.scene||'',reason:r.reason||'',review:r.review||'',is_public:false});
        if(error&&error.code!=='23505')throw Error('가져올 수 없는 항목이 있어요. 원본은 이 브라우저에 있어요.');
        success++;
      }
      if(success===old.length)localStorage.setItem('moabom-guest-imported:'+owner,'yes');
      toast(success+'개 기록을 확인했어요.');
    } catch(error){toast(success+'개 처리 후 중단했어요. '+error.message);}
    finally{button.disabled=false;await loadRecords();if(success===old.length)button.classList.add('hidden');}
  }
  function normalizeTmdb(item,type) {
    const date=item.first_air_date || item.release_date || '';
    const title=item.name || item.title;
    const original=item.original_name || item.original_title || '';
    return {id:item.id,tmdbType:type,title,original,date,source:'TMDB',
      subtitle:[date,original && original!==title ? original : ''].filter(Boolean).join(' · '),
      poster:item.poster_path?'https://image.tmdb.org/t/p/w500'+item.poster_path:'',
      overview:String(item.overview || '').slice(0,1600)};
  }
  async function tmdbSearch(q,kind,page) {
    const type=kind==='movie'?'movie':'tv';
    const res=await fetch('/api/search?'+new URLSearchParams({type,q,page}),{signal:AbortSignal.timeout(14000)});
    if(!res.ok) throw Error('작품 검색 서비스에 연결할 수 없어요.');
    const data=await res.json();
    return {items:(data.results||[]).map(i=>normalizeTmdb(i,type)),more:page<data.total_pages};
  }
  // Music metadata is separate from user-selected YouTube video links.
  async function musicSearch(q){
    const res=await fetch('/api/music?q='+encodeURIComponent(q));
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(data.error||'음악 검색 연결에 실패했어요.');
    return (data.results||[]).map(item=>({
      id:item.id,title:item.title||'',artist:item.artist||'',album:item.album||'',
      subtitle:[item.artist,item.album,item.year].filter(Boolean).join(' · '),
      poster:item.poster||'',source:item.source||'MusicBrainz',link:item.link||''
    }));
  }
  const youtubeUrl = value => {
    const raw=String(value||'').trim();if(!raw)return '';
    try{
      const url=new URL(raw);
      const host=url.hostname.toLowerCase();
      if(url.protocol!=='https:'||url.username||url.password)return '';
      if(host==='youtu.be'){
        const id=url.pathname.slice(1).split('/')[0];
        return /^[A-Za-z0-9_-]{11}$/.test(id)?'https://www.youtube.com/watch?v='+id:'';
      }
      if(['www.youtube.com','youtube.com','m.youtube.com','music.youtube.com'].includes(host)){
        const segment=url.pathname.split('/').filter(Boolean);
        const id=segment[0]==='watch'?url.searchParams.get('v'):(['shorts','live','embed'].includes(segment[0])?segment[1]:'');
        return /^[A-Za-z0-9_-]{11}$/.test(id||'')?'https://www.youtube.com/watch?v='+id:'';
      }
      return '';
    }catch{return '';}
  };
  function openYoutubeSearch(title,artist){
    const query=[title,artist].filter(Boolean).join(' ').trim();
    window.open(query?'https://www.youtube.com/results?search_query='+encodeURIComponent(query):'https://www.youtube.com/','_blank','noopener,noreferrer');
  }
  let searchSequence=0;
  async function searchMedia(append=false) {
    const q=$('mediaSearch').value.trim();
    if(!q || q.length>100){toast('검색어는 1~100자로 입력해 주세요.');return;}
    const kind=selectedKind==='pair'?$('pairType').value:selectedKind;
    const same=selectedSearch?.q===q && selectedSearch?.kind===kind;
    const next=append===true && same;
    const page=next?catalogPage+1:1;
    if(!next){catalogItems=[];catalogMore=false;}
    const seq=++searchSequence;
    selectedSearch={q,kind};
    const box=$('searchResults');
    box.classList.remove('hidden'); box.setAttribute('aria-busy','true');
    if(!next) box.textContent='검색하고 있어요…';
    else if(box.querySelector('[data-more]')) box.querySelector('[data-more]').disabled=true;
    try {
      const data=kind==='music'?{items:await musicSearch(q),more:false}:await tmdbSearch(q,kind,page);
      if(seq!==searchSequence)return;
      catalogPage=page; catalogMore=data.more;
      const merged=new Map(catalogItems.map(r=>[r.source+':'+r.id,r]));
      for(const r of data.items) if(r.title)merged.set(r.source+':'+r.id,r);
      catalogItems=[...merged.values()];
      renderSearchResults(box);
    } catch(e) {
      if(seq!==searchSequence)return;
      if(next) renderSearchResults(box); else box.replaceChildren();
      const msg=document.createElement('p');msg.className='search-status';
      msg.textContent=(e.message||'외부 검색 연결에 실패했어요.')+' 다시 검색하거나 아래에 직접 입력하세요.';box.append(msg);
    } finally { if(seq===searchSequence)box.removeAttribute('aria-busy'); }
  }
  function renderSearchResults(box){
    box.innerHTML=catalogItems.length?catalogItems.map((r,i)=>
      '<button type="button" class="search-result" data-search-index="'+i+'"><span class="search-thumb">'+publicPhoto(r.poster)+'</span><div><strong>'+safe(r.title)+'</strong><small>'+safe([r.subtitle,r.source].filter(Boolean).join(' · '))+'</small></div><span>선택</span></button>'
    ).join(''):'<p class="search-status">검색 결과가 없어요. 아래에 직접 입력할 수 있어요.</p>';
    if(catalogMore)box.insertAdjacentHTML('beforeend','<button type="button" class="outline-btn" data-more>검색 결과 더 보기</button>');
  }
  function pickResult(index) {
    const r=catalogItems[index]; if(!r)return;
    const music=selectedKind==='music';
    $('mediaTitle').value=r.title; $('mediaSubtitle').value=r.subtitle||'';
    $('musicId').value=music?r.id||'':'';
    $('musicArtistInput').value=music?r.artist||'':'';
    $('musicAlbumInput').value=music?r.album||'':'';
    $('musicLink').value=music?r.link||'':'';
    $('releaseDate').value=r.date||'';
    $('mediaOverview').value=music?'':r.overview||'';renderOverview();
    selectedTmdb=r.source==='TMDB'&&r.id?{id:r.id,type:r.tmdbType}:null;
    $('tmdbId').value=selectedTmdb?.id||'';$('tmdbType').value=selectedTmdb?.type||'';
    $('posterUrl').value=r.poster||'';updatePreview();$('searchResults').classList.add('hidden');
  }

  function bind(){
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    document.querySelectorAll('[data-target]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();switchView(b.dataset.target);}));
    ['cardRecord','cardTemplate','cardCaption','cardShowRating','cardShowDate'].forEach(id=>{
      $(id).addEventListener(id==='cardCaption'?'input':'change',renderPhotoCard);
    });
    $('cardDownload').addEventListener('click',downloadPhotoCard);
    $('rewatchOriginal').addEventListener('change',syncRewatchChoices);
    $('rewatchForm').addEventListener('submit',saveRewatch);
    $('rewatchResults').addEventListener('click',e=>{
      const del=e.target.closest('[data-rewatch-delete]');
      if(del)return deleteRewatch(del.dataset.rewatchDelete);
      const card=e.target.closest('[data-rewatch-detail]');
      if(card)openDetail(card.dataset.rewatchDetail,false);
    });
    $('gardenPeriod').addEventListener('change',renderGarden);
    $('gardenCanvas').addEventListener('click',e=>{const flower=e.target.closest('[data-garden-id]');if(flower)openDetail(flower.dataset.gardenId,false);else if(e.target.closest('[data-first]'))openForm();});
    $('moodChoices').addEventListener('click',e=>{const b=e.target.closest('[data-mood-id]');if(b){moodId=b.dataset.moodId;renderMood();}});
    document.querySelectorAll('[data-mood-kind]').forEach(el=>el.addEventListener('change',()=>renderMood()));
    $('moodRefresh').addEventListener('click',()=>renderMood(true));
    $('moodResults').addEventListener('click',e=>{const b=e.target.closest('[data-mood-record]');if(b)openPublicDetail(b.dataset.moodRecord);});
    $('newRecord').addEventListener('click',()=>openForm());$('collectionAdd').addEventListener('click',()=>openForm());
    $('prevMonth').addEventListener('click',()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1);renderCalendar();});
    $('nextMonth').addEventListener('click',()=>{viewDate=new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1);renderCalendar();});
    $('todayButton').addEventListener('click',()=>{viewDate=new Date();renderCalendar();});
    $('calendarSearch').addEventListener('input',searchMyCalendarRecords);
    $('calendarSearch').addEventListener('keydown',e=>{if(e.key==='Escape'){$('calendarSearch').value='';searchMyCalendarRecords();}});
    $('calendarSearchResults').addEventListener('click',e=>{const card=e.target.closest('[data-id]');if(!card)return;const record=records.find(r=>r.id===card.dataset.id);if(record){$('calendarSearch').value='';searchMyCalendarRecords();viewDate=new Date(record.record_date+'T12:00:00');renderCalendar();openDetail(record.id,false);}});
    $('calendarKinds').addEventListener('click',e=>{const btn=e.target.closest('[data-calendar-kind]');if(!btn)return;calendarKind=btn.dataset.calendarKind;document.querySelectorAll('#calendarKinds button').forEach(b=>{const active=b===btn;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});renderCalendar();});
    $('dayRecords').addEventListener('click',e=>{const card=e.target.closest('[data-id]');if(card){closeDialog('dayDialog');openDetail(card.dataset.id,false);}});
    $('dayNew').addEventListener('click',()=>{closeDialog('dayDialog');openForm(selectedDate,calendarKind==='all'?'drama':calendarKind);});
    $('recentRecords').addEventListener('click',e=>{if(e.target.closest('[data-first]'))openForm();});
    $('calendar').addEventListener('click',e=>{const list=e.target.closest('[data-daylist]');if(list)return showDay(list.dataset.daylist);const add=e.target.closest('[data-add]');const card=e.target.closest('[data-id]');if(add)return openForm(add.dataset.add,calendarKind==='all'?'drama':calendarKind);if(card)return openDetail(card.dataset.id,false);const day=e.target.closest('[data-date]');if(day)openForm(day.dataset.date,calendarKind==='all'?'drama':calendarKind);});
    ['recentRecords','collectionRecords','publicRecords'].forEach(id=>$(id).addEventListener('click',e=>{const card=e.target.closest('[data-id]');if(card){if(card.dataset.public==='1')openPublicDetail(card.dataset.id);else openDetail(card.dataset.id,false);}}));
    $('filters').addEventListener('click',e=>{const el=e.target.closest('[data-filter]');if(!el)return;activeFilter=el.dataset.filter;selectedGroupKey=null;document.querySelectorAll('.pill').forEach(b=>b.classList.toggle('selected',b===el));renderCollection();});
    $('collectionModes').addEventListener('click',e=>{
      const btn=e.target.closest('[data-group]');if(!btn)return;
      collectionMode=btn.dataset.group;selectedGroupKey=null;
      document.querySelectorAll('#collectionModes [data-group]').forEach(b=>b.classList.toggle('active',b===btn));
      renderCollection();
    });
    $('groupedRecords').addEventListener('click',e=>{
      const record=e.target.closest('.record-card[data-id]');
      if(record)return openDetail(record.dataset.id,false);
      if(e.target.closest('[data-group-close]'))selectedGroupKey=null;
      else{const group=e.target.closest('[data-groupid]');if(!group)return;selectedGroupKey=group.dataset.groupid;}
      renderCollection();
    });
    $('guestImport').addEventListener('click',importGuestRecords);
    $('filterSearch').addEventListener('input',renderCollection);
    $('recordSort').addEventListener('change',renderCollection);
    $('exportJson').addEventListener('click',()=>exportMyRecords('json'));
    $('exportCsv').addEventListener('click',()=>exportMyRecords('csv'));
    let searchTimer; $('publicSearch').addEventListener('input',()=>{publicSequence++;clearTimeout(searchTimer);searchTimer=setTimeout(loadPublic,250);});
    $('morePublic').addEventListener('click',()=>loadPublic(true));
    $('publicSort').addEventListener('change',()=>loadPublic());
    $('refreshPublic').addEventListener('click',loadPublic);
    $('discoverPublic').addEventListener('click',discoverPublicRecord);
    $('recommendDirection').addEventListener('change',()=>{
      const direction=$('recommendDirection').value;
      if(direction==='workToMusic')$('recommendKind').value='music';
      else if(direction==='musicToWork')$('recommendKind').value='all';
      if(recommendLoaded)rankRecommendationCandidates();else loadRecommendations();
    });
    $('recommendKind').addEventListener('change',()=>{if(recommendLoaded){rankRecommendationCandidates();$('recommendStatus').textContent='조건에 맞는 추천 '+recommendRanked.length+'개를 골랐어요.';}else loadRecommendations();});
    $('recommendRegion').addEventListener('change',()=>{if(recommendLoaded){rankRecommendationCandidates();$('recommendStatus').textContent='조건에 맞는 추천 '+recommendRanked.length+'개를 골랐어요.';}else loadRecommendations();});
    $('recommendRefresh').addEventListener('click',()=>loadRecommendations(true));
    $('recommendMore').addEventListener('click',()=>{recommendPage++;renderRecommendations();});
    $('recommendResults').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)openPublicDetail(b.dataset.id);});
    $('spacesTabs').addEventListener('click',e=>{const b=e.target.closest('[data-space-kind]');if(b)changeSpaceKind(b.dataset.spaceKind);});
    $('spaceAdd').addEventListener('click',()=>openSpaceForm());
    $('spacesResults').addEventListener('click',e=>{
      if(e.target.closest('[data-space-login]'))return openAuth('login');
      if(e.target.closest('[data-space-add]'))return openSpaceForm();
      const record=e.target.closest('[data-space-record]');if(record)return openDetail(record.dataset.spaceRecord,false);
      const edit=e.target.closest('[data-space-edit]');if(edit){
        const entry=spaceItems.find(s=>s.id===edit.dataset.spaceEdit);
        if(entry)openSpaceForm(entry);
      }
    });
    $('spaceKind').addEventListener('change',syncSpaceFormKind);
    $('spaceForm').addEventListener('submit',saveSpace);
    $('spaceDelete').addEventListener('click',deleteSpace);
    $('spaceImageFile').addEventListener('change',e=>{
      clearSpaceObjectUrl();
      const file=e.target.files?.[0];
      if(!file){refreshSpaceImagePreview($('spaceImageUrl').value);return;}
      if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>5*1024*1024){
        $('spaceImageStatus').textContent='JPG·PNG·WebP, 5MB 이하 이미지만 가능해요.';
        e.target.value='';return;
      }
      spaceImageRemoved=false;
      $('spaceImageUrl').value='';
      spaceImageObjectUrl=URL.createObjectURL(file);
      refreshSpaceImagePreview(spaceImageObjectUrl);
      // Blob URLs are local previews, never persisted or sent to the database.
      $('spaceImagePreview').src=spaceImageObjectUrl;
      $('spaceImagePreview').classList.remove('hidden');
      $('spaceImageRemove').classList.remove('hidden');
      $('spaceImageStatus').textContent='사진을 선택했어요. 기억 저장 시 업로드됩니다.';
    });
    $('spaceImageUrl').addEventListener('input',()=>{
      if($('spaceImageUrl').value.trim()){
        clearSpaceObjectUrl();$('spaceImageFile').value='';spaceImageRemoved=false;
      }
      refreshSpaceImagePreview($('spaceImageUrl').value);
    });
    $('spaceImageRemove').addEventListener('click',()=>{
      resetSpaceImageEditor();
      spaceImageRemoved=true;
      $('spaceImageUrl').value='';
      $('spaceImageStatus').textContent='저장하면 사진이 제거됩니다.';
    });
    $('connectionCanvas').addEventListener('click',e=>{if(e.target.closest('[data-first]'))return openForm();const node=e.target.closest('[data-connection-id]');if(node)openDetail(node.dataset.connectionId,false);});
    $('publicFilters').addEventListener('click',e=>{
      const b=e.target.closest('[data-public-filter]');if(!b)return;
      publicFilter=b.dataset.publicFilter;
      document.querySelectorAll('#publicFilters [data-public-filter]').forEach(x=>x.classList.toggle('selected',x===b));
      loadPublic();
    });
    document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close)));
    document.querySelectorAll('.dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
    $('kindTabs').addEventListener('click',e=>{const b=e.target.closest('[data-kind]');if(b)setKind(b.dataset.kind);});
    $('recordDateMode').addEventListener('change',updateWatchDateMode);
    $('dramaEpisodeMode').addEventListener('change',updateDramaEpisodeMode);
    $('starRating').addEventListener('click',e=>{const b=e.target.closest('[data-star]');if(!b)return;$('rating').value=String(Number(b.dataset.star)==Number($('rating').value)?0:Number(b.dataset.star));paintStars();});
    $('changePoster').addEventListener('click',openPosterPicker);
    for(const p of ['Tmdb','Upload','Link'])$('posterTab'+p).addEventListener('click',()=>choosePosterPane(p));
    $('posterGoogle').addEventListener('click',()=>{const q=$('mediaTitle').value.trim()||$('mediaSearch').value.trim();if(!q){toast('먼저 작품 이름을 입력해 주세요.');return;}window.open('https://www.google.com/search?tbm=isch&q='+encodeURIComponent(q+' 포스터'),'_blank','noopener,noreferrer');});
    $('posterUpload').addEventListener('change',async e=>{
      const file=e.target.files?.[0], draft=draftId;if(!file)return;
      $('uploadStatus').textContent='사진을 조정하고 있어요…';
      try{const result=await resizePoster(file);if(draft!==draftId||!$('posterDialog').open||!setPoster(result))return;$('uploadStatus').textContent='사진을 선택했어요. 저장하면 기록에 함께 보관돼요.';closeDialog('posterDialog');}
      catch(err){$('uploadStatus').textContent=err.message||'사진을 처리할 수 없어요.';}
      finally{e.target.value='';}
    });
    $('applyPosterUrl').addEventListener('click',()=>{if(setPoster($('posterCustomUrl').value.trim())){closeDialog('posterDialog');toast('포스터를 변경했어요.');}});
    $('resetPoster').addEventListener('click',()=>{setPoster('');closeDialog('posterDialog');});
    $('pairType').addEventListener('change',()=>{clearMedia();setKind('pair');});
    $('mediaSearch').addEventListener('input',()=>{searchSequence++; catalogItems=[];catalogMore=false;$('searchResults').classList.add('hidden');});
    $('songSearch').addEventListener('input',()=>{songSequence++;$('songSearchResults').classList.add('hidden');});
    $('searchResults').addEventListener('click',e=>{
      if(e.target.closest('[data-more]')) return searchMedia(true);
      const btn=e.target.closest('[data-search-index]');if(btn)pickResult(Number(btn.dataset.searchIndex));
    });
    $('searchBtn').addEventListener('click',searchMedia);$('mediaSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchMedia();}});
    $('songSearchBtn').addEventListener('click',searchLinkedSong);
    $('songSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchLinkedSong();}});
    $('songTitle').addEventListener('input',()=>{$('songId').value='';$('songPoster').value='';$('songLink').value='';renderLinkedSong();});
    $('songArtistInput').addEventListener('input',()=>{$('songArtist').value=$('songArtistInput').value;$('songId').value='';renderLinkedSong();});
    $('musicArtistInput').addEventListener('input',()=>{$('musicArtist').value=$('musicArtistInput').value;$('musicId').value='';});
    $('musicAlbumInput').addEventListener('input',()=>{$('musicAlbum').value=$('musicAlbumInput').value;});
    $('musicYoutubeSearch').addEventListener('click',()=>openYoutubeSearch($('mediaTitle').value,$('musicArtistInput').value));
    $('songYoutubeSearch').addEventListener('click',()=>openYoutubeSearch($('songTitle').value,$('songArtistInput').value));
    $('mediaTitle').addEventListener('input',()=>{$('releaseDate').value='';selectedTmdb=null;$('tmdbId').value='';$('tmdbType').value='';$('musicId').value='';$('musicLink').value='';$('mediaOverview').value='';renderOverview();});
    $('recordForm').addEventListener('submit',saveRecord);$('deleteRecord').addEventListener('click',deleteRecord);
    $('editFromDetail').addEventListener('click',()=>{const r=currentDetail?.r;closeDialog('detailDialog');if(r)openForm(r.record_date,r.kind,r);});
    $('shareRecord').addEventListener('click',shareCurrentRecord);
    $('detailContent').addEventListener('click',e=>{const b=e.target.closest('[data-jump]');if(b)jumpToRelated(b.dataset.jump);});
    $('authForm').addEventListener('submit',login);$('authButton').addEventListener('click',authClick);
    $('profileButton').addEventListener('click',toggleAccountMenu);
    $('accountEditNickname').addEventListener('click',openNicknameProfile);
    $('accountLogout').addEventListener('click',async()=>{closeAccountMenu();await authClick();});
    document.addEventListener('click',event=>{
      if(!$('accountMenu').classList.contains('hidden')&&!event.target.closest('.account-menu-wrap'))closeAccountMenu();
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!$('accountMenu').classList.contains('hidden')){
        closeAccountMenu();$('profileButton').focus();
      }
    });
    $('profileForm').addEventListener('submit',saveNicknameProfile);
    $('creditsButton').addEventListener('click',()=>showDialog('creditsDialog'));
    document.querySelectorAll('[data-authmode]').forEach(btn=>btn.addEventListener('click',()=>setAuthMode(btn.dataset.authmode)));
  }
  async function init(){
    bind();$('recordDate').value=today();render();
    if(client)client.auth.onAuthStateChange((event)=>{
      if(event==='PASSWORD_RECOVERY'){
        setTimeout(()=>{setAuthMode('update');if(!$('authDialog').open)showDialog('authDialog');},0);
      } else setTimeout(refreshAuth,0);
    });
    await refreshAuth();
    if(location.hash.includes('type=recovery'))setTimeout(()=>{setAuthMode('update');if(!$('authDialog').open)showDialog('authDialog');},400);
    if(new URLSearchParams(location.search).has('record'))await openSharedRecord();
  }
  init();
})();
