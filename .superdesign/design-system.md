# StatFax Design System

## Product
Mobile-first player-prop analytics dashboard. MLB is intentionally limited to home-run markets. NFL is intentionally limited to Anytime Touchdown and First Touchdown Scorer markets. Preserve dense, fast scanning for experienced users while keeping essential decisions legible and touch-friendly.

## NFL Prop Board
- Use the same StatFax shell, sport switcher, typography, spacing, card treatment, and silver-violet interaction language as MLB.
- Support QB, RB, WR, and TE. The market control includes Anytime TD, First TD, 2+ TD, passing yards, receptions, receiving yards, rushing yards, rushing + receiving, and passing + rushing.
- Keep a compact market rail and a Board/Cards view control; cards are the deeper scan while the board remains the fastest ranked comparison.
- The first scan is full player name, position/team, opponent and game time, model probability, line/odds when available, and model edge.
- Supporting signals prioritize red-zone targets/touches, goal-line role, route/snap share, opponent allowance by position, TD/yardage/reception streaks, home/away splits, injury/inactive risk, and team implied points.
- QB cards include completions/attempts. Every card includes a small weather impact line and a clear live/pregame state.
- Position and team filters are compact; the default board covers RB, WR, TE, and relevant rushing QBs.
- First TD Scorer must visibly communicate its higher variance and show probability/price without presenting long odds as inherently valuable.
- 2+ TD is a first-class filter/market and must never be inferred from Anytime TD probability without an explicit multi-score model output.
- Injury, questionable, inactive, and role-change states require text plus icon/color. Missing odds or uncertain workload must remain explicit.
- Player selection opens a football-specific research surface with eligibility, recent game log, red-zone role, defense-vs-position, splits, weather, and live pace. It must not reuse baseball terminology or metrics.
- Mobile keeps the ranked board as full-width cards/rows with 44px actions, stable probability and odds columns, and no horizontal page overflow.

## Visual identity
- Official brand mark: the metallic `SF` lightning icon at `/icon.png`. Use its brushed-silver, ink-black, graphite, and restrained violet-light palette throughout product chrome.
- OLED background: `#07060c`; elevated ink: `#0f0e15`; glass cards: `rgba(21,20,26,.76)`; graphite borders: `rgba(227,227,231,.10)`.
- Text: polished silver `#f2f2f5`; secondary: `#c4c4cc`; faint: `#858491`.
- Primary accent: cool silver-violet `#b8b7d8`; active glow: `rgba(151,149,203,.30)`; link accent: `#aaa9d2`.
- Semantic grades retain distinct meaning but use desaturated, icon-compatible hues: PRIME `#d6b56f`; STRONG `#69b99e`; LEAN `#c69a57`; SKIP `#676673`. Errors remain muted red.
- Fonts: Space Grotesk for the StatFax wordmark, workspace titles, player names, and major headings; Inter for UI/body; JetBrains Mono for probabilities, odds, dates, and statistics.
- Radii: 10px controls, 16px cards, 24px large overlays. Use restrained silver-violet glows only for selected, featured, or live states; never restore electric cyan.

## Mobile Games page
- Target 320–430px widths with no page-level horizontal overflow.
- Keep the fixed four-item bottom navigation and clear its safe area.
- Use a compact segmented control for HR Extractor / Detail Silos.
- Make Game of the Day visually prominent but concise.
- Game cards prioritize matchup, time/live state, environment, and the top two hitters.
- Collapse long explanations to the strongest two reasons, with a 44px `Why this pick` affordance for more.
- All interactive targets must be at least 44×44px or have an equivalent invisible hit area.
- Essential text is at least 12px; player names and probabilities are 14–18px.
- Use Lucide SVG icons only; no emoji icons.
- Preserve visible focus states and reduced-motion behavior.

## Mobile Board page
- Preserve ranked scanning as the primary job: rank, full player name, matchup, grade/model score, and HR probability must be immediately visible.
- Keep Day Rating and Pick of the Day, but reduce their initial-screen footprint so the first ranked rows appear above the fold.
- Use full-width player rows with a stable probability column and no name truncation at 320px.
- Show only the highest-value supporting signals inline; secondary metrics and explanations belong behind progressive disclosure or the player drawer.
- Watch and parlay actions must be 44px and remain accessible without relying on swipe gestures.
- Keep confirmed/projected, hot/rising, batting order, opponent pitcher, and live/final state legible.
- Momentum status belongs directly after the player name; it must not float at the far edge of the identity row.

## Player Research workspace
- Treat the player surface as the confidence step between discovery and adding a pick. Its first scan is identity, matchup, lineup spot, grade/model score, HR probability, market edge, and the strongest two or three reasons.
- Desktop uses a centered research workspace with a persistent identity/decision rail and a scrollable evidence pane. Do not make users re-read identity or lose watch/slip actions while changing evidence sections.
- Mobile is a full-screen sheet. Keep player identity, HR probability, and the primary add-to-slip action visible without making the research body feel cramped.
- Organize evidence into four understandable families: Power, Form, Matchup, and Environment. Advanced Statcast, trends, splits, spray, and model details remain available through progressive disclosure.
- Opposing pitcher vulnerability and handedness context belong beside matchup evidence, with the pitcher name visibly actionable.
- Lead explanations with no more than three plain-language reasons. Dense raw stats remain secondary and must not push the decision summary below the initial viewport.
- Persistent actions are Add to parlay, Watch, and Share. Mobile action targets are at least 44x44px; desktop actions remain clearly labeled.
- Board and Games must open the same player experience and preserve the existing grade, signal, live-state, and market meanings.

## Parlay decision workspace
- Treat the active slip as the conversion step after player research. Its first scan is leg count, parlay grade, model all-hit probability, sportsbook or fair odds, edge/EV, projected payout, and the weakest leg.
- Desktop uses a persistent right-side decision workspace when expanded. The ticket summary, wager/payout, warnings, and primary review/share action stay visible while the leg list and replacement suggestions scroll.
- Mobile opens as a full-screen builder above the app navigation. Use a compact sticky title/scorecard, one scroll region, and a sticky bottom review action. The collapsed slip remains a concise bottom pill.
- Every leg row prioritizes full player name, team/opponent, lineup state, model grade/score, HR probability, price, and per-leg edge. Weakest-leg and live states require text plus color/icon.
- Explain the construction with no more than three plain-language signals: pricing/value, lineup/readiness risk, and game overlap/correlation. Missing odds and projected lineups must be explicit warnings.
- Keep same-game math labeled as independent until a validated correlation uplift exists. Never imply an unmodeled correlation benefit.
- Provide a direct replacement path for the weakest leg using qualified players from unused games. Replacement candidates show how the finished parlay's all-hit probability, edge, or grade would change.
- Primary workflow is Review parlay; secondary actions are Build, Save, Copy/Share, and Clear. Mobile actions are at least 44x44px.
- Live tickets resolve to Pending, Live, Dead, or Cashed and show hits out of total legs without changing the original ticket composition.

## Mobile Weather page
- Treat each game as an impact card, not a miniature desktop report. Matchup, venue/time, carry verdict, precipitation risk, and park HR factor must be visible in the first scan.
- Use a compact weather hero band for wind direction/speed plus the carry verdict; keep temperature, precipitation, and park HR factor as the three primary stats.
- Move humidity, gust detail, and lower-priority conditions behind progressive disclosure when space is tight.
- Show the top three helped bats by default. Keep the fourth and deeper context available through an explicit 44px disclosure control.
- The sort and filter controls must be 44px tall, fit 320-430px widths without page overflow, and make the selected state readable without color alone.
- Favorable, neutral, suppressed, rain-risk, and dome states require text labels as well as color/icons.

## Mobile Pitchers page and cards
- The mode switch is a full-width, 44px segmented control. Sorting is a separate compact row only when the selected mode needs it.
- Vulnerability rows prioritize pitcher, opponent, vulnerability tier, HR/9, estimated strikeouts, and the three strongest batter targets.
- Reusable detail cards must work at 320-430px both in the Pitchers page and in the pitcher drawer.
- The detail-card first scan is: pitcher identity and matchup, vulnerability score/tier, three key stats, platoon attack side, and top three HR targets.
- Never force scouting content into a narrow side column. Pitch mix, splits, workload, and extra targets move into full-width progressive-disclosure sections on mobile.
- Target rows are at least 44px tall and preserve full player names, handedness, grade, and score without horizontal overflow.
- Keep K-prop parlays collapsed and secondary to the pitcher-card browsing task.

## Mobile Parlay Combos
- Use a three-part workspace: Live, Tickets, and History. Only one section is expanded on mobile; desktop may keep the full stacked view.
- Lead with the current state and useful counts. Explanatory paragraphs are supporting text and should not dominate the first screen.
- Combo rows prioritize result/status, strategy, leg count, and leg names. Use Lucide status icons instead of emoji.
- History filters use a two-column mobile grid with 44px triggers. Limit long histories initially and expose an explicit Show more control.

## Mobile Parlay Combo Builder
- Present the builder as a full-screen mobile workspace with a fixed 56px title bar and its own scroll region.
- Keep scorecard and same-window mode summaries compact. The two slate selectors share one row and remain 44px tall.
- Combo size is a three-part segmented control. Secondary pool controls live behind one 44px `More filters` disclosure with an active-filter count.
- A combo card's first scan is size, strategy, lineup state, grade, all-hit summary, and player legs. Copy, Tail, Why, and Track remain available with 44px targets.
- Keep the combo header to one compact identity row. Copy, Tail, Why, and Track share the bottom action bar on mobile instead of creating a second header row.
- Player legs prioritize full name, team, lineup/risk state, opponent pitcher, ERA, probability, and grade. Barrel, ISO, pitch-edge, condition, and per-leg lock detail are secondary on mobile.
- Keep each two-leg card near 320-350px tall at 320-430px widths and avoid horizontal overflow.

## Mobile Pitcher Vulnerability
- Tier headers remain visible, but each pitcher is a self-contained attack card with identity, vulnerability score, three key stats, and three tappable targets.
- Score/tier meaning must use text plus color. Target buttons remain 44px and do not rely on swipe gestures.

## Mobile K Brain
- Search is 44px. Filter families are visually separated and horizontally scrollable without page-level overflow.
- Each arm card leads with pitcher/matchup and one decimal projected-K hero; confidence and expected innings sit directly beside that point estimate while the uncertainty range remains quiet secondary context.
- The sportsbook-line evaluator stays visible and reports only the modeled chance to go over the entered line. Never label a probability as value, fade, or neutral without sportsbook odds.
- Show exactly three compact primary drivers: expected workload, opponent strikeout rate, and adjusted pitcher strikeout rate/recent trend.
- Weather, umpire, park, TTTO, lineup pressure, and batter H2H use one progressive-disclosure section.
- Do not render a probability ladder.

## Mobile Results
- Use a 2x2 KPI grid, then a compact Grades/Calibration segment instead of showing two narrow charts side by side.
- Grade performance is a vertical set of full-width horizontal bars. Each row aligns grade, observed hit rate, and sample size on one line; explanatory copy sits below the complete chart.
- The top-tier HR feed defaults to a useful recent subset and offers a 44px Show all control.
- Daily results become labeled mobile rows rather than a six-column squeezed table.
- Model and Combos are a full-width segmented control and must synchronize when navigating directly between routes.

## Results accountability workspace
- Treat Results as the proof and learning step after research and ticket building. The first scan answers: what happened, whether the process created value, what is still live, and what the user should change next.
- Use three synchronized modes: Overview, My Tickets, and Model. Overview combines the user's actual ledger with the model record; My Tickets owns wager-level outcomes; Model preserves calibration and ranking diagnostics.
- Lead Overview with a compact verdict and no more than four metrics. Prioritize settled record, net units/ROI when stakes and odds exist, live exposure, and model health. Never calculate ROI from model picks the user did not explicitly track.
- Ticket records preserve the original legs, model all-hit probability, posted odds, wager, projected payout, creation time, and final outcome. Missing wager or odds must remain visibly unknown rather than being treated as zero.
- Ticket status uses Pending, Live, Cashed, Dead, and Unknown with text plus icon/color. A ticket may be edited only before games start; settlement freezes the original composition and economics.
- Surface one plain-language review brief: strongest repeatable signal, biggest avoidable risk, sample-size warning, and a direct next action. Outcome alone must never label a sound positive-EV decision as bad process.
- Daily and weekly summaries separate process metrics (model edge, lineup confirmation, price completeness) from outcome metrics (cash rate, profit, ROI). Use explicit denominators and sample sizes.
- Desktop uses a wide accountability workspace: compact summary strip, review brief, then a two-column ledger/learning layout. Mobile uses a full-width segmented control, 2x2 KPIs, stacked review brief, and labeled ticket cards with 44px actions.
- Avoid ornamental finance charts, fabricated closing-line value, celebratory language without settled evidence, and dense six-column ticket tables on mobile.

## Interaction
- Primary tap on a player opens player details.
- Pitcher names are clearly tappable without appearing like tiny inline links.
- Selected tabs and controls use the silver-violet brand accent; grades retain distinct semantic colors.
- Transitions stay between 150–250ms and use transform/opacity.

## Anti-patterns
- Do not introduce light mode, blue enterprise-dashboard styling, gradients outside existing cyan/team/grade accents, ornamental charts, cramped 22–34px action buttons, or paragraphs of five reasons inside every list card.
