# Extractable components

## Header
- Source: `ui/src/components/Header.jsx`
- Category: layout
- Description: Branded sticky header with date, navigation, live state, and settings controls.
- Extractable props: active view, live state, navigation callbacks
- Hardcoded: StatFax brand, icon set, CSS classes

## BottomNav
- Source: `ui/src/App.jsx`
- Category: layout
- Description: Phone-only four-tab bottom navigation.
- Extractable props: activeItem, navigation callback
- Hardcoded: Board, Games, Pitchers, Results labels and icons

## Filters
- Source: `ui/src/components/Filters.jsx`
- Category: basic
- Description: Search, team, grade, and advanced filtering controls.
- Extractable props: filter values and change callbacks
- Hardcoded: labels, icon names, CSS classes

## BatterRow
- Source: `ui/src/components/BatterRow.jsx`
- Category: basic
- Description: Dense responsive player probability row with swipe actions.
- Extractable props: batter data, selection state, action callbacks
- Hardcoded: metric layout, grade presentation, icons