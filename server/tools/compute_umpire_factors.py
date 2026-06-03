import json

data_2024 = {
    'Angel Hernandez': 1.88,
    'Bruce Dreckman': 3.11,
    'Edwin Jimenez': 2.09,
    'Andy Fletcher': 2.56,
    'Mark Wegner': 2.13,
    'Marvin Hudson': 2.61,
    'Ryan Blakney': 2.28,
    'Adrian Johnson': 2.83,
    'Tom Hanahan': 2.75,
    'Sean Barber': 2.70,
    'Chad Whitson': 2.56,
    'Jacob Metz': 2.45,
    'Mark Ripperger': 2.65,
    'Larry Vanover': 1.77,
    'Jonathan Parra': 2.00,
    'Lance Barksdale': 2.06,
    'Derek Thomas': 2.75,
    'Clint Vondrak': 2.07,
    'Scott Barry': 1.91,
    'Jordan Baker': 2.48,
    'CB Bucknor': 2.31,
    'Edwin Moscoso': 2.06,
    'Austin Jones': 1.86,
    'Brian Walsh': 2.31,
    'Lance Barrett': 2.48,
    'Charlie Ramos': 2.11,
    'Nick Mahrley': 2.21,
    'Jansen Visconti': 1.97,
    'Nestor Ceja': 2.07,
    'Stu Scheurwater': 2.19,
    'Jeremy Riggs': 1.82,
    'Jeremie Rehak': 2.29,
    'Tripp Gibson': 2.55,
    'Alfonso Marquez': 2.52,
    'Alex MacKay': 2.17,
    'Bill Miller': 2.25,
    'John Tumpane': 2.38,
    'Shane Livensparger': 2.00,
    'Brock Ballou': 2.45,
    'Todd Tichenor': 2.40,
    'Laz Diaz': 2.62,
    'Chris Guccione': 2.21,
    'Chad Fairchild': 2.37,
    'Adam Beck': 2.96,
    'Roberto Ortiz': 2.34,
    'Brian Knight': 1.56,
    'Tony Randazzo': 2.20,
    'Quinn Wolcott': 1.85,
    'Chris Segal': 2.68,
    'Malachi Moore': 1.90,
    'Dan Bellino': 2.31,
    'Adam Hamari': 2.22,
    'Emil Jimenez': 2.44,
    'Mike Muchlinski': 2.34,
    'Nate Tomlinson': 2.14,
    'Phil Cuzzi': 2.67,
    'Alex Tosi': 1.83,
    'Junior Valentine': 2.50,
    'Gabe Morales': 2.13,
    'Dan Merzel': 2.38,
    'John Libka': 1.93,
    'Erich Bacchus': 1.78,
    'Mark Carlson': 1.61,
    'Paul Clemons': 2.45,
    'Vic Carapazza': 2.61,
    'Will Little': 2.11,
    'James Hoye': 2.25,
    'Cory Blaser': 2.00,
    'Nic Lentz': 2.18,
    'Ryan Wills': 2.26,
    'David Rackley': 1.96,
    'Ben May': 1.75,
    'Alan Porter': 2.17,
    'Ryan Additon': 2.47,
    'Manny Gonzalez': 2.24,
    'Carlos Torres': 2.42,
    'DJ Reyburn': 2.31,
    'Brian ONora': 2.36,
    'Doug Eddings': 2.15,
    'Hunter Wendelstedt': 2.16,
    'Jim Wolf': 1.74,
    'Mike Estabrook': 2.03,
    'Chris Conroy': 1.63,
    'Ramon De Jesus': 2.00,
    'Brennan Miller': 1.83,
    'Rob Drake': 2.07,
    'David Arrieta': 1.60,
}

rpg_2025 = {
    'Cory Blaser': 7.1,
    'Phil Cuzzi': 7.2,
    'Austin Jones': 7.2,
    'Nic Lentz': 7.2,
    'DJ Reyburn': 7.4,
    'Nick Mahrley': 7.5,
    'Charlie Ramos': 7.5,
    'Marvin Hudson': 7.6,
    'John Libka': 7.6,
    'Edwin Jimenez': 7.7,
    'Derek Thomas': 7.7,
    'Mike Estabrook': 7.9,
    'Paul Clemons': 7.9,
    'Ryan Blakney': 7.9,
    'Todd Tichenor': 7.9,
    'Adam Beck': 8.0,
    'Adam Hamari': 8.0,
    'Chris Segal': 8.0,
    'Hunter Wendelstedt': 8.0,
    'Will Little': 8.3,
    'CB Bucknor': 8.4,
    'Brennan Miller': 8.4,
    'Roberto Ortiz': 8.4,
    'John Tumpane': 8.4,
    'Lance Barksdale': 8.5,
    'Alex MacKay': 8.5,
    'Mark Carlson': 8.6,
    'Bruce Dreckman': 8.6,
    'Jansen Visconti': 8.6,
    'Gabe Morales': 8.7,
    'Dan Merzel': 8.8,
    'Stu Scheurwater': 8.8,
    'Quinn Wolcott': 8.8,
    'James Hoye': 8.9,
    'Mark Ripperger': 8.9,
    'Alex Tosi': 8.9,
    'Erich Bacchus': 9.0,
    'Nestor Ceja': 9.0,
    'Laz Diaz': 9.0,
    'Rob Drake': 9.0,
    'Tony Randazzo': 9.0,
    'Carlos Torres': 9.0,
    'Scott Barry': 9.1,
    'Dan Bellino': 9.1,
    'Chad Fairchild': 9.1,
    'Chris Guccione': 9.1,
    'Jonathan Parra': 9.1,
    'Mike Muchlinski': 9.2,
    'Brian ONora': 9.3,
    'Brian Walsh': 9.3,
    'Ryan Wills': 9.3,
    'Jeremie Rehak': 9.4,
    'Jim Wolf': 9.4,
    'David Arrieta': 9.5,
    'Sean Barber': 9.5,
    'Manny Gonzalez': 9.5,
    'Shane Livensparger': 9.5,
    'Alan Porter': 9.5,
    'Brock Ballou': 9.6,
    'Vic Carapazza': 9.6,
    'Doug Eddings': 9.6,
    'Bill Miller': 9.6,
    'Malachi Moore': 9.6,
    'Edwin Moscoso': 9.6,
    'Lance Barrett': 9.7,
    'Ben May': 9.7,
    'Jordan Baker': 9.8,
    'Adrian Johnson': 9.8,
    'Alfonso Marquez': 9.8,
    'Ramon De Jesus': 9.9,
    'David Rackley': 9.9,
    'Mark Wegner': 10.0,
    'Chad Whitson': 10.1,
    'Chris Conroy': 10.2,
    'Andy Fletcher': 10.4,
    'Tom Hanahan': 10.4,
    'Junior Valentine': 10.4,
    'Clint Vondrak': 11.1,
    'Emil Jimenez': 6.9,
    'Nate Tomlinson': 8.2,
}

mean_hr_2024 = sum(data_2024.values()) / len(data_2024)
mean_rpg_2025 = sum(rpg_2025.values()) / len(rpg_2025)
print("Mean HR/Gm 2024: %.4f" % mean_hr_2024)
print("Mean RPG 2025: %.4f" % mean_rpg_2025)

def clamp(val, lo, hi):
    return max(lo, min(hi, val))

def conservative_factor(raw_mult):
    dev = raw_mult - 1.0
    compressed_dev = dev * 0.30
    compressed_dev = clamp(compressed_dev, -0.07, 0.07)
    return round(1.0 + compressed_dev, 3)

above_below_2024 = {}
for name, hr in data_2024.items():
    above_below_2024[name] = 'above' if hr > mean_hr_2024 else 'below'

above_below_2025 = {}
for name, rpg in rpg_2025.items():
    above_below_2025[name] = 'above' if rpg > mean_rpg_2025 else 'below'

print()
hdr = "%-30s %10s %10s %10s %10s %10s %8s %8s" % (
    'Umpire', '2024 HR/G', '2024 raw', '2024 dir', '2025 RPG', '2025 dir', 'Agree?', 'factor')
print(hdr)
print("-"*100)

consistent_umps = {}

sorted_umps = sorted(data_2024.items(), key=lambda x: x[1])
for name, hr in sorted_umps:
    raw_mult = hr / mean_hr_2024
    dev = abs(raw_mult - 1.0)
    if dev < 0.08:
        continue
    dir_2024 = above_below_2024.get(name, 'N/A')
    rpg_val = rpg_2025.get(name)
    dir_2025 = above_below_2025.get(name, 'N/A') if rpg_val else 'N/A'
    agree = 'YES' if dir_2024 == dir_2025 else ('N/A' if dir_2025 == 'N/A' else 'NO')
    cf = conservative_factor(raw_mult)
    rpg_str = "%.1f" % rpg_val if rpg_val else "N/A"
    print("%-30s %10.2f %10.4f %10s %10s %10s %8s %8s" % (
        name, hr, raw_mult, dir_2024, rpg_str, dir_2025, agree, str(cf)))
    if agree == 'YES':
        consistent_umps[name] = cf

print()
print("Total consistent umpires: %d" % len(consistent_umps))
print()
print("=== FINAL CONSISTENT UMPIRES ===")
for name, factor in sorted(consistent_umps.items(), key=lambda x: x[1]):
    print("  %-30s -> %s" % (name, factor))

print()
print("Factor range: %.3f to %.3f" % (
    min(consistent_umps.values()),
    max(consistent_umps.values())
))
