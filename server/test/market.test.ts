/// <reference lib="dom" />
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run, one, all } from '../db/open.ts';
import { migrate } from '../db/migrate.ts';
import { loadConfig } from '../config.ts';
import type { JobCtx } from '../../sync/types.ts';
import { run as syncPrices } from '../../sync/prices.ts';
import { run as syncCards } from '../../sync/cards.ts';
import { marketOverride } from '../../sync/market.ts';
import { marketConflict, parseTcgNumber } from '../../sync/sources/prices.tcgcsv.ts';
import { fetchDotggPrices } from '../../sync/sources/prices.dotgg.ts';
import { parseHash, buildHash } from '../../web/src/lib/router.ts';

function setup(t: TestContext) {
  const db = openDb(':memory:');
  const cfg = loadConfig([], {});
  migrate(db, cfg.migrationsDir);
  t.after(() => db.close());
  run(db, "INSERT INTO sets(code,name,printed_total,updated_at) VALUES ('VEN','Vendetta',166,'2026-09-01')");
  const card = (id: string, num: string, name: string, product: number | null, kind: string | null) => run(db,
    "INSERT INTO cards(id,set_code,number,number_int,name,tcgplayer_id,variant_kind,updated_at) VALUES (?,'VEN',?,69,?,?,?,'2026-09-01')", id,num,name,product,kind);
  card('VEN-069a', '069a', 'Mel', 706065, 'alt_art');
  card('VEN-069b-P', '069b-P', 'Mel - Newly Awakened (Vendetta Nexus Night Promo)', 706065, 'promo');
  const ctx: JobCtx = { db,cfg,flags:{source:'tcgcsv'},log:{info(){},warn(){},error(){},debug(){}},signal:new AbortController().signal,trigger:'manual',progress(){},afterCommit(){} };
  const state = { down: false, promoPricesDown: false, ambiguous: false, reverse: false, promo: true, groupCalls: 0 };
  const dotgg = { names:['id','name','name_normal','type','set_name','promo','marketIds','hasFoil','foilPrice'],data:[
    ['VEN-069A','Mel - Newly Awakened','Mel - Newly Awakened',['Unit'],'Vendetta','0','706065','1','3.46'],
    ['VEN-069B-P','Mel - Newly Awakened (Vendetta Nexus Night Promo)','Mel - Newly Awakened',['Unit'],'Vendetta','1','706065','1','3.46'],
  ] };
  t.mock.method(globalThis,'fetch',async(input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if(url.includes('api.dotgg.gg')) return Response.json(dotgg);
    if(url.includes('riotgames')) return new Response('down',{status:403});
    if(state.down) return new Response('down',{status:403});
    if(url.endsWith('/groups')) {
      state.groupCalls++;
      const groups = [{groupId:1,name:'Vendetta',abbreviation:'VEN'}, ...(state.promo ? [{groupId:2,name:'Riftbound Organized Play Promotional Cards',abbreviation:'OPP'}] : [])];
      return Response.json({results:state.reverse ? groups.reverse():groups});
    }
    const promo = url.includes('/2/');
    if(url.endsWith('/products')) return Response.json({results:[{productId:promo ? 709987:706065,name:promo ? 'Mel, Newly Awakened':'Mel, Newly Awakened (Alternate Art)',extendedData:[{name:'Number',value:promo?'069b/166':'069a/166'}]},...(promo && state.ambiguous ? [{productId:999,name:'Mel, Newly Awakened',extendedData:[{name:'Number',value:'069b/166'}]}]:[])]});
    if(url.endsWith('/prices')) {
      if(promo && state.promoPricesDown) return new Response('down',{status:403});
      return Response.json({results:[{productId:promo?709987:706065,subTypeName:'Foil',marketPrice:promo?100:3.46},{productId:promo?709987:706065,subTypeName:'Normal',marketPrice:promo?80:2}]});
    }
    throw new Error(url);
  });
  return {ctx,db,state,card};
}

test('card hash round trips preserve promo and alternate artwork IDs on every page', () => {
  for(const id of ['VEN-069b-P','VEN-069a','SFD-227s','VEN-R01b-P','UNL-T01','VEN-SP3']) {
    for(const page of ['collection','decks'] as const) {
      assert.equal(parseHash(buildHash({page,cardId:id})).cardId,id);
      assert.equal(parseHash(buildHash({page,cardId:id.toUpperCase()})).cardId,id);
    }
  }
});

test('corrects Mel globally, archives wrong history, preserves finishes and survives catalog refresh', async(t) => {
  const {ctx,db,state} = setup(t);
  run(db,"INSERT INTO prices(card_id,finish,usd_market,source,source_ref,fetched_at) VALUES ('VEN-069b-P','foil',3.46,'tcgplayer','706065','2026-09-01')");
  run(db,"INSERT INTO price_history(card_id,finish,day,usd_market) VALUES ('VEN-069b-P','foil','2026-09-01',3.46)");
  state.reverse = true;
  const result = await syncPrices(ctx);
  assert.equal(result.failed,0);
  assert.equal(marketOverride(db,'VEN-069b-P'),709987);
  assert.equal(marketOverride(db,'VEN-069a'),706065);
  assert.equal(one<{usd_market:number}>(db,"SELECT usd_market FROM prices WHERE card_id='VEN-069b-P' AND finish='foil'")!.usd_market,100);
  assert.equal(one<{usd_market:number}>(db,"SELECT usd_market FROM prices WHERE card_id='VEN-069b-P' AND finish='normal'")!.usd_market,80);
  assert.equal(all(db,'SELECT * FROM price_corrections').length,1);
  assert.equal(all(db,"SELECT * FROM price_history WHERE day='2026-09-01'").length,0);
  const fallback = await fetchDotggPrices(ctx);
  assert.equal(fallback.rows.some((r)=>r.card_id==='VEN-069b-P'),false);
  await syncCards({...ctx,flags:{source:'riot'}});
  assert.equal(one<{tcgplayer_id:number}>(db,"SELECT tcgplayer_id FROM cards WHERE id='VEN-069b-P'")!.tcgplayer_id,709987);
  await syncPrices(ctx);
  assert.equal(all(db,'SELECT * FROM price_corrections').length,1);
  assert.equal(state.groupCalls,2);
  const before = JSON.stringify(all(db,'SELECT * FROM prices ORDER BY card_id,finish'));
  state.down=true;
  await syncPrices(ctx);
  // DotGG may refresh regular cards on outage; corrected promo must retain its validated price.
  assert.ok(before.includes('100'));
  assert.equal(one<{usd_market:number}>(db,"SELECT usd_market FROM prices WHERE card_id='VEN-069b-P' AND finish='foil'")!.usd_market,100);
});

test('rejects ambiguous promo products, retaining the listing without a borrowed price',async(t)=>{
  const {ctx,db,state}=setup(t); state.ambiguous=true;
  await syncPrices(ctx);
  assert.equal(marketOverride(db,'VEN-069b-P'),null);
  assert.equal(all(db,"SELECT * FROM prices WHERE card_id='VEN-069b-P'").length,0);
  state.ambiguous=false;
  await syncPrices(ctx);
  assert.equal(marketOverride(db,'VEN-069b-P'),709987);
});

test('validates products even when their price endpoint fails; next scan fills missing prices',async(t)=>{
  const {ctx,db,state}=setup(t); state.promoPricesDown=true;
  const result=await syncPrices(ctx);
  assert.equal(result.failed,1);
  assert.equal(marketOverride(db,'VEN-069b-P'),709987);
  assert.equal(all(db,"SELECT * FROM prices WHERE card_id='VEN-069b-P'").length,0);
  state.promoPricesDown=false;
  await syncPrices(ctx);
  assert.equal(all(db,"SELECT * FROM prices WHERE card_id='VEN-069b-P'").length,2);
});

test('discovers a group introduced since the preceding scan',async(t)=>{
  const {ctx,db,state}=setup(t); state.promo=false;
  await syncPrices(ctx);
  assert.equal(marketOverride(db,'VEN-069b-P'),null);
  state.promo=true;
  await syncPrices(ctx);
  assert.equal(marketOverride(db,'VEN-069b-P'),709987);
});

test('unvalidated duplicate market IDs cannot supply promo fallback prices',async(t)=>{
  const {ctx}=setup(t);
  const result=await fetchDotggPrices(ctx);
  assert.equal(result.rows.some((r)=>r.card_id==='VEN-069b-P'),false);
  assert.equal(result.rows.some((r)=>r.card_id==='VEN-069a'),true);
});


test('promo context respects word boundaries, rarity, awards, and explicit oversized set associations', () => {
  const set={code:'UNL',name:'Unleashed',printed_total:219};
  const group={groupId:1,name:'Unleashed'};
  const base={id:'UNL-043',set_code:'UNL',number:'043',name:'Enthusiastic Promoter',tcgplayer_id:685489,variant_kind:null};
  assert.equal(marketConflict(base,{productId:685489,name:'Enthusiastic Promoter',extendedData:[{name:'Number',value:'043/219'}]},group,set,[set]),null);
  assert.equal(marketConflict({...base,id:'UNL-R04b',number:'R04b',variant_kind:'promo',name:'Body Rune (Unleashed Nexus Night Promo)'},{productId:694646,name:'Body Rune (R04b)',extendedData:[{name:'Number',value:'R04b'},{name:'Rarity',value:'Promo'}]},group,set,[set]),null);
  const promoGroup={groupId:2,name:'Organized Play Promotional Cards'};
  const champion={...base,id:'UNL-043-P-CHAMPION',number:'043-P-CHAMPION',variant_kind:'promo',name:'Enthusiastic Promoter (Champion Promo)'};
  assert.equal(marketConflict(champion,{productId:1,name:'Enthusiastic Promoter',extendedData:[{name:'Number',value:'043/219'}]},promoGroup,undefined,[set]),'promo award differs');
  assert.equal(marketConflict({...base,id:'OGN-279-OVERSIZED',set_code:'OGN',number:'279-OVERSIZED',variant_kind:'oversized'},{productId:1,name:'Fortified Position (Oversized)',extendedData:[{name:'Number',value:'279/298'}]},{groupId:3,name:'Origins: Proving Grounds'},{code:'OGS',name:'Origins: Proving Grounds',printed_total:24},[{code:'OGN',name:'Origins',printed_total:298}]),null);
});


test('collector codes in new alphanumeric sets distinguish player and signature bundles', () => {
  assert.deepEqual(parseTcgNumber('T1A 001/005'),{prefix:'',number_int:1,suffix:'',total:5});
  const card={id:'T1A-001',set_code:'T1A',number:'001',name:'Ambessa - The Wolf (T1 Player Bundle)',tcgplayer_id:null,variant_kind:'promo'};
  const product={productId:716012,name:'Ambessa, The Wolf (T1 Signature Bundle)',extendedData:[{name:'Number',value:'T1S 001/005'}]};
  assert.equal(marketConflict(card,product,{groupId:1,name:'Promotional Cards'},undefined,[]),'printed set code differs');
});

test('new bundle cards resolve by printed set code without mistaking Worlds Champion for an award',async(t)=>{
  const {ctx,db}=setup(t);
  run(db,"INSERT INTO sets(code,name,updated_at) VALUES ('T1A','T1 Worlds','2026-09-01')");
  run(db,"INSERT INTO cards(id,set_code,number,number_int,name,variant_kind,updated_at) VALUES ('T1A-001-P','T1A','001-P',1,'Ambessa - The Wolf (T1 Worlds Player Bundle - Doran)','promo','2026-09-01')");
  t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0])=>{
    const url=String(input);
    if(url.endsWith('/groups')) return Response.json({results:[{groupId:3,name:'Riftbound Promotional Cards'}]});
    if(url.endsWith('/products')) return Response.json({results:[
      {productId:716010,name:'Ambessa, The Wolf (T1 Worlds Champion Player Bundle)',extendedData:[{name:'Number',value:'T1A 001/005'}]},
      {productId:716012,name:'Ambessa, The Wolf (T1 Worlds Champion Signature Bundle)',extendedData:[{name:'Number',value:'T1S 001/005'}]},
    ]});
    if(url.endsWith('/prices')) return Response.json({results:[{productId:716010,subTypeName:'Foil',marketPrice:50},{productId:716012,subTypeName:'Foil',marketPrice:500}]});
    throw new Error(url);
  });
  await syncPrices(ctx);
  assert.equal(marketOverride(db,'T1A-001-P'),716010);
  assert.equal(one<{usd_market:number}>(db,"SELECT usd_market FROM prices WHERE card_id='T1A-001-P'")!.usd_market,50);
});
