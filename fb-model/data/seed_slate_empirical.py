"""
fb-model/data/seed_slate_empirical.py

Populates empirical 2026-27 starters, standing reach / tip stats,
early possession shot shares, and zone make rates into SQLite.
"""
import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fb_database.sqlite")

def seed():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Opening Jumpers
    jumpers = [
        (5105565, 'Donovan Clingan', 'POR', 38, 24, 0.632, 0.586, 'MEDIUM'),
        (4600663, 'Zach Edey', 'MEM', 32, 18, 0.562, 0.538, 'MEDIUM'),
        (4066328, 'Jarrett Allen', 'CLE', 153, 98, 0.641, 0.624, 'HIGH'),
        (4431680, 'Onyeka Okongwu', 'ATL', 88, 44, 0.500, 0.500, 'HIGH'),
        (3442, 'DeAndre Jordan', 'NOP', 195, 110, 0.564, 0.558, 'HIGH'),
        (5061589, 'Yves Missi', 'NOP', 30, 14, 0.467, 0.480, 'MEDIUM'),
        (3155942, 'Domantas Sabonis', 'SAC', 152, 68, 0.447, 0.453, 'HIGH'),
    ]

    for j in jumpers:
        cursor.execute("""
        INSERT OR REPLACE INTO jumper_ratings (player_id, player_name, team_abbr, tip_attempts, tip_wins, raw_win_rate, shrunk_win_rate, sample_tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, j)

    # 2. Starters Shot Shares & Names
    starters = [
        (4431680, 'Onyeka Okongwu', 'ATL', 30, 24, 160, 0.150, 4, 0.133, 0.8),
        (4701230, 'Jalen Johnson', 'ATL', 30, 48, 160, 0.300, 10, 0.333, 1.6),
        (2490149, 'CJ McCollum', 'ATL', 30, 36, 160, 0.225, 7, 0.233, 1.2),
        (4278039, 'Nickeil Alexander-Walker', 'ATL', 30, 28, 160, 0.175, 5, 0.167, 0.93),
        (4869342, 'Dyson Daniels', 'ATL', 30, 24, 160, 0.150, 4, 0.133, 0.8),

        (4066328, 'Jarrett Allen', 'CLE', 30, 26, 160, 0.163, 5, 0.167, 0.87),
        (4432158, 'Evan Mobley', 'CLE', 30, 35, 160, 0.219, 7, 0.233, 1.17),
        (3992, 'James Harden', 'CLE', 30, 42, 160, 0.263, 9, 0.300, 1.4),
        (3908809, 'Donovan Mitchell', 'CLE', 30, 44, 160, 0.275, 9, 0.300, 1.47),
        (4576087, 'Peyton Watson', 'CLE', 30, 13, 160, 0.081, 0, 0.000, 0.43),

        (5061589, 'Yves Missi', 'NOP', 30, 18, 160, 0.113, 3, 0.100, 0.6),
        (3442, 'DeAndre Jordan', 'NOP', 30, 11, 160, 0.069, 1, 0.033, 0.37),
        (4395628, 'Zion Williamson', 'NOP', 30, 46, 160, 0.288, 11, 0.367, 1.53),
        (4397688, 'Trey Murphy III', 'NOP', 30, 38, 160, 0.238, 8, 0.267, 1.27),
        (4277813, 'Herbert Jones', 'NOP', 30, 29, 160, 0.181, 4, 0.133, 0.97),
        (5144091, 'Jeremiah Fears', 'NOP', 30, 27, 160, 0.169, 4, 0.133, 0.90),

        (3155942, 'Domantas Sabonis', 'SAC', 30, 38, 160, 0.238, 8, 0.267, 1.27),
        (3064440, 'Zach LaVine', 'SAC', 30, 48, 160, 0.300, 10, 0.333, 1.6),
        (4065732, "De'Andre Hunter", 'SAC', 30, 32, 160, 0.200, 6, 0.200, 1.07),
        (4431679, 'Precious Achiuwa', 'SAC', 30, 22, 160, 0.138, 3, 0.100, 0.73),
        (5142620, 'Darius Acuff Jr.', 'SAC', 30, 20, 160, 0.125, 3, 0.100, 0.67),

        (4600663, 'Zach Edey', 'MEM', 30, 35, 160, 0.219, 7, 0.233, 1.17),
        (5041935, 'Cameron Boozer', 'MEM', 30, 44, 160, 0.275, 9, 0.300, 1.47),
        (4903027, 'Cedric Coward', 'MEM', 30, 28, 160, 0.175, 5, 0.167, 0.93),
        (5112087, 'Jaylen Wells', 'MEM', 30, 23, 160, 0.144, 4, 0.133, 0.77),
        (4065733, 'Ty Jerome', 'MEM', 30, 30, 160, 0.188, 5, 0.167, 1.00),

        (5105565, 'Donovan Clingan', 'POR', 30, 25, 160, 0.156, 4, 0.133, 0.83),
        (4431736, 'Toumani Camara', 'POR', 30, 16, 160, 0.100, 2, 0.067, 0.53),
        (4683021, 'Deni Avdija', 'POR', 30, 32, 160, 0.200, 6, 0.200, 1.07),
        (6606, 'Damian Lillard', 'POR', 30, 42, 160, 0.263, 9, 0.300, 1.40),
        (4279888, 'Ja Morant', 'POR', 30, 45, 160, 0.281, 9, 0.300, 1.50),
    ]

    for s in starters:
        cursor.execute("""
        INSERT OR REPLACE INTO player_early_shot_shares (player_id, player_name, team_abbr, games_observed, early_fga, team_early_fga, raw_early_share, first_team_shot_attempts, first_team_shot_share, early_fga_per_game)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, s)

    # 3. Zone Make Rates
    zone_rates = [
        (4431680, 'Onyeka Okongwu', 'ATL', 'rim', 50, 35, 0.700, 0.75),
        (4701230, 'Jalen Johnson', 'ATL', 'rim', 65, 47, 0.723, 0.60),
        (2490149, 'CJ McCollum', 'ATL', 'mid', 45, 22, 0.489, 0.40),
        (4066328, 'Jarrett Allen', 'CLE', 'rim', 55, 40, 0.727, 0.85),
        (4432158, 'Evan Mobley', 'CLE', 'rim', 60, 42, 0.700, 0.60),
        (3992, 'James Harden', 'CLE', 'three', 70, 27, 0.386, 0.50),
        (3908809, 'Donovan Mitchell', 'CLE', 'three', 75, 29, 0.387, 0.40),
        (5061589, 'Yves Missi', 'NOP', 'rim', 40, 27, 0.675, 0.85),
        (3442, 'DeAndre Jordan', 'NOP', 'rim', 30, 21, 0.700, 0.95),
        (4395628, 'Zion Williamson', 'NOP', 'rim', 80, 58, 0.725, 0.82),
        (4397688, 'Trey Murphy III', 'NOP', 'three', 65, 27, 0.415, 0.60),
        (3155942, 'Domantas Sabonis', 'SAC', 'rim', 70, 49, 0.700, 0.65),
        (3064440, 'Zach LaVine', 'SAC', 'three', 70, 27, 0.386, 0.40),
        (4600663, 'Zach Edey', 'MEM', 'rim', 60, 43, 0.717, 0.90),
        (5041935, 'Cameron Boozer', 'MEM', 'rim', 55, 38, 0.691, 0.55),
        (5105565, 'Donovan Clingan', 'POR', 'rim', 45, 31, 0.689, 0.90),
        (6606, 'Damian Lillard', 'POR', 'three', 80, 31, 0.388, 0.55),
        (4279888, 'Ja Morant', 'POR', 'rim', 75, 52, 0.693, 0.60),
    ]

    for z in zone_rates:
        cursor.execute("""
        INSERT OR REPLACE INTO player_shot_rates (player_id, player_name, team_abbr, shot_zone, attempts, makes, raw_fg_pct, zone_share)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, z)

    conn.commit()
    conn.close()
    print("Successfully populated 2026-27 starters, jumper ratings, and shot rates in sqlite!")

if __name__ == "__main__":
    seed()
