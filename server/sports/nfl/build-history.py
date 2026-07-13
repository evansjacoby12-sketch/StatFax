#!/usr/bin/env python3
"""Build compact StatFax NFL history from nflverse CSV releases.

Uses only the Python standard library. Weekly player stats provide the stable
player/game layer; play-by-play adds red-zone usage, defense-vs-position and
game weather. The default window is 2020 through the current calendar year.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PLAYER_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv.gz"
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz"
POSITIONS = {"QB", "RB", "WR", "TE"}


def number(value, default=0.0):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def integer(value, default=0):
    return int(number(value, default))


def stream_csv(url, attempts=3):
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "StatFax-NFL-History/1.0"})
            response = urllib.request.urlopen(request, timeout=90)
            gz = gzip.GzipFile(fileobj=response)
            text = io.TextIOWrapper(gz, encoding="utf-8", newline="")
            yield from csv.DictReader(text)
            return
        except Exception as error:  # network retry boundary
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to load {url}: {last_error}")


def compact_week(row):
    return {
        "season": integer(row.get("season")),
        "week": integer(row.get("week")),
        "gameId": row.get("game_id"),
        "team": row.get("team"),
        "opponent": row.get("opponent_team"),
        "completions": integer(row.get("completions")),
        "attempts": integer(row.get("attempts")),
        "passingYards": integer(row.get("passing_yards")),
        "passingTds": integer(row.get("passing_tds")),
        "carries": integer(row.get("carries")),
        "rushingYards": integer(row.get("rushing_yards")),
        "rushingTds": integer(row.get("rushing_tds")),
        "receptions": integer(row.get("receptions")),
        "targets": integer(row.get("targets")),
        "receivingYards": integer(row.get("receiving_yards")),
        "receivingTds": integer(row.get("receiving_tds")),
        "targetShare": round(number(row.get("target_share")), 4),
        "snapShare": None,
        # TD-scorer props only settle on a player's own rush/receiving score;
        # a QB throwing a touchdown is not an Anytime TD scorer result.
        "totalTds": integer(row.get("rushing_tds")) + integer(row.get("receiving_tds")),
    }


def game_is_home(game_id, team):
    parts = str(game_id or "").split("_")
    return len(parts) >= 4 and parts[-1] == team


def build_player_history(seasons):
    players = {}
    position_by_id = {}
    for season in seasons:
        url = PLAYER_URL.format(season=season)
        print(f"player stats {season}", file=sys.stderr)
        for row in stream_csv(url):
            position = row.get("position")
            player_id = row.get("player_id")
            if position not in POSITIONS or not player_id or row.get("season_type") != "REG":
                continue
            position_by_id[player_id] = position
            entry = players.setdefault(player_id, {
                "id": player_id,
                "name": row.get("player_display_name") or row.get("player_name") or player_id,
                "position": position,
                "headshotUrl": row.get("headshot_url") or None,
                "teams": [],
                "recentGames": [],
                "splits": {"home": {"games": 0, "totalTds": 0}, "away": {"games": 0, "totalTds": 0}},
            })
            team = row.get("team")
            if team and team not in entry["teams"]:
                entry["teams"].append(team)
            week = compact_week(row)
            entry["recentGames"].append(week)
            split = "home" if game_is_home(row.get("game_id"), team) else "away"
            entry["splits"][split]["games"] += 1
            entry["splits"][split]["totalTds"] += week["rushingTds"] + week["receivingTds"]
    for entry in players.values():
        entry["recentGames"].sort(key=lambda game: (game["season"], game["week"]), reverse=True)
        entry["recentGames"] = entry["recentGames"][:24]
        for split in ("home", "away"):
            data = entry["splits"][split]
            data["tdRate"] = round(data["totalTds"] / data["games"], 4) if data["games"] else None
    return players, position_by_id


def nested_counter():
    return defaultdict(lambda: defaultdict(lambda: {
        "games": set(), "touchdowns": 0, "redZoneTargets": 0, "redZoneCarries": 0,
        "passingYards": 0, "rushingYards": 0, "receivingYards": 0,
    }))


def build_play_context(seasons, position_by_id):
    usage = defaultdict(lambda: {"redZoneTargets": 0, "endZoneTargets": 0, "redZoneCarries": 0, "goalLineCarries": 0, "touchdowns": 0})
    defense = nested_counter()
    weather_by_game = {}
    for season in seasons:
        url = PBP_URL.format(season=season)
        print(f"play by play {season}", file=sys.stderr)
        for row in stream_csv(url):
            if row.get("season_type") != "REG":
                continue
            game_id = row.get("game_id")
            defteam = row.get("defteam")
            yardline = number(row.get("yardline_100"), 999)
            receiver_id = row.get("receiver_player_id")
            rusher_id = row.get("rusher_player_id")
            passer_id = row.get("passer_player_id")
            touchdown = integer(row.get("touchdown")) == 1

            if game_id and game_id not in weather_by_game:
                weather_by_game[game_id] = {
                    "roof": row.get("roof") or None,
                    "surface": row.get("surface") or None,
                    "tempF": number(row.get("temp"), None),
                    "windMph": number(row.get("wind"), None),
                    "description": row.get("weather") or None,
                    "stadium": row.get("game_stadium") or row.get("stadium") or None,
                }

            if yardline <= 20 and integer(row.get("pass_attempt")) == 1 and receiver_id:
                usage[receiver_id]["redZoneTargets"] += 1
                if yardline <= 10:
                    usage[receiver_id]["endZoneTargets"] += 1
                position = position_by_id.get(receiver_id)
                if defteam and position in POSITIONS:
                    defense[defteam][position]["games"].add(game_id)
                    defense[defteam][position]["redZoneTargets"] += 1

            if yardline <= 20 and integer(row.get("rush_attempt")) == 1 and rusher_id:
                usage[rusher_id]["redZoneCarries"] += 1
                if yardline <= 5:
                    usage[rusher_id]["goalLineCarries"] += 1
                position = position_by_id.get(rusher_id)
                if defteam and position in POSITIONS:
                    defense[defteam][position]["games"].add(game_id)
                    defense[defteam][position]["redZoneCarries"] += 1

            if touchdown:
                scorer_id = row.get("td_player_id") or receiver_id or rusher_id
                if scorer_id:
                    usage[scorer_id]["touchdowns"] += 1
                    position = position_by_id.get(scorer_id)
                    if defteam and position in POSITIONS:
                        defense[defteam][position]["games"].add(game_id)
                        defense[defteam][position]["touchdowns"] += 1

            if defteam:
                for player_id, yards_key, target_key in (
                    (passer_id, "passingYards", "passing_yards"),
                    (rusher_id, "rushingYards", "rushing_yards"),
                    (receiver_id, "receivingYards", "receiving_yards"),
                ):
                    position = position_by_id.get(player_id)
                    if player_id and position in POSITIONS:
                        defense[defteam][position]["games"].add(game_id)
                        defense[defteam][position][yards_key] += integer(row.get(target_key))

    compact_defense = {}
    for team, positions in defense.items():
        compact_defense[team] = {}
        for position, values in positions.items():
            games = len(values["games"])
            compact_defense[team][position] = {
                key: (round(value / games, 4) if games and key != "games" else value)
                for key, value in values.items() if key != "games"
            }
            compact_defense[team][position]["games"] = games
    return usage, compact_defense, weather_by_game


def main():
    current_year = datetime.now(timezone.utc).year
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-season", type=int, default=2020)
    # The current-season weekly release may not exist yet during the offseason.
    # Default to the latest completed season; callers can opt into the active
    # year once nflverse has published it.
    parser.add_argument("--to-season", type=int, default=current_year - 1)
    parser.add_argument("--output", default="dist/nfl/history.json")
    parser.add_argument("--skip-pbp", action="store_true", help="Build weekly player history without the larger play-by-play download")
    args = parser.parse_args()
    if args.from_season < 2020:
        parser.error("StatFax NFL history starts at 2020")
    seasons = list(range(args.from_season, args.to_season + 1))
    players, position_by_id = build_player_history(seasons)
    usage, defense, weather = ({}, {}, {}) if args.skip_pbp else build_play_context(seasons, position_by_id)
    for player_id, entry in players.items():
        entry["redZone"] = usage.get(player_id, {})
    payload = {
        "version": 1,
        "sport": "nfl",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "seasons": seasons,
        "source": {
            "provider": "nflverse",
            "license": "CC-BY-4.0",
            "playerStats": PLAYER_URL,
            "playByPlay": None if args.skip_pbp else PBP_URL,
        },
        "players": list(players.values()),
        "defenseAllowedByPosition": defense,
        "weatherByGame": weather,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {output} ({len(players)} players, {len(defense)} defenses)")


if __name__ == "__main__":
    main()
