import os
import requests
import urllib3
import psutil
from ddragon import dd_manager

# Disable SSL warnings for self-signed certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def read_lockfile(path):
    """Parse the LCU lockfile."""
    try:
        with open(path, 'r') as f:
            data = f.read().split(':')
            return {
                'name': data[0],
                'pid': int(data[1]),
                'port': int(data[2]),
                'password': data[3],
                'protocol': data[4]
            }
    except Exception as e:
        print(f"[LCU] Error reading lockfile: {e}")
        return None

def find_lcu_credentials():
    """Find League Client process and parse LCU port and password."""
    for proc in psutil.process_iter(['name', 'cmdline', 'exe']):
        try:
            if proc.info['name'] == 'LeagueClient.exe':
                cmdline = proc.info['cmdline']
                port = None
                token = None
                if cmdline:
                    for arg in cmdline:
                        if arg.startswith('--app-port='):
                            port = int(arg.split('=')[1])
                        elif arg.startswith('--remoting-auth-token='):
                            token = arg.split('=')[1]
                
                if port and token:
                    return {
                        'port': port,
                        'password': token,
                        'protocol': 'https'
                    }
                
                # Fallback to reading lockfile in the client folder
                exe_path = proc.info['exe']
                if exe_path:
                    dir_path = os.path.dirname(exe_path)
                    lockfile_path = os.path.join(dir_path, 'lockfile')
                    if os.path.exists(lockfile_path):
                        return read_lockfile(lockfile_path)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
            
    # Try default C: drive path if process not found or cmdline inaccessible
    default_lockfile = r"C:\Riot Games\League of Legends\lockfile"
    if os.path.exists(default_lockfile):
        return read_lockfile(default_lockfile)
        
    return None

class LCUManager:
    def __init__(self):
        self.credentials = None
        self.session = None
        self.base_url = ""
        self.summoner_name = None
        self.summoner_tag = None
        self.puuid = None
        
    def connect(self):
        """Attempt to connect to the League client."""
        self.credentials = find_lcu_credentials()
        if not self.credentials:
            self.session = None
            return False
            
        self.base_url = f"{self.credentials['protocol']}://127.0.0.1:{self.credentials['port']}"
        self.session = requests.Session()
        self.session.auth = ('riot', self.credentials['password'])
        self.session.verify = False
        
        # Test connection by fetching current summoner
        try:
            res = self.session.get(f"{self.base_url}/lol-summoner/v1/current-summoner", timeout=2)
            if res.status_code == 200:
                s_data = res.json()
                # Newer clients have gameName and tagLine, fallback to displayName
                self.summoner_name = s_data.get("gameName", s_data.get("displayName", "Summoner"))
                self.summoner_tag = s_data.get("tagLine", "")
                self.puuid = s_data.get("puuid")
                return True
        except Exception as e:
            print(f"[LCU] Connection test failed: {e}")
            
        self.session = None
        return False
        
    def is_connected(self):
        if not self.session:
            return self.connect()
        try:
            res = self.session.get(f"{self.base_url}/lol-summoner/v1/current-summoner", timeout=1)
            return res.status_code == 200
        except Exception:
            self.session = None
            return False

    def get_game_phase(self):
        """Query the current game flow phase."""
        if not self.is_connected():
            return "None"
        try:
            res = self.session.get(f"{self.base_url}/lol-gameflow/v1/gameflow-phase", timeout=1)
            if res.status_code == 200:
                # Returns game phase as a string inside quotes, e.g. "ChampSelect"
                return res.json()
        except Exception:
            pass
        return "None"

    def get_champ_select_data(self):
        """Extract user role, champion hovered/locked, and enemy champion picks."""
        if not self.is_connected():
            return None
            
        try:
            res = self.session.get(f"{self.base_url}/lol-champ-select/v1/session", timeout=1)
            if res.status_code != 200:
                return None
                
            session = res.json()
            local_cell_id = session.get("localPlayerCellId")
            
            my_team = session.get("myTeam", [])
            their_team = session.get("theirTeam", [])
            
            user_player = None
            user_index = 0
            for idx, p in enumerate(my_team):
                if p.get("cellId") == local_cell_id:
                    user_player = p
                    user_index = idx
                    break
                    
            if not user_player:
                return None
                
            # Extract user's assigned role
            # LCU roles: 'top', 'jungle', 'middle', 'bottom', 'utility', or empty for normal games
            role = user_player.get("assignedPosition", "")
            if not role:
                role = "middle" # Default fallback
                
            user_champ_id = user_player.get("championId", 0)
            # Check if hovered or locked. In LCU, championId changes when hovered,
            # but we can check if they have locked in by looking at actions.
            # actions contains turns. Let's find if the local player has locked.
            is_locked = False
            actions = session.get("actions", [])
            for turn_group in actions:
                for action in turn_group:
                    if action.get("actorCellId") == local_cell_id and action.get("type") == "pick":
                        is_locked = action.get("completed", False)
            
            # Hovered / Locked champion info
            user_champ = None
            if user_champ_id > 0:
                user_champ = dd_manager.get_champion_by_id(user_champ_id)
                
            # Enemy Picks (only locked champions, which are visible to the team)
            enemy_picks = []
            for p in their_team:
                c_id = p.get("championId", 0)
                if c_id > 0:
                    champ = dd_manager.get_champion_by_id(c_id)
                    enemy_picks.append({
                        "id": c_id,
                        "name": champ["name"],
                        "key": champ["key"],
                        "image": champ["image"],
                        "role": p.get("assignedPosition", "")
                    })
                    
            # My Team Picks
            team_picks = []
            for p in my_team:
                # Only list other players' locked in picks
                if p.get("cellId") != local_cell_id:
                    c_id = p.get("championId", 0)
                    if c_id > 0:
                        champ = dd_manager.get_champion_by_id(c_id)
                        team_picks.append({
                            "id": c_id,
                            "name": champ["name"],
                            "key": champ["key"],
                            "image": champ["image"],
                            "role": p.get("assignedPosition", "")
                        })

            return {
                "role": role,
                "champion_id": user_champ_id,
                "champion_name": user_champ["name"] if user_champ else None,
                "champion_key": user_champ["key"] if user_champ else None,
                "champion_image": user_champ["image"] if user_champ else None,
                "is_locked": is_locked,
                "enemy_picks": enemy_picks,
                "team_picks": team_picks,
                "user_index": user_index
            }
            
        except Exception as e:
            print(f"[LCU] Error fetching champ select data: {e}")
            return None

    def import_runes(self, primary_style_id, sub_style_id, perk_ids, shard_ids, page_name="Antigravity Build"):
        """Import runes configuration into the League Client via LCU."""
        if not self.is_connected():
            return {"success": False, "error": "League Client is not connected."}
            
        try:
            # 1. Fetch all pages
            res = self.session.get(f"{self.base_url}/lol-perks/v1/pages")
            if res.status_code != 200:
                return {"success": False, "error": "Failed to retrieve rune pages from client."}
                
            pages = res.json()
            
            # Find the first editable (custom) page
            editable_page = next((p for p in pages if p.get("isDeletable") is True), None)
            
            if not editable_page:
                return {"success": False, "error": "No editable rune page found. Please delete one premade page or create a custom page."}
                
            page_id = editable_page["id"]
            
            # 2. Combine perks: 4 primary, 2 secondary, 3 shards
            selected_perks = list(perk_ids) + list(shard_ids)
            
            # Ensure it has exactly 9 elements
            if len(selected_perks) < 9:
                while len(selected_perks) < 9:
                    selected_perks.append(5001) # fallback stat mod
                    
            payload = {
                "name": page_name,
                "primaryStyleId": int(primary_style_id),
                "subStyleId": int(sub_style_id),
                "selectedPerkIds": [int(x) for x in selected_perks[:9]]
            }
            
            # 3. Update the page
            put_res = self.session.put(f"{self.base_url}/lol-perks/v1/pages/{page_id}", json=payload)
            if put_res.status_code not in [200, 201, 204]:
                return {"success": False, "error": f"Failed to update rune page: {put_res.text}"}
                
            # 4. Set as active page
            self.session.put(f"{self.base_url}/lol-perks/v1/activepage", json=page_id)
            
            return {"success": True, "page_name": page_name}
            
        except Exception as e:
            return {"success": False, "error": str(e)}

# Global LCU manager
lcu_manager = LCUManager()

if __name__ == "__main__":
    print("Scanning for League Client...")
    connected = lcu_manager.connect()
    print(f"Connected: {connected}")
    if connected:
        print(f"Summoner: {lcu_manager.summoner_name}#{lcu_manager.summoner_tag}")
        phase = lcu_manager.get_game_phase()
        print(f"Game Phase: {phase}")
        if phase == "ChampSelect":
            data = lcu_manager.get_champ_select_data()
            print(f"Champ Select Data: {data}")
