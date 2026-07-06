import requests
from bs4 import BeautifulSoup
import json
import re
from ddragon import dd_manager

# Translate Riot LCU roles to U.GG roles
ROLE_MAP = {
    "middle": "mid",
    "top": "top",
    "jungle": "jungle",
    "bottom": "adc",
    "utility": "support",
    "mid": "mid",
    "adc": "adc",
    "support": "support"
}

def clean_champ_name(name):
    """Normalize champion name for U.GG URL path."""
    # Remove spaces, apostrophes, periods, and convert to lowercase
    # e.g., "Cho'Gath" -> "chogath", "Dr. Mundo" -> "drmundo"
    # Special case: Wukong is monkeyking in Riot API, but wukong in U.GG URLs.
    # Wukong's DDragon key is "MonkeyKing", name is "Wukong".
    # Since our normalized name checks lowercase, "wukong" will match "wukong" correctly.
    cleaned = name.lower().replace("'", "").replace(" ", "").replace(".", "")
    # Special u.gg overrides if any (none needed currently for basic names)
    return cleaned

def parse_ssr(html_content):
    """Extract and parse window.__SSR_DATA__ from page HTML."""
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        for script in soup.find_all('script'):
            content = script.string or ""
            if "window.__SSR_DATA__" in content:
                idx = content.find("window.__SSR_DATA__ =")
                start = content.find("{", idx)
                bracket_count = 0
                end = -1
                for j in range(start, len(content)):
                    char = content[j]
                    if char == '{':
                        bracket_count += 1
                    elif char == '}':
                        bracket_count -= 1
                        if bracket_count == 0:
                            end = j + 1
                            break
                if end != -1:
                    return json.loads(content[start:end])
    except Exception as e:
        print(f"[U.GG] Error parsing SSR: {e}")
    return None

def fetch_champion_stats(champion_name, role="mid", rank="emerald_plus", region="world"):
    """
    Fetch comprehensive meta builds, runes, items, and counters for a champion and role from U.GG.
    """
    # Standardize role name
    role = ROLE_MAP.get(role.lower(), "mid")
    champ_url_name = clean_champ_name(champion_name)
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # URLs
    build_url = f"https://u.gg/lol/champions/{champ_url_name}/build?rank={rank}&region={region}"
    counter_url = f"https://u.gg/lol/champions/{champ_url_name}/counter?rank={rank}&region={region}"
    
    build_data = {}
    counters = []
    
    try:
        # 1. Fetch Build
        build_res = requests.get(build_url, headers=headers, timeout=8)
        build_ssr = parse_ssr(build_res.text) if build_res.status_code == 200 else None
        
        # 2. Fetch Counters
        counter_res = requests.get(counter_url, headers=headers, timeout=8)
        counter_ssr = parse_ssr(counter_res.text) if counter_res.status_code == 200 else None
        
        role_key = f"{region}_{rank}_{role}"
        
        # 3. Process Build & Runes
        if build_ssr:
            overview_key = next((k for k in build_ssr.keys() if "overview" in k and "recommended" in k), None)
            if overview_key:
                overview_dict = build_ssr[overview_key].get("data", {})
                
                # Check for role key (fallback if exact match is missing)
                actual_key = role_key
                if actual_key not in overview_dict:
                    matching_keys = [k for k in overview_dict.keys() if k.endswith(f"_{role}")]
                    if matching_keys:
                        actual_key = matching_keys[0]
                        
                role_build = overview_dict.get(actual_key, {})
                
                # Resolve Runes
                rec_runes = role_build.get("rec_runes") or {}
                primary_style = dd_manager.get_rune_by_id(rec_runes.get("primary_style", 0))
                sub_style = dd_manager.get_rune_by_id(rec_runes.get("sub_style", 0))
                
                perks = []
                for perk_id in rec_runes.get("active_perks", []):
                    perks.append(dd_manager.get_rune_by_id(perk_id))
                    
                # Resolve Shards
                shards = []
                for shard_id in (role_build.get("stat_shards") or {}).get("active_shards", []):
                    shards.append(dd_manager.get_rune_by_id(shard_id))
                    
                # Resolve Starter Items
                starter_items = []
                for item_id in (role_build.get("rec_starting_items") or {}).get("ids", []):
                    starter_items.append(dd_manager.get_item_by_id(item_id))
                    
                # Resolve Core Items
                core_items = []
                for item_id in (role_build.get("rec_core_items") or {}).get("ids", []):
                    core_items.append(dd_manager.get_item_by_id(item_id))
                    
                # Resolve Situational Items (item_options_1 and item_options_2)
                situational_items = []
                for opt in ["item_options_1", "item_options_2"]:
                    for item_dict in (role_build.get(opt) or []):
                        item_id = item_dict.get("id")
                        if item_id:
                            situational_items.append(dd_manager.get_item_by_id(item_id))
                
                # Resolve Summoners
                summoner_spells = []
                summoner_names = {
                    1: "Cleanse", 3: "Exhaust", 4: "Flash", 6: "Ghost", 7: "Heal",
                    11: "Smite", 12: "Teleport", 14: "Ignite", 21: "Barrier"
                }
                summoner_filenames = {
                    1: "SummonerBoost",
                    3: "SummonerExhaust",
                    4: "SummonerFlash",
                    6: "SummonerHaste",
                    7: "SummonerHeal",
                    11: "SummonerSmite",
                    12: "SummonerTeleport",
                    14: "SummonerDot",
                    21: "SummonerBarrier"
                }
                for s_id in (role_build.get("rec_summoner_spells") or {}).get("ids", []):
                    img_name = summoner_filenames.get(s_id, "SummonerFlash")
                    summoner_spells.append({
                        "id": s_id,
                        "name": summoner_names.get(s_id, f"Spell {s_id}"),
                        "image": f"https://ddragon.leagueoflegends.com/cdn/{dd_manager.version}/img/spell/{img_name}.png"
                    })
                
                # Resolve skill path from list or dict containing slots
                rec_skill_path = role_build.get("rec_skill_path") or {}
                skill_path_list = []
                if isinstance(rec_skill_path, dict):
                    skill_path_list = rec_skill_path.get("slots") or []
                elif isinstance(rec_skill_path, list):
                    skill_path_list = rec_skill_path
                
                build_data = {
                    "runes": {
                        "primary_style": primary_style,
                        "sub_style": sub_style,
                        "perks": perks,
                        "shards": shards
                    },
                    "starting_items": starter_items,
                    "core_items": core_items,
                    "situational_items": situational_items[:6], # limit to 6 options
                    "skill_priority": (role_build.get("rec_skills") or {}).get("priority", "Q > W > E"),
                    "skill_path": skill_path_list,
                    "summoner_spells": summoner_spells
                }
                
        # 4. Process Counters
        if counter_ssr:
            matchups_key = next((k for k in counter_ssr.keys() if "matchups" in k), None)
            if matchups_key:
                matchups_dict = counter_ssr[matchups_key].get("data", {})
                
                actual_key = role_key
                if actual_key not in matchups_dict:
                    matching_keys = [k for k in matchups_dict.keys() if k.endswith(f"_{role}")]
                    if matching_keys:
                        actual_key = matching_keys[0]
                        
                role_matchups = matchups_dict.get(actual_key, {})
                raw_counters = role_matchups.get("counters", [])
                
                for c in raw_counters:
                    c_id = c.get("champion_id")
                    champ_info = dd_manager.get_champion_by_id(c_id)
                    # Ahri winrate against them. Lower means they counter Ahri harder.
                    win_rate = c.get("win_rate", 50.0)
                    matches = c.get("matches", 0)
                    
                    counters.append({
                        "champion_id": c_id,
                        "name": champ_info["name"],
                        "key": champ_info["key"],
                        "image": champ_info["image"],
                        "win_rate": win_rate, # Winrate of our champion against them
                        "matches": matches,
                        "gold_adv_15": -c.get("gold_adv_15", 0), # Positive means our champion leads
                        "xp_adv_15": -c.get("xp_adv_15", 0),
                        "cs_adv_15": -c.get("cs_adv_15", 0),
                        "kill_adv_15": -c.get("kill_adv_15", 0),
                        "team_gold_difference_15": -c.get("team_gold_difference_15", 0),
                        # Mobafire links
                        "mobafire_guide_url": f"https://www.mobafire.com/league-of-legends/champion/{clean_champ_name(champ_info['name'])}",
                        "mobafire_counters_url": f"https://www.mobafire.com/league-of-legends/champion/{clean_champ_name(champ_info['name'])}/counters"
                    })
                
                # Sort counters so that the hardest matchups (lowest win rate for selected champion) are first
                counters = sorted(counters, key=lambda x: x["win_rate"])
                
    except Exception as e:
        print(f"[U.GG] Error fetching champion stats: {e}")
        
    return {
        "champion": champion_name,
        "role": role,
        "build": build_data,
        "counters": counters
    }

if __name__ == "__main__":
    # Test fetch Ahri
    res = fetch_champion_stats("Ahri", "mid")
    print(f"Champion: {res['champion']}")
    print(f"Skills Priority: {res['build'].get('skill_priority')}")
    print(f"Starter Items: {[i['name'] for i in res['build'].get('starting_items', [])]}")
    print(f"Core Items: {[i['name'] for i in res['build'].get('core_items', [])]}")
    print(f"Summoners: {[s['name'] for s in res['build'].get('summoner_spells', [])]}")
    print("Hardest Matchups:")
    for c in res["counters"][:5]:
        print(f"  {c['name']}: Winrate against them = {c['win_rate']}%, Gold Diff @15 = {c['gold_adv_15']}")
