#!/usr/bin/env node
/**
 * Historical, date-ordered replay of the First Basket opening-role blend.
 *
 * Uses ESPN's game-dated scoreboard/PBP/boxscore records and PBP Stats' opening
 * shots. ESPN boxscores expose actual starters after games, so this is a
 * lineup-conditioned retrospective replay, not proof the same lineups were
 * confirmed before tip. All feature histories are cut off before each game.
 * The synthetic fb_database.sqlite is intentionally not read.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateGameFirstBasketMonteCarlo } from '../../src/sports/nba/logic/firstBasketEngine.js';
import { blendRecentOpeningRole } from '../../src/sports/nba/logic/openingRoleForm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE_FILE = resolve(ROOT,'dist/nba/historical-pbp-replay-cache-2024-now.json');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const PBP_STATS = 'https://api.pbpstats.com/get-shots/nba';
const NBA_TEAM_IDS = {
  ATL:1610612737,BOS:1610612738,BKN:1610612751,CHA:1610612766,CHI:1610612741,CLE:1610612739,
  DAL:1610612742,DEN:1610612743,DET:1610612765,GSW:1610612744,HOU:1610612745,IND:1610612754,
  LAC:1610612746,LAL:1610612747,MEM:1610612763,MIA:1610612748,MIL:1610612749,MIN:1610612750,
  NOP:1610612740,NYK:1610612752,OKC:1610612760,ORL:1610612753,PHI:1610612755,PHX:1610612756,
  POR:1610612757,SAC:1610612758,SAS:1610612759,TOR:1610612761,UTA:1610612762,WAS:1610612764,
};
const ESPN_ABBR = { NY:'NYK', GS:'GSW', NO:'NOP', SA:'SAS', UTAH:'UTA' };
const ZONES = ['rim', 'mid', 'three'];
const PRIORS = { rim: 0.65, mid: 0.42, three: 0.36 };
const PRIORMIX = {
  C:{rim:.65,mid:.15,three:.20}, PF:{rim:.45,mid:.30,three:.25}, SF:{rim:.25,mid:.30,three:.45},
  SG:{rim:.25,mid:.30,three:.45}, PG:{rim:.25,mid:.30,three:.45},
};
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, '');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

async function getJson(url, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${url}`),{status:response.status,retryable:response.status===429 || response.status>=500});
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts && error.retryable!==false) await sleep(error.status===503 || error.status===429 ? Math.min(15000,3000 * (2 ** attempt)) : 300 * (attempt + 1));
      else if (error.retryable===false) break;
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

async function mapLimit(values, limit, worker) {
  const out = new Array(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      out[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

function dateRange(start, end) {
  const dates = [];
  for (let d = new Date(`${start}T12:00:00Z`), last = new Date(`${end}T12:00:00Z`); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10).replaceAll('-', ''));
  }
  return dates;
}

function chicagoDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(iso));
}

function canonicalTeam(abbr) {
  const value = String(abbr || '').toUpperCase();
  return ESPN_ABBR[value] || value;
}

export function extractGame(summary, event) {
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  const eventTeams = new Map(competitors.map(row => [String(row.team.id), {
    abbr: canonicalTeam(row.team.abbreviation), side: row.homeAway,
  }]));
  const rosterById = new Map();
  const starters = { home: [], away: [] };
  for (const group of summary?.boxscore?.players || []) {
    const teamAbbr = canonicalTeam(group.team?.abbreviation);
    const side = [...eventTeams.values()].find(item => item.abbr === teamAbbr)?.side;
    if (!side) continue;
    for (const athleteGroup of group.statistics || []) for (const row of athleteGroup.athletes || []) {
      const athlete = row.athlete;
      if (!athlete?.id) continue;
      const player = {
        id:String(athlete.id), name:athlete.displayName, team:teamAbbr,
        position:normalizePosition(athlete.position?.abbreviation), starter:row.starter === true,
      };
      rosterById.set(player.id, player);
      if (player.starter) starters[side].push(player);
    }
  }
  for (const side of ['home','away']) starters[side].sort((a,b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));

  const plays = (summary?.plays || []).map(play => ({
    id:String(play.id || ''), seq:Number(play.sequenceNumber), period:Number(play.period?.number),
    teamId:String(play.team?.id || ''), type:String(play.type?.text || ''), text:String(play.text || ''),
    scoring:play.scoringPlay === true, shooting:play.shootingPlay === true,
    points:Number(play.scoreValue) || 0, pointsAttempted:Number(play.pointsAttempted) || 0,
    participantIds:(play.participants || []).map(row => String(row.athlete?.id || '')).filter(Boolean),
  })).sort((a,b) => a.seq - b.seq);
  const openingTip = plays.find(play => play.period === 1 && /jump\s*ball/i.test(play.type) && play.participantIds.length >= 2) || null;
  const firstFieldGoal = plays.find(play => play.period === 1 && play.shooting && play.scoring &&
    [2,3].includes(play.points) && !/free throw/i.test(play.type) && play.participantIds.length > 0) || null;
  return {
    eventId:String(event.id), eventAt:event.date, localDate:chicagoDate(event.date),
    name:event.name, home:starters.home[0]?.team || [...eventTeams.values()].find(x=>x.side==='home')?.abbr,
    away:starters.away[0]?.team || [...eventTeams.values()].find(x=>x.side==='away')?.abbr,
    starters, rosterById:Object.fromEntries(rosterById), teamByEspnId:Object.fromEntries([...eventTeams].map(([id,x])=>[id,x.abbr])),
    plays, openingTip, firstFieldGoal,
  };
}

function normalizePosition(raw) {
  const value = String(raw || '').toUpperCase();
  if (value.includes('C')) return 'C';
  if (value.includes('F')) return value.includes('G') ? 'SF' : 'PF';
  if (value.includes('G')) return value.includes('F') ? 'SF' : 'PG';
  return 'SF';
}

function classifyZone(play) {
  if (play.pointsAttempted === 3 || /three point|3-point/i.test(`${play.type} ${play.text}`)) return 'three';
  return /layup|dunk|tip|alley.?oop|hook|finger roll|putback|driving|floating/i.test(`${play.type} ${play.text}`) ? 'rim' : 'mid';
}

function updatePlayerShotHistory(game, playerShots, teamDefense) {
  for (const play of game.plays) {
    if (!play.shooting || ![2,3].includes(play.pointsAttempted) || !play.participantIds.length) continue;
    const shooterId = play.participantIds[0];
    const shooter = game.rosterById[shooterId];
    const offense = game.teamByEspnId[play.teamId] || shooter?.team;
    const zone = classifyZone(play);
    const row = playerShots.get(shooterId) || Object.fromEntries(ZONES.map(z => [z,{attempts:0,makes:0}]));
    row[zone].attempts++;
    if (play.scoring && play.points === play.pointsAttempted) row[zone].makes++;
    playerShots.set(shooterId,row);
    const defense = offense === game.home ? game.away : game.home;
    const allowed = teamDefense.get(defense) || Object.fromEntries(ZONES.map(z => [z,{attempts:0,makes:0}]));
    allowed[zone].attempts++;
    if (play.scoring && play.points === play.pointsAttempted) allowed[zone].makes++;
    teamDefense.set(defense,allowed);
  }
}

function openingRowsFor(team, beforeDate, pbpOpening) {
  const season = seasonForDate(beforeDate);
  return (pbpOpening.get(`${season}:${team}`) || []).filter(row => row.game_date && row.game_date < beforeDate && Number(row.poss_num) <= 2);
}

function seasonForDate(date) {
  const year=Number(date.slice(0,4)), month=Number(date.slice(5,7));
  return `${month>=10 ? year : year-1}-${String((month>=10 ? year+1 : year)%100).padStart(2,'0')}`;
}

function uniqueOpeningShots(rows) {
  const byGame = new Map();
  for (const row of rows) {
    const prior = byGame.get(String(row.gid));
    if (!prior || Number(row.shot_time) > Number(prior.shot_time)) byGame.set(String(row.gid),row);
  }
  return [...byGame.values()];
}

export function roleShares(team, starters, game, pbpOpening, includeRecent) {
  const beforeDate = game.localDate;
  const seasonRows = uniqueOpeningShots(openingRowsFor(team,beforeDate,pbpOpening));
  const priorCounts = starters.map(() => 0);
  const nameIndexes = new Map(starters.map((player,index) => [norm(player.name),index]));
  for (const row of seasonRows) {
    const index = nameIndexes.get(norm(row.player));
    if (index != null) priorCounts[index]++;
  }
  const pseudoGames = 20;
  const base = starters.map((player,index) => ({
    ...player,
    earlyShotShare:(priorCounts[index] + pseudoGames / starters.length) /
      (priorCounts.reduce((sum,count)=>sum+count,0) + pseudoGames),
  }));
  if (!includeRecent) return base;
  const window = limit => {
    const selected = uniqueOpeningShots(openingRowsFor(team,beforeDate,pbpOpening))
      .sort((a,b)=>String(b.game_date).localeCompare(String(a.game_date)) || String(b.gid).localeCompare(String(a.gid)))
      .slice(0,limit);
    const counts = {};
    for (const row of selected) {
      const key = norm(row.player);
      counts[key] = (counts[key] || 0) + 1;
    }
    return { sampleGames:selected.length, shotCount:Object.values(counts).reduce((sum,count)=>sum+count,0), byPlayer:counts };
  };
  return blendRecentOpeningRole(base,{last5:window(5),last10:window(10)});
}

function historicalTipProbability(game, jumperHistory) {
  const homeJumper = game.starters.home.find(player=>player.position==='C') || game.starters.home[0];
  const awayJumper = game.starters.away.find(player=>player.position==='C') || game.starters.away[0];
  if (!homeJumper?.id || !awayJumper?.id) return 0.5;
  const shrunk = id => {
    const row = jumperHistory.get(id) || { attempts:0,wins:0 };
    return (row.wins + 10) / (row.attempts + 20);
  };
  const pHome = shrunk(homeJumper.id), pAway = shrunk(awayJumper.id);
  const logit = p => Math.log(p / (1-p));
  const d = logit(pHome) - logit(pAway);
  return 1 / (1 + Math.exp(-d));
}

function currentJumpOutcome(game) {
  const tip = game.openingTip;
  if (!tip || tip.participantIds.length < 3) return null;
  const winner = game.rosterById[tip.participantIds[2]]?.team || game.teamByEspnId[tip.teamId];
  return { jumperIds:tip.participantIds.slice(0,2), winner };
}

function updateJumpHistory(game, jumperHistory) {
  const result = currentJumpOutcome(game);
  if (!result?.winner) return;
  for (const id of result.jumperIds) {
    const player = game.rosterById[id];
    if (!player) continue;
    const row = jumperHistory.get(id) || { attempts:0,wins:0 };
    row.attempts++;
    if (player.team === result.winner) row.wins++;
    jumperHistory.set(id,row);
  }
}

function playerFeatures(player, playerShots, defense, rolePlayer) {
  const prior = playerShots.get(player.id) || Object.fromEntries(ZONES.map(zone=>[zone,{attempts:0,makes:0}]));
  const priorMix = PRIORMIX[player.position] || PRIORMIX.SF;
  const mixWeight = 20;
  const totalAttempts = ZONES.reduce((sum,zone)=>sum+prior[zone].attempts,0);
  const shotMix = Object.fromEntries(ZONES.map(zone=>[zone,
    (prior[zone].attempts + priorMix[zone]*mixWeight)/(totalAttempts+mixWeight)]));
  const zoneFG = Object.fromEntries(ZONES.map(zone=>{
    const sample = prior[zone];
    const attemptsPrior = zone === 'mid' ? 20 : 30;
    const raw = (sample.makes + PRIORS[zone]*attemptsPrior)/(sample.attempts+attemptsPrior);
    const factor = zone === 'three' ? defense?.threeFactor ?? 1 : 1;
    return [zone,Math.max(zone==='rim'?.50:.28,Math.min(zone==='rim'?.82:.55,raw*factor))*100];
  }));
  return { ...player, ...rolePlayer, team:player.team, isStarter:true, shotMix, zoneFG, ftRate:.28, ftPct:.78,
    turnoverRate:12.5, orebRate:26 };
}

function metrics(rows, treatment) {
  const subset = rows.map(row=>row[treatment]);
  const covered = subset.filter(row=>row.actualInPool);
  const calibration = [];
  const edges = [0,.06,.09,.12,.15,.20,1.01];
  for (let i=0;i<edges.length-1;i++) {
    const vals = [];
    for (const row of subset) for (const player of row.players) if (player.prob >= edges[i] && player.prob < edges[i+1]) vals.push({prob:player.prob,hit:player.id===row.actualId});
    if (vals.length) calibration.push({range:`${Math.round(edges[i]*100)}-${Math.round(edges[i+1]*100)}%`,n:vals.length,
      predicted:vals.reduce((s,v)=>s+v.prob,0)/vals.length,observed:vals.filter(v=>v.hit).length/vals.length});
  }
  return {
    games:subset.length, actualStarterCoverage:covered.length/subset.length,
    top1Hits:subset.filter(row=>row.top1Hit).length, top1Rate:subset.filter(row=>row.top1Hit).length/subset.length,
    top1RateCovered:covered.length ? covered.filter(row=>row.top1Hit).length/covered.length : null,
    top3Rate:subset.filter(row=>row.top3Hit).length/subset.length,
    meanActualRankCovered:covered.length ? covered.reduce((sum,row)=>sum+row.actualRank,0)/covered.length : null,
    logLossCovered:covered.length ? -covered.reduce((sum,row)=>sum+Math.log(Math.max(1e-6,row.actualProb)),0)/covered.length : null,
    multiclassBrierCovered:covered.length ? covered.reduce((sum,row)=>sum+row.players.reduce((s,p)=>s+(p.prob-(p.id===row.actualId?1:0))**2,0),0)/covered.length : null,
    expectedTop1:subset.reduce((sum,row)=>sum+row.topProb,0)/subset.length,
    calibration,
  };
}

function makePredictions(game, playerShots, teamDefense, pbpOpening, jumperHistory, iterations) {
  if (game.starters.home.length !== 5 || game.starters.away.length !== 5) return null;
  const homeC = game.starters.home.find(p=>p.position==='C') || game.starters.home[0];
  const awayC = game.starters.away.find(p=>p.position==='C') || game.starters.away[0];
  const historicalTip = historicalTipProbability(game,jumperHistory);
  const hAllowed = teamDefense.get(game.home) || {};
  const aAllowed = teamDefense.get(game.away) || {};
  const factorFor = allowed => {
    const zone=allowed.three || {attempts:0,makes:0};
    const pct=(zone.makes+0.36*30)/(zone.attempts+30);
    return Math.max(.92,Math.min(1.08,pct/.36));
  };
  const teamRows = (team, starters, defense) => {
    const share6 = roleShares(team,starters,game,pbpOpening,false);
    const share7 = roleShares(team,starters,game,pbpOpening,true);
    return {
      v6:share6.map(player=>playerFeatures(player,playerShots,defense,player)),
      v7:share7.map(player=>playerFeatures(player,playerShots,defense,player)),
    };
  };
  const home = teamRows(game.home,game.starters.home,{threeFactor:factorFor(hAllowed)});
  const away = teamRows(game.away,game.starters.away,{threeFactor:factorFor(aAllowed)});
  const predict = version => {
    const result = simulateGameFirstBasketMonteCarlo({
      homePlayers:home[version],awayPlayers:away[version],
      tipMatchup:{tipProbA:historicalTip},settlementRule:'FIRST_FIELD_GOAL',
      iterations,seed:`${game.eventId}-opening-role-replay`,
    });
    const players=[...home[version],...away[version]].map(player=>({
      id:player.id,name:player.name,team:player.team,
      prob:(result.playerStats[player.id]?.wins || 0)/iterations,
      earlyShotShare:player.earlyShotShare,
      recentRole:player.openingRoleRecent || null,
    })).sort((a,b)=>b.prob-a.prob);
    const actualId=game.firstFieldGoal?.participantIds[0] || null;
    const actualRank=actualId ? players.findIndex(player=>player.id===actualId)+1 : 0;
    return {
      actualId,actualInPool:players.some(player=>player.id===actualId),actualRank,
      actualProb:players.find(player=>player.id===actualId)?.prob || null,
      top1:players[0]?.name || null,topProb:players[0]?.prob || 0,
      top1Hit:players[0]?.id===actualId,top3Hit:players.slice(0,3).some(player=>player.id===actualId),players,
    };
  };
  return { v6:predict('v6'),v7:predict('v7'),historicalTipProbHome:historicalTip,
    lineupSource:'ESPN final boxscore actual starters; pregame announcement timestamp unavailable',
    jumperSource:'Starter centers with prior-only jump history; current game jump participants are excluded from inputs' };
}

async function readCache() {
  try { return JSON.parse(await readFile(CACHE_FILE,'utf8')); }
  catch { return {events:null,summaries:{},opening:{}}; }
}

async function writeCache(cache) {
  await mkdir(dirname(CACHE_FILE),{recursive:true});
  await writeFile(CACHE_FILE,JSON.stringify(cache),'utf8');
}

async function fetchScoreboards(start, end, cache) {
  cache.scoreboards ||= {};
  const dates=dateRange(start,end);
  const daily=await mapLimit(dates,8,async date=>{
    if (cache.scoreboards[date]) return cache.scoreboards[date];
    const payload=await getJson(`${ESPN}/scoreboard?dates=${date}`);
    const rows=(payload.events || []).filter(event=>event.status?.type?.completed);
    cache.scoreboards[date]=rows;
    return rows;
  });
  const rows=daily.flat();
  const events=[...new Map(rows.map(event=>[String(event.id),event])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  cache.events={start,end,rows:events};
  await writeCache(cache);
  return events;
}

async function fetchPbpOpening(cache, seasons) {
  const requests=seasons.flatMap(season=>Object.entries(NBA_TEAM_IDS).map(([team,id])=>({team,id,season})));
  cache.opening ||= {};
  let completed=0,persist=Promise.resolve();
  const fetched=await mapLimit(requests,2,async ({team,id,season})=>{
    const key=`${season}:${team}`;
    if (cache.opening[key]) return [key,cache.opening[key]];
    const qs=new URLSearchParams({Season:season,SeasonType:'Regular Season',EntityType:'Team',EntityId:String(id),PeriodEquals:'1',FromTime:'720',ToTime:'600'});
    const payload=await getJson(`${PBP_STATS}?${qs}`);
    const results=payload.results || [];
    if (!Array.isArray(payload.results) || results.length>=500) throw new Error(`PBP Stats opening-shot response for ${key} was invalid or capped (${results.length})`);
    cache.opening[key]=results;
    completed++;
    if (completed%10===0) {
      console.log(`[historical-pbp-replay] fetched ${completed} new team-season opening histories`);
      persist=persist.then(()=>writeCache(cache));
      await persist;
    }
    return [key,results];
  });
  await writeCache(cache);
  return new Map(fetched);
}

export async function run({ start='2024-10-22', testStart='2024-11-01', end='2026-10-30', iterations=10000,
  output='fb-model/data/first-basket-historical-replay-2024-11-through-2026-10.json' } = {}) {
  const cache=await readCache();
  const events=await fetchScoreboards(start,end,cache);
  if (!events.length) throw new Error('No completed historical games found in ESPN scoreboard range.');
  cache.games ||= {};
  let completed=0,unavailable=[];
  const games=await mapLimit(events,7,async event=>{
    const key=String(event.id);
    if (cache.games[key]) return cache.games[key];
    try {
      const summary=await getJson(`${ESPN}/summary?event=${key}`);
      const game=extractGame(summary,event);
      cache.games[key]=game;
      completed++;
      if (completed%50===0) {
        await writeCache(cache);
        console.log(`[historical-pbp-replay] parsed ${completed} new summaries`);
      }
      return game;
    } catch(error) {
      unavailable.push({eventId:key,date:event.date,error:error.message});
      completed++;
      return null;
    }
  });
  await writeCache(cache);
  const availableGames=games.filter(Boolean).sort((a,b)=>a.eventAt.localeCompare(b.eventAt));
  const seasons=[...new Set(availableGames.map(game=>seasonForDate(game.localDate)))];
  const pbpOpening=await fetchPbpOpening(cache,seasons);
  await writeCache(cache);
  const playerShots=new Map(),teamDefense=new Map(),jumperHistory=new Map();
  const evaluated=[];
  for (const game of availableGames) {
    const isTest=game.localDate>=testStart && game.localDate<=end;
    if (isTest) {
      const prediction=makePredictions(game,playerShots,teamDefense,pbpOpening,jumperHistory,iterations);
      if (prediction && game.firstFieldGoal) evaluated.push({
        date:game.localDate,eventId:game.eventId,matchup:`${game.away}@${game.home}`,
        actualFirstFieldGoalScorer:game.rosterById[game.firstFieldGoal.participantIds[0]]?.name || null,
        actualPlayerId:game.firstFieldGoal.participantIds[0],
        actualLineups:{home:game.starters.home.map(p=>p.name),away:game.starters.away.map(p=>p.name)},
        firstFieldGoal:{sequence:game.firstFieldGoal.seq,clock:game.plays.find(p=>p.id===game.firstFieldGoal.id)?.text || null},
        ...prediction,
      });
    }
    updatePlayerShotHistory(game,playerShots,teamDefense);
    updateJumpHistory(game,jumperHistory);
  }
  const metricsV6=metrics(evaluated,'v6'),metricsV7=metrics(evaluated,'v7');
  const switched=evaluated.filter(row=>row.v6.top1!==row.v7.top1);
  const report={
    schemaVersion:1,createdAt:new Date().toISOString(),seasons,
    range:{featureTrainingStart:start,scoredLocalDates:`${testStart} through ${end}`},
    sources:{
      scheduleAndPlayByPlay:'ESPN historical scoreboard and game summary endpoint',
      openingRole:'PBP Stats get-shots/nba, first-quarter shot attempts during the first 120 seconds; only game possession 1 or 2; all history filtered to before the evaluated game',
      actualStarters:'ESPN final boxscore. Starter truth is known after games; archived pregame announcement timestamps were not available.',
      syntheticArchive:'fb-model/data/fb_database.sqlite was excluded because its ingestion script generates randomized play-by-play and seeds fixed example lineups.',
    },
    modeling:{
      comparison:`same date-ordered ${iterations.toLocaleString('en-US')}-trial possession simulation and prior-only player/defense/tip inputs; v7 adds the production L5/L10 opening-role blend to v6 season-role shares`,
      iterations,
      l5L10Blend:'35% L5 + 65% L10 recent share; recent blend weight rises from 5% at five games to 10% at ten games',
      otherInputs:'player shot-zone mix and makes from prior ESPN play-by-play only, shrunk to league priors; tip rates from prior historical opening jump balls only; neutral early-turnover/OREB priors',
      marketOddsUsed:false,
      caveats:['Lineup-conditioned retrospective test, not a complete pregame availability replay.',
      'The range evaluates the opening-role adjustment, not a perfect reproduction of every v6/v7 production feature or live roster prior.',
        'Metrics on player probability proper scores are reported only when the actual first scorer is among the ten actual starters.'],
    },
    fetchedGames:availableGames.length,unavailableSummaryGames:unavailable,
    scoredGames:evaluated.length,
    actualStarterCoverage:metricsV6.actualStarterCoverage,
    versionMetrics:{v6:metricsV6,v7:metricsV7},
    topPickChangedGames:switched.length,
    topPickChanges:switched.map(row=>({date:row.date,matchup:row.matchup,v6:row.v6.top1,v7:row.v7.top1,
      actual:row.actualFirstFieldGoalScorer,v6Hit:row.v6.top1Hit,v7Hit:row.v7.top1Hit,
      v6Prob:row.v6.topProb,v7Prob:row.v7.topProb})),
    games:evaluated,
  };
  const destination=resolve(ROOT,output);
  await mkdir(dirname(destination),{recursive:true});
  await writeFile(destination,JSON.stringify(report,null,2)+'\n','utf8');
  return {report,path:destination};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options={};
  const names={'--start':'start','--test-start':'testStart','--end':'end','--iterations':'iterations','--output':'output'};
  for(let i=2;i<process.argv.length;i++) {
    const key=names[process.argv[i]];
    if(!key || process.argv[i+1]==null) throw new Error(`Unknown or incomplete argument: ${process.argv[i]}`);
    options[key]=key==='iterations' ? Number(process.argv[++i]) : process.argv[++i];
  }
  run(options).then(({report,path})=>{
    console.log(JSON.stringify({path,fetchedGames:report.fetchedGames,scoredGames:report.scoredGames,
      v6:report.versionMetrics.v6,v7:report.versionMetrics.v7,
      changedTopPicks:report.topPickChangedGames,topPickChanges:report.topPickChanges},null,2));
  }).catch(error=>{console.error(`[historical-pbp-replay] ${error.stack || error}`);process.exitCode=1;});
}
