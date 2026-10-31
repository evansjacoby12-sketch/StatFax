import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGame, roleShares } from '../fb-model/eval/replay_historical_pbp.mjs';

function boxscoreTeam(abbreviation, prefix) {
  return {
    team:{abbreviation},
    statistics:[{athletes:Array.from({length:5},(_,index)=>({
      starter:true,
      athlete:{id:`${prefix}${index}`,displayName:`${prefix} Player ${index}`,position:{abbreviation:index===0?'C':index===1?'F':'G'}},
    }))}],
  };
}

test('historical replay parser uses actual starters and first made field goal, not a made free throw', () => {
  const summary={
    header:{competitions:[{competitors:[
      {team:{id:'2',abbreviation:'BOS'},homeAway:'home'},
      {team:{id:'18',abbreviation:'NY'},homeAway:'away'},
    ]}]},
    boxscore:{players:[boxscoreTeam('BOS','h'),boxscoreTeam('NY','a')]},
    plays:[
      {id:'jump',sequenceNumber:'1',period:{number:1},type:{text:'Jumpball'},team:{id:'2'},participants:[{athlete:{id:'h0'}},{athlete:{id:'a0'}},{athlete:{id:'h1'}}]},
      {id:'ft',sequenceNumber:'2',period:{number:1},type:{text:'Free Throw'},shootingPlay:true,scoringPlay:true,scoreValue:1,pointsAttempted:1,participants:[{athlete:{id:'h1'}}]},
      {id:'fg',sequenceNumber:'3',period:{number:1},type:{text:'Driving Layup Shot'},shootingPlay:true,scoringPlay:true,scoreValue:2,pointsAttempted:2,participants:[{athlete:{id:'a2'}}]},
    ],
  };
  const game=extractGame(summary,{id:'event1',date:'2024-11-01T23:00:00Z',name:'NY at Boston'});
  assert.equal(game.starters.home.length,5);
  assert.equal(game.starters.away.length,5);
  assert.equal(game.home,'BOS');
  assert.equal(game.away,'NYK');
  assert.equal(game.firstFieldGoal.id,'fg');
  assert.equal(game.rosterById[game.firstFieldGoal.participantIds[0]].name,'a Player 2');
});

test('historical role replay excludes same-day/current and future PBP from prior-only L5/L10', () => {
  const starters=Array.from({length:5},(_,index)=>({id:`p${index}`,name:`Player ${index}`,team:'BOS',position:index===0?'C':'PG'}));
  const rows=Array.from({length:11},(_,index)=>({
    gid:`g${index+1}`,game_date:`2024-11-${String(index+1).padStart(2,'0')}`,
    poss_num:1,player:index<5?'Player 0':index<10?'Player 1':'Player 2',shot_time:700,made:true,
  }));
  const game={localDate:'2024-11-11'};
  const history=new Map([['2024-25:BOS',rows]]);
  const season=roleShares('BOS',starters,game,history,false);
  const recent=roleShares('BOS',starters,game,history,true);
  assert.equal(recent[0].openingRoleRecent.last5Games,5);
  assert.equal(recent[0].openingRoleRecent.last10Games,10);
  assert.equal(recent[0].openingRoleRecent.applied,true);
  assert.ok(recent[1].earlyShotShare>season[1].earlyShotShare);
  assert.equal(recent[2].openingRoleRecent.last10Share,0);
});
