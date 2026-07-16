export const SPORT_UI = Object.freeze({
  mlb: Object.freeze({
    id: 'mlb',
    label: 'MLB',
    primaryViews: [
      { id: 'board', label: 'Board', icon: 'Rows3', desc: 'Ranked board' },
      { id: 'games', label: 'Games', icon: 'CalendarDays', desc: 'Game-by-game' },
      { id: 'pitchers', label: 'Pitchers', icon: 'Radar', desc: 'Pitcher vulnerability' },
      { id: 'weather', label: 'Weather', icon: 'CloudSun', desc: 'Weather report' },
      { id: 'results', label: 'Results', icon: 'ChartNoAxesCombined', desc: 'Model track record + combos' },
    ],
    mobileViews: [
      { id: 'board', label: 'Board', icon: 'Rows3' },
      { id: 'games', label: 'Games', icon: 'CalendarDays' },
      { id: 'pitchers', label: 'Pitchers', icon: 'Radar' },
      { id: 'results', label: 'Results', icon: 'ChartNoAxesCombined' },
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
