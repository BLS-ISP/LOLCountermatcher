import asyncio
import os
import json
import traceback
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
import requests
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
import sys

if getattr(sys, 'frozen', False):
    EXE_DIR = os.path.dirname(sys.executable)
else:
    EXE_DIR = os.path.dirname(os.path.abspath(__file__))


from ddragon import dd_manager
from lcu import lcu_manager
from ugg import fetch_champion_stats
from opgg import fetch_opgg_champion_stats

app = FastAPI(title="LoL Countermatcher & Build Helper")

# Ensure static directory exists
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# WebSocket connections tracker
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        # Create a copy of the list to avoid modification issues during iteration
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# In-memory cache for U.GG and OP.GG fetched stats to avoid duplicate requests
# Format: (champ_name, role) -> stats_dict
stats_cache = {}
opgg_cache = {}

# Load gameplay tips database
TIPS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tips.json")
champion_tips = {}
if os.path.exists(TIPS_FILE):
    try:
        with open(TIPS_FILE, "r", encoding="utf-8") as f:
            champion_tips = json.load(f)
        print(f"[Backend] Successfully loaded gameplay tips for {len(champion_tips)} champions.")
    except Exception as e:
        print(f"[Backend] Error loading tips.json: {e}")

def get_champion_tips(champ_name):
    """Retrieve counter tips for a champion from the database or fall back to class-based tips."""
    for key, tips in champion_tips.items():
        if key.lower() == champ_name.lower():
            return tips
            
    champ_info = dd_manager.get_champion_by_name(champ_name)
    if champ_info:
        tags = champ_info.get("tags", [])
        if "Mage" in tags:
            return [
                "Build Magic Resist (e.g. Negatron Cloak) early to survive their spell rotations.",
                "Abuse their high skill cooldowns and mana dependencies early in the lane.",
                "Dodge their main poke spells before looking for all-in trades."
            ]
        elif "Assassin" in tags:
            return [
                "Respect their level 6 power spike. Play defensively when their ultimate is available.",
                "Keep river bushes warded to track their flanking and roaming movements.",
                "Build early Armor/Magic Resist or items like Zhonya's/Sterak's to survive their burst."
            ]
        elif "Tank" in tags:
            return [
                "Build Percent Health damage items (e.g., Liandry's Torment, Lord Dominik's Regards) to shred them.",
                "Avoid wasting major high-damage spell rotations on them in teamfights; target squishier enemies.",
                "Be wary of their crowd control (CC) chains during teamfights or river skirmishes."
            ]
        elif "Marksman" in tags:
            return [
                "Punish them when they step forward to last hit minions in lane.",
                "Focus them down first in teamfights, as they are the primary damage source but lack defense.",
                "Avoid long, extended basic attack trades unless you have burst advantages."
            ]
            
    return [
        "Play around their cooldowns. Trade when their key spells are down.",
        "Keep vision in bushes and river pathways to prevent enemy jungler ganks.",
        "Ensure you buy Control Wards and focus on maintaining high creep score (CS)."
    ]

CACHE_DIR = os.path.join(EXE_DIR, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)
import time

def get_cached_stats(champion_name, role):
    key = (champion_name.lower(), role.lower())
    if key in stats_cache:
        return stats_cache[key]
        
    # Check disk cache
    safe_name = champion_name.lower().replace(" ", "").replace("'", "")
    filename = os.path.join(CACHE_DIR, f"ugg_{safe_name}_{role.lower()}.json")
    if os.path.exists(filename):
        if time.time() - os.path.getmtime(filename) < 86400:
            try:
                with open(filename, "r", encoding="utf-8") as f:
                    stats = json.load(f)
                if stats and stats.get("build"):
                    stats_cache[key] = stats
                    return stats
            except Exception as e:
                print(f"[Backend] Error reading disk cache for {champion_name}: {e}")

    # Fetch from web
    stats = fetch_champion_stats(champion_name, role)
    if stats and stats.get("build"):
        stats_cache[key] = stats
        try:
            with open(filename, "w", encoding="utf-8") as f:
                json.dump(stats, f, indent=4)
        except Exception as e:
            print(f"[Backend] Error writing disk cache for {champion_name}: {e}")
            
    return stats_cache.get(key)

def get_cached_opgg_stats(champion_name, role):
    key = (champion_name.lower(), role.lower())
    if key in opgg_cache:
        return opgg_cache[key]
        
    # Check disk cache
    safe_name = champion_name.lower().replace(" ", "").replace("'", "")
    filename = os.path.join(CACHE_DIR, f"opgg_{safe_name}_{role.lower()}.json")
    if os.path.exists(filename):
        if time.time() - os.path.getmtime(filename) < 86400:
            try:
                with open(filename, "r", encoding="utf-8") as f:
                    stats = json.load(f)
                if stats and stats.get("build"):
                    opgg_cache[key] = stats
                    return stats
            except Exception as e:
                print(f"[Backend] Error reading OPGG disk cache for {champion_name}: {e}")

    # Fetch from web
    stats = fetch_opgg_champion_stats(champion_name, role)
    if stats and stats.get("build"):
        opgg_cache[key] = stats
        try:
            with open(filename, "w", encoding="utf-8") as f:
                json.dump(stats, f, indent=4)
        except Exception as e:
            print(f"[Backend] Error writing OPGG disk cache for {champion_name}: {e}")
            
    return opgg_cache.get(key)

@app.get("/")
async def get_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>LoL Countermatcher Frontend is missing!</h1><p>Please create index.html in the static directory.</p>")

@app.get("/api/champions")
async def get_champions():
    """Return list of all champions for autocomplete search."""
    champs = []
    for c_id, info in dd_manager.champions.items():
        champs.append({
            "id": c_id,
            "name": info["name"],
            "key": info["key"],
            "image": info["image"],
            "tags": info.get("tags", [])
        })
    return sorted(champs, key=lambda x: x["name"])

@app.get("/api/connection-url")
async def get_connection_url():
    """Retrieve host machine local LAN IP for mobile browser sync."""
    import socket
    local_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    return {
        "local_ip": local_ip,
        "port": 8000,
        "url": f"http://{local_ip}:8000"
    }

@app.get("/api/search")
async def search_champion(champion: str, role: str = "mid"):
    """Handle manual stats lookups."""
    # Find matching champion from DDragon
    champ_info = dd_manager.get_champion_by_name(champion)
    if not champ_info:
        return {"error": f"Champion '{champion}' not found."}
        
    stats_ugg = get_cached_stats(champ_info["name"], role)
    stats_opgg = get_cached_opgg_stats(champ_info["name"], role)
    
    if not stats_ugg and not stats_opgg:
        return {"error": "Failed to retrieve stats from both U.GG and OP.GG."}
        
    tips = get_champion_tips(champ_info["name"])
    return {
        "ugg": stats_ugg,
        "opgg": stats_opgg,
        "tips": tips
    }

from pydantic import BaseModel
from typing import List

class RunesImportRequest(BaseModel):
    primary_style_id: int
    sub_style_id: int
    perk_ids: List[int]
    shard_ids: List[int]
    page_name: str

@app.post("/api/import-runes")
async def import_runes_endpoint(req: RunesImportRequest):
    """Import recommended runes directly into the LCU Client."""
    res = lcu_manager.import_runes(
        primary_style_id=req.primary_style_id,
        sub_style_id=req.sub_style_id,
        perk_ids=req.perk_ids,
        shard_ids=req.shard_ids,
        page_name=req.page_name
    )
    return res

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # Send current state immediately on connect
    try:
        await websocket.send_json(current_state)
        while True:
            # Keep connection open
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# Global state tracker
current_state = {
    "connected": False,
    "summoner": None,
    "phase": "None",
    "champ_select": None,
    "stats": None,
    "stats_opgg": None,
    "tips": None,
    "draft_suggestions": None,
    "live_game": None,
    "warmup": None
}

async def prefetch_champ_stats_async(champ_name, role_name):
    # Standardize position
    role_map = {"bottom": "adc", "utility": "support", "middle": "mid", "top": "top", "jungle": "jungle"}
    std_role = role_map.get(role_name.lower(), "mid")
    
    # Fetch in thread to avoid blocking loop
    def fetch():
        get_cached_stats(champ_name, std_role)
        get_cached_opgg_stats(champ_name, std_role)
        
    await asyncio.to_thread(fetch)

def calculate_draft_suggestions(cs_data):
    if not cs_data:
        return None
        
    role = cs_data.get("role", "").lower()
    # Map LCU role to standard role
    role_map = {"bottom": "adc", "utility": "support", "middle": "mid", "top": "top", "jungle": "jungle"}
    std_player_role = role_map.get(role, "mid")
    
    enemy_picks = cs_data.get("enemy_picks", [])
    team_picks = cs_data.get("team_picks", [])
    
    # 1. Calculate Whole Team Counters (top 3)
    opponent = next((e for e in enemy_picks if e.get("role", "").lower() == role), None)
    
    candidates = []
    if opponent:
        opponent_name = opponent["name"]
        opponent_role = std_player_role
        
        ugg_s = get_cached_stats(opponent_name, opponent_role)
        opgg_s = get_cached_opgg_stats(opponent_name, opponent_role)
        
        c_set = set()
        if ugg_s and ugg_s.get("counters"):
            for c in ugg_s["counters"]:
                c_set.add(c["champion_id"])
        if opgg_s and opgg_s.get("counters"):
            for c in opgg_s["counters"]:
                c_set.add(c["champion_id"])
        candidates = list(c_set)
    else:
        # Fallback if opponent not locked: use all champions as potential candidates
        candidates = list(dd_manager.champions.keys())
            
    team_counters = []
    for c_id in candidates:
        champ_info = dd_manager.get_champion_by_id(c_id)
        if not champ_info:
            continue
            
        score = 0.0
        matches_countered = 0
        
        for enemy in enemy_picks:
            enemy_name = enemy["name"]
            enemy_role = role_map.get(enemy["role"].lower(), "mid")
            
            e_ugg = get_cached_stats(enemy_name, enemy_role)
            e_opgg = get_cached_opgg_stats(enemy_name, enemy_role)
            
            wr_list = []
            if e_ugg and e_ugg.get("counters"):
                for ec in e_ugg["counters"]:
                    if ec["champion_id"] == c_id:
                        wr_list.append(ec["win_rate"])
            if e_opgg and e_opgg.get("counters"):
                for ec in e_opgg["counters"]:
                    if ec["champion_id"] == c_id:
                        wr_list.append(ec["win_rate"])
                        
            if wr_list:
                avg_wr = sum(wr_list) / len(wr_list)
                score += (50.0 - avg_wr)
                matches_countered += 1
                
        if len(enemy_picks) > 0 and matches_countered > 0:
            tips_list = get_champion_tips(champ_info["name"])
            synergy_note = tips_list[0] if tips_list else "Strong overall matchup winrate."
            team_counters.append({
                "champion_id": c_id,
                "name": champ_info["name"],
                "image": champ_info["image"],
                "score": round(score, 2),
                "matches_countered": matches_countered,
                "synergy_note": synergy_note
            })
            
    team_counters = sorted(team_counters, key=lambda x: x["score"], reverse=True)[:3]
    
    # 2. Botlane Suggestions (ADC + Support complex evaluation)
    botlane_suggestions = []
    if std_player_role in ["adc", "support"]:
        # Find ally botlaner
        ally_bot = None
        if std_player_role == "support":
            ally_bot = next((p for p in team_picks if p.get("role", "").lower() == "bottom"), None)
            target_role = "support"
        else:
            ally_bot = next((p for p in team_picks if p.get("role", "").lower() == "utility"), None)
            target_role = "adc"
            
        enemy_adc = next((e for e in enemy_picks if e.get("role", "").lower() == "bottom"), None)
        enemy_sup = next((e for e in enemy_picks if e.get("role", "").lower() == "utility"), None)
        
        bot_candidates = list(dd_manager.champions.keys())
            
        synergy_map = {}
        if ally_bot:
            # Load stats of teammate to extract synergies
            ally_stats = get_cached_opgg_stats(ally_bot["name"], "adc" if std_player_role == "support" else "support")
            if ally_stats and ally_stats.get("build") and ally_stats["build"].get("synergies"):
                syn_list = ally_stats["build"]["synergies"].get(target_role, [])
                for syn in syn_list:
                    synergy_map[syn["champion_id"]] = syn["win_rate"]
                    
        supports_set = {
            "Thresh", "Lulu", "Janna", "Nami", "Yuumi", "Soraka", "Sona", "Karma", 
            "Braum", "Leona", "Alistar", "Taric", "Rakan", "Pyke", "Nautilus", 
            "Blitzcrank", "Bard", "Morgana", "Zyra", "Brand", "Lux", "Senna", "Seraphine",
            "Renata Glasc", "Rell", "Milio", "Hwei"
        }
        adcs_set = {
            "Ashe", "Caitlyn", "Draven", "Ezreal", "Jhin", "Jinx", "Kai'Sa", "Kalista",
            "Kog'Maw", "Lucian", "Miss Fortune", "Samira", "Sivir", "Tristana", "Varus",
            "Vayne", "Xayah", "Zeri", "Aphelios", "Nilah", "Twitch"
        }
        
        role_filter_set = supports_set if target_role == "support" else adcs_set
        
        for c_id in bot_candidates:
            champ_info = dd_manager.get_champion_by_id(c_id)
            if not champ_info or champ_info["name"] not in role_filter_set:
                continue
                
            synergy_wr = synergy_map.get(c_id, 50.0)
            synergy_delta = synergy_wr - 50.0
            
            adc_delta = 0.0
            if enemy_adc:
                adc_ugg = get_cached_stats(enemy_adc["name"], "adc")
                adc_opgg = get_cached_opgg_stats(enemy_adc["name"], "adc")
                wr_list = []
                if adc_ugg and adc_ugg.get("counters"):
                    for ec in adc_ugg["counters"]:
                        if ec["champion_id"] == c_id:
                            wr_list.append(ec["win_rate"])
                if adc_opgg and adc_opgg.get("counters"):
                    for ec in adc_opgg["counters"]:
                        if ec["champion_id"] == c_id:
                            wr_list.append(ec["win_rate"])
                if wr_list:
                    adc_delta = 50.0 - (sum(wr_list) / len(wr_list))
                    
            sup_delta = 0.0
            if enemy_sup:
                sup_ugg = get_cached_stats(enemy_sup["name"], "support")
                sup_opgg = get_cached_opgg_stats(enemy_sup["name"], "support")
                wr_list = []
                if sup_ugg and sup_ugg.get("counters"):
                    for ec in sup_ugg["counters"]:
                        if ec["champion_id"] == c_id:
                            wr_list.append(ec["win_rate"])
                if sup_opgg and sup_opgg.get("counters"):
                    for ec in sup_opgg["counters"]:
                        if ec["champion_id"] == c_id:
                            wr_list.append(ec["win_rate"])
                if wr_list:
                    sup_delta = 50.0 - (sum(wr_list) / len(wr_list))
                    
            score = synergy_delta + adc_delta + sup_delta
            
            botlane_suggestions.append({
                "champion_id": c_id,
                "name": champ_info["name"],
                "image": champ_info["image"],
                "score": round(score, 2),
                "synergy_wr": round(synergy_wr, 1),
                "enemy_adc_locked": enemy_adc is not None,
                "enemy_sup_locked": enemy_sup is not None,
                "ally_bot_locked": ally_bot is not None,
                "ally_bot_name": ally_bot["name"] if ally_bot else ""
            })
            
        botlane_suggestions = sorted(botlane_suggestions, key=lambda x: x["score"], reverse=True)[:3]
        
    # Calculate AD/AP damage ratios for both teams
    ally_picks = cs_data.get("team_picks", [])
    enemy_picks = cs_data.get("enemy_picks", [])
    user_champ = cs_data.get("champion_name")
    
    def get_team_damage_ratios(picks, user_pick=None):
        ad_count = 0.0
        ap_count = 0.0
        
        all_champs = [p["name"] for p in picks if p.get("name")]
        if user_pick:
            all_champs.append(user_pick)
            
        if not all_champs:
            return {"ad": 50, "ap": 50}
            
        for name in all_champs:
            profile, conf = dd_manager.get_champion_damage_profile(name)
            if profile == "AP":
                ap_count += 1.0
            else:
                ad_count += 1.0
                
        total = ad_count + ap_count
        if total == 0:
            return {"ad": 50, "ap": 50}
            
        return {
            "ad": int(round((ad_count / total) * 100)),
            "ap": int(round((ap_count / total) * 100))
        }
        
    damage_balance = {
        "ally": get_team_damage_ratios(ally_picks, user_champ),
        "enemy": get_team_damage_ratios(enemy_picks)
    }
    
    # 3. Ban Recommendations (worst matchups of hovered hero)
    ban_rec = None
    if user_champ:
        ugg_s = get_cached_stats(user_champ, std_player_role)
        opgg_s = get_cached_opgg_stats(user_champ, std_player_role)
        worst_wr = 0.0
        worst_counter_champ = None
        
        counters_checked = []
        if ugg_s and ugg_s.get("counters"):
            counters_checked.extend(ugg_s["counters"])
        if opgg_s and opgg_s.get("counters"):
            counters_checked.extend(opgg_s["counters"])
            
        for c in counters_checked:
            if c.get("win_rate", 0) > worst_wr:
                worst_wr = c["win_rate"]
                worst_counter_champ = c
                
        if worst_counter_champ:
            c_info = dd_manager.get_champion_by_id(worst_counter_champ["champion_id"])
            ban_rec = {
                "name": c_info["name"],
                "win_rate": round(worst_wr, 1),
                "image": c_info["image"]
            }
            
    # 4. Pick Order Swap Advisor
    user_index = cs_data.get("user_index", 0)
    swap_suggested = False
    swap_message = ""
    if std_player_role in ["top", "mid"] and user_index < 3:
        swap_suggested = True
        swap_message = "Solo lane pick order swap suggested: Ask to swap with Bot/Support to secure counterpick priority!"
        
    # 5. Composition Auditor
    all_allies = [p["name"] for p in ally_picks if p.get("name")]
    if user_champ:
        all_allies.append(user_champ)
        
    has_tank = False
    for name in all_allies:
        champ_info = dd_manager.get_champion_by_name(name)
        if champ_info and "Tank" in champ_info.get("tags", []):
            has_tank = True
            break
            
    cc_champs_set = {"Thresh", "Leona", "Nautilus", "Morgana", "Blitzcrank", "Pyke", "Alistar", "Taric", "Braum", "Rakan", "Rell", "Maokai", "Amumu", "Malphite", "Sejuani", "Ornn", "Galio", "Zac", "Shen", "Sion", "Gragas", "Syndra", "Orianna", "Lissandra", "Lux", "Veigar"}
    cc_count = 0
    for name in all_allies:
        champ_info = dd_manager.get_champion_by_name(name)
        if champ_info:
            if any(tag in champ_info.get("tags", []) for tag in ["Tank", "Mage"]) or name in cc_champs_set:
                cc_count += 1
                
    warnings = []
    if len(all_allies) >= 3:
        if not has_tank:
            warnings.append("No Frontline: Your team lacks a reliable tank. Consider drafting a frontline champ.")
        if cc_count == 0:
            warnings.append("Low CC: Your team lacks crowd control/stuns. Consider drafting a champion with hard CC.")
        if damage_balance["ally"]["ad"] >= 90:
            warnings.append("Full AD Team: Team is mostly physical damage. Consider drafting magic damage (AP).")
        if damage_balance["ally"]["ap"] >= 90:
            warnings.append("Full AP Team: Team is mostly magic damage. Consider drafting physical damage (AD).")
        
    return {
        "team_counters": team_counters,
        "botlane_suggestions": botlane_suggestions,
        "damage_balance": damage_balance,
        "ban_recommendation": ban_rec,
        "swap_advisor": {
            "suggested": swap_suggested,
            "message": swap_message
        },
        "comp_audit": {
            "warnings": warnings
        }
    }

def is_locally_cached(champion_name, role):
    safe_name = champion_name.lower().replace(" ", "").replace("'", "")
    ugg_file = os.path.join(CACHE_DIR, f"ugg_{safe_name}_{role.lower()}.json")
    opgg_file = os.path.join(CACHE_DIR, f"opgg_{safe_name}_{role.lower()}.json")
    if os.path.exists(ugg_file) and os.path.exists(opgg_file):
        if time.time() - os.path.getmtime(ugg_file) < 86400 and time.time() - os.path.getmtime(opgg_file) < 86400:
            return True
    return False

def match_summoner(name1: str, name2: str) -> bool:
    if not name1 or not name2:
        return False
    # Clean names: strip tag, lowercase, remove spaces
    n1 = name1.split("#")[0].replace(" ", "").lower()
    n2 = name2.split("#")[0].replace(" ", "").lower()
    return n1 == n2

async def lcu_monitoring_loop():
    """Background task to continuously poll the League of Legends client and update state."""
    global current_state
    
    prev_phase = "None"
    prev_cs_data = None
    debounce_task = None
    
    print("[Backend] LCU Monitoring loop started.")
    
    while True:
        try:
            connected = lcu_manager.is_connected()
            
            if not connected:
                if current_state["connected"]:
                    print("[Backend] League client disconnected.")
                    current_state = {
                        "connected": False,
                        "summoner": None,
                        "phase": "None",
                        "champ_select": None,
                        "stats": None,
                        "stats_opgg": None,
                        "draft_suggestions": None
                    }
                    await manager.broadcast(current_state)
                prev_phase = "None"
                prev_cs_data = None
                await asyncio.sleep(2)
                continue
                
            # Client is connected
            if not current_state["connected"]:
                print(f"[Backend] Connected to League Client: {lcu_manager.summoner_name}#{lcu_manager.summoner_tag}")
                current_state["connected"] = True
                current_state["summoner"] = {
                    "name": lcu_manager.summoner_name,
                    "tag": lcu_manager.summoner_tag,
                    "puuid": lcu_manager.puuid
                }
                await manager.broadcast(current_state)
                
            phase = lcu_manager.get_game_phase()
            state_changed = False
            
            if phase != prev_phase:
                print(f"[Backend] Game phase changed: {prev_phase} -> {phase}")
                current_state["phase"] = phase
                prev_phase = phase
                state_changed = True
                
            if phase == "ChampSelect":
                cs_data = lcu_manager.get_champ_select_data()
                if cs_data:
                    if cs_data != prev_cs_data or state_changed:
                        # Trigger prefetch for all teammate and enemy picks
                        for p in cs_data.get("team_picks", []):
                            if p.get("name") and p.get("role"):
                                asyncio.create_task(prefetch_champ_stats_async(p["name"], p["role"]))
                        for p in cs_data.get("enemy_picks", []):
                            if p.get("name") and p.get("role"):
                                asyncio.create_task(prefetch_champ_stats_async(p["name"], p["role"]))

                        champ_id = cs_data["champion_id"]
                        role = cs_data["role"]
                        print(f"[Backend] ChampSelect selection updated. Active Hero ID: {champ_id}, Role: {role}")
                        current_state["champ_select"] = {
                            "role": role,
                            "champion": {
                                "id": champ_id,
                                "name": cs_data["champion_name"],
                                "key": cs_data["champion_key"],
                                "image": cs_data["champion_image"]
                            } if champ_id > 0 else None,
                            "is_locked": cs_data["is_locked"],
                            "enemy_picks": cs_data["enemy_picks"],
                            "team_picks": cs_data["team_picks"]
                        }
                        
                        prev_cs_data = cs_data
                        state_changed = True
                        
                        # Cancel existing prefetch task if any
                        if debounce_task:
                            debounce_task.cancel()
                            debounce_task = None
                            
                        # Trigger stats prefetch
                        if cs_data["champion_name"]:
                            if cs_data["is_locked"] or is_locally_cached(cs_data["champion_name"], role):
                                print(f"[Backend] Pick ready (locked or cached). Loading {cs_data['champion_name']} ({role}) immediately.", flush=True)
                                stats = get_cached_stats(cs_data["champion_name"], role)
                                stats_opgg = get_cached_opgg_stats(cs_data["champion_name"], role)
                                current_state["stats"] = stats
                                current_state["stats_opgg"] = stats_opgg
                                current_state["tips"] = get_champion_tips(cs_data["champion_name"])
                            else:
                                print(f"[Backend] Pick hovered but not cached. Scheduling debounced prefetch for {cs_data['champion_name']} ({role}) in 1.5s...", flush=True)
                                current_state["stats"] = None
                                current_state["stats_opgg"] = None
                                current_state["tips"] = get_champion_tips(cs_data["champion_name"])
                                
                                async def delayed_prefetch(champ_name, role_name):
                                    try:
                                        await asyncio.sleep(1.5)
                                        print(f"[Backend] Hover debounce completed. Fetching stats for: {champ_name} ({role_name})", flush=True)
                                        loop = asyncio.get_running_loop()
                                        stats = await loop.run_in_executor(None, get_cached_stats, champ_name, role_name)
                                        stats_opgg = await loop.run_in_executor(None, get_cached_opgg_stats, champ_name, role_name)
                                        
                                        # Verify they are still hovering the same champ
                                        chk_cs = lcu_manager.get_champ_select_data()
                                        if chk_cs and chk_cs.get("champion_name") == champ_name:
                                            current_state["stats"] = stats
                                            current_state["stats_opgg"] = stats_opgg
                                            await manager.broadcast(current_state)
                                            print(f"[Backend] Apply debounced stats for {champ_name}", flush=True)
                                    except asyncio.CancelledError:
                                        pass
                                    except Exception as ex:
                                        print(f"[Backend] Error in delayed prefetch: {ex}")
                                        
                                debounce_task = asyncio.create_task(delayed_prefetch(cs_data["champion_name"], role))
                        else:
                            current_state["stats"] = None
                            current_state["stats_opgg"] = None
                            current_state["tips"] = None
                            if cs_data["enemy_picks"]:
                                latest_enemy = cs_data["enemy_picks"][-1]
                                print(f"[Backend] Enemy locked: {latest_enemy['name']}. Fetching enemy counters...")
                                enemy_stats = get_cached_stats(latest_enemy["name"], role)
                                enemy_stats_opgg = get_cached_opgg_stats(latest_enemy["name"], role)
                                if enemy_stats:
                                    current_state["stats"] = {
                                        "champion": latest_enemy["name"],
                                        "role": role,
                                        "is_enemy_focus": True,
                                        "counters": enemy_stats["counters"]
                                    }
                                if enemy_stats_opgg:
                                    current_state["stats_opgg"] = {
                                        "champion": latest_enemy["name"],
                                        "role": role,
                                        "is_enemy_focus": True,
                                        "counters": enemy_stats_opgg["counters"]
                                    }
                                current_state["tips"] = get_champion_tips(latest_enemy["name"])
                                    
                        # Compute draft suggestions based on active selections
                        current_state["draft_suggestions"] = calculate_draft_suggestions(cs_data)
                            
            elif phase == "InProgress":
                # In game phase. Attempt to find which champion we are playing if we don't know it.
                # LCU exposes session at /lol-gameflow/v1/session
                if not current_state.get("champ_select"):
                    try:
                        res = lcu_manager.session.get(f"{lcu_manager.base_url}/lol-gameflow/v1/session", timeout=1)
                        if res.status_code == 200:
                            g_session = res.json()
                            game_data = g_session.get("gameData", {})
                            team_one = game_data.get("teamOne", [])
                            team_two = game_data.get("teamTwo", [])
                            all_players = team_one + team_two
                            
                            our_player = next((p for p in all_players if p.get("puuid") == lcu_manager.puuid), None)
                            if our_player:
                                c_id = our_player.get("championId", 0)
                                if c_id > 0:
                                    user_champ = dd_manager.get_champion_by_id(c_id)
                                    print(f"[Backend] Detected active in-game champion: {user_champ['name']}")
                                    
                                    role = "middle"
                                    if current_state.get("champ_select") and current_state["champ_select"].get("role"):
                                        role = current_state["champ_select"]["role"]
                                    
                                    # Identify enemy team players
                                    our_team = "teamOne"
                                    if any(p.get("puuid") == lcu_manager.puuid for p in team_two):
                                        our_team = "teamTwo"
                                    
                                    enemy_players = team_one if our_team == "teamTwo" else team_two
                                    
                                    enemies = []
                                    for p in enemy_players:
                                        ec_id = p.get("championId", 0)
                                        if ec_id > 0:
                                            echamp = dd_manager.get_champion_by_id(ec_id)
                                            enemies.append({
                                                "id": ec_id,
                                                "name": echamp["name"],
                                                "image": echamp["image"],
                                                "spell1_id": p.get("spell1Id", 0),
                                                "spell2_id": p.get("spell2Id", 0)
                                            })
                                            
                                    current_state["champ_select"] = {
                                        "role": role,
                                        "champion": user_champ,
                                        "is_locked": True,
                                        "enemy_picks": enemies,
                                        "team_picks": []
                                    }
                                    stats = get_cached_stats(user_champ["name"], role)
                                    stats_opgg = get_cached_opgg_stats(user_champ["name"], role)
                                    current_state["stats"] = stats
                                    current_state["stats_opgg"] = stats_opgg
                                    current_state["tips"] = get_champion_tips(user_champ["name"])
                                    state_changed = True
                    except Exception as ex:
                        print(f"[Backend] Error reading in-game session: {ex}")
                        
                # Continually poll live client data API (port 2999) for real-time items, levels, CS, and KDAs
                try:
                    res_live = requests.get("https://127.0.0.1:2999/liveclientdata/allgamedata", verify=False, timeout=0.8)
                    if res_live.status_code == 200:
                        live_data = res_live.json()
                        all_players = live_data.get("allPlayers", [])
                        game_time = live_data.get("gameData", {}).get("gameTime", 0.0)
                        events = live_data.get("events", {}).get("Events", [])
                        
                        # Fetch active player name directly from Live Client Data API if available
                        active_api_name = None
                        try:
                            res_name = requests.get("https://127.0.0.1:2999/liveclientdata/activeplayername", verify=False, timeout=0.4)
                            if res_name.status_code == 200:
                                active_api_name = res_name.json()
                        except Exception:
                            pass
                            
                        our_summoner_name = None
                        if current_state.get("summoner"):
                            our_summoner_name = current_state["summoner"].get("name")
                        
                        active_name_to_match = active_api_name or our_summoner_name
                        
                        # Find the active player in all_players to get CS and items
                        active_p_obj = None
                        if active_name_to_match:
                            for p in all_players:
                                p_name = p.get("summonerName")
                                if p_name and match_summoner(p_name, active_name_to_match):
                                    active_p_obj = p
                                    break
                                    
                        # Active player statistics
                        ap = live_data.get("activePlayer", {})
                        
                        # Compute active player items gold cost and CS
                        ap_gold_total = 0
                        ap_cs = 0
                        if active_p_obj:
                            ap_cs = active_p_obj.get("scores", {}).get("creepScore", 0)
                            raw_items = active_p_obj.get("items", [])
                            for item in raw_items:
                                item_id = item.get("itemID")
                                if item_id:
                                    item_data = dd_manager.get_item_by_id(item_id)
                                    ap_gold_total += item_data.get("gold_total", 0)
                                
                        active_player_data = {
                            "level": ap.get("level", 1),
                            "gold": ap_gold_total,
                            "cs": ap_cs
                        }
                        
                        our_team_name = "ORDER"
                        if active_p_obj:
                            our_team_name = active_p_obj.get("team", "ORDER")
                                
                        ally_team = []
                        enemy_team = []
                        active_player_team_idx = 0
                        
                        for p in all_players:
                            if p.get("team") == our_team_name:
                                ally_team.append(p)
                                p_name = p.get("summonerName")
                                if p_name and active_name_to_match and match_summoner(p_name, active_name_to_match):
                                    active_player_team_idx = len(ally_team) - 1
                            else:
                                enemy_team.append(p)
                                
                        lane_opponent_name = "Unknown"
                        lane_opponent_cs = 0
                        if active_player_team_idx < len(enemy_team):
                            opp = enemy_team[active_player_team_idx]
                            lane_opponent_name = opp.get("championName", "Unknown")
                            lane_opponent_cs = opp.get("scores", {}).get("creepScore", 0)
                                
                        ally_gold_total = 0
                        enemy_gold_total = 0
                        for p in all_players:
                            p_gold = 0
                            raw_items = p.get("items", [])
                            for item in raw_items:
                                item_id = item.get("itemID")
                                if item_id:
                                    item_data = dd_manager.get_item_by_id(item_id)
                                    p_gold += item_data.get("gold_total", 0)
                            if p.get("team") == our_team_name:
                                ally_gold_total += p_gold
                            else:
                                enemy_gold_total += p_gold
                                
                        current_state["live_game"] = {
                            "game_time": game_time,
                            "events": events,
                            "active_player": active_player_data,
                            "ally_gold": ally_gold_total,
                            "enemy_gold": enemy_gold_total,
                            "lane_opponent_name": lane_opponent_name,
                            "lane_opponent_cs": lane_opponent_cs
                        }
                                
                        live_enemies = []
                        for p in all_players:
                            if p.get("team") != our_team_name:
                                champ_name = p.get("championName")
                                
                                raw_items = p.get("items", [])
                                items = []
                                has_lucidity = False
                                for item in raw_items:
                                    item_id = item.get("itemID")
                                    if item_id:
                                        if str(item_id) == "3158":
                                            has_lucidity = True
                                        items.append(dd_manager.get_item_by_id(item_id))
                                        
                                spells = p.get("summonerSpells", {})
                                spell_display_to_id = {
                                    "Cleanse": 1, "Exhaust": 3, "Flash": 4, "Ghost": 6, "Heal": 7,
                                    "Smite": 11, "Teleport": 12, "Ignite": 14, "Barrier": 21
                                }
                                s1_name = spells.get("summonerSpellOne", {}).get("displayName", "Flash")
                                s2_name = spells.get("summonerSpellTwo", {}).get("displayName", "Ignite")
                                s1_id = spell_display_to_id.get(s1_name, 4)
                                s2_id = spell_display_to_id.get(s2_name, 14)
                                
                                champ_info = dd_manager.get_champion_by_name(champ_name)
                                champ_image = champ_info["image"] if champ_info else ""
                                
                                live_enemies.append({
                                    "id": champ_info["id"] if champ_info else 0,
                                    "name": champ_name,
                                    "image": champ_image,
                                    "level": p.get("level", 1),
                                    "scores": {
                                        "kills": p.get("scores", {}).get("kills", 0),
                                        "deaths": p.get("scores", {}).get("deaths", 0),
                                        "assists": p.get("scores", {}).get("assists", 0),
                                        "cs": p.get("scores", {}).get("creepScore", 0)
                                    },
                                    "items": items,
                                    "has_lucidity": has_lucidity,
                                    "spell1_id": s1_id,
                                    "spell2_id": s2_id,
                                    "respawn_timer": p.get("respawnTimer", 0.0)
                                })
                                
                        if live_enemies and current_state.get("champ_select"):
                            current_state["champ_select"]["enemy_picks"] = live_enemies
                            state_changed = True
                except Exception:
                    current_state["live_game"] = None
            else:
                # Normal/None/Lobby state
                if current_state["champ_select"] is not None:
                    current_state["champ_select"] = None
                    current_state["stats"] = None
                    current_state["stats_opgg"] = None
                    current_state["tips"] = None
                    current_state["draft_suggestions"] = None
                    current_state["live_game"] = None
                    state_changed = True
                prev_cs_data = None
                
            if state_changed:
                await manager.broadcast(current_state)
                
        except Exception as e:
            print(f"[Backend] Error in monitoring loop: {e}")
            traceback.print_exc()
            
        await asyncio.sleep(2)

# Low-level Windows ctypes key press listener for hotkeys
# Captures customizable modifiers and key presets for Enemy CD tracking
import ctypes
import time
import threading

loop = None

DEFAULT_SETTINGS = {
    "voice_coach_enabled": True,
    "voice_name": "",
    "voice_speed": 1.0,
    "voice_pitch": 1.0,
    "hotkey_ctrl": True,
    "hotkey_alt": True,
    "hotkey_shift": False,
    "hotkey_keys": "1-5", # "1-5" or "F1-F5"
    "default_source": "ugg",
    "default_matchups": "worst"
}

CACHE_DIR = os.path.join(EXE_DIR, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)
SETTINGS_FILE = os.path.join(EXE_DIR, "settings.json")
active_settings = DEFAULT_SETTINGS.copy()

def load_settings():
    global active_settings
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                for k, v in DEFAULT_SETTINGS.items():
                    if k not in loaded:
                        loaded[k] = v
                active_settings = loaded
                print(f"[Backend] Successfully loaded settings from {SETTINGS_FILE}", flush=True)
                return
        except Exception as e:
            print(f"[Backend] Error loading settings from {SETTINGS_FILE}: {e}", flush=True)
            
    active_settings = DEFAULT_SETTINGS.copy()
    print(f"[Backend] Initialized default companion settings at: {SETTINGS_FILE}", flush=True)
    
def save_settings(settings):
    global active_settings
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=4)
        active_settings = settings
    except Exception as e:
        print(f"[Backend] Error saving settings: {e}")

def keyboard_listener():
    user32 = ctypes.windll.user32
    
    VK_CONTROL = 0x11
    VK_MENU = 0x12 # Alt
    VK_SHIFT = 0x10
    
    triggered_keys = {}
    
    while True:
        try:
            time.sleep(0.08) # 80ms poll rate is optimal
            
            # Read config values dynamically
            req_ctrl = active_settings.get("hotkey_ctrl", True)
            req_alt = active_settings.get("hotkey_alt", True)
            req_shift = active_settings.get("hotkey_shift", False)
            key_preset = active_settings.get("hotkey_keys", "1-5")
            
            # Check active modifier keys
            ctrl_down = (user32.GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0
            alt_down = (user32.GetAsyncKeyState(VK_MENU) & 0x8000) != 0
            shift_down = (user32.GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0
            
            # Match required modifier state
            modifiers_match = True
            if req_ctrl and not ctrl_down: modifiers_match = False
            if req_alt and not alt_down: modifiers_match = False
            if req_shift and not shift_down: modifiers_match = False
            
            if modifiers_match:
                base_vk = 0x30 if key_preset == "1-5" else 0x6F
                
                for i in range(1, 6):
                    vk = base_vk + i
                    is_down = (user32.GetAsyncKeyState(vk) & 0x8000) != 0
                    
                    is_ult = shift_down if not req_shift else alt_down
                    key_id = f"{i}_{is_ult}"
                    if is_down:
                        if not triggered_keys.get(key_id):
                            triggered_keys[key_id] = True
                            
                            action_type = "hotkey_ult" if is_ult else "hotkey_spell"
                            event_payload = {
                                "type": action_type,
                                "enemy_index": i - 1
                            }
                            if loop:
                                asyncio.run_coroutine_threadsafe(
                                    manager.broadcast(event_payload),
                                    loop
                                )
                    else:
                        triggered_keys[key_id] = False
        except Exception:
            pass

# Matchup Notes File Mappings
NOTES_FILE = os.path.join(EXE_DIR, "matchup_notes.json")

def load_notes():
    if os.path.exists(NOTES_FILE):
        try:
            with open(NOTES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}
    
def save_notes(notes):
    try:
        with open(NOTES_FILE, "w", encoding="utf-8") as f:
            json.dump(notes, f, indent=4)
    except Exception as e:
        print(f"[Backend] Error saving notes: {e}")

@app.get("/api/notes")
def get_notes(champion: str):
    notes = load_notes()
    return {"note": notes.get(champion.lower(), "")}

@app.post("/api/notes")
async def update_notes(data: dict):
    champion = data.get("champion")
    note = data.get("note", "")
    if champion:
        notes = load_notes()
        notes[champion.lower()] = note
        save_notes(notes)
        return {"success": True}
    return {"success": False, "error": "Invalid champion"}

@app.get("/api/settings")
def get_settings():
    load_settings()
    return active_settings

@app.post("/api/settings")
async def update_settings(data: dict):
    save_settings(data)
    return {"success": True}

POPULAR_META_CHAMPIONS = {
    "top": ["Garen", "Darius", "Aatrox", "Jax", "Malphite", "Fiora", "Gnar", "Ornn", "Camille", "Urgot", "Sett", "KSante", "Renekton", "Shen", "Nasus", "Teemo", "Gwen", "Tryndamere", "Kayle", "ChoGath", "Mordekaiser", "Sion", "Singed", "Rumble", "Yorick", "Poppy", "Volibear", "Kennen", "Olaf", "Jayce"],
    "jungle": ["Kayn", "Lee Sin", "Graves", "Hecarim", "KhaZix", "Viego", "Nocturne", "Lillia", "Master Yi", "Shaco", "Jarvan IV", "Ekko", "Evelynn", "Elise", "Gragas", "Nunu", "Rengar", "Amumu", "Rammus", "Warwick", "Jax", "Briar", "Udyr", "Sejuani", "Fiddlesticks", "Zac", "BelVeth", "Xin Zhao", "Nidalee", "Kindred"],
    "mid": ["Yasuo", "Yone", "Ahri", "Zed", "Lux", "Akali", "Sylas", "Katarina", "Syndra", "Orianna", "Vex", "Aurelion Sol", "Kassadin", "Fizz", "Leblanc", "Viktor", "Veigar", "Galio", "Talon", "Hwei", "Vladimir", "Naafiri", "Malzahar", "Zoe", "Lissandra", "Tristana", "Corki", "Jayce", "Azir", "Swayn"],
    "adc": ["Jinx", "Ezreal", "KaiSa", "Jhin", "Caitlyn", "Lucian", "Ashe", "Vayne", "Miss Fortune", "Samira", "Twitch", "Aphelios", "Zeri", "Varus", "Draven", "Tristana", "Sivir", "Nilah", "KogMaw", "Kalista", "Xayah", "Smolder"],
    "support": ["Thresh", "Lulu", "Lux", "Nautilus", "Senna", "Pyke", "Blitzcrank", "Karma", "Morgana", "Yuumi", "Sona", "Soraka", "Leona", "Nami", "Bard", "Milio", "Rakan", "Janna", "Alistar", "Xerath", "Zyra", "Brand", "Maokai", "Taric", "Braum", "Renata", "Zilean"]
}

async def warmup_meta_cache_task():
    print("[Backend] Starting meta warmup cache prefetch thread...", flush=True)
    await asyncio.sleep(2.0) # wait for uvicorn bind
    
    flat_roster = []
    for role, champs in POPULAR_META_CHAMPIONS.items():
        for champ in champs:
            flat_roster.append((champ, role))
            
    seen = set()
    deduped_roster = []
    for champ, role in flat_roster:
        key = (champ.lower(), role)
        if key not in seen:
            seen.add(key)
            deduped_roster.append((champ, role))
            
    total_targets = len(deduped_roster)
    print(f"[Backend] Warmup cache contains {total_targets} distinct champion-role targets.", flush=True)
    
    # Initialize warmup state
    current_state["warmup"] = {
        "progress": 0,
        "count": 0,
        "total": total_targets
    }
    
    success_count = 0
    success_lock = asyncio.Lock()
    to_scrape = []
    
    # Step 1: Check and load already cached targets instantly from disk in parallel
    loop = asyncio.get_running_loop()
    disk_load_tasks = []
    
    async def load_cached_target(champ, role):
        nonlocal success_count
        try:
            # Gather U.GG and OP.GG disk reads concurrently
            await asyncio.gather(
                loop.run_in_executor(None, get_cached_stats, champ, role),
                loop.run_in_executor(None, get_cached_opgg_stats, champ, role)
            )
            async with success_lock:
                success_count += 1
        except Exception:
            to_scrape.append((champ, role))

    for champ, role in deduped_roster:
        if is_locally_cached(champ, role):
            disk_load_tasks.append(load_cached_target(champ, role))
        else:
            to_scrape.append((champ, role))
            
    if disk_load_tasks:
        await asyncio.gather(*disk_load_tasks)
            
    # Update state with cached items progress immediately
    if success_count > 0:
        pct = int(round((success_count / total_targets) * 100))
        current_state["warmup"] = {
            "progress": pct,
            "count": success_count,
            "total": total_targets
        }
        await manager.broadcast(current_state)
        print(f"[Backend] Instantly loaded {success_count}/{total_targets} targets from disk cache.", flush=True)
        
    if not to_scrape:
        current_state["warmup"] = {
            "progress": 100,
            "count": success_count,
            "total": total_targets,
            "completed": True
        }
        await manager.broadcast(current_state)
        print(f"[Backend] Warmup cache completed. All {success_count} targets loaded from disk.", flush=True)
        return
        
    # Step 2: Scrape missing targets concurrently
    sem = asyncio.Semaphore(15) # Up to 15 concurrent champion scrapes
    
    async def warm_target(champ, role):
        nonlocal success_count
        async with sem:
            try:
                # Fetch U.GG and OP.GG concurrently!
                await asyncio.gather(
                    loop.run_in_executor(None, get_cached_stats, champ, role),
                    loop.run_in_executor(None, get_cached_opgg_stats, champ, role)
                )
                async with success_lock:
                    success_count += 1
                    current_count = success_count
                
                # Calculate and update state
                pct = int(round((current_count / total_targets) * 100))
                current_state["warmup"] = {
                    "progress": pct,
                    "count": current_count,
                    "total": total_targets
                }
                
                # Broadcast updates to active clients every 5 targets or when completed
                if current_count % 5 == 0 or current_count == total_targets:
                    await manager.broadcast(current_state)
                    
                if current_count % 20 == 0:
                    print(f"[Backend] Warmup cache progress: {current_count}/{total_targets} targets warmed.", flush=True)
            except Exception:
                pass

    # Start concurrent scrapers for missing targets
    tasks = [warm_target(champ, role) for champ, role in to_scrape]
    await asyncio.gather(*tasks)
            
    current_state["warmup"] = {
        "progress": 100,
        "count": success_count,
        "total": total_targets,
        "completed": True
    }
    await manager.broadcast(current_state)
    print(f"[Backend] Warmup cache completed. Total targets warmed: {success_count}.", flush=True)

@app.on_event("startup")
async def startup_event():
    global loop
    loop = asyncio.get_event_loop()
    
    # Load settings from file on start
    load_settings()
    
    # Start keyboard listener in background thread
    threading.Thread(target=keyboard_listener, daemon=True).start()
    
    # Start LCU monitoring loop in the background
    asyncio.create_task(lcu_monitoring_loop())
    
    # Start meta warmup caching task
    asyncio.create_task(warmup_meta_cache_task())

def main():
    print("[Backend] Launching FastAPI Web Server on http://localhost:8000...")
    # Open user's default browser automatically after server starts
    import webbrowser
    def open_browser():
        try:
            # Wait 1.5 seconds for the server to bind and start accepting connections
            import time
            time.sleep(1.5)
            print("[Backend] Automatically opening web browser dashboard...")
            webbrowser.open("http://localhost:8000")
        except Exception as e:
            print(f"[Backend] Could not open browser automatically: {e}")
            
    import threading
    threading.Thread(target=open_browser, daemon=True).start()
    
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")

if __name__ == "__main__":
    main()
