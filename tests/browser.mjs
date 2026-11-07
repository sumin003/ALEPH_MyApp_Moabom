// Run against an isolated HTTP fixture. Uses the same official Auth/PostgREST SDK as production.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(process.env.MOABOM_TEST_MODULES ? path.join(process.env.MOABOM_TEST_MODULES,'package.json') : import.meta.url);
const {chromium}=require('playwright');
const sdk=path.join(path.dirname(require.resolve('@supabase/supabase-js/package.json')),'dist/umd/supabase.js');
const records=new Map();
const owner='11111111-1111-4111-8111-111111111111';
const account={id:owner,aud:'authenticated',role:'authenticated',email:'reader@example.invalid',email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{nickname:'봄기록'},identities:[]};
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt=[b64({alg:'HS256',typ:'JWT'}),b64({sub:owner,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600}),b64('test-signature')].join('.');
const errors=[];
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://127.0.0.1');
    function send(body,type='application/json',status=200){
      res.writeHead(status,{'Content-Type':type});res.end(type==='application/json'?JSON.stringify(body):body);
    }
    let input='';for await(const chunk of req)input+=chunk;
    const data=input?JSON.parse(input):{};
    if(u.pathname==='/config.js')return send('window.APP_CONFIG={SUPABASE_URL:location.origin,SUPABASE_PUBLISHABLE_KEY:"test-publishable"}','application/javascript');
    if(u.pathname==='/test-sdk.js')return send(await readFile(sdk),'application/javascript');
    if(u.pathname==='/auth/v1/token')return send({access_token:jwt,token_type:'bearer',expires_in:3600,refresh_token:'test-only-refresh-token',user:account});
    if(u.pathname==='/auth/v1/user')return send(account);
    if(u.pathname==='/auth/v1/logout')return send({});
    if(u.pathname==='/auth/v1/recover')return send({});
    if(u.pathname==='/auth/v1/signup')return send({...account,email_confirmed_at:null});
    if(u.pathname==='/rest/v1/taste_journal_records'||u.pathname==='/rest/v1/taste_journal_public_feed'){
      const publicFeed=u.pathname.endsWith('taste_journal_public_feed');
      const signedIn=req.headers.authorization==='Bearer '+jwt;
      let rows=[...records.values()].filter(r=>r.is_public||(!publicFeed&&signedIn&&r.user_id===owner));
      for(const key of ['id','user_id','is_public','kind','version']) {
        const v=u.searchParams.get(key);if(v)rows=rows.filter(r=>String(r[key])===v.slice(3));
      }
      if(req.method==='POST'){
        assert(!publicFeed && signedIn && data.user_id===owner);assert(data.media.key && data.media.kind);
        if(data.kind==='pair')assert(data.song.kind==='music'&&data.scene&&data.reason);else assert.equal(data.song,null);
        const row={...data,id:data.id,created_at:new Date().toISOString(),version:1};
        records.set(row.id,row);return send(row,'application/json',201);
      }
      if(req.method==='PATCH'||req.method==='DELETE'){
        assert(!publicFeed && signedIn && u.searchParams.has('version'));assert(!Object.hasOwn(data,'updated_at'));
        for(const row of rows)if(req.method==='PATCH')Object.assign(row,data,{version:row.version+1});else records.delete(row.id);
      }
      res.setHeader('content-range',rows.length?'0-'+(rows.length-1)+'/'+rows.length:'*/0');
      if(req.headers.accept?.includes('vnd.pgrst.object'))return send(rows[0]||null);
      return send(rows);
    }
    if(u.pathname==='/api/search'){
      if(u.searchParams.get('q')==='오프라인')return send({error:'upstream'},'application/json',502);
      const movie=u.searchParams.get('type')==='movie',second=u.searchParams.get('page')==='2';
      return send({total_pages:2,results:[{id:second?18:17,name:movie?undefined:'봄의 기록',title:movie?'봄의 영화':undefined,original_name:'Spring',first_air_date:'2024-03-02',overview:'작품 소개',poster_path:'/spring.jpg'}]});
    }
    if(u.pathname==='/api/posters')return send({posters:[{file_path:'/other.jpg'}]});
    if(u.pathname==='/api/music')return send({results:[{id:'apple:100',title:'봄 노래',artist:'봄 가수',album:'새 앨범',source:'Apple Music',link:'https://example.invalid/track'}]});
    const file=u.pathname==='/'?'index.html':u.pathname.slice(1);
    if(!['index.html','app.js','styles.css','assets/pressed-flowers.svg','assets/moabom-flower.svg','assets/Pretendard-Regular.woff2','assets/Pretendard-Bold.woff2','assets/approved_cherry_tree.jpg'].includes(file))return send({},'application/json',404);
    const ext=path.extname(file), types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.svg':'image/svg+xml','.css':'text/css','.woff2':'font/woff2','.jpg':'image/jpeg'};
    let body=await readFile(path.join(root,file));
    if(ext==='.html')body=body.toString().replace(/https:\/\/cdn\.jsdelivr\.net[^"]+supabase\.min\.js/,'/test-sdk.js');
    return send(body,types[ext]);
  }catch(e){errors.push(e.message);res.statusCode=500;res.end('Fixture error');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox',...(process.env.MOABOM_CHROME_ARGS?JSON.parse(process.env.MOABOM_CHROME_ARGS):[])]});
try {
  const context=await browser.newContext({viewport:{width:1366,height:740},timezoneId:'Asia/Seoul'});
  const page=await context.newPage();
  const sel=id=>page.locator('#'+id);
  const click=async id=>sel(id).click();
  const fill=async(id,value)=>sel(id).fill(value);
  const waitText=async(id,expected)=>page.waitForFunction(([id,t])=>document.getElementById(id)?.textContent===t,[id,expected],{timeout:6000});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://image.tmdb.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="55" height="80"><rect width="55" height="80" fill="#a1b58e"/></svg>'}));
  await page.goto(url);
  await page.waitForSelector('.day-cell[data-date]');
  const initial=await sel('monthLabel').innerText();
  await click('nextMonth');assert.notEqual(await sel('monthLabel').innerText(),initial);
  await click('prevMonth');await waitText('monthLabel',initial);await click('prevMonth');await click('todayButton');await waitText('monthLabel',initial);
  await click('newRecord');await sel('authDialog').waitFor({state:'visible'});
  await click('authSignupTab');await fill('signupNickname','봄기록');await fill('email','reader@example.invalid');await fill('authPassword','test-password-only');await fill('authPasswordConfirm','test-password-only');
  await click('authSubmit');await sel('authMessage').filter({hasText:'이메일 확인'}).waitFor({timeout:7000});
  await click('authResetTab');await click('authSubmit');await sel('authMessage').filter({hasText:'이메일로 보냈어요'}).waitFor();
  await click('authLoginTab');await fill('authPassword','test-password-only');await click('authSubmit');await sel('authDialog').waitFor({state:'hidden'});
  await waitText('profileDisplayName','봄기록');assert.equal(await sel('profileButton').isVisible(),true);
  const date=await page.locator('.is-today').getAttribute('data-date');
  for(const kind of ['drama','movie','music','pair']){
    await page.locator('[data-add="'+date+'"]').click();
    await page.locator('#kindTabs [data-kind="'+kind+'"]').click();
    assert.equal(await sel('pairFields').isVisible(),kind==='pair');
    if(kind==='pair')await sel('pairType').selectOption('movie');
    await fill('mediaSearch','봄');await click('searchBtn');await page.locator('[data-search-index="0"]').waitFor();
    if(kind==='drama'){
      await page.locator('[data-more]').click();await page.locator('[data-search-index="1"]').waitFor();
    }
    await page.locator('[data-search-index="0"]').click();
    if(kind!=='music')assert.equal(await sel('releaseDate').inputValue(),'2024-03-02');
    if(kind==='drama'){
      // The drama editor now requires explicit episode bounds or the all-episodes choice.
      await fill('dramaEpisodeStart','1');await fill('dramaEpisodeEnd','4');
      assert.equal(await sel('dramaWatchRound').inputValue(),'1');
      await click('changePoster');await page.locator('[data-poster-index="0"]').click();assert.match(await sel('posterUrl').inputValue(),/other.jpg/);
      await click('changePoster');await click('posterTabUpload');
      await sel('posterUpload').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKXcAAAAASUVORK5CYII=','base64')});
      await sel('posterDialog').waitFor({state:'hidden'});assert.match(await sel('posterUrl').inputValue(),/^data:image\/jpeg/);
    }
    if(kind==='movie'){await click('changePoster');await click('posterTabLink');await fill('posterCustomUrl','https://image.tmdb.org/t/p/w500/custom.jpg');await click('applyPosterUrl');}
    if(kind==='music')assert.equal(await sel('musicAlbumInput').inputValue(),'새 앨범');
    if(kind==='pair'){
      await fill('songSearch','봄');await click('songSearchBtn');await page.locator('[data-song-index="0"]').click();
      await fill('scene','봄밤에 걸어가는 장면');await fill('reason','기타 소리가 어울렸다');await sel('connectionKind').selectOption('later');
      await fill('songYoutubeUrl','https://youtu.be/abcdefghijk');await sel('isPublic').check();
    }
    await page.locator('[data-star="4"]').click();await page.locator('[data-star="4"]').click();assert.equal(await sel('rating').inputValue(),'0');
    await page.locator('[data-star="5"]').click();await fill('review',kind+' 감상');
    await click('saveRecord');await sel('recordDialog').waitFor({state:'hidden'});
    if(kind==='drama'){
      const saved=[...records.values()].find(r=>r.kind==='drama');
      assert.equal(saved.media.watch_round,1);
      assert.equal(saved.media.episode_start,1);
      assert.equal(saved.media.episode_end,4);
    }
    await waitText('railTotal',String(records.size));
  }
  assert.equal(records.size,4);await waitText('railRating','5.0');await waitText('allTotal','4');
  for(const key of ['Drama','Movie','Music','Pair'])await waitText('rail'+key,'1');
  await page.reload();await waitText('railTotal','4');
  await page.locator('[data-calendar-kind="music"]').click();assert.equal(await page.locator('.day-poster').count(),1);
  await page.locator('[data-calendar-kind="all"]').click();await page.locator('[data-daylist]').click();assert.equal(await page.locator('#dayRecords .mini-record').count(),4);
  await page.locator('#dayRecords .mini-record').first().click();await sel('detailDialog').waitFor({state:'visible'});await page.locator('#detailDialog button[data-close]').last().click();
  await click('nextMonth');await waitText('railTotal','0');await waitText('allTotal','4');await click('todayButton');
  // Check real layout geometry, pointer and keyboard focus, document-flow scroll.
  for(const width of [1366,768,390,320]){
    await page.setViewportSize({width,height:640});
    await page.evaluate(()=>document.fonts.ready);
    assert(await page.evaluate(()=>document.fonts.check('16px Pretendard','모아봄')));
    const metrics=await page.evaluate(()=>{
      const rect=id=>document.getElementById(id).getBoundingClientRect(), a=rect('prevMonth'),b=rect('monthLabel'),c=rect('nextMonth'),d=rect('todayButton');
      return {width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:a.right<=b.left+.1&&b.right<=c.left+.1&&c.right<=d.left+.1,hit:a.width>=44&&c.height>=44};
    });
    assert(metrics.scroll<=width && metrics.buttons && metrics.hit,'Layout '+JSON.stringify(metrics));
    const before=await page.locator('.spring-rail').evaluate(el=>el.getBoundingClientRect().top+scrollY);
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    const after=await page.locator('.spring-rail').evaluate(el=>el.getBoundingClientRect().top+scrollY);
    assert(Math.abs(before-after)<1,'Summary rail must scroll with the document');
    await page.evaluate(()=>scrollTo(0,0));
    if(process.env.CAPTURE_DIR){await mkdir(process.env.CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CAPTURE_DIR,'calendar-'+width+'.png'),fullPage:true});}
    await click('prevMonth');assert.equal(await sel('prevMonth').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
    await page.keyboard.press('Tab');assert.equal(await sel('nextMonth').evaluate(el=>el.matches(':focus-visible')),true);
    await click('todayButton');
  }
  await page.locator('[data-view="collection"]').click();await page.locator('[data-group="works"]').click();
  assert.equal(await page.locator('.group-card').count(),2);
  await page.locator('[data-group="songs"]').click();assert.equal(await page.locator('.group-card').count(),1);
  for(const [id,extension] of [['exportJson','json'],['exportCsv','csv']]){
    const download=page.waitForEvent('download');await click(id);assert((await download).suggestedFilename().endsWith('.'+extension));
  }
  const pair=[...records.values()].find(r=>r.kind==='pair');assert.equal(pair.song.album,'새 앨범');
  const guest=await browser.newPage();guest.on('pageerror',e=>errors.push(e.message));
  await guest.goto(url+'/?record='+pair.id);await guest.locator('#detailDialog[open]').waitFor();assert.equal(await guest.locator('#editFromDetail').isVisible(),false);
  assert.match(await guest.locator('.youtube-source').getAttribute('href'),/watch\?v=abcdefghijk/);
  await page.locator('[data-group="entries"]').click();await page.locator('#collectionRecords [data-id="'+pair.id+'"]').click();await click('editFromDetail');await sel('isPublic').uncheck();await fill('review','다시 본 감상');await click('saveRecord');await sel('recordDialog').waitFor({state:'hidden'});
  assert.equal(records.get(pair.id).version,2);assert.equal(records.get(pair.id).review,'다시 본 감상');
  await guest.reload();await guest.locator('#toast').filter({hasText:'비공개'}).waitFor();assert.equal(await guest.locator('#detailDialog').isVisible(),false);
  await page.locator('#collectionRecords [data-id="'+pair.id+'"]').click();await click('editFromDetail');page.once('dialog',d=>d.accept());await click('deleteRecord');await sel('recordDialog').waitFor({state:'hidden'});assert.equal(records.size,3);
  await page.locator('[data-view="calendar"]').click();await waitText('railTotal','3');
  await click('profileButton');await click('accountLogout');await waitText('railTotal','0');assert.deepEqual(errors,[]);
  console.log('PASS — four record types, calendar navigation/overflow/filters, alternate and uploaded covers, rating toggle, edit/delete, grouped records, public revocation, exports, session, document scroll and 1366/768/390/320px layouts');
} finally {
  await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));
}
