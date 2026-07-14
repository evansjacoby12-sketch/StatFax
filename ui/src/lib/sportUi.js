export const SPORT_UI = Object.freeze({
  mlb: Object.freeze({
    id: 'mlb',
    label: 'MLB',
    primaryViews: [
      { id: 'board', label: 'Board', icon: 'List', desc: 'Ranked board' },
      { id: 'games', label: 'Games', icon: 'LayoutGrid', desc: 'Game-by-game' },
      { id: 'pitchers', label: 'Pitchers', icon: 'Crosshair', desc: 'Pitcher vulnerability' },
      { id: 'weather', label: 'Weather', icon: 'Wind', desc: 'Weather report' },
      { id: 'results', label: 'Results', icon: 'Activity', desc: 'Model track record + combos' },
    ],
    mobileViews: [
      { id: 'board', label: 'Board', icon: 'List' },
      { id: 'games', label: 'Games', icon: 'LayoutGrid' },
      { id: 'pitchers', label: 'Pitchers', icon: 'Crosshair' },
      { id: 'results', label: 'Results', icon: 'Activity' },
    ],
  }),
  nfl: Object.freeze({
    id: 'nfl',
    label: 'NFL',
    primaryViews: [
      { id: 'signals', label: 'Signals', icon: 'Zap' },
      { id: 'bet-lab', label: 'Bet Lab', icon: 'Beaker' },
      { id: 'performance', label: 'Performance', icon: 'Gauge' },
    ],
    mobileViews: [
      { id: 'signals', label: 'Signals', icon: 'Zap' },
      { id: 'bet-lab', label: 'Bet Lab', icon: 'Beaker' },
      { id: 'performance', label: 'Performance', icon: 'Gauge' },
    ],
  }),
  nba: Object.freeze({
    id: 'nba',
    label: 'NBA',
    enabled: false,
    primaryViews: [
      { id: 'signals', label: 'Signals', icon: 'Zap' },
      { id: 'bet-lab', label: 'Bet Lab', icon: 'Beaker' },
      { id: 'performance', label: 'Performance', icon: 'Gauge' },
    ],
    mobileViews: [
      { id: 'signals', label: 'Signals', icon: 'Zap' },
      { id: 'bet-lab', label: 'Bet Lab', icon: 'Beaker' },
      { id: 'performance', label: 'Performance', icon: 'Gauge' },
    ],
  }),
})

export const sportUi = (sport) => SPORT_UI[sport] || SPORT_UI.mlb
