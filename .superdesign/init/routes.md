# Routes and views

StatFax is a Vite React single-page application. It does not use a URL router; `ui/src/App.jsx` owns view state and renders Board, Games, Pitchers, Results/Combos, Groups, Backtest, Weather, Zone, Settings, Guide, and ticket/parlay overlays. The public URL is `/`, with PWA shortcuts using hash fragments.

- `/` â€” `ui/src/main.jsx` â†’ `ui/src/App.jsx`
- `/#board` â€” Board view within `App.jsx`
- `/#games` â€” Games view within `App.jsx`
- `/#pitchers` â€” Pitchers view within `App.jsx`
- `/#results` â€” Results view within `App.jsx`