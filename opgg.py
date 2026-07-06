import requests
import json
import re
from ddragon import dd_manager

# Mapping for OP.GG position enums
POSITION_MAP = {
    "middle": "mid",
    "top": "top",
    "jungle": "jungle",
    "bottom": "adc",
    "utility": "support",
    "mid": "mid",
    "adc": "adc",
    "support": "support"
}

def create_dynamic_class(class_name, fields):
    """
    Dynamically compile a Python class matching the MCP tool output headers.
    """
    def init(self, *args):
        for field, val in zip(fields, args):
            setattr(self, field, val)
            
    def to_dict(self):
        d = {}
        for field in fields:
            val = getattr(self, field, None)
            if hasattr(val, "to_dict"):
                d[field] = val.to_dict()
            elif isinstance(val, list):
                d[field] = [item.to_dict() if hasattr(item, "to_dict") else item for item in val]
            else:
                d[field] = val
        return d
        
    return type(class_name, (object,), {"__init__": init, "to_dict": to_dict})

def clean_opgg_champ_name(name):
    """
    Map Riot DDragon name to OP.GG UPPER_SNAKE_CASE key.
    Examples: 'MonkeyKing' -> 'MONKEY_KING', 'Leblanc' -> 'LEBLANC', 'DrMundo' -> 'DR_MUNDO'
    """
    champ_info = dd_manager.get_champion_by_name(name)
    if not champ_info:
        return name.upper().replace(" ", "_").replace("'", "")
        
    key = champ_info["key"] # e.g., 'MonkeyKing', 'DrMundo', 'Leblanc', 'Chogath'
    snake = re.sub(r'(?<!^)(?=[A-Z])', '_', key).upper()
    return snake

def get_moba_name(name):
    return name.lower().replace(" ", "").replace("'", "").replace(".", "")

def fetch_opgg_champion_stats(champion_name, role="mid"):
    """
    Fetch builds, runes, skills, counters, and synergies from OP.GG's official MCP server.
    """
    role = POSITION_MAP.get(role.lower(), "mid")
    opgg_champ_key = clean_opgg_champ_name(champion_name)
    
    base_url = "https://mcp-api.op.gg/mcp"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # JSON-RPC request payload
    rpc_call = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "lol_get_champion_analysis",
            "arguments": {
                "game_mode": "ranked",
                "champion": opgg_champ_key,
                "position": role,
                "desired_output_fields": [
                    "champion",
                    "position",
                    "data.starter_items",
                    "data.core_items",
                    "data.boots",
                    "data.runes",
                    "data.skills",
                    "data.skill_masteries",
                    "data.summoner_spells",
                    "data.strong_counters",
                    "data.weak_counters",
                    "data.synergies.support",
                    "data.synergies.adc"
                ]
            }
        },
        "id": "1"
    }
    
    build_data = {}
    counters = []
    
    try:
        res = requests.post(base_url, headers=headers, json=rpc_call, timeout=12)
        if res.status_code == 200:
            rpc_res = res.json()
            if "error" in rpc_res:
                print(f"[OP.GG] RPC Error: {rpc_res['error']}")
                return None
                
            content = rpc_res.get("result", {}).get("content", [])
            if not content:
                print("[OP.GG] Empty content list in response.")
                return None
                
            text_data = content[0].get("text", "")
            
            # Find the instantiation block
            inst_start = text_data.find("LolGetChampionAnalysis(")
            if inst_start == -1:
                print("[OP.GG] Instantiation block not found in text.")
                return None
                
            inst_str = text_data[inst_start:].strip()
            
            # Parse class definitions dynamically from text header
            lines = text_data[:inst_start].split("\n")
            eval_namespace = {}
            for line in lines:
                line = line.strip()
                if line.startswith("class "):
                    match = re.match(r'class (\w+):\s*(.*)', line)
                    if match:
                        c_name = match.group(1)
                        c_fields = [f.strip() for f in match.group(2).split(",") if f.strip()]
                        eval_namespace[c_name] = create_dynamic_class(c_name, c_fields)
            
            # Safe eval parsing
            parsed_obj = eval(inst_str, {"__builtins__": None}, eval_namespace)
            stats = parsed_obj.to_dict()
            data_dict = stats.get("data") or {}
            
            if data_dict:
                # 1. Resolve Runes
                r_raw = data_dict.get("runes") or {}
                if r_raw:
                    primary_style = dd_manager.get_rune_by_id(r_raw.get("primary_page_id", 0))
                    sub_style = dd_manager.get_rune_by_id(r_raw.get("secondary_page_id", 0))
                    
                    perks = []
                    for perk_id in (r_raw.get("primary_rune_ids") or []) + (r_raw.get("secondary_rune_ids") or []):
                        perks.append(dd_manager.get_rune_by_id(perk_id))
                        
                    shards = []
                    for shard_id in (r_raw.get("stat_mod_ids") or []):
                        shards.append(dd_manager.get_rune_by_id(shard_id))
                        
                    build_data["runes"] = {
                        "primary_style": primary_style,
                        "sub_style": sub_style,
                        "perks": perks,
                        "shards": shards
                    }
                
                # 2. Resolve Starting Items
                starter_items = []
                s_raw = data_dict.get("starter_items") or {}
                if s_raw and s_raw.get("ids"):
                    for item_id in s_raw.get("ids", []):
                        starter_items.append(dd_manager.get_item_by_id(item_id))
                build_data["starting_items"] = starter_items
                
                # 3. Resolve Core Items & Boots
                core_items = []
                c_raw = data_dict.get("core_items") or {}
                if c_raw and c_raw.get("ids"):
                    for item_id in c_raw.get("ids", []):
                        core_items.append(dd_manager.get_item_by_id(item_id))
                
                b_raw = data_dict.get("boots") or {}
                if b_raw and b_raw.get("ids"):
                    for item_id in b_raw.get("ids", []):
                        core_items.append(dd_manager.get_item_by_id(item_id))
                        
                build_data["core_items"] = core_items
                build_data["situational_items"] = []
                
                # 4. Resolve Skills Priority and Path
                skills_raw = data_dict.get("skills") or {}
                skill_masteries = data_dict.get("skill_masteries") or {}
                
                priority = "Q > W > E"
                if skill_masteries and skill_masteries.get("ids"):
                    priority = " > ".join(skill_masteries.get("ids"))
                    
                build_data["skill_priority"] = priority
                build_data["skill_path"] = skills_raw.get("order", []) if skills_raw else []
                
                # 5. Resolve Summoner Spells
                summoners = []
                sp_raw = data_dict.get("summoner_spells") or {}
                if sp_raw and sp_raw.get("ids"):
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
                    for s_id in sp_raw.get("ids", []):
                        img_name = summoner_filenames.get(s_id, "SummonerFlash")
                        summoners.append({
                            "id": s_id,
                            "name": summoner_names.get(s_id, f"Spell {s_id}"),
                            "image": f"https://ddragon.leagueoflegends.com/cdn/{dd_manager.version}/img/spell/{img_name}.png"
                        })
                build_data["summoner_spells"] = summoners
                
                # 6. Resolve Teammate Synergies
                synergies_data = {"adc": [], "support": []}
                syn_raw = data_dict.get("synergies") or {}
                if syn_raw:
                    # Support list
                    for sup in (syn_raw.get("support") or []):
                        if not sup:
                            continue
                        wr = sup.get("win_rate", 0.5)
                        if wr <= 1.0:
                            wr = wr * 100
                        synergies_data["support"].append({
                            "champion_id": sup.get("synergy_champion_id"),
                            "name": sup.get("synergy_champion_name"),
                            "win_rate": wr
                        })
                    # ADC list
                    for adc in (syn_raw.get("adc") or []):
                        if not adc:
                            continue
                        wr = adc.get("win_rate", 0.5)
                        if wr <= 1.0:
                            wr = wr * 100
                        synergies_data["adc"].append({
                            "champion_id": adc.get("synergy_champion_id"),
                            "name": adc.get("synergy_champion_name"),
                            "win_rate": wr
                        })
                build_data["synergies"] = synergies_data
                
                # 7. Resolve Counters
                for sc in (data_dict.get("strong_counters") or []):
                    if not sc:
                        continue
                    c_id = sc.get("champion_id")
                    champ_info = dd_manager.get_champion_by_id(c_id)
                    wr = sc.get("win_rate", 0.5)
                    if wr <= 1.0:
                        wr = wr * 100
                        
                    counters.append({
                        "champion_id": c_id,
                        "name": champ_info["name"],
                        "key": champ_info["key"],
                        "image": champ_info["image"],
                        "win_rate": wr,
                        "matches": sc.get("play", 0),
                        "gold_adv_15": 0,
                        "xp_adv_15": 0,
                        "cs_adv_15": 0,
                        "kill_adv_15": 0,
                        "team_gold_difference_15": 0,
                        "mobafire_guide_url": f"https://www.mobafire.com/league-of-legends/champion/{get_moba_name(champ_info['name'])}",
                        "mobafire_counters_url": f"https://www.mobafire.com/league-of-legends/champion/{get_moba_name(champ_info['name'])}/counters"
                    })
                    
                for wc in data_dict.get("weak_counters", []):
                    c_id = wc.get("champion_id")
                    champ_info = dd_manager.get_champion_by_id(c_id)
                    wr = wc.get("win_rate", 0.5)
                    if wr <= 1.0:
                        wr = wr * 100
                        
                    counters.append({
                        "champion_id": c_id,
                        "name": champ_info["name"],
                        "key": champ_info["key"],
                        "image": champ_info["image"],
                        "win_rate": wr,
                        "matches": wc.get("play", 0),
                        "gold_adv_15": 0,
                        "xp_adv_15": 0,
                        "cs_adv_15": 0,
                        "kill_adv_15": 0,
                        "team_gold_difference_15": 0,
                        "mobafire_guide_url": f"https://www.mobafire.com/league-of-legends/champion/{get_moba_name(champ_info['name'])}",
                        "mobafire_counters_url": f"https://www.mobafire.com/league-of-legends/champion/{get_moba_name(champ_info['name'])}/counters"
                    })
                    
                counters = sorted(counters, key=lambda x: x["win_rate"])
                
            return {
                "champion": champion_name,
                "role": role,
                "build": build_data,
                "counters": counters
            }
            
    except Exception as e:
        print(f"[OP.GG] Error fetching champion stats: {e}")
        
    return None

if __name__ == "__main__":
    # Test fetch Wukong jungle and print support synergies
    res = fetch_opgg_champion_stats("Lucian", "adc")
    if res:
        print(f"OP.GG Stats for {res['champion']} ({res['role']}):")
        print(f"Support Synergies count: {len(res['build'].get('synergies', {}).get('support', []))}")
        if res['build'].get('synergies', {}).get('support'):
            print(f"Top Support Synergy: {res['build']['synergies']['support'][0]['name']} ({res['build']['synergies']['support'][0]['win_rate']}%)")
    else:
        print("Failed to load OP.GG stats.")
