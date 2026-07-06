import os
import json
import requests
import sys

if getattr(sys, 'frozen', False):
    EXE_DIR = os.path.dirname(sys.executable)
else:
    EXE_DIR = os.path.dirname(os.path.abspath(__file__))

CACHE_DIR = os.path.join(EXE_DIR, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

VERSION_FILE = os.path.join(CACHE_DIR, "version.json")

def get_latest_version():
    """Fetch the latest Data Dragon version string."""
    try:
        if os.path.exists(VERSION_FILE):
            # Check if cached version is fresh (e.g., loaded within last 24h, or just use it as fallback)
            with open(VERSION_FILE, "r") as f:
                cached_versions = json.load(f)
                if cached_versions and isinstance(cached_versions, list):
                    fallback = cached_versions[0]
                else:
                    fallback = "14.13.1"
        else:
            fallback = "14.13.1"
            
        res = requests.get("https://ddragon.leagueoflegends.com/api/versions.json", timeout=5)
        if res.status_code == 200:
            versions = res.json()
            with open(VERSION_FILE, "w") as f:
                json.dump(versions, f)
            return versions[0]
        return fallback
    except Exception as e:
        print(f"[DDragon] Warning: Failed to fetch version.json: {e}")
        if os.path.exists(VERSION_FILE):
            with open(VERSION_FILE, "r") as f:
                return json.load(f)[0]
        return "14.13.1"

class DataDragonManager:
    def __init__(self):
        self.version = get_latest_version()
        
        # Version-specific cache filenames
        self.champion_file = os.path.join(CACHE_DIR, f"champion_{self.version}.json")
        self.item_file = os.path.join(CACHE_DIR, f"item_{self.version}.json")
        self.runes_file = os.path.join(CACHE_DIR, f"runes_{self.version}.json")
        
        self.champions = {}      # ID (int) -> info dict
        self.champions_by_key = {} # Key (str) -> info dict
        self.items = {}          # ID (str) -> info dict
        self.runes = {}          # ID (int) -> info dict
        
        # Clean up old version files to save disk space
        self.cleanup_old_cache()
        self.load_data()
        
    def cleanup_old_cache(self):
        try:
            for filename in os.listdir(CACHE_DIR):
                if filename.endswith(".json") and filename != "version.json":
                    if self.version not in filename:
                        os.remove(os.path.join(CACHE_DIR, filename))
        except Exception as e:
            print(f"[DDragon] Cache cleanup warning: {e}")
            
    def download_if_missing(self, url, file_path):
        """Download a JSON resource to local cache if missing."""
        if not os.path.exists(file_path):
            print(f"[DDragon] Cache missing. Downloading: {url}")
            try:
                res = requests.get(url, timeout=10)
                if res.status_code == 200:
                    with open(file_path, "w", encoding="utf-8") as f:
                        json.dump(res.json(), f)
                else:
                    raise Exception(f"HTTP Status {res.status_code}")
            except Exception as e:
                print(f"[DDragon] Error downloading {url}: {e}")
                
    def load_data(self):
        # 1. Champions
        champ_url = f"https://ddragon.leagueoflegends.com/cdn/{self.version}/data/en_US/champion.json"
        self.download_if_missing(champ_url, self.champion_file)
        
        if os.path.exists(self.champion_file):
            with open(self.champion_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                champ_data = data.get("data", {})
                for c_name, c_info in champ_data.items():
                    c_id = int(c_info.get("key"))
                    info = {
                        "id": c_id,
                        "key": c_info.get("id"),       # e.g., 'MonkeyKing'
                        "name": c_info.get("name"),     # e.g., 'Wukong'
                        "title": c_info.get("title"),
                        "image": f"https://ddragon.leagueoflegends.com/cdn/{self.version}/img/champion/{c_info.get('image', {}).get('full')}",
                        "tags": c_info.get("tags", []),
                        "stats_info": c_info.get("info", {})
                    }
                    self.champions[c_id] = info
                    self.champions_by_key[info["key"].lower()] = info
                    self.champions_by_key[info["name"].lower().replace(" ", "")] = info
                    
        # 2. Items
        item_url = f"https://ddragon.leagueoflegends.com/cdn/{self.version}/data/en_US/item.json"
        self.download_if_missing(item_url, self.item_file)
        
        if os.path.exists(self.item_file):
            with open(self.item_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                item_data = data.get("data", {})
                for item_id, item_info in item_data.items():
                    self.items[item_id] = {
                        "id": item_id,
                        "name": item_info.get("name"),
                        "description": item_info.get("description"),
                        "plaintext": item_info.get("plaintext"),
                        "image": f"https://ddragon.leagueoflegends.com/cdn/{self.version}/img/item/{item_id}.png",
                        "gold_total": item_info.get("gold", {}).get("total", 0)
                    }
                    
        # 3. Runes (Runes Reforged)
        runes_url = f"https://ddragon.leagueoflegends.com/cdn/{self.version}/data/en_US/runesReforged.json"
        self.download_if_missing(runes_url, self.runes_file)
        
        if os.path.exists(self.runes_file):
            with open(self.runes_file, "r", encoding="utf-8") as f:
                styles = json.load(f)
                for style in styles:
                    style_id = style.get("id")
                    style_name = style.get("name")
                    style_icon = style.get("icon")
                    style_info = {
                        "id": style_id,
                        "name": style_name,
                        "key": style.get("key"),
                        "icon": f"https://ddragon.leagueoflegends.com/cdn/img/{style_icon}"
                    }
                    self.runes[style_id] = style_info
                    
                    # Traverse slots (tiers) of runes
                    for slot in style.get("slots", []):
                        for rune in slot.get("runes", []):
                            r_id = rune.get("id")
                            r_name = rune.get("name")
                            r_icon = rune.get("icon")
                            self.runes[r_id] = {
                                "id": r_id,
                                "name": r_name,
                                "key": rune.get("key"),
                                "icon": f"https://ddragon.leagueoflegends.com/cdn/img/{r_icon}",
                                "style_id": style_id,
                                "style_name": style_name
                            }
                            
    def get_champion_by_id(self, champ_id):
        return self.champions.get(int(champ_id), {
            "id": champ_id,
            "key": "Unknown",
            "name": f"Champion {champ_id}",
            "image": ""
        })
        
    def get_champion_by_name(self, name):
        normalized = name.lower().replace(" ", "").replace("'", "").replace(".", "")
        # Try direct match
        if normalized in self.champions_by_key:
            return self.champions_by_key[normalized]
        # Soft match
        for key, info in self.champions_by_key.items():
            if normalized in key or key in normalized:
                return info
        return None
        
    def get_champion_damage_profile(self, champ_name):
        """
        Return the primary damage type ('AD' or 'AP') and a confidence score.
        Uses Data Dragon stats and tags.
        """
        champ = self.get_champion_by_name(champ_name)
        if not champ:
            return "AD", 0.5 # Safe default
            
        tags = champ.get("tags", [])
        stats_info = champ.get("stats_info", {})
        
        magic = stats_info.get("magic", 1)
        attack = stats_info.get("attack", 1)
        
        if magic > attack:
            profile = "AP"
            confidence = min(0.95, 0.5 + (magic - attack) * 0.1)
        else:
            profile = "AD"
            confidence = min(0.95, 0.5 + (attack - magic) * 0.1)
            
        if "Mage" in tags or "Spellcaster" in tags:
            profile = "AP"
            confidence = max(confidence, 0.85)
        elif "Marksman" in tags:
            profile = "AD"
            confidence = max(confidence, 0.90)
            
        # Hardcoded overrides for edge cases where ddragon stats are ambiguous
        overrides = {
            "ezreal": ("AD", 0.7),
            "corki": ("AP", 0.85), # Corki does mostly magic damage
            "katarina": ("AP", 0.75),
            "akali": ("AP", 0.8),
            "varus": ("AD", 0.75),
            "kayle": ("AP", 0.75),
            "shaco": ("AD", 0.7),
            "twitch": ("AD", 0.8),
            "singed": ("AP", 0.9),
            "mordekaiser": ("AP", 0.9)
        }
        
        lookup_name = champ_name.lower().replace(" ", "").replace("'", "")
        if lookup_name in overrides:
            return overrides[lookup_name]
            
        return profile, confidence
        
    def get_item_by_id(self, item_id):
        item_id_str = str(item_id)
        return self.items.get(item_id_str, {
            "id": item_id,
            "name": f"Item {item_id}",
            "image": ""
        })
        
    def get_rune_by_id(self, rune_id):
        r_id = int(rune_id)
        # Check stat shard mapping (u.gg stat shards represent stat buffs)
        shard_mappings = {
            5001: ("Health Scaling", "healthscaling"),
            5002: ("Armor", "armor"),
            5003: ("Magic Resist", "magicres"),
            5005: ("Attack Speed", "attackspeed"),
            5007: ("Ability Haste", "cdrscaling"),
            5008: ("Adaptive Force", "adaptiveforce"),
            5010: ("Movement Speed", "movementspeed"),
            5011: ("Health Flat", "healthplus"),
            5013: ("Tenacity and Slow Resist", "tenacity")
        }
        if r_id in shard_mappings:
            name, filename = shard_mappings[r_id]
            return {
                "id": r_id,
                "name": name,
                "icon": f"https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmods{filename}icon.png"
            }
            
        return self.runes.get(r_id, {
            "id": r_id,
            "name": f"Perk {r_id}",
            "icon": ""
        })

# Global manager instance
dd_manager = DataDragonManager()

if __name__ == "__main__":
    print(f"Data Dragon Version: {dd_manager.version}")
    print(f"Ahri Mapping: {dd_manager.get_champion_by_id(103)}")
    print(f"Health Pot Mapping: {dd_manager.get_item_by_id(2003)}")
    print(f"Electrocute Mapping: {dd_manager.get_rune_by_id(8112)}")
