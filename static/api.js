// LAN connection QR code generation
async function setupConnectionQR() {
    try {
        const res = await fetch("/api/connection-url");
        const data = await res.json();
        if (data.url && typeof QRCode !== "undefined") {
            el.connectionLinkText.textContent = data.url;
            el.connectionLinkText.href = data.url;
            
            // Render QR Code onto canvas
            QRCode.toCanvas(el.connectionQr, data.url, {
                width: 110,
                margin: 0,
                color: {
                    dark: "#000000",
                    light: "#ffffff"
                }
            }, (error) => {
                if (error) console.error("[QR] Error rendering QR Code:", error);
            });
        }
    } catch (e) {
        console.error("[QR] Failed to setup connection QR Code:", e);
    }
}

// Preload popular champion assets in the browser cache
function preloadCommonAssets(champions) {
    if (!champions || champions.length === 0) return;
    const popular = [
        "Yasuo", "Yone", "Ahri", "Zed", "Lux", "Jinx", "Ezreal", "Kai'Sa", "Jhin", "Lee Sin", 
        "Thresh", "Lulu", "Nautilus", "Garen", "Darius", "Aatrox", "Kayn", "Viego", "Kha'Zix", "Caitlyn"
    ];
    champions.forEach(c => {
        if (popular.includes(c.name)) {
            const img = new Image();
            img.src = c.image;
        }
    });
}

// Fetch autocomplete champions list
async function fetchChampionsList() {
    try {
        const res = await fetch("/api/champions");
        if (res.ok) {
            state.allChampions = await res.json();
            preloadCommonAssets(state.allChampions);
        }
    } catch (e) {
        console.error("Failed to load champion list:", e);
    }
}

function handleSearchInput() {
    const val = el.search.value.trim().toLowerCase();
    if (!val) {
        hideAutocomplete();
        return;
    }
    
    const matches = state.allChampions.filter(c => 
        c.name.toLowerCase().includes(val) || c.key.toLowerCase().includes(val)
    ).slice(0, 8);
    
    if (matches.length === 0) {
        hideAutocomplete();
        return;
    }
    
    el.autocompleteList.innerHTML = "";
    matches.forEach(champ => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.innerHTML = `
            <img src="${champ.image}" alt="${champ.name}">
            <span>${champ.name}</span>
        `;
        item.addEventListener("click", () => {
            el.search.value = champ.name;
            hideAutocomplete();
            state.manualSearchActive = true;
            triggerStatsLookup(champ.name, state.activeRole);
        });
        el.autocompleteList.appendChild(item);
    });
    
    el.autocompleteList.classList.remove("hidden");
}

function hideAutocomplete() {
    el.autocompleteList.classList.add("hidden");
}

// Fetch stats via API (manual lookups)
async function triggerStatsLookup(championName, role) {
    showLoading();
    try {
        const res = await fetch(`/api/search?champion=${encodeURIComponent(championName)}&role=${role}`);
        const data = await res.json();
        hideLoading();
        
        if (data.error) {
            alert(data.error);
            return;
        }
        
        state.statsUgg = data.ugg;
        state.statsOpgg = data.opgg;
        state.activeTips = data.tips;
        state.activeChampion = championName;
        
        renderActiveSourceStats();
    } catch (e) {
        hideLoading();
        console.error("Error loading champion stats:", e);
    }
}

// WebSocket connection to LCU
function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    state.ws = new WebSocket(wsUrl);
    
    state.ws.onopen = () => {
        console.log("WebSocket connected.");
        if (el.serverStatusDot) {
            el.serverStatusDot.className = "dot dot-green";
            el.serverStatusText.textContent = "Online";
            el.serverStatusText.style.color = "var(--color-green)";
        }
    };
    
    state.ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        console.log("[WebSocket] Received payload:", payload);
        if (payload.type === "voice_alert") {
            speak(payload.text);
        } else if (payload.type === "hotkey_spell") {
            const rows = document.querySelectorAll(".hud-enemy-row");
            if (rows && rows[payload.enemy_index]) {
                const btn = rows[payload.enemy_index].querySelector(".hud-enemy-spells .hud-spell-container:first-child button");
                if (btn) btn.click();
            }
        } else if (payload.type === "hotkey_ult") {
            const rows = document.querySelectorAll(".hud-enemy-row");
            if (rows && rows[payload.enemy_index]) {
                const btn = rows[payload.enemy_index].querySelector(".hud-enemy-spells .hud-spell-container:nth-child(3) button");
                if (btn) btn.click();
            }
        } else {
            handleStateUpdate(payload);
        }
    };
    
    state.ws.onclose = () => {
        console.log("WebSocket disconnected. Retrying in 3 seconds...");
        if (el.serverStatusDot) {
            el.serverStatusDot.className = "dot dot-red";
            el.serverStatusText.textContent = "Offline";
            el.serverStatusText.style.color = "#dc3545";
        }
        updateClientStatus({ connected: false, phase: "None" });
        setTimeout(connectWebSocket, 3000);
    };
    
    state.ws.onerror = (e) => {
        console.error("WebSocket error:", e);
        if (el.serverStatusDot) {
            el.serverStatusDot.className = "dot dot-red";
            el.serverStatusText.textContent = "Offline";
            el.serverStatusText.style.color = "#dc3545";
        }
    };
}

// State Update Coordinator
function handleStateUpdate(payload) {
    if (payload.session_id && state.sessionId && payload.session_id !== state.sessionId) {
        console.log("[Update] Server session ID changed. Reloading page...");
        window.location.reload();
        return;
    }
    if (payload.session_id) {
        state.sessionId = payload.session_id;
    }
    if (payload.version) {
        state.version = payload.version;
    }
    if (payload.ddragon_version) {
        state.ddVersion = payload.ddragon_version;
    }

    updateClientStatus(payload);
    
    // Render lobby & queue status
    renderLobbyAndMatchmaking(payload.matchmaking_or_lobby, payload.phase);
    
    // Render cache preloading warmup progress
    if (payload.warmup) {
        if (el.warmupStatus && el.warmupText) {
            const w = payload.warmup;
            if (el.warmupDot) {
                if (w.completed || w.progress >= 100) {
                    el.warmupDot.className = "dot dot-green";
                    el.warmupText.textContent = `Warmed (${w.count}/${w.total})`;
                    el.warmupText.style.color = "var(--color-green)";
                } else {
                    el.warmupDot.className = "dot dot-yellow";
                    el.warmupText.textContent = `${w.progress}% (${w.count}/${w.total})`;
                    el.warmupText.style.color = "var(--color-gold)";
                }
            }
        }
    }
    
    if (!payload.connected && payload.phase !== "InProgress") {
        state.lcuChampion = null;
        if (!state.manualSearchActive) {
            showWaitingScreen();
        }
        renderDraftSuggestions(null);
        return;
    }
    
    // Connected Summoner
    if (payload.summoner) {
        el.summonerDisplay.classList.remove("hidden");
        el.summonerName.textContent = `${payload.summoner.name}#${payload.summoner.tag}`;
    }
    
    const phase = payload.phase;
    if (state.phase !== phase) {
        state.phase = phase;
        state.spokenObjectives.clear();
    }
    
    if (phase === "ChampSelect" && payload.champ_select) {
        state.manualSearchActive = false; // LCU takes priority
        const cs = payload.champ_select;
        
        // Hide in-game HUD
        el.inGameHud.classList.add("hidden");
        
        // Sync active role with client position
        const lcuRole = cs.role.toLowerCase();
        const translatedRole = lcuRole === "middle" ? "mid" : lcuRole === "utility" ? "support" : lcuRole === "bottom" ? "adc" : lcuRole;
        if (translatedRole && state.activeRole !== translatedRole) {
            state.activeRole = translatedRole;
            el.roleButtons.forEach(btn => {
                if (btn.dataset.role === translatedRole) {
                    el.roleButtons.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                }
            });
        }
        
        // Save tips
        state.activeTips = payload.tips || null;
        
        // Render lobby enemy picks if any
        if (cs.enemy_picks && cs.enemy_picks.length > 0) {
            el.lobbyEnemiesCard.classList.remove("hidden");
            el.lobbyEnemiesList.innerHTML = "";
            cs.enemy_picks.forEach(enemy => {
                const item = document.createElement("div");
                item.className = "lobby-enemy-item";
                item.innerHTML = `<img src="${enemy.image}" alt="${enemy.name}" title="${enemy.name}">`;
                item.addEventListener("click", () => {
                    state.manualSearchActive = true;
                    document.querySelectorAll(".lobby-enemy-item").forEach(i => i.classList.remove("selected"));
                    item.classList.add("selected");
                    triggerStatsLookup(enemy.name, state.activeRole);
                });
                el.lobbyEnemiesList.appendChild(item);
            });
        } else {
            el.lobbyEnemiesCard.classList.add("hidden");
        }
        
        // Render stats payload if hovered/picked
        const hasStats = (payload.stats && payload.stats.champion) || (payload.stats_opgg && payload.stats_opgg.champion);
        const hasChampion = cs.champion && cs.champion.name;
        
        if (hasStats) {
            el.waitingScreen.classList.add("hidden");
            el.dashboard.classList.remove("hidden");
            state.statsUgg = (payload.stats && payload.stats.champion) ? payload.stats : null;
            state.statsOpgg = payload.stats_opgg;
            state.activeChampion = (state.statsUgg || state.statsOpgg).champion;
            renderActiveSourceStats();
            
            // Pre-Lock Coach Briefing Logic
            if (hasChampion) {
                if (!cs.is_locked) {
                    if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "block";
                    renderPreLockBriefing(cs.champion.name, state.activeRole, state.statsUgg || state.statsOpgg);
                } else {
                    if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "none";
                    state.lastHoveredChampion = null;
                }
            } else {
                if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "none";
                state.lastHoveredChampion = null;
            }
        } else if (hasChampion) {
            // Champion is hovered/picked but stats haven't loaded yet — show champion info with loading state
            el.waitingScreen.classList.add("hidden");
            el.dashboard.classList.remove("hidden");
            
            state.activeChampion = cs.champion.name;
            el.heroPortrait.src = cs.champion.image || "";
            el.heroName.textContent = cs.champion.name;
            el.heroBadge.textContent = cs.is_locked ? "LOCKED IN" : "HOVERING";
            el.heroBadge.style.borderColor = cs.is_locked ? "var(--color-green)" : "var(--color-gold)";
            el.heroBadge.style.color = cs.is_locked ? "var(--color-green)" : "var(--color-gold-bright)";
            el.heroBadge.style.background = cs.is_locked ? "rgba(40, 167, 69, 0.15)" : "rgba(200, 155, 60, 0.15)";
            el.heroRoleDisplay.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-gold"></i> Loading build data...`;
            
            el.primaryRunesList.innerHTML = "<p class='subtext text-muted'>Loading runes...</p>";
            el.secondaryRunesList.innerHTML = "";
            el.shardsList.innerHTML = "";
            el.summonersList.innerHTML = "";
            el.skillsPriorityText.textContent = "-";
            el.skillPathRow.innerHTML = "";
            el.startingItemsList.innerHTML = "";
            el.coreItemsList.innerHTML = "";
            el.situationalItemsList.innerHTML = "";
            
            if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "none";
        } else {
            state.activeChampion = null;
            state.statsUgg = null;
            state.statsOpgg = null;
            if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "none";
            state.lastHoveredChampion = null;
            
            el.waitingScreen.classList.add("hidden");
            el.dashboard.classList.remove("hidden");
            
            el.heroPortrait.src = "";
            el.heroName.textContent = "Select Champion";
            el.heroBadge.textContent = "CHAMP SELECT";
            el.heroBadge.style.borderColor = "var(--color-gold)";
            el.heroBadge.style.color = "var(--color-gold-bright)";
            el.heroBadge.style.background = "rgba(200, 155, 60, 0.15)";
            el.heroRoleDisplay.innerHTML = `<i class="fa-solid fa-gamepad text-gold"></i> Hover or pick your champion...`;
            
            el.primaryRunesList.innerHTML = "<p class='subtext text-muted'>Hover a champion to load runes</p>";
            el.secondaryRunesList.innerHTML = "";
            el.shardsList.innerHTML = "";
            el.summonersList.innerHTML = "";
            el.skillsPriorityText.textContent = "-";
            el.skillPathRow.innerHTML = "";
            el.startingItemsList.innerHTML = "";
            el.coreItemsList.innerHTML = "";
            el.situationalItemsList.innerHTML = "";
            
            el.countersTitle.textContent = "Worst Matchups / Counterpicks";
            el.countersList.innerHTML = "<p class='subtext text-muted' style='padding: 15px 0;'>Draft suggestions and lane matchups will appear as champions are picked.</p>";
            
            if (state.activeTips) {
                renderMatchupTips(state.activeTips);
            } else {
                el.matchupTipsCard.classList.add("hidden");
            }
        }
        
        renderDraftSuggestions(payload.draft_suggestions);
        
    } else if (phase === "InProgress") {
        state.manualSearchActive = false;
        
        if (payload.champ_select && payload.champ_select.role) {
            const cs = payload.champ_select;
            const lcuRole = cs.role.toLowerCase();
            const translatedRole = lcuRole === "middle" ? "mid" : lcuRole === "utility" ? "support" : lcuRole === "bottom" ? "adc" : lcuRole;
            if (translatedRole && state.activeRole !== translatedRole) {
                state.activeRole = translatedRole;
                el.roleButtons.forEach(btn => {
                    if (btn.dataset.role === translatedRole) {
                        el.roleButtons.forEach(b => b.classList.remove("active"));
                        btn.classList.add("active");
                    }
                });
            }
        }
        
        el.waitingScreen.classList.add("hidden");
        el.dashboard.classList.remove("hidden");
        
        el.inGameHud.classList.remove("hidden");
        
        if (payload.champ_select && payload.champ_select.enemy_picks) {
            renderInGameHUD(payload.champ_select.enemy_picks);
        } else {
            renderInGameHUD([]);
        }
        
        if (payload.live_game) {
            state.lastActiveGame = {
                game_time: payload.live_game.game_time,
                active_player: payload.live_game.active_player,
                events: payload.live_game.events,
                championName: state.activeChampion || (payload.stats || payload.stats_opgg || {}).champion || "Active Champion",
                championImage: el.heroPortrait.src || ""
            };
            
            const gameTime = payload.live_game.game_time;
            
            if (gameTime === 0) {
                if (el.loadingScreenAdvisor) {
                    el.loadingScreenAdvisor.style.display = "block";
                    renderLoadingScreenAdvisor();
                }
            } else {
                if (el.loadingScreenAdvisor) {
                    el.loadingScreenAdvisor.style.display = "none";
                }
            }
            
            renderLiveObjectiveTimers(gameTime, payload.live_game.events);
            renderCSBenchmark(gameTime, payload.live_game.active_player);
            renderDefensiveAdvisor(payload.live_game.active_player, payload.champ_select ? payload.champ_select.enemy_picks : []);
            renderJungleGankPredictor(gameTime, payload.champ_select ? payload.champ_select.enemy_picks : []);
            renderGoldLead(payload.live_game.ally_gold, payload.live_game.enemy_gold);
            
            renderDirectLaneCS(payload.live_game.active_player, payload.live_game.lane_opponent_name, payload.live_game.lane_opponent_cs);
            
            renderGoldRecallAdvisor(payload.live_game.active_player);
        } else {
            if (el.loadingScreenAdvisor) el.loadingScreenAdvisor.style.display = "none";
            renderLiveObjectiveTimers(0, []);
            renderCSBenchmark(0, null);
            el.defensiveAdviceBlock.classList.add("hidden");
            if (el.goldRecallBlock) el.goldRecallBlock.classList.add("hidden");
            el.jungleGankCard.classList.add("hidden");
            el.goldLeadValue.textContent = "Even";
            el.goldLeadValue.className = "gold-lead-value neutral";
            el.goldLeadValue.style.color = "var(--text-muted)";
            if (el.csLeadValue) {
                el.csLeadValue.textContent = "Even";
                el.csLeadValue.style.color = "var(--text-muted)";
            }
            if (el.csLeadDetails) el.csLeadDetails.textContent = "0 vs 0 CS";
        }
        
        const hasInGameStats = (payload.stats && payload.stats.champion) || (payload.stats_opgg && payload.stats_opgg.champion);
        if (hasInGameStats) {
            state.statsUgg = (payload.stats && payload.stats.champion) ? payload.stats : null;
            state.statsOpgg = payload.stats_opgg;
            state.activeChampion = (state.statsUgg || state.statsOpgg).champion;
            state.activeTips = payload.tips || null;
            renderActiveSourceStats();
        }
        
        renderDraftSuggestions(null);
    } else {
        state.lcuChampion = null;
        state.activeTips = null;
        el.inGameHud.classList.add("hidden");
        
        if (state.lastActiveGame && state.lastActiveGame.game_time > 120) {
            showPostGameReport(state.lastActiveGame);
            state.lastActiveGame = null;
        }
        
        if (!state.manualSearchActive) {
            state.statsUgg = null;
            state.statsOpgg = null;
            showWaitingScreen();
        }
        renderDraftSuggestions(null);
    }
}

// Action Handler to Import Runes via LCU
function handleImportRunes() {
    if (!state.connected || !state.displayedRunes) return;
    
    el.importRunesBtn.disabled = true;
    el.importRunesBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Importing...`;
    
    fetch("/api/import-runes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            primary_style_id: state.displayedRunes.primary_style_id,
            sub_style_id: state.displayedRunes.sub_style_id,
            perk_ids: state.displayedRunes.perk_ids,
            shard_ids: state.displayedRunes.shard_ids,
            page_name: `Antigravity: ${state.displayedRunes.champion}`
        })
    })
    .then(res => res.json())
    .then(res => {
        if (res.success) {
            el.importRunesBtn.innerHTML = `<i class="fa-solid fa-check"></i> Imported!`;
            el.importRunesBtn.style.background = "linear-gradient(135deg, var(--color-green), #2e7d32)";
            el.importRunesBtn.style.borderColor = "var(--color-green)";
            
            setTimeout(() => {
                el.importRunesBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Import to Client`;
                el.importRunesBtn.style.background = "";
                el.importRunesBtn.style.borderColor = "";
                el.importRunesBtn.disabled = !state.connected;
            }, 3000);
        } else {
            alert(`Failed to import runes: ${res.error}`);
            resetImportButton();
        }
    })
    .catch(err => {
        console.error("Error importing runes:", err);
        alert("Failed to connect to backend server.");
        resetImportButton();
    });
}

// Load customization settings from server and apply defaults
async function loadSettingsFromServer() {
    try {
        const res = await fetch("/api/settings");
        const settings = await res.json();
        
        state.settings = settings;
        
        // Populate inputs
        if (el.settingsVoiceCoach) el.settingsVoiceCoach.checked = settings.voice_coach_enabled;
        if (el.settingsVoiceSpeed) {
            el.settingsVoiceSpeed.value = settings.voice_speed;
            if (el.rateVal) el.rateVal.textContent = settings.voice_speed.toFixed(2);
        }
        if (el.settingsVoicePitch) {
            el.settingsVoicePitch.value = settings.voice_pitch;
            if (el.pitchVal) el.pitchVal.textContent = settings.voice_pitch.toFixed(1);
        }
        
        if (el.settingsHkCtrl) el.settingsHkCtrl.checked = settings.hotkey_ctrl;
        if (el.settingsHkAlt) el.settingsHkAlt.checked = settings.hotkey_alt;
        if (el.settingsHkShift) el.settingsHkShift.checked = settings.hotkey_shift;
        if (el.settingsHkKeys) el.settingsHkKeys.value = settings.hotkey_keys;
        
        if (el.settingsDefSource) el.settingsDefSource.value = settings.default_source;
        if (el.settingsDefMatchups) el.settingsDefMatchups.value = settings.default_matchups;
        
        // Apply Preferences (Default source)
        if (settings.default_source && settings.default_source !== state.activeSource) {
            state.activeSource = settings.default_source;
            el.sourceButtons.forEach(btn => {
                if (btn.dataset.source === settings.default_source) {
                    el.sourceButtons.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                }
            });
        }
        
        // Apply Preferences (Default matchups sort)
        if (settings.default_matchups && settings.default_matchups !== state.matchupFilter) {
            state.matchupFilter = settings.default_matchups;
            const isWorst = settings.default_matchups === "worst";
            if (el.toggleWorstMatchups && el.toggleBestMatchups) {
                if (isWorst) {
                    el.toggleWorstMatchups.classList.add("active");
                    el.toggleWorstMatchups.style.background = "var(--color-gold)";
                    el.toggleWorstMatchups.style.color = "#000";
                    el.toggleBestMatchups.classList.remove("active");
                    el.toggleBestMatchups.style.background = "transparent";
                    el.toggleBestMatchups.style.color = "var(--text-muted)";
                } else {
                    el.toggleBestMatchups.classList.add("active");
                    el.toggleBestMatchups.style.background = "var(--color-gold)";
                    el.toggleBestMatchups.style.color = "#000";
                    el.toggleWorstMatchups.classList.remove("active");
                    el.toggleWorstMatchups.style.background = "transparent";
                    el.toggleWorstMatchups.style.color = "var(--text-muted)";
                }
            }
        }
        
        populateSpeechVoices(settings.voice_name);
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
}

// Populate the system voices select dropdown
function populateSpeechVoices(preferredVoiceName) {
    if (!('speechSynthesis' in window) || !el.settingsVoiceSelect) return;
    
    const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        el.settingsVoiceSelect.innerHTML = "";
        
        voices.forEach(voice => {
            const opt = document.createElement("option");
            opt.value = voice.name;
            opt.textContent = `${voice.name} (${voice.lang})`;
            if (preferredVoiceName && voice.name === preferredVoiceName) {
                opt.selected = true;
            } else if (!preferredVoiceName && voice.default) {
                opt.selected = true;
            }
            el.settingsVoiceSelect.appendChild(opt);
        });
    };
    
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }
}

async function handleSaveCustomBuild() {
    if (!state.displayedData || !state.displayedData.build) {
        alert("No active build found to save.");
        return;
    }
    
    el.saveBuildBtn.disabled = true;
    el.saveBuildBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    
    try {
        const res = await fetch("/api/custom-build", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                champion: state.activeChampion,
                role: state.activeRole,
                build: state.displayedData.build
            })
        });
        const data = await res.json();
        if (data.success) {
            state.customBuild = {
                champion: state.activeChampion,
                role: state.activeRole,
                build: state.displayedData.build,
                counters: state.displayedData.counters || []
            };
            el.saveBuildBtn.innerHTML = `<i class="fa-solid fa-check"></i> Saved!`;
            el.saveBuildBtn.style.background = "linear-gradient(135deg, var(--color-green), #2e7d32)";
            
            setTimeout(() => {
                el.saveBuildBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save as My Build`;
                el.saveBuildBtn.style.background = "";
                el.saveBuildBtn.disabled = false;
            }, 2000);
        } else {
            alert("Failed to save custom build.");
            el.saveBuildBtn.disabled = false;
            el.saveBuildBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save as My Build`;
        }
    } catch (e) {
        console.error("Error saving custom build:", e);
        el.saveBuildBtn.disabled = false;
        el.saveBuildBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save as My Build`;
    }
}

async function loadMatchHistory() {
    if (!el.matchHistoryList) return;
    try {
        const res = await fetch("/api/match-history");
        const history = await res.json();
        
        el.matchHistoryList.innerHTML = "";
        if (history.length === 0) {
            el.matchHistoryList.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px; width: 100%;">No games played yet. Make sure LCU connection is active to record matches.</span>`;
            if (el.avgCsMin) el.avgCsMin.textContent = "0.0";
            return;
        }
        
        let totalCs = 0;
        let count = 0;
        const averageAll = (state.phase !== "ChampSelect" && state.phase !== "InProgress" && !state.manualSearchActive);

        history.forEach(m => {
            if (averageAll || m.role === state.activeRole) {
                totalCs += m.cs_min;
                count++;
            }
            const item = document.createElement("div");
            item.style.display = "flex";
            item.style.alignItems = "center";
            item.style.justifyContent = "space-between";
            item.style.background = "rgba(255, 255, 255, 0.03)";
            item.style.border = "1px solid var(--border-light)";
            item.style.padding = "6px 10px";
            item.style.borderRadius = "6px";
            item.style.fontSize = "11px";
            item.style.gap = "8px";
            item.style.width = "100%";
            
            const durationMin = Math.floor(m.duration_sec / 60);
            const durationSec = m.duration_sec % 60;
            const resColor = m.win ? "var(--color-green)" : "#dc3545";
            const resText = m.win ? "Victory" : "Defeat";
            
            const champInfo = state.allChampions.find(c => c.name.toLowerCase() === m.champion.toLowerCase()) || {
                image: ""
            };
            
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${champInfo.image || ''}" style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border-light);" alt="${m.champion}">
                    <div>
                        <div style="font-weight: 700; color: var(--text-primary);">${m.champion} <span style="font-weight: 400; font-size: 9px; color: var(--text-muted); text-transform: uppercase;">(${m.role})</span></div>
                        <div style="font-size: 9px; color: var(--text-muted);">${m.timestamp} - ${durationMin}m ${durationSec}s</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 700; color: ${resColor};">${resText}</div>
                    <div style="font-size: 10px; color: var(--color-gold);">${m.cs_min.toFixed(1)} CS/Min</div>
                </div>
            `;
            el.matchHistoryList.appendChild(item);
        });
        
        const avg = count > 0 ? (totalCs / count) : 0;
        if (el.avgCsMin) {
            if (averageAll) {
                el.avgCsMin.textContent = count > 0 ? `${avg.toFixed(1)}` : `0.0`;
            } else {
                el.avgCsMin.textContent = count > 0 ? `${avg.toFixed(1)} (${state.activeRole.toUpperCase()})` : `0.0 (${state.activeRole.toUpperCase()})`;
            }
        }
    } catch (e) {
        console.error("Failed to load match history:", e);
    }
}

let updateDownloadUrl = "";

async function checkUpdateOnStartup() {
    try {
        const res = await fetch("/api/check-update");
        const data = await res.json();
        if (data.update_available) {
            updateDownloadUrl = data.download_url;
            if (el.updateVersion) el.updateVersion.textContent = data.latest_version;
            if (el.updateBanner) el.updateBanner.classList.remove("hidden");
        }
    } catch (e) {
        console.error("Failed to check for updates:", e);
    }
}

async function handleTriggerUpdate() {
    if (!updateDownloadUrl) return;
    el.triggerUpdateBtn.disabled = true;
    el.triggerUpdateBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Updating...`;
    
    try {
        const res = await fetch("/api/trigger-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ download_url: updateDownloadUrl })
        });
        const data = await res.json();
        if (!data.success) {
            alert(`Update failed: ${data.error}`);
            el.triggerUpdateBtn.disabled = false;
            el.triggerUpdateBtn.textContent = "Update Now";
        }
    } catch (e) {
        console.error("Error trigger update:", e);
        alert("Failed to initiate update.");
        el.triggerUpdateBtn.disabled = false;
        el.triggerUpdateBtn.textContent = "Update Now";
    }
}
