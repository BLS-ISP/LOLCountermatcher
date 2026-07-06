// Global App State
const state = {
    connected: false,
    phase: "None",
    summoner: null,
    activeRole: "mid",
    activeChampion: null, // name of active champion
    lcuChampion: null,    // champion name detected from LCU
    manualSearchActive: false,
    allChampions: [],     // cached list for autocomplete
    ws: null,
    
    // Multi-source caching
    statsUgg: null,
    statsOpgg: null,
    activeSource: "ugg",
    matchupFilter: "worst",
    spokenObjectives: new Set(),
    lastProcessedEventId: -1,
    lastHoveredChampion: null
};

// DOM Elements
const el = {
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    summonerDisplay: document.getElementById("summoner-display"),
    summonerName: document.getElementById("summoner-name"),
    search: document.getElementById("champion-search"),
    autocompleteList: document.getElementById("autocomplete-list"),
    roleButtons: document.querySelectorAll(".role-btn"),
    sourceButtons: document.querySelectorAll(".source-btn"),
    loadingSpinner: document.getElementById("loading-spinner"),
    waitingScreen: document.getElementById("waiting-screen"),
    dashboard: document.getElementById("dashboard-grid"),
    
    // Summary Panel
    heroPortrait: document.getElementById("hero-portrait"),
    heroName: document.getElementById("hero-name"),
    heroBadge: document.getElementById("hero-badge"),
    heroRoleDisplay: document.getElementById("hero-role-display"),
    mobafireGuideBtn: document.getElementById("mobafire-guide-btn"),
    mobafireCountersBtn: document.getElementById("mobafire-counters-btn"),
    lobbyEnemiesCard: document.getElementById("lobby-enemies-card"),
    lobbyEnemiesList: document.getElementById("lobby-enemies-list"),
    countersTitle: document.getElementById("counters-title"),
    countersList: document.getElementById("counters-list"),
    toggleWorstMatchups: document.getElementById("toggle-worst-matchups"),
    toggleBestMatchups: document.getElementById("toggle-best-matchups"),
    
    // Runes
    primaryPathIcon: document.getElementById("primary-path-icon"),
    primaryPathName: document.getElementById("primary-path-name"),
    primaryRunesList: document.getElementById("primary-runes-list"),
    secondaryPathIcon: document.getElementById("secondary-path-icon"),
    secondaryPathName: document.getElementById("secondary-path-name"),
    secondaryRunesList: document.getElementById("secondary-runes-list"),
    shardsList: document.getElementById("shards-list"),
    summonersList: document.getElementById("summoners-list"),
    
    // Builds & Skills
    skillsPriorityText: document.getElementById("skills-priority-text"),
    skillPathRow: document.getElementById("skill-path-row"),
    startingItemsList: document.getElementById("starting-items-list"),
    coreItemsList: document.getElementById("core-items-list"),
    situationalItemsList: document.getElementById("situational-items-list"),
    
    // Right Sidebar & Draft Suggestions
    rightSidebarCol: document.getElementById("right-sidebar-col"),
    teamCountersCard: document.getElementById("team-counters-card"),
    teamCountersList: document.getElementById("team-counters-list"),
    botlaneDuoCard: document.getElementById("botlane-duo-card"),
    botlaneSuggestionsList: document.getElementById("botlane-suggestions-list"),
    
    // Import Button
    importRunesBtn: document.getElementById("import-runes-btn"),
    
    // In-Game HUD
    inGameHud: document.getElementById("in-game-hud"),
    hudEnemiesList: document.getElementById("hud-enemies-list"),
    
    // Connection QR
    connectionQr: document.getElementById("connection-qr"),
    connectionLinkText: document.getElementById("connection-link-text"),
    
    // Damage Balance Tracker
    damageTrackerCard: document.getElementById("damage-tracker-card"),
    allyDamageRatio: document.getElementById("ally-damage-ratio"),
    allyAdBar: document.getElementById("ally-ad-bar"),
    allyApBar: document.getElementById("ally-ap-bar"),
    enemyDamageRatio: document.getElementById("enemy-damage-ratio"),
    enemyAdBar: document.getElementById("enemy-ad-bar"),
    enemyApBar: document.getElementById("enemy-ap-bar"),
    
    // Matchup Tips
    matchupTipsCard: document.getElementById("matchup-tips-card"),
    matchupTipsList: document.getElementById("matchup-tips-list"),
    matchupNotesArea: document.getElementById("matchup-notes-area"),
    notesStatus: document.getElementById("notes-status"),
    spikeEarly: document.getElementById("spike-early"),
    spikeMid: document.getElementById("spike-mid"),
    spikeLate: document.getElementById("spike-late"),
    
    // Advanced Winrate Helpers
    objectiveTimersList: document.getElementById("objective-timers-list"),
    csGauge: document.getElementById("cs-gauge"),
    csTargetLabel: document.getElementById("cs-target-label"),
    defensiveAdviceBlock: document.getElementById("defensive-advice-block"),
    defensiveAdviceText: document.getElementById("defensive-advice-text"),
    jungleGankCard: document.getElementById("jungle-gank-card"),
    gankRiskLevel: document.getElementById("gank-risk-level"),
    gankProgressBar: document.getElementById("gank-progress-bar"),
    gankRiskMessage: document.getElementById("gank-risk-message"),
    
    // Gold Lead & Post-Game Modal
    goldLeadValue: document.getElementById("gold-lead-value"),
    postGameModal: document.getElementById("post-game-modal"),
    closePostGameBtn: document.getElementById("close-post-game-btn"),
    postGameHeroImg: document.getElementById("post-game-hero-img"),
    postGameHeroName: document.getElementById("post-game-hero-name"),
    postGameCsMin: document.getElementById("post-game-cs-min"),
    postGameCsRating: document.getElementById("post-game-cs-rating"),
    postGameGold: document.getElementById("post-game-gold"),
    postGameDuration: document.getElementById("post-game-duration"),
    postGameCoachNote: document.getElementById("post-game-coach-note"),
    
    // Settings elements
    settingsModal: document.getElementById("settings-modal"),
    settingsToggleBtn: document.getElementById("settings-toggle-btn"),
    closeSettingsBtn: document.getElementById("close-settings-btn"),
    saveSettingsBtn: document.getElementById("save-settings-btn"),
    settingsVoiceCoach: document.getElementById("settings-voice-coach"),
    settingsVoiceSelect: document.getElementById("settings-voice-select"),
    settingsVoiceSpeed: document.getElementById("settings-voice-speed"),
    settingsVoicePitch: document.getElementById("settings-voice-pitch"),
    settingsHkCtrl: document.getElementById("settings-hk-ctrl"),
    settingsHkAlt: document.getElementById("settings-hk-alt"),
    settingsHkShift: document.getElementById("settings-hk-shift"),
    settingsHkKeys: document.getElementById("settings-hk-keys"),
    settingsDefSource: document.getElementById("settings-def-source"),
    settingsDefMatchups: document.getElementById("settings-def-matchups"),
    rateVal: document.getElementById("rate-val"),
    pitchVal: document.getElementById("pitch-val"),
    testVoiceBtn: document.getElementById("test-voice-btn"),
    
    // CS Lead & Gold Advisor & Loading Advisor elements
    csLeadValue: document.getElementById("cs-lead-value"),
    csLeadDetails: document.getElementById("cs-lead-details"),
    goldRecallBlock: document.getElementById("gold-recall-block"),
    goldRecallText: document.getElementById("gold-recall-text"),
    loadingScreenAdvisor: document.getElementById("loading-screen-advisor"),
    loadingStartItems: document.getElementById("loading-start-items"),
    loadingStartAdvice: document.getElementById("loading-start-advice"),
    loadingLaneTips: document.getElementById("loading-lane-tips"),
    
    // Pre-Lock Briefing elements
    preLockBriefingCard: document.getElementById("pre-lock-briefing-card"),
    briefingWinrateBadge: document.getElementById("briefing-winrate-badge"),
    briefingBanName: document.getElementById("briefing-ban-name"),
    briefingAdviceText: document.getElementById("briefing-advice-text"),
    briefingThreatsList: document.getElementById("briefing-threats-list"),
    warmupStatus: document.getElementById("warmup-status"),
    warmupText: document.getElementById("warmup-text")
};

// Initialize Application
async function init() {
    setupEventListeners();
    await fetchChampionsList();
    await loadSettingsFromServer();
    await setupConnectionQR();
    connectWebSocket();
}

// Fetch local LAN IP and render companion connection QR code
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

// Event Listeners
function setupEventListeners() {
    // Data source selection
    el.sourceButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const source = btn.dataset.source;
            if (state.activeSource === source) return;
            
            el.sourceButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.activeSource = source;
            
            renderActiveSourceStats();
        });
    });

    // Role selection
    el.roleButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const role = btn.dataset.role;
            if (state.activeRole === role) return;
            
            // Update active styling
            el.roleButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.activeRole = role;
            
            // Refresh stats if we have an active champion
            if (state.activeChampion) {
                triggerStatsLookup(state.activeChampion, state.activeRole);
            }
        });
    });

    // Autocomplete Search Input
    el.search.addEventListener("input", handleSearchInput);
    
    // Hide dropdown when clicking outside
    document.addEventListener("click", (e) => {
        if (!el.search.contains(e.target) && !el.autocompleteList.contains(e.target)) {
            hideAutocomplete();
        }
    });

    // Clear search on focus
    el.search.addEventListener("focus", () => {
        if (el.search.value) {
            handleSearchInput();
        }
    });

    // Runes Import trigger
    if (el.importRunesBtn) {
        el.importRunesBtn.addEventListener("click", handleImportRunes);
    }
    
    // Close Post-Game Modal trigger
    if (el.closePostGameBtn) {
        el.closePostGameBtn.addEventListener("click", () => {
            el.postGameModal.classList.add("hidden");
        });
    }
    
    // Matchup Toggle triggers
    if (el.toggleWorstMatchups && el.toggleBestMatchups) {
        el.toggleWorstMatchups.addEventListener("click", () => {
            if (state.matchupFilter === "worst") return;
            state.matchupFilter = "worst";
            el.toggleWorstMatchups.classList.add("active");
            el.toggleWorstMatchups.style.background = "var(--color-gold)";
            el.toggleWorstMatchups.style.color = "#000";
            el.toggleBestMatchups.classList.remove("active");
            el.toggleBestMatchups.style.background = "transparent";
            el.toggleBestMatchups.style.color = "var(--text-muted)";
            renderActiveSourceStats();
        });
        
        el.toggleBestMatchups.addEventListener("click", () => {
            if (state.matchupFilter === "best") return;
            state.matchupFilter = "best";
            el.toggleBestMatchups.classList.add("active");
            el.toggleBestMatchups.style.background = "var(--color-gold)";
            el.toggleBestMatchups.style.color = "#000";
            el.toggleWorstMatchups.classList.remove("active");
            el.toggleWorstMatchups.style.background = "transparent";
            el.toggleWorstMatchups.style.color = "var(--text-muted)";
            renderActiveSourceStats();
        });
    }
    
    // Debounced notes auto-saver
    let notesTimeout = null;
    if (el.matchupNotesArea) {
        el.matchupNotesArea.addEventListener("input", () => {
            if (!state.activeChampion) return;
            
            if (el.notesStatus) {
                el.notesStatus.textContent = "Saving...";
                el.notesStatus.style.color = "var(--color-gold-bright)";
            }
            
            clearTimeout(notesTimeout);
            notesTimeout = setTimeout(() => {
                fetch("/api/notes", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        champion: state.activeChampion,
                        note: el.matchupNotesArea.value
                    })
                })
                .then(res => res.json())
                .then(res => {
                    if (res.success && el.notesStatus) {
                        el.notesStatus.textContent = "Saved";
                        el.notesStatus.style.color = "var(--text-muted)";
                    }
                })
                .catch(() => {
                    if (el.notesStatus) {
                        el.notesStatus.textContent = "Failed to save";
                        el.notesStatus.style.color = "#dc3545";
                    }
                });
            }, 600);
        });
    }
    
    // Settings Toggles & Save Listeners
    if (el.settingsToggleBtn && el.settingsModal) {
        el.settingsToggleBtn.addEventListener("click", () => {
            el.settingsModal.classList.remove("hidden");
        });
    }
    
    if (el.closeSettingsBtn && el.settingsModal) {
        el.closeSettingsBtn.addEventListener("click", () => {
            el.settingsModal.classList.add("hidden");
        });
    }
    
    // Sliders real-time values update
    if (el.settingsVoiceSpeed && el.rateVal) {
        el.settingsVoiceSpeed.addEventListener("input", () => {
            el.rateVal.textContent = parseFloat(el.settingsVoiceSpeed.value).toFixed(2);
        });
    }
    if (el.settingsVoicePitch && el.pitchVal) {
        el.settingsVoicePitch.addEventListener("input", () => {
            el.pitchVal.textContent = parseFloat(el.settingsVoicePitch.value).toFixed(1);
        });
    }
    
    // Settings Saver POST request
    if (el.saveSettingsBtn && el.settingsModal) {
        el.saveSettingsBtn.addEventListener("click", () => {
            const settingsPayload = {
                voice_coach_enabled: el.settingsVoiceCoach.checked,
                voice_name: el.settingsVoiceSelect.value,
                voice_speed: parseFloat(el.settingsVoiceSpeed.value),
                voice_pitch: parseFloat(el.settingsVoicePitch.value),
                hotkey_ctrl: el.settingsHkCtrl.checked,
                hotkey_alt: el.settingsHkAlt.checked,
                hotkey_shift: el.settingsHkShift.checked,
                hotkey_keys: el.settingsHkKeys.value,
                default_source: el.settingsDefSource.value,
                default_matchups: el.settingsDefMatchups.value
            };
            
            el.saveSettingsBtn.disabled = true;
            el.saveSettingsBtn.textContent = "Saving...";
            
            fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settingsPayload)
            })
            .then(res => res.json())
            .then(res => {
                el.saveSettingsBtn.disabled = false;
                el.saveSettingsBtn.textContent = "Save & Apply Settings";
                if (res.success) {
                    state.settings = settingsPayload;
                    el.settingsModal.classList.add("hidden");
                    
                    // Reload settings configurations immediately
                    loadSettingsFromServer();
                }
            })
            .catch(err => {
                el.saveSettingsBtn.disabled = false;
                el.saveSettingsBtn.textContent = "Save & Apply Settings";
                alert("Failed to save settings: " + err);
            });
        });
    }
    
    // Test Voice alert trigger
    if (el.testVoiceBtn) {
        el.testVoiceBtn.addEventListener("click", () => {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance("Voice Coach system check. Tactical alert systems online.");
                
                // Read directly from current input configurations
                utterance.rate = parseFloat(el.settingsVoiceSpeed?.value || 1.0);
                utterance.pitch = parseFloat(el.settingsVoicePitch?.value || 1.0);
                
                const selectedVoiceName = el.settingsVoiceSelect?.value;
                if (selectedVoiceName) {
                    const voices = window.speechSynthesis.getVoices();
                    const matchingVoice = voices.find(v => v.name === selectedVoiceName);
                    if (matchingVoice) {
                        utterance.voice = matchingVoice;
                    }
                }
                
                window.speechSynthesis.speak(utterance);
            }
        });
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

// Autocomplete Champion Search Logic
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
    ).slice(0, 8); // limit to 8 suggestions
    
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

// Fetch stats via API (for manual lookups)
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

// Render stats for the active data source
function renderActiveSourceStats() {
    let data = null;
    if (state.activeSource === "opgg") {
        data = state.statsOpgg;
    } else if (state.activeSource === "ugg") {
        data = state.statsUgg;
    } else if (state.activeSource === "merged") {
        data = getMergedStats();
    }
    
    // Render gameplay counter tips
    renderMatchupTips(state.activeTips);
    
    // Fetch and load matchup notes
    if (state.activeChampion) {
        fetch(`/api/notes?champion=${encodeURIComponent(state.activeChampion)}`)
        .then(res => res.json())
        .then(res => {
            if (el.matchupNotesArea) {
                el.matchupNotesArea.value = res.note || "";
                if (el.notesStatus) {
                    el.notesStatus.textContent = "Saved";
                    el.notesStatus.style.color = "var(--text-muted)";
                }
            }
        })
        .catch(() => {
            if (el.matchupNotesArea) el.matchupNotesArea.value = "";
        });
        
        // Render power spikes timeline
        renderPowerSpikes(state.activeChampion);
    }
    
    if (!data) {
        // Fallback to whichever is available
        const fallbackData = state.statsUgg || state.statsOpgg;
        if (fallbackData) {
            renderDashboard(fallbackData);
        } else {
            showWaitingScreen(`No build data found for ${state.activeChampion} in ${state.activeSource.toUpperCase()}`);
        }
        return;
    }
    renderDashboard(data);
}

// Merge U.GG and OP.GG statistics into a single comparative dashboard dataset
function getMergedStats() {
    if (!state.statsUgg || !state.statsOpgg) {
        return state.statsUgg || state.statsOpgg;
    }
    
    const ugg = state.statsUgg;
    const opgg = state.statsOpgg;
    
    const merged = {
        champion: ugg.champion,
        role: ugg.role,
        is_enemy_focus: ugg.is_enemy_focus || opgg.is_enemy_focus,
        is_merged: true,
        build: null,
        counters: []
    };
    
    // 1. Merge Builds
    if (ugg.build && opgg.build) {
        merged.build = {
            runes: mergeRunes(ugg.build.runes, opgg.build.runes),
            starting_items: mergeItems(ugg.build.starting_items, opgg.build.starting_items),
            core_items: mergeItems(ugg.build.core_items, opgg.build.core_items),
            situational_items: mergeItems(ugg.build.situational_items || [], opgg.build.situational_items || []),
            skill_priority: ugg.build.skill_priority === opgg.build.skill_priority 
                ? ugg.build.skill_priority 
                : `U.GG: ${ugg.build.skill_priority} | OP.GG: ${opgg.build.skill_priority}`,
            skill_path: ugg.build.skill_path, // default to U.GG path
            summoner_spells: mergeItems(ugg.build.summoner_spells || [], opgg.build.summoner_spells || [])
        };
    } else if (ugg.build || opgg.build) {
        merged.build = ugg.build || opgg.build;
    }
    
    // 2. Merge Counters
    const uggCounters = ugg.counters || [];
    const opggCounters = opgg.counters || [];
    const counterMap = new Map();
    
    uggCounters.forEach(c => {
        counterMap.set(c.champion_id, {
            champion_id: c.champion_id,
            name: c.name,
            key: c.key,
            image: c.image,
            ugg_wr: c.win_rate,
            opgg_wr: null,
            win_rate: c.win_rate,
            matches: c.matches,
            gold_adv_15: c.gold_adv_15,
            sources: ["ugg"]
        });
    });
    
    opggCounters.forEach(c => {
        if (counterMap.has(c.champion_id)) {
            const existing = counterMap.get(c.champion_id);
            existing.opgg_wr = c.win_rate;
            existing.win_rate = (existing.ugg_wr + c.win_rate) / 2;
            existing.matches += c.matches;
            existing.sources.push("opgg");
        } else {
            counterMap.set(c.champion_id, {
                champion_id: c.champion_id,
                name: c.name,
                key: c.key,
                image: c.image,
                ugg_wr: null,
                opgg_wr: c.win_rate,
                win_rate: c.win_rate,
                matches: c.matches,
                gold_adv_15: 0,
                sources: ["opgg"]
            });
        }
    });
    
    merged.counters = Array.from(counterMap.values());
    merged.counters.sort((a, b) => a.win_rate - b.win_rate);
    return merged;
}

function mergeRunes(uggRunes, opggRunes) {
    if (!uggRunes) return opggRunes;
    if (!opggRunes) return uggRunes;
    
    const mergedRunes = JSON.parse(JSON.stringify(uggRunes));
    const opggPerkIds = new Set(opggRunes.perks.map(p => p.id));
    const opggShardIds = new Set(opggRunes.shards.map(s => s.id));
    
    mergedRunes.primary_style.consensus = (uggRunes.primary_style.id === opggRunes.primary_style.id);
    mergedRunes.sub_style.consensus = (uggRunes.sub_style.id === opggRunes.sub_style.id);
    
    mergedRunes.perks.forEach(p => {
        p.consensus = opggPerkIds.has(p.id);
    });
    
    mergedRunes.shards.forEach(s => {
        s.consensus = opggShardIds.has(s.id);
    });
    
    return mergedRunes;
}

function mergeItems(uggItems, opggItems) {
    const itemMap = new Map();
    uggItems.forEach(item => {
        itemMap.set(item.id, {
            ...item,
            sources: ["ugg"]
        });
    });
    opggItems.forEach(item => {
        if (itemMap.has(item.id)) {
            itemMap.get(item.id).sources.push("opgg");
        } else {
            itemMap.set(item.id, {
                ...item,
                sources: ["opgg"]
            });
        }
    });
    return Array.from(itemMap.values());
}

// WebSocket connection to LCU
function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    state.ws = new WebSocket(wsUrl);
    
    state.ws.onopen = () => {
        console.log("WebSocket connected.");
    };
    
    state.ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "hotkey_spell") {
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
        updateClientStatus({ connected: false, phase: "None" });
        setTimeout(connectWebSocket, 3000);
    };
    
    state.ws.onerror = (e) => {
        console.error("WebSocket error:", e);
    };
}

// State Update Coordinator
function handleStateUpdate(payload) {
    updateClientStatus(payload);
    
    // Render cache preloading warmup progress
    if (payload.warmup) {
        if (el.warmupStatus && el.warmupText) {
            const w = payload.warmup;
            if (w.completed || w.progress >= 100) {
                el.warmupText.textContent = "Cache Warmed";
                setTimeout(() => {
                    if (el.warmupStatus) el.warmupStatus.style.display = "none";
                }, 3000);
            } else {
                el.warmupStatus.style.display = "flex";
                el.warmupText.textContent = `Caching Meta: ${w.progress}%`;
            }
        }
    } else {
        if (el.warmupStatus) {
            el.warmupStatus.style.display = "none";
        }
    }
    
    if (!payload.connected) {
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
                // Click to see their builds / counters
                item.addEventListener("click", () => {
                    state.manualSearchActive = true;
                    // Check if selection is already active
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
        if (payload.stats || payload.stats_opgg) {
            el.waitingScreen.classList.add("hidden");
            el.dashboard.classList.remove("hidden");
            state.statsUgg = payload.stats;
            state.statsOpgg = payload.stats_opgg;
            state.activeChampion = (payload.stats || payload.stats_opgg).champion;
            renderActiveSourceStats();
            
            // Pre-Lock Coach Briefing Logic
            if (cs.champion && cs.champion.name) {
                if (!cs.is_locked) {
                    if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "block";
                    renderPreLockBriefing(cs.champion.name, state.activeRole, payload.stats || payload.stats_opgg);
                } else {
                    if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "none";
                    state.lastHoveredChampion = null;
                }
            } else {
                if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "none";
                state.lastHoveredChampion = null;
            }
        } else {
            // No hovered champion yet
            state.activeChampion = null;
            state.statsUgg = null;
            state.statsOpgg = null;
            if (el.preLockBriefingCard) el.preLockBriefingCard.style.display = "none";
            state.lastHoveredChampion = null;
            
            // Show dashboard so that lobby picks and draft suggestions sidebar are visible!
            el.waitingScreen.classList.add("hidden");
            el.dashboard.classList.remove("hidden");
            
            // Clear builds sections (this happens if we only focus on enemy counter recommendations)
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
            
            // Render tips against enemy picks if available
            if (state.activeTips) {
                renderMatchupTips(state.activeTips);
            } else {
                el.matchupTipsCard.classList.add("hidden");
            }
        }
        
        // Render draft suggestions
        renderDraftSuggestions(payload.draft_suggestions);
        
    } else if (phase === "InProgress") {
        state.manualSearchActive = false;
        
        // Keep dashboard visible for runes & item build paths next to HUD
        el.waitingScreen.classList.add("hidden");
        el.dashboard.classList.remove("hidden");
        
        // Show In-Game HUD
        el.inGameHud.classList.remove("hidden");
        
        if (payload.champ_select && payload.champ_select.enemy_picks) {
            renderInGameHUD(payload.champ_select.enemy_picks);
        } else {
            renderInGameHUD([]);
        }
        
        // Handle real-time live game updates (objectives, CS benchmarks, gank risings)
        if (payload.live_game) {
            state.lastActiveGame = {
                game_time: payload.live_game.game_time,
                active_player: payload.live_game.active_player,
                championName: state.activeChampion || (payload.stats || payload.stats_opgg || {}).champion || "Active Champion",
                championImage: el.heroPortrait.src || ""
            };
            
            const gameTime = payload.live_game.game_time;
            
            // Loading Screen Matchup Advisor Toggle
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
            
            // Direct Lane CS Difference
            renderDirectLaneCS(payload.live_game.active_player, payload.live_game.lane_opponent_name, payload.live_game.lane_opponent_cs);
            
            // Gold Recall Advisor
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
            if (el.csLeadValue) {
                el.csLeadValue.textContent = "Even";
                el.csLeadValue.style.color = "var(--text-muted)";
            }
            if (el.csLeadDetails) el.csLeadDetails.textContent = "0 vs 0 CS";
        }
        
        if (payload.stats || payload.stats_opgg) {
            state.statsUgg = payload.stats;
            state.statsOpgg = payload.stats_opgg;
            state.activeChampion = (payload.stats || payload.stats_opgg).champion;
            state.activeTips = payload.tips || null;
            renderActiveSourceStats(); // Kept to update runes cache in background
        }
        
        renderDraftSuggestions(null);
    } else {
        // Idle/Lobby State
        state.lcuChampion = null;
        state.activeTips = null;
        el.inGameHud.classList.add("hidden");
        
        // Trigger Post-Game Modal if a game just completed (e.g. longer than 2 minutes)
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

// UI Transition Helpers
function updateClientStatus(payload) {
    state.connected = payload.connected;
    
    // Update import button disabled state
    if (el.importRunesBtn) {
        if (!payload.connected) {
            el.importRunesBtn.disabled = true;
        } else if (state.displayedRunes) {
            el.importRunesBtn.disabled = false;
        }
    }
    
    // Status text & colors
    if (!payload.connected) {
        el.statusDot.className = "dot dot-red";
        el.statusText.textContent = "Disconnected";
        el.summonerDisplay.classList.add("hidden");
    } else {
        const phase = payload.phase;
        if (phase === "ChampSelect") {
            el.statusDot.className = "dot dot-yellow";
            el.statusText.textContent = "Champion Select";
        } else if (phase === "InProgress") {
            el.statusDot.className = "dot dot-blue";
            el.statusText.textContent = "In Game";
        } else {
            el.statusDot.className = "dot dot-green";
            el.statusText.textContent = "Lobby - Idle";
        }
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

function resetImportButton() {
    el.importRunesBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Import to Client`;
    el.importRunesBtn.disabled = !state.connected;
    el.importRunesBtn.style.background = "";
    el.importRunesBtn.style.borderColor = "";
}

function showLoading() {
    el.loadingSpinner.classList.remove("hidden");
    el.waitingScreen.classList.add("hidden");
    el.dashboard.classList.add("hidden");
}

function hideLoading() {
    el.loadingSpinner.classList.add("hidden");
}

function showWaitingScreen(customText = "") {
    el.waitingScreen.classList.remove("hidden");
    el.dashboard.classList.add("hidden");
    if (customText) {
        el.waitingScreen.querySelector("p").textContent = customText;
    } else {
        el.waitingScreen.querySelector("p").textContent = 
            "Launch your League client. The app will automatically sync during Champion Select to suggest rune pages, item paths, and lane matchups.";
    }
}

// RENDER DASHBOARD CORE
function renderDashboard(data) {
    el.waitingScreen.classList.add("hidden");
    el.dashboard.classList.remove("hidden");
    
    // 1. Champion Meta Info
    const champName = data.champion;
    const isEnemyFocus = data.is_enemy_focus || false;
    
    const champInfo = state.allChampions.find(c => c.name.toLowerCase() === champName.toLowerCase()) || {
        image: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champName}_0.jpg` // Fallback placeholder
    };
    
    el.heroPortrait.src = champInfo.image || "";
    el.heroName.textContent = champName;
    
    // Adjust badge and headings depending on search perspective
    if (isEnemyFocus) {
        el.heroBadge.textContent = "OPPONENT DETECTED";
        el.heroBadge.style.borderColor = "var(--color-red)";
        el.heroBadge.style.color = "var(--color-red)";
        el.heroBadge.style.background = "rgba(211, 47, 47, 0.15)";
        
        if (state.matchupFilter === "best") {
            el.countersTitle.textContent = `Counters Against ${champName} (Best Picks First)`;
        } else {
            el.countersTitle.textContent = `Weak Picks Against ${champName} (Worst Picks First)`;
        }
    } else {
        el.heroBadge.textContent = state.manualSearchActive ? "MANUAL LOOKUP" : "ACTIVE HERO";
        el.heroBadge.style.borderColor = "var(--color-gold)";
        el.heroBadge.style.color = "var(--color-gold-bright)";
        el.heroBadge.style.background = "rgba(200, 155, 60, 0.15)";
        
        if (state.matchupFilter === "best") {
            el.countersTitle.textContent = `Best Matchups for ${champName} (Highest Winrate First)`;
        } else {
            el.countersTitle.textContent = `Worst Matchups for ${champName} (Lowest Winrate First)`;
        }
    }
    
    // Role Display
    const displayRoles = { mid: "Middle Lane", top: "Top Lane", jungle: "Jungle", adc: "Bottom Lane (ADC)", support: "Support" };
    el.heroRoleDisplay.innerHTML = `<i class="fa-solid fa-gamepad text-gold"></i> ${displayRoles[data.role] || data.role}`;
    
    // Mobafire links
    const mobaChampName = champName.toLowerCase().replace("'", "").replace(" ", "").replace(".", "");
    el.mobafireGuideBtn.href = `https://www.mobafire.com/league-of-legends/champion/${mobaChampName}`;
    el.mobafireCountersBtn.href = `https://www.mobafire.com/league-of-legends/champion/${mobaChampName}/counters`;
    
    // 2. Render Runes (if build is available)
    if (data.build && data.build.runes) {
        const runes = data.build.runes;
        
        // Primary Path
        el.primaryPathIcon.src = runes.primary_style.icon || "";
        el.primaryPathName.textContent = runes.primary_style.name;
        el.primaryRunesList.innerHTML = "";
        
        runes.perks.slice(0, 4).forEach((rune, idx) => {
            const row = document.createElement("div");
            row.className = idx === 0 ? "rune-row-node keystone" : "rune-row-node";
            if (rune.consensus) row.classList.add("consensus-rune");
            row.innerHTML = `
                <div class="rune-icon-circle">
                    <img src="${rune.icon}" alt="${rune.name}">
                </div>
                <span>${rune.name}</span>
            `;
            el.primaryRunesList.appendChild(row);
        });
        
        // Secondary Path
        el.secondaryPathIcon.src = runes.sub_style.icon || "";
        el.secondaryPathName.textContent = runes.sub_style.name;
        el.secondaryRunesList.innerHTML = "";
        
        runes.perks.slice(4).forEach(rune => {
            const row = document.createElement("div");
            row.className = "rune-row-node";
            if (rune.consensus) row.classList.add("consensus-rune");
            row.innerHTML = `
                <div class="rune-icon-circle">
                    <img src="${rune.icon}" alt="${rune.name}">
                </div>
                <span>${rune.name}</span>
            `;
            el.secondaryRunesList.appendChild(row);
        });
        
        // Shards
        el.shardsList.innerHTML = "";
        runes.shards.forEach(shard => {
            const node = document.createElement("div");
            node.className = "shard-node";
            if (shard.consensus) node.classList.add("consensus-rune");
            node.innerHTML = `<img src="${shard.icon}" alt="${shard.name}" title="${shard.name}">`;
            el.shardsList.appendChild(node);
        });
        
        // Spells
        el.summonersList.innerHTML = "";
        if (data.build.summoner_spells) {
            data.build.summoner_spells.forEach(spell => {
                const node = document.createElement("div");
                node.className = "spell-node";
                node.innerHTML = `
                    <img src="${spell.image}" alt="${spell.name}">
                    <span>${spell.name}</span>
                `;
                el.summonersList.appendChild(node);
            });
        }
        
        // Skill priority
        el.skillsPriorityText.textContent = data.build.skill_priority || "Q > W > E";
        
        // Skill progression row
        el.skillPathRow.innerHTML = "";
        if (data.build.skill_path) {
            data.build.skill_path.forEach((skill, idx) => {
                const node = document.createElement("div");
                const skillClass = `skill-${skill.toLowerCase()}`;
                node.className = `skill-path-node ${skillClass}`;
                node.innerHTML = `
                    <span class="node-lvl">${idx + 1}</span>
                    <span class="node-letter">${skill}</span>
                `;
                el.skillPathRow.appendChild(node);
            });
        }
        
        // Items render
        const renderItems = (itemsList, container) => {
            container.innerHTML = "";
            if (!itemsList || itemsList.length === 0) {
                container.innerHTML = `<p class="subtext text-muted">No items recommended</p>`;
                return;
            }
            itemsList.forEach(item => {
                const card = document.createElement("div");
                card.className = "item-node-card";
                
                // Add source classes if cross-compared
                if (item.sources) {
                    if (item.sources.includes("ugg") && item.sources.includes("opgg")) {
                        card.classList.add("consensus-item");
                        card.title = `${item.name} (Recommended by both U.GG and OP.GG)`;
                    } else {
                        const src = item.sources[0];
                        card.classList.add(`${src}-only-item`);
                        card.title = `${item.name} (Recommended by ${src.toUpperCase()} only)`;
                    }
                } else {
                    card.title = item.name;
                }
                
                card.innerHTML = `<img src="${item.image}" alt="${item.name}">`;
                container.appendChild(card);
            });
        };
        
        renderItems(data.build.starting_items, el.startingItemsList);
        renderItems(data.build.core_items, el.coreItemsList);
        renderItems(data.build.situational_items, el.situationalItemsList);
        
        // Cache current runes for LCU importing
        state.displayedRunes = {
            champion: data.champion,
            primary_style_id: runes.primary_style.id,
            sub_style_id: runes.sub_style.id,
            perk_ids: runes.perks.map(p => p.id),
            shard_ids: runes.shards.map(s => s.id)
        };
        if (el.importRunesBtn) {
            el.importRunesBtn.disabled = !state.connected;
        }
    } else {
        // Clear builds sections (this happens if we only focus on enemy counter recommendations)
        el.primaryRunesList.innerHTML = "<p class='subtext text-muted'>Select your hero to load runes</p>";
        el.secondaryRunesList.innerHTML = "";
        el.shardsList.innerHTML = "";
        el.summonersList.innerHTML = "";
        el.skillsPriorityText.textContent = "-";
        el.skillPathRow.innerHTML = "";
        el.startingItemsList.innerHTML = "";
        el.coreItemsList.innerHTML = "";
        el.situationalItemsList.innerHTML = "";
        
        state.displayedRunes = null;
        if (el.importRunesBtn) {
            el.importRunesBtn.disabled = true;
        }
    }
    
    // 3. Render Counters List
    el.countersList.innerHTML = "";
    if (data.counters && data.counters.length > 0) {
        let sortedCounters = [...data.counters];
        if (state.matchupFilter === "best") {
            sortedCounters.sort((a, b) => b.win_rate - a.win_rate);
        } else {
            sortedCounters.sort((a, b) => a.win_rate - b.win_rate);
        }
        
        sortedCounters.slice(0, 15).forEach(c => {
            const row = document.createElement("div");
            row.className = "counter-row-item";
            
            // Check if winrate color-coding
            // Note: data.win_rate represents the winrate of our champion AGAINST this champion.
            // If isEnemyFocus is true, win_rate is enemy's winrate against them, so lower winrate means opponent loses.
            const wr = c.win_rate;
            let wrClass = "wr-neutral";
            
            if (isEnemyFocus) {
                // We want to pick champions that have the lowest winrate for the enemy, i.e. we win.
                // U.GG stores "win_rate" as the enemy's winrate against this champ.
                // E.g., if Zed (enemy) winrate is 47%, that means this champ counters Zed (good for us!).
                if (wr < 48) wrClass = "wr-good";
                else if (wr > 52) wrClass = "wr-bad";
            } else {
                // We are looking at our champion's matchups. Higher winrate is good.
                if (wr > 52) wrClass = "wr-good";
                else if (wr < 48) wrClass = "wr-bad";
            }
            
            // Stats indicator (Gold Differential)
            const gold = c.gold_adv_15;
            let goldHtml = "";
            if (gold && gold !== 0) {
                let goldClass = "";
                let goldText = `${gold > 0 ? "+" : ""}${gold}g`;
                if (gold > 100) goldClass = "stat-lead";
                else if (gold < -100) goldClass = "stat-behind";
                goldHtml = `<span class="counter-stat-pill ${goldClass}" title="Gold differential at 15 minutes">${goldText}</span>`;
            }
            
            // Display source indicator badge
            let sourceBadgeHtml = "";
            if (c.sources) {
                if (c.sources.includes("ugg") && c.sources.includes("opgg")) {
                    sourceBadgeHtml = `<span class="source-badge both">BOTH</span>`;
                } else {
                    const src = c.sources[0];
                    sourceBadgeHtml = `<span class="source-badge ${src}">${src.toUpperCase()}</span>`;
                }
            }
            
            row.innerHTML = `
                <div class="counter-row-left">
                    <img src="${c.image}" alt="${c.name}" class="counter-champ-img">
                    <div class="counter-champ-meta">
                        <div class="counter-champ-title-row">
                            <span class="counter-champ-name">${c.name}</span>
                            ${sourceBadgeHtml}
                        </div>
                        <span class="counter-champ-matches">${c.matches.toLocaleString()} matches</span>
                    </div>
                </div>
                <div class="counter-row-right">
                    ${goldHtml}
                    <div class="counter-winrate-box">
                        <span class="winrate-value ${wrClass}">${wr.toFixed(1)}%</span>
                        <span class="winrate-label">${isEnemyFocus ? 'Enemy WR' : 'Our WR'}</span>
                    </div>
                </div>
            `;
            
            // Click counter row to load their build!
            row.addEventListener("click", () => {
                state.manualSearchActive = true;
                el.search.value = c.name;
                triggerStatsLookup(c.name, data.role);
            });
            
            el.countersList.appendChild(row);
        });
    } else {
        el.countersList.innerHTML = `<p class="subtext text-muted" style="padding: 15px 0;">No counters data available.</p>`;
    }
}

// Start App
window.addEventListener("DOMContentLoaded", init);

// Render Draft Suggestions Sidebar panels
function renderDraftSuggestions(suggestions) {
    if (!suggestions) {
        if (el.teamCountersCard) el.teamCountersCard.classList.add("hidden");
        if (el.botlaneDuoCard) el.botlaneDuoCard.classList.add("hidden");
        if (el.damageTrackerCard) el.damageTrackerCard.classList.add("hidden");
        const alertCard = document.getElementById("draft-alerts-card");
        if (alertCard) alertCard.classList.add("hidden");
        return;
    }
    
    const { team_counters, botlane_suggestions, damage_balance } = suggestions;
    
    // Render AD/AP progress bars
    renderDamageBalance(damage_balance);
    
    // Render Draft Advisories (ban recommendations, pick swaps, comp auditor)
    const alertList = document.getElementById("draft-alerts-list");
    const alertCard = document.getElementById("draft-alerts-card");
    
    if (alertList && alertCard) {
        alertList.innerHTML = "";
        let hasAdvisories = false;
        
        // 1. Pick Order Swap Advisor
        if (suggestions.swap_advisor && suggestions.swap_advisor.suggested) {
            hasAdvisories = true;
            const alertRow = document.createElement("div");
            alertRow.className = "draft-alert-item swap-warning";
            alertRow.style.cssText = "background: rgba(255, 193, 7, 0.1); border: 1px solid #ffc107; padding: 10px; border-radius: 6px; font-size: 11px; color: #ffc107; display: flex; align-items: center; gap: 8px;";
            alertRow.innerHTML = `<i class="fa-solid fa-arrow-right-arrow-left" style="font-size: 14px;"></i> <div>${suggestions.swap_advisor.message}</div>`;
            alertList.appendChild(alertRow);
        }
        
        // 2. Composition Warnings
        if (suggestions.comp_audit && suggestions.comp_audit.warnings && suggestions.comp_audit.warnings.length > 0) {
            suggestions.comp_audit.warnings.forEach(warn => {
                hasAdvisories = true;
                const alertRow = document.createElement("div");
                alertRow.className = "draft-alert-item comp-warning";
                alertRow.style.cssText = "background: rgba(220, 53, 69, 0.1); border: 1px solid #dc3545; padding: 10px; border-radius: 6px; font-size: 11px; color: #dc3545; display: flex; align-items: center; gap: 8px;";
                alertRow.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 14px;"></i> <div>${warn}</div>`;
                alertList.appendChild(alertRow);
            });
        }
        
        // 3. Ban Recommendations
        if (suggestions.ban_recommendation) {
            hasAdvisories = true;
            const banRow = document.createElement("div");
            banRow.className = "draft-alert-item ban-recommendation";
            banRow.style.cssText = "background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-light); padding: 10px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px;";
            banRow.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${suggestions.ban_recommendation.image}" alt="Ban" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid #dc3545; filter: grayscale(1);">
                    <div style="font-size: 11px; color: var(--text-secondary);">
                        <strong style="color: var(--text-primary);">Ban Suggested:</strong> ${suggestions.ban_recommendation.name}
                        <div style="font-size: 9px; color: var(--text-muted); margin-top: 1px;">Worst Matchup (Opponent Winrate: ${suggestions.ban_recommendation.win_rate}%)</div>
                    </div>
                </div>
                <span style="font-size: 9px; background: rgba(220, 53, 69, 0.15); color: #dc3545; border: 1px solid #dc3545; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">RECOMMENDED BAN</span>
            `;
            alertList.appendChild(banRow);
        }
        
        if (hasAdvisories) {
            alertCard.classList.remove("hidden");
        } else {
            alertCard.classList.add("hidden");
        }
    }
    
    // 1. Render Team Counters
    el.teamCountersList.innerHTML = "";
    if (team_counters && team_counters.length > 0) {
        if (el.teamCountersCard) el.teamCountersCard.classList.remove("hidden");
        team_counters.forEach(c => {
            const row = document.createElement("div");
            row.className = "suggestion-row";
            row.style.flexDirection = "column";
            row.style.alignItems = "stretch";
            row.style.gap = "8px";
            
            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div class="suggestion-left">
                        <img src="${c.image}" alt="${c.name}" class="suggestion-img">
                        <div class="suggestion-meta">
                            <span class="suggestion-name">${c.name}</span>
                            <span class="suggestion-sub">Counters ${c.matches_countered} enemies</span>
                        </div>
                    </div>
                    <div class="suggestion-right">
                        <span class="suggestion-score-box">+${c.score.toFixed(1)}%</span>
                        <span class="suggestion-score-label">Draft Adv</span>
                    </div>
                </div>
                <div class="suggestion-synergy-note" style="font-size: 11px; color: var(--color-gold-bright); padding: 6px 10px; background: rgba(200, 155, 60, 0.04); border-left: 2px solid var(--color-gold); border-radius: 2px; line-height: 1.4;">
                    <i class="fa-solid fa-lightbulb"></i> ${c.synergy_note}
                </div>
            `;
            // Click to lookup candidate
            row.addEventListener("click", () => {
                state.manualSearchActive = true;
                el.search.value = c.name;
                triggerStatsLookup(c.name, state.activeRole);
            });
            el.teamCountersList.appendChild(row);
        });
    } else {
        if (el.teamCountersCard) el.teamCountersCard.classList.add("hidden");
    }
    
    // 2. Render Botlane Suggestions
    if (botlane_suggestions && botlane_suggestions.length > 0) {
        if (el.botlaneDuoCard) el.botlaneDuoCard.classList.remove("hidden");
        el.botlaneSuggestionsList.innerHTML = "";
        
        botlane_suggestions.forEach(c => {
            const row = document.createElement("div");
            row.className = "suggestion-row";
            
            let breakdownText = "";
            if (c.ally_bot_locked) {
                breakdownText = `Synergy: ${c.synergy_wr.toFixed(1)}% with ${c.ally_bot_name}`;
            } else {
                breakdownText = "Synergy: N/A (no ally locked)";
            }
            
            row.innerHTML = `
                <div class="suggestion-left">
                    <img src="${c.image}" alt="${c.name}" class="suggestion-img">
                    <div class="suggestion-meta">
                        <span class="suggestion-name">${c.name}</span>
                        <span class="suggestion-sub">${breakdownText}</span>
                    </div>
                </div>
                <div class="suggestion-right">
                    <span class="suggestion-score-box">${c.score > 0 ? "+" : ""}${c.score.toFixed(1)}%</span>
                    <span class="suggestion-score-label">Bot Score</span>
                </div>
            `;
            
            row.addEventListener("click", () => {
                state.manualSearchActive = true;
                el.search.value = c.name;
                triggerStatsLookup(c.name, state.activeRole);
            });
            el.botlaneSuggestionsList.appendChild(row);
        });
    } else {
        if (el.botlaneDuoCard) el.botlaneDuoCard.classList.add("hidden");
    }
}

// Render gameplay counter tips
function renderMatchupTips(tips) {
    if (!tips || tips.length === 0) {
        el.matchupTipsCard.classList.add("hidden");
        el.matchupTipsList.innerHTML = "";
        return;
    }
    el.matchupTipsCard.classList.remove("hidden");
    el.matchupTipsList.innerHTML = "";
    tips.forEach(tip => {
        const li = document.createElement("li");
        li.textContent = tip;
        el.matchupTipsList.appendChild(li);
    });
}

// Render AD/AP composition ratios during draft
function renderDamageBalance(damageBalance) {
    if (!damageBalance) {
        el.damageTrackerCard.classList.add("hidden");
        return;
    }
    
    el.damageTrackerCard.classList.remove("hidden");
    
    const allyAd = damageBalance.ally.ad;
    const allyAp = damageBalance.ally.ap;
    const enemyAd = damageBalance.enemy.ad;
    const enemyAp = damageBalance.enemy.ap;
    
    // Update labels
    el.allyDamageRatio.textContent = `${allyAd}% AD / ${allyAp}% AP`;
    el.enemyDamageRatio.textContent = `${enemyAd}% AD / ${enemyAp}% AP`;
    
    // Update bars widths
    el.allyAdBar.style.width = `${allyAd}%`;
    el.allyApBar.style.width = `${allyAp}%`;
    el.enemyAdBar.style.width = `${enemyAd}%`;
    el.enemyApBar.style.width = `${enemyAp}%`;
}

// Render the in-game HUD listing enemies, spells, and cooldown triggers
const summonerSpellsData = {
    1: { name: "Cleanse", file: "SummonerBoost", cd: 210 },
    3: { name: "Exhaust", file: "SummonerExhaust", cd: 210 },
    4: { name: "Flash", file: "SummonerFlash", cd: 300 },
    6: { name: "Ghost", file: "SummonerHaste", cd: 210 },
    7: { name: "Heal", file: "SummonerHeal", cd: 240 },
    11: { name: "Smite", file: "SummonerSmite", cd: 15 },
    12: { name: "Teleport", file: "SummonerTeleport", cd: 360 },
    14: { name: "Ignite", file: "SummonerDot", cd: 180 },
    21: { name: "Barrier", file: "SummonerBarrier", cd: 180 }
};

// Track active timers on the frontend
// Format: "champName_spellId" -> intervalId
const activeSpellTimers = {};

function renderInGameHUD(enemies) {
    if (!enemies || enemies.length === 0) {
        el.hudEnemiesList.innerHTML = `<p class="subtext text-muted" style="text-align: center; padding: 30px;">Waiting for active game session data...</p>`;
        return;
    }
    
    // Save current checkboxes state
    const checkboxStates = {};
    document.querySelectorAll(".haste-toggle").forEach(cb => {
        checkboxStates[cb.id] = cb.checked;
    });
    
    el.hudEnemiesList.innerHTML = "";
    
    enemies.forEach(enemy => {
        const row = document.createElement("div");
        row.className = "hud-enemy-row";
        
        const trackerId = `haste_${enemy.name.replace(/\s/g, "")}`;
        
        // Check for enemy penetration items
        let hasPenetration = false;
        let penType = "";
        const penItemIds = [
            3135, 3137, 3020, // magic pen
            3036, 3033, 3035, 3302, // armor pen
            6676, 3142, 6701, 6706, 3814, 6675, 6692, 6695, 6696, 3179 // lethality
        ];
        if (enemy.items) {
            enemy.items.forEach(item => {
                const itemIdInt = parseInt(item.id);
                if (penItemIds.includes(itemIdInt)) {
                    hasPenetration = true;
                    if ([3135, 3137, 3020].includes(itemIdInt)) {
                        penType = "MAGIC PEN";
                    } else if ([3036, 3033, 3035, 3302].includes(itemIdInt)) {
                        penType = "ARMOR PEN";
                    } else {
                        penType = "LETHALITY";
                    }
                }
            });
        }
        
        const penBadge = hasPenetration ? `<span class="badge-accent" style="margin-left: 8px; font-size: 9px; padding: 1px 6px; background: rgba(220, 53, 69, 0.15); border: 1px solid #dc3545; color: #dc3545; font-weight: 800;"><i class="fa-solid fa-triangle-exclamation"></i> ${penType} THREAT</span>` : "";
        
        // Respawn tracking & voice alarm
        let respawnBadge = "";
        if (enemy.respawn_timer !== undefined && enemy.respawn_timer > 0) {
            const respawnSeconds = Math.ceil(enemy.respawn_timer);
            respawnBadge = `<span class="badge-accent" style="margin-left: 8px; font-size: 9px; padding: 1px 6px; background: rgba(220, 53, 69, 0.15); border: 1px solid #dc3545; color: #dc3545; font-weight: 800;"><i class="fa-solid fa-skull"></i> DEAD (${respawnSeconds}s)</span>`;
            
            if (respawnSeconds <= 10) {
                const alertKey = `${enemy.name}_respawn_10s`;
                if (state.spokenObjectives && !state.spokenObjectives.has(alertKey)) {
                    state.spokenObjectives.add(alertKey);
                    speak(`${enemy.name} is respawning in ten seconds.`);
                }
            }
        } else if (enemy.respawn_timer !== undefined && enemy.respawn_timer === 0) {
            const alertKey = `${enemy.name}_respawn_10s`;
            if (state.spokenObjectives) {
                state.spokenObjectives.delete(alertKey);
            }
        }
        
        // Render inventory items (up to 6)
        let itemsHtml = "";
        if (enemy.items && enemy.items.length > 0) {
            enemy.items.forEach(item => {
                itemsHtml += `
                    <div class="hud-inventory-node" title="${item.name}">
                        <img src="${item.image || ''}" alt="${item.name}">
                    </div>
                `;
            });
        }
        
        const itemCount = enemy.items ? enemy.items.length : 0;
        for (let i = itemCount; i < 6; i++) {
            itemsHtml += `<div class="hud-inventory-node empty"></div>`;
        }
        
        const hasLiveData = enemy.level !== undefined && enemy.scores !== undefined;
        const levelBadge = hasLiveData ? `<span class="hud-enemy-level">${enemy.level}</span>` : "";
        const scoreText = hasLiveData ? `${enemy.scores.kills}/${enemy.scores.deaths}/${enemy.scores.assists} (${enemy.scores.cs} CS)` : "Lobby Sync Active";
        
        const autoCheckLucidity = enemy.has_lucidity ? "checked disabled class='auto-haste'" : "";
        const autoLabelClass = enemy.has_lucidity ? "class='auto-haste-label glowing-text-blue'" : "";
        
        row.innerHTML = `
            <div class="hud-enemy-left">
                <div style="position: relative;">
                    <img src="${enemy.image}" alt="${enemy.name}" class="hud-enemy-img" ${enemy.respawn_timer > 0 ? 'style="filter: grayscale(1) opacity(0.4);"' : ''}>
                    ${levelBadge}
                </div>
                <div>
                    <span class="hud-enemy-name">${enemy.name} ${penBadge} ${respawnBadge}</span>
                    <span class="hud-enemy-scores">${scoreText}</span>
                    <div class="hud-enemy-inventory">
                        ${itemsHtml}
                    </div>
                </div>
            </div>
            
            <div class="hud-enemy-controls">
                <div style="display: flex; flex-direction: column; gap: 4px; margin-right: 20px;">
                    <label ${autoLabelClass} style="font-size: 11px; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" id="${trackerId}_lucidity" ${autoCheckLucidity} class="haste-toggle"> Lucidity Boots ${enemy.has_lucidity ? '(Auto)' : '(+12 Haste)'}
                    </label>
                    <label style="font-size: 11px; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" id="${trackerId}_insight" class="haste-toggle"> Cosmic Insight (+18 Haste)
                    </label>
                </div>
                
                <div class="hud-enemy-spells">
                    <div class="hud-spell-container" id="spell-btn_${enemy.name.replace(/\s/g, "")}_1"></div>
                    <div class="hud-spell-container" id="spell-btn_${enemy.name.replace(/\s/g, "")}_2"></div>
                    <div class="hud-spell-container" id="spell-btn_${enemy.name.replace(/\s/g, "")}_ult"></div>
                </div>
            </div>
        `;
        
        el.hudEnemiesList.appendChild(row);
        
        drawSpellButton(enemy, 1, enemy.spell1_id, trackerId);
        drawSpellButton(enemy, 2, enemy.spell2_id, trackerId);
        drawUltimateButton(enemy);
    });
    
    // Restore checkboxes state
    Object.keys(checkboxStates).forEach(id => {
        const cb = document.getElementById(id);
        if (cb && !cb.disabled) {
            cb.checked = checkboxStates[id];
        }
    });
}

function drawSpellButton(enemy, spellIndex, spellId, trackerId) {
    const containerId = `spell-btn_${enemy.name.replace(/\s/g, "")}_${spellIndex}`;
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const spell = summonerSpellsData[spellId] || { name: `Spell ${spellId}`, file: "SummonerFlash", cd: 300 };
    const version = state.allChampions.length > 0 && state.allChampions[0].image ? state.allChampions[0].image.split('/cdn/')[1].split('/')[0] : '16.13.1';
    const imageUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${spell.file}.png`;
    
    const btn = document.createElement("button");
    btn.className = "hud-spell-btn";
    btn.title = `Click to start CD for ${spell.name}`;
    btn.innerHTML = `
        <img src="${imageUrl}" alt="${spell.name}">
        <div class="cd-overlay">
            <span class="cd-text"></span>
        </div>
    `;
    
    // Click listener
    btn.addEventListener("click", () => {
        const timerKey = `${enemy.name.replace(/\s/g, "")}_${spellId}`;
        
        // If already on cooldown, click again to cancel!
        if (activeSpellTimers[timerKey]) {
            clearInterval(activeSpellTimers[timerKey].interval);
            delete activeSpellTimers[timerKey];
            btn.classList.remove("on-cooldown");
            btn.title = `Click to start CD for ${spell.name}`;
            return;
        }
        
        // Determine total cooldown reduction (Haste)
        const lucidityChecked = document.getElementById(`${trackerId}_lucidity`)?.checked;
        const insightChecked = document.getElementById(`${trackerId}_insight`)?.checked;
        
        let spellHaste = 0;
        if (lucidityChecked) spellHaste += 12;
        if (insightChecked) spellHaste += 18;
        
        let cdSeconds = Math.round(spell.cd / (1 + spellHaste / 100));
        
        btn.classList.add("on-cooldown");
        btn.title = `Spell on cooldown! Click to cancel.`;
        
        const overlay = btn.querySelector(".cd-overlay");
        const text = btn.querySelector(".cd-text");
        text.textContent = `${cdSeconds}s`;
        
        const intervalId = setInterval(() => {
            cdSeconds--;
            if (cdSeconds <= 0) {
                clearInterval(intervalId);
                delete activeSpellTimers[timerKey];
                btn.classList.remove("on-cooldown");
                btn.title = `Click to start CD for ${spell.name}`;
                speak(`${enemy.name} ${spell.name} is back up.`);
            } else {
                text.textContent = `${cdSeconds}s`;
            }
        }, 1000);
        
        activeSpellTimers[timerKey] = {
            interval: intervalId,
            endTime: Date.now() + (cdSeconds * 1000)
        };
    });
    
    // Restore state if timer is already ticking from a previous render
    const timerKey = `${enemy.name.replace(/\s/g, "")}_${spellId}`;
    const active = activeSpellTimers[timerKey];
    if (active) {
        const remaining = Math.round((active.endTime - Date.now()) / 1000);
        if (remaining > 0) {
            btn.classList.add("on-cooldown");
            btn.title = `Spell on cooldown! Click to cancel.`;
            const text = btn.querySelector(".cd-text");
            text.textContent = `${remaining}s`;
            
            // Re-bind interval
            clearInterval(active.interval);
            const intervalId = setInterval(() => {
                const curRemaining = Math.round((active.endTime - Date.now()) / 1000);
                if (curRemaining <= 0) {
                    clearInterval(intervalId);
                    delete activeSpellTimers[timerKey];
                    btn.classList.remove("on-cooldown");
                    btn.title = `Click to start CD for ${spell.name}`;
                    speak(`${enemy.name} ${spell.name} is back up.`);
                } else {
                    text.textContent = `${curRemaining}s`;
                }
            }, 1000);
            active.interval = intervalId;
        } else {
            delete activeSpellTimers[timerKey];
        }
    }
    
    container.appendChild(btn);
}

// Base Ultimate Cooldowns dictionary (Rank 1, 2, 3)
const ultimateCooldownsData = {
    "Malphite": [130, 105, 80],
    "Amumu": [150, 125, 100],
    "Karthus": [200, 180, 160],
    "Lux": [40, 30, 20],
    "Ashe": [80, 70, 60],
    "Shen": [200, 180, 160],
    "Soraka": [160, 145, 130],
    "Sona": [140, 120, 100],
    "Zed": [120, 100, 80],
    "Orianna": [110, 95, 80],
    "TwistedFate": [180, 150, 120],
    "Blitzcrank": [60, 40, 20],
    "Leona": [90, 75, 60]
};

function getUltimateCooldown(champName, rank) {
    const cds = ultimateCooldownsData[champName] || [120, 100, 80];
    return cds[rank - 1] || cds[0];
}

function drawUltimateButton(enemy) {
    const containerId = `spell-btn_${enemy.name.replace(/\s/g, "")}_ult`;
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let rank = 1;
    if (enemy.level >= 11 && enemy.level < 16) rank = 2;
    if (enemy.level >= 16) rank = 3;
    
    const baseCd = getUltimateCooldown(enemy.name, rank);
    
    const btn = document.createElement("button");
    btn.className = "hud-spell-btn ultimate";
    btn.title = `Click to start CD for Ultimate (Rank ${rank}, CD: ${baseCd}s)`;
    btn.innerHTML = `
        <img src="${enemy.image}" alt="Ult" style="filter: hue-rotate(45deg);">
        <div class="cd-overlay">
            <span class="cd-text"></span>
        </div>
    `;
    
    btn.addEventListener("click", () => {
        const timerKey = `${enemy.name.replace(/\s/g, "")}_ult`;
        
        if (activeSpellTimers[timerKey]) {
            clearInterval(activeSpellTimers[timerKey].interval);
            delete activeSpellTimers[timerKey];
            btn.classList.remove("on-cooldown");
            btn.title = `Click to start CD for Ultimate (Rank ${rank}, CD: ${baseCd}s)`;
            return;
        }
        
        let cdSeconds = baseCd;
        
        btn.classList.add("on-cooldown");
        btn.title = `Ultimate on cooldown! Click to cancel.`;
        
        const overlay = btn.querySelector(".cd-overlay");
        const text = btn.querySelector(".cd-text");
        text.textContent = `${cdSeconds}s`;
        
        const intervalId = setInterval(() => {
            cdSeconds--;
            if (cdSeconds <= 0) {
                clearInterval(intervalId);
                delete activeSpellTimers[timerKey];
                btn.classList.remove("on-cooldown");
                btn.title = `Click to start CD for Ultimate (Rank ${rank}, CD: ${baseCd}s)`;
                speak(`${enemy.name} ultimate is back up.`);
            } else {
                text.textContent = `${cdSeconds}s`;
            }
        }, 1000);
        
        activeSpellTimers[timerKey] = {
            interval: intervalId,
            endTime: Date.now() + (cdSeconds * 1000)
        };
    });
    
    const timerKey = `${enemy.name.replace(/\s/g, "")}_ult`;
    const active = activeSpellTimers[timerKey];
    if (active) {
        const remaining = Math.round((active.endTime - Date.now()) / 1000);
        if (remaining > 0) {
            btn.classList.add("on-cooldown");
            btn.title = `Ultimate on cooldown! Click to cancel.`;
            const text = btn.querySelector(".cd-text");
            text.textContent = `${remaining}s`;
            
            clearInterval(active.interval);
            const intervalId = setInterval(() => {
                const curRemaining = Math.round((active.endTime - Date.now()) / 1000);
                if (curRemaining <= 0) {
                    clearInterval(intervalId);
                    delete activeSpellTimers[timerKey];
                    btn.classList.remove("on-cooldown");
                    btn.title = `Click to start CD for Ultimate (Rank ${rank}, CD: ${baseCd}s)`;
                    speak(`${enemy.name} ultimate is back up.`);
                } else {
                    text.textContent = `${curRemaining}s`;
                }
            }, 1000);
            active.interval = intervalId;
        } else {
            delete activeSpellTimers[timerKey];
        }
    }
    
    container.appendChild(btn);
}

let lastDragonKillTime = null;

function renderLiveObjectiveTimers(gameTime, events) {
    if (gameTime <= 0) {
        el.objectiveTimersList.innerHTML = `<p class="subtext text-muted" style="padding: 10px 0;">Timers will load when game session starts.</p>`;
        return;
    }
    
    if (events && events.length > 0) {
        if (state.lastProcessedEventId === -1) {
            const maxId = Math.max(...events.map(e => e.EventID));
            state.lastProcessedEventId = maxId;
        }
        
        events.forEach(evt => {
            if (evt.EventName === "DragonKill") {
                const deathTime = evt.EventTime;
                if (!lastDragonKillTime || deathTime > lastDragonKillTime) {
                    lastDragonKillTime = deathTime;
                }
            }
            
            // Announce structural/objective kills safely
            if (evt.EventID > state.lastProcessedEventId) {
                state.lastProcessedEventId = evt.EventID;
                
                if (evt.EventName === "TurretKilled") {
                    if (evt.KillerName) {
                        speak(`Turret destroyed by ${evt.KillerName}.`);
                    } else {
                        speak("Turret destroyed.");
                    }
                } else if (evt.EventName === "InhibKilled") {
                    speak("Inhibitor destroyed.");
                } else if (evt.EventName === "DragonKill") {
                    speak("Dragon slain.");
                } else if (evt.EventName === "BaronKill") {
                    speak("Baron Nashor slain.");
                } else if (evt.EventName === "HeraldKill") {
                    speak("Rift Herald slain.");
                }
            }
        });
    }
    
    el.objectiveTimersList.innerHTML = "";
    
    const objectives = [];
    
    // 1. Elemental Dragon
    let dragonStatus = "";
    let dragonTimeLeft = 0;
    if (gameTime < 300) {
        dragonTimeLeft = 300 - gameTime;
        dragonStatus = `Spawns at 5:00 (${formatTime(dragonTimeLeft)})`;
    } else if (lastDragonKillTime) {
        const nextSpawn = lastDragonKillTime + 300;
        if (gameTime < nextSpawn) {
            dragonTimeLeft = nextSpawn - gameTime;
            dragonStatus = `Spawns in ${formatTime(dragonTimeLeft)}`;
        } else {
            dragonStatus = "Alive / Active";
        }
    } else {
        dragonStatus = "Alive / Active";
    }
    objectives.push({ name: "Elemental Dragon", status: dragonStatus, timeLeft: dragonTimeLeft, icon: "fa-dragon" });
    
    // 2. Void Grubs (6:00 to 9:45)
    let grubsStatus = "";
    let grubsTimeLeft = 0;
    if (gameTime < 360) {
        grubsTimeLeft = 360 - gameTime;
        grubsStatus = `Spawns at 6:00 (${formatTime(grubsTimeLeft)})`;
    } else if (gameTime >= 360 && gameTime < 585) {
        grubsStatus = "Active on Map";
    } else {
        grubsStatus = "Despawned";
    }
    objectives.push({ name: "Void Grubs", status: grubsStatus, timeLeft: grubsTimeLeft, icon: "fa-bug" });
    
    // 3. Rift Herald (14:00 to 19:45)
    let heraldStatus = "";
    let heraldTimeLeft = 0;
    if (gameTime < 840) {
        heraldTimeLeft = 840 - gameTime;
        heraldStatus = `Spawns at 14:00 (${formatTime(heraldTimeLeft)})`;
    } else if (gameTime >= 840 && gameTime < 1185) {
        heraldStatus = "Active on Map";
    } else {
        heraldStatus = "Despawned / Replaced";
    }
    objectives.push({ name: "Rift Herald", status: heraldStatus, timeLeft: heraldTimeLeft, icon: "fa-shield" });
    
    // 4. Baron Nashor (20:00+)
    let baronStatus = "";
    let baronTimeLeft = 0;
    if (gameTime < 1200) {
        baronTimeLeft = 1200 - gameTime;
        baronStatus = `Spawns at 20:00 (${formatTime(baronTimeLeft)})`;
    } else {
        baronStatus = "Alive / Active";
    }
    objectives.push({ name: "Baron Nashor", status: baronStatus, timeLeft: baronTimeLeft, icon: "fa-skull" });
    
    // 5. Cannon Wave recall helper
    let waveMsg = "";
    let waveTimeLeft = 0;
    if (gameTime < 105) {
        waveTimeLeft = 105 - gameTime;
        waveMsg = `Cannon wave at 1:45 (${formatTime(waveTimeLeft)})`;
    } else {
        const afterFifteen = gameTime >= 900;
        const interval = afterFifteen ? 60 : 90;
        const offset = 105;
        const elapsed = gameTime - offset;
        const cycles = Math.floor(elapsed / interval);
        const nextSpawn = offset + ((cycles + 1) * interval);
        waveTimeLeft = nextSpawn - gameTime;
        waveMsg = `Next Cannon Wave in ${formatTime(waveTimeLeft)}`;
    }
    objectives.push({ name: "Recall Window (Cannon)", status: waveMsg, timeLeft: waveTimeLeft, icon: "fa-clock" });
    
    objectives.forEach(obj => {
        const row = document.createElement("div");
        row.className = "objective-row";
        if (obj.status.includes("Alive") || obj.status.includes("Active")) {
            row.classList.add("active");
        }
        
        let timerClass = "objective-timer";
        if (obj.timeLeft > 0 && obj.timeLeft <= 60) {
            timerClass += " spawning-soon";
            if (obj.timeLeft > 50) {
                const alertKey = `${obj.name}_60s`;
                if (state.spokenObjectives && !state.spokenObjectives.has(alertKey)) {
                    state.spokenObjectives.add(alertKey);
                    speak(`${obj.name} is spawning in sixty seconds.`);
                }
            } else if (obj.timeLeft > 10 && obj.timeLeft <= 15) {
                const alertKey = `${obj.name}_15s`;
                if (state.spokenObjectives && !state.spokenObjectives.has(alertKey)) {
                    state.spokenObjectives.add(alertKey);
                    speak(`${obj.name} spawning in fifteen seconds.`);
                }
            }
        }
        
        row.innerHTML = `
            <span class="objective-name"><i class="fa-solid ${obj.icon}"></i> ${obj.name}</span>
            <span class="${timerClass}">${obj.status}</span>
        `;
        el.objectiveTimersList.appendChild(row);
    });
}

function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function renderCSBenchmark(gameTime, activePlayer) {
    const isSupport = state.activeRole === "support" || state.activeRole === "utility";
    const targetLabel = isSupport ? "Target: <= 2.0 CS/min" : "Target: 8.0 CS/min";
    
    if (gameTime <= 0 || !activePlayer) {
        el.csGauge.textContent = "0.0";
        el.csGauge.className = isSupport ? "cs-gauge green" : "cs-gauge red";
        el.csTargetLabel.textContent = targetLabel;
        return;
    }
    
    const minutes = gameTime / 60;
    if (minutes < 1) {
        el.csGauge.textContent = "0.0";
        el.csGauge.className = "cs-gauge green";
        el.csTargetLabel.textContent = targetLabel;
        return;
    }
    
    const csMin = (activePlayer.cs / minutes).toFixed(1);
    el.csGauge.textContent = csMin;
    
    el.csGauge.className = "cs-gauge";
    if (isSupport) {
        if (parseFloat(csMin) <= 2.0) {
            el.csGauge.classList.add("green");
        } else if (parseFloat(csMin) <= 3.0) {
            el.csGauge.classList.add("yellow");
        } else {
            el.csGauge.classList.add("red");
        }
    } else {
        if (parseFloat(csMin) >= 8.0) {
            el.csGauge.classList.add("green");
        } else if (parseFloat(csMin) >= 6.5) {
            el.csGauge.classList.add("yellow");
        } else {
            el.csGauge.classList.add("red");
        }
    }
    
    el.csTargetLabel.textContent = `Current CS: ${activePlayer.cs} | ${targetLabel}`;
}

function renderDefensiveAdvisor(activePlayer, enemies) {
    if (!activePlayer || !enemies || enemies.length === 0) {
        el.defensiveAdviceBlock.classList.add("hidden");
        return;
    }
    
    let physicalThreat = 0;
    let magicThreat = 0;
    
    enemies.forEach(enemy => {
        let threatScore = enemy.level * 10;
        if (enemy.scores) {
            threatScore += enemy.scores.kills * 20;
        }
        
        let damageProfile = "AD";
        const apChamps = ["Ahri", "Akali", "Anivia", "Annie", "AurelionSol", "Azir", "Brand", "Cassiopeia", "Diana", "Elise", "Evelynn", "Fiddlesticks", "Fizz", "Galio", "Gragas", "Gwen", "Heimerdinger", "Karthus", "Kassadin", "Katarina", "Kayle", "Kennan", "Leblanc", "Lillia", "Lissandra", "Lulu", "Lux", "Malzahar", "Morderkaiser", "Morgana", "Neeko", "Nidalee", "Nunu", "Orianna", "Rumble", "Ryze", "Singed", "Swain", "Syndra", "Taliyah", "Teemo", "Vex", "Viktor", "Vladimir", "Xerath", "Ziggy", "Zoe", "Zyra", "Sona", "Soraka", "Janna", "Karma", "Nami", "Taric", "Yuumi", "Zilean", "Bard", "Milio", "Renata"];
        
        if (apChamps.includes(enemy.name.replace(/\s/g, ""))) {
            damageProfile = "AP";
        }
        
        if (damageProfile === "AP") {
            magicThreat += threatScore;
        } else {
            physicalThreat += threatScore;
        }
    });
    
    el.defensiveAdviceBlock.classList.remove("hidden");
    
    if (magicThreat > physicalThreat * 1.3) {
        el.defensiveAdviceText.innerHTML = `<strong>Heavy Magic Damage Threat Detected!</strong><br>Prioritize magic resistance components such as <strong>Null-Magic Mantle</strong> or <strong>Negatron Cloak</strong>. Consider building into <strong>Hexdrinker</strong> or <strong>Spectre's Cowl</strong>.`;
    } else if (physicalThreat > magicThreat * 1.3) {
        el.defensiveAdviceText.innerHTML = `<strong>Heavy Physical Damage Threat Detected!</strong><br>Prioritize armor upgrades. Pick up a <strong>Cloth Armor</strong> or <strong>Plated Steelcaps</strong> to reduce incoming auto-attack damage.`;
    } else {
        el.defensiveAdviceText.innerHTML = `<strong>Balanced Damage Threats.</strong><br>Defensive boots (Plated Steelcaps vs Mercury's Treads) are optimal choices. Sticking to standard core item builds is recommended.`;
    }
}

function renderJungleGankPredictor(gameTime, enemies) {
    if (gameTime <= 0 || gameTime > 240) {
        el.jungleGankCard.classList.add("hidden");
        return;
    }
    
    let hasJungler = false;
    let junglerName = "";
    enemies.forEach(enemy => {
        if (enemy.spell1_id === 11 || enemy.spell2_id === 11) {
            hasJungler = true;
            junglerName = enemy.name;
        }
    });
    
    if (!hasJungler) {
        el.jungleGankCard.classList.add("hidden");
        return;
    }
    
    el.jungleGankCard.classList.remove("hidden");
    
    const bar = el.gankProgressBar;
    const badge = el.gankRiskLevel;
    const msg = el.gankRiskMessage;
    
    if (gameTime >= 165 && gameTime <= 220) {
        badge.textContent = "HIGH";
        badge.className = "risk-badge high";
        bar.className = "gank-progress-bar high";
        bar.style.width = "90%";
        msg.innerHTML = `<strong>DANGER!</strong> ${junglerName} has likely finished a full clear. River and tribush gank risk is extremely high. Place wards now!`;
        
        const alertKey = "gank_high_first_clear";
        if (state.spokenObjectives && !state.spokenObjectives.has(alertKey)) {
            state.spokenObjectives.add(alertKey);
            speak(`Caution. ${junglerName} has completed their first jungle clear. Gank risk is high. Ward river approaches.`);
        }
    } else if (gameTime >= 120 && gameTime < 165) {
        badge.textContent = "MEDIUM";
        badge.className = "risk-badge medium";
        bar.className = "gank-progress-bar medium";
        bar.style.width = "50%";
        msg.innerHTML = `${junglerName} is clearing camps. Prepare river wards for incoming ganks starting around 2:50.`;
    } else {
        badge.textContent = "LOW";
        badge.className = "risk-badge low";
        bar.className = "gank-progress-bar low";
        bar.style.width = "15%";
        msg.innerHTML = `${junglerName} is on their starting buff. Safe to trade aggressively in lane.`;
    }
}

// Render Gold Lead
function renderGoldLead(allyGold, enemyGold) {
    if (!el.goldLeadValue) return;
    
    const diff = allyGold - enemyGold;
    if (diff > 0) {
        el.goldLeadValue.textContent = `+${diff.toLocaleString()} G (Ally Lead)`;
        el.goldLeadValue.className = "gold-lead-value green";
        el.goldLeadValue.style.color = "#28a745";
    } else if (diff < 0) {
        el.goldLeadValue.textContent = `-${Math.abs(diff).toLocaleString()} G (Enemy Lead)`;
        el.goldLeadValue.className = "gold-lead-value red";
        el.goldLeadValue.style.color = "#dc3545";
    } else {
        el.goldLeadValue.textContent = "Even";
        el.goldLeadValue.className = "gold-lead-value neutral";
        el.goldLeadValue.style.color = "var(--text-muted)";
    }
}

// Show Post-Game Performance Summary Modal
function showPostGameReport(lastGame) {
    if (!lastGame || !el.postGameModal) return;
    
    // Set Champion portrait and name
    el.postGameHeroName.textContent = lastGame.championName;
    el.postGameHeroImg.src = lastGame.championImage;
    
    // Calculate final stats
    const minutes = lastGame.game_time / 60;
    const csMin = (lastGame.active_player.cs / minutes).toFixed(1);
    el.postGameCsMin.textContent = `${csMin} CS/min`;
    
    const isSupport = state.activeRole === "support" || state.activeRole === "utility";
    
    // Evaluate CS performance
    const rating = el.postGameCsRating;
    rating.className = "";
    if (isSupport) {
        if (parseFloat(csMin) <= 2.0) {
            rating.textContent = "Excellent Support CS";
            rating.style.color = "#28a745";
        } else {
            rating.textContent = "High Lane Tax";
            rating.style.color = "#dc3545";
        }
    } else {
        if (parseFloat(csMin) >= 8.0) {
            rating.textContent = "Elite Farming";
            rating.style.color = "#28a745";
        } else if (parseFloat(csMin) >= 6.5) {
            rating.textContent = "Good / Stable";
            rating.style.color = "#ffc107";
        } else {
            rating.textContent = "Under-performing";
            rating.style.color = "#dc3545";
        }
    }
    
    // Set game time duration
    el.postGameDuration.textContent = formatTime(lastGame.game_time);
    
    // Set final inventory gold value
    const finalGold = lastGame.active_player.net_worth || lastGame.active_player.gold || 0;
    el.postGameGold.textContent = `${finalGold.toLocaleString()} G`;
    
    // Custom dynamically generated Coach Note advice based on performance
    const coach = el.postGameCoachNote;
    if (isSupport) {
        if (parseFloat(csMin) <= 2.0) {
            coach.innerHTML = `<strong>Coach Recommendation:</strong> Perfect support play style! You kept your lane tax low and allowed your ADC to secure maximum farm. Focus on map vision, warding, and positioning near your allies.`;
        } else {
            coach.innerHTML = `<strong>Coach Recommendation:</strong> Your CS is slightly high for a support role. Avoid clearing minion waves unless your ADC is dead or backing, as sharing lane farm delays their item core spikes.`;
        }
    } else {
        if (parseFloat(csMin) < 6.5) {
            coach.innerHTML = `<strong>Coach Recommendation:</strong> Focus on wave management and mid-game farming. Try not to miss waves when backing. Focus on catching side-lane waves before they reach your towers.`;
        } else if (parseFloat(csMin) >= 8.0) {
            coach.innerHTML = `<strong>Coach Recommendation:</strong> Excellent farming efficiency! Continue converting your gold leads into objective map pressure by grouping for Baron and Dragon teamfights.`;
        } else {
            coach.innerHTML = `<strong>Coach Recommendation:</strong> Solid match performance. Keep looking for small trading advantages in lane and coordinate with your Jungler to secure early Void Grubs and Rift Herald.`;
        }
    }
    
    // Reveal modal
    el.postGameModal.classList.remove("hidden");
}

// Speech queue to prevent overlapping announcements from canceling each other
let speechQueue = [];
let isSpeaking = false;

function speak(text) {
    if (!text) return;
    if (!state.settings || !state.settings.voice_coach_enabled) return;
    
    if ('speechSynthesis' in window) {
        speechQueue.push(text);
        processSpeechQueue();
    }
}

function processSpeechQueue() {
    if (isSpeaking || speechQueue.length === 0) return;
    
    isSpeaking = true;
    const text = speechQueue.shift();
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Apply speed & pitch
    utterance.rate = state.settings.voice_speed !== undefined ? state.settings.voice_speed : 1.0;
    utterance.pitch = state.settings.voice_pitch !== undefined ? state.settings.voice_pitch : 1.0;
    
    // Select matching system voice
    if (state.settings.voice_name) {
        const voices = window.speechSynthesis.getVoices();
        const matchingVoice = voices.find(v => v.name === state.settings.voice_name);
        if (matchingVoice) {
            utterance.voice = matchingVoice;
        }
    }
    
    utterance.onend = function() {
        isSpeaking = false;
        setTimeout(processSpeechQueue, 100);
    };
    
    utterance.onerror = function(event) {
        console.error('Speech synthesis error:', event.error, 'for text:', text);
        isSpeaking = false;
        setTimeout(processSpeechQueue, 100);
    };
    
    window.speechSynthesis.speak(utterance);
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

// Dynamically determine Early/Mid/Late champion power spikes based on primary role tags
function renderPowerSpikes(championName) {
    if (!el.spikeEarly || !el.spikeMid || !el.spikeLate) return;
    
    const champ = state.allChampions.find(c => c.name.toLowerCase() === championName.toLowerCase());
    
    // Fallback/Default values (Mage style)
    let early = "weak";
    let mid = "strong";
    let late = "strong";
    
    if (champ && champ.tags) {
        const tags = champ.tags.map(t => t.toLowerCase());
        
        if (tags.includes("assassin")) {
            early = "neutral";
            mid = "strong";
            late = "weak";
        } else if (tags.includes("tank")) {
            early = "weak";
            mid = "strong";
            late = "strong";
        } else if (tags.includes("marksman")) {
            early = "weak";
            mid = "neutral";
            late = "strong";
        } else if (tags.includes("support")) {
            early = "neutral";
            mid = "strong";
            late = "strong";
        } else if (tags.includes("fighter")) {
            early = "neutral";
            mid = "strong";
            late = "neutral";
        }
    }
    
    const colors = {
        weak: { bg: "rgba(220, 53, 69, 0.75)", label: "Weak" },
        neutral: { bg: "rgba(255, 193, 7, 0.75)", label: "Neutral" },
        strong: { bg: "rgba(40, 167, 69, 0.75)", label: "Strong" }
    };
    
    el.spikeEarly.style.background = colors[early].bg;
    el.spikeEarly.textContent = `Early: ${colors[early].label}`;
    
    el.spikeMid.style.background = colors[mid].bg;
    el.spikeMid.textContent = `Mid: ${colors[mid].label}`;
    
    el.spikeLate.style.background = colors[late].bg;
    el.spikeLate.textContent = `Late: ${colors[late].label}`;
}

// Direct Lane CS Lead difference tracker
function renderDirectLaneCS(activePlayer, oppName, oppCs) {
    if (!activePlayer || !el.csLeadValue || !el.csLeadDetails) return;
    
    const myCs = activePlayer.cs || 0;
    const diff = myCs - oppCs;
    
    if (diff > 0) {
        el.csLeadValue.textContent = `+${diff} CS`;
        el.csLeadValue.style.color = "#28a745";
        el.csLeadValue.className = "glowing-text-green";
        
        const alertKey15 = "cs_lead_15";
        const alertKey30 = "cs_lead_30";
        
        if (diff >= 30) {
            if (state.spokenObjectives && !state.spokenObjectives.has(alertKey30)) {
                state.spokenObjectives.add(alertKey30);
                speak(`Incredible farming. You have a massive thirty creep score lead over ${oppName}.`);
            }
        } else if (diff >= 15) {
            if (state.spokenObjectives && !state.spokenObjectives.has(alertKey15)) {
                state.spokenObjectives.add(alertKey15);
                speak(`Excellent. You have a fifteen creep score lead over ${oppName}.`);
            }
        }
    } else if (diff < 0) {
        el.csLeadValue.textContent = `${diff} CS`;
        el.csLeadValue.style.color = "#dc3545";
        el.csLeadValue.className = "";
    } else {
        el.csLeadValue.textContent = "Even";
        el.csLeadValue.style.color = "var(--text-muted)";
        el.csLeadValue.className = "";
    }
    
    el.csLeadDetails.textContent = `${myCs} vs ${oppCs} CS (${oppName})`;
}

// Gold Recall Buy Advisor
function renderGoldRecallAdvisor(activePlayer) {
    if (!activePlayer || !el.goldRecallBlock || !el.goldRecallText) return;
    
    const currentGold = activePlayer.gold || 0;
    
    let advice = "";
    if (currentGold >= 1300) {
        advice = "🛒 B.F. Sword, Lost Chapter, or Noonquiver buy window reached. Optimal recall timing!";
    } else if (currentGold >= 1100) {
        advice = "🛒 Serrated Dirk, Caulfield's Warhammer, or Sorcerer's Shoes buy window reached. Good recall timing!";
    }
    
    if (advice) {
        el.goldRecallBlock.classList.remove("hidden");
        el.goldRecallText.innerHTML = `<strong>Recall Window:</strong> ${advice} (Current Gold: ${currentGold.toLocaleString()} G)`;
        
        const alertKey = `gold_recall_${Math.floor(currentGold / 100) * 100}`;
        if (state.spokenObjectives && !state.spokenObjectives.has(alertKey)) {
            state.spokenObjectives.add(alertKey);
            speak("Optimal gold buy window reached. Consider recalling.");
        }
    } else {
        el.goldRecallBlock.classList.add("hidden");
    }
}

// Loading Screen Matchup Advisor
function renderLoadingScreenAdvisor() {
    if (!el.loadingStartItems || !el.loadingStartAdvice || !el.loadingLaneTips) return;
    
    const startItems = [
        { name: "Doran's Shield", img: "https://ddragon.leagueoflegends.com/cdn/13.24.1/img/item/1054.png" },
        { name: "Doran's Blade", img: "https://ddragon.leagueoflegends.com/cdn/13.24.1/img/item/1055.png" },
        { name: "Doran's Ring", img: "https://ddragon.leagueoflegends.com/cdn/13.24.1/img/item/1056.png" }
    ];
    
    let activeItem = startItems[0];
    let advice = "Doran's Shield is recommended against heavy poke and ranged match-ups to sustain lane pressure.";
    
    const activeChamp = state.activeChampion ? state.activeChampion.toLowerCase() : "";
    if (activeChamp) {
        const mageChamps = ["sona", "ahri", "lux", "veigar", "xerath", "anivia", "syndra", "orianna"];
        const bladeChamps = ["yasuo", "yone", "zed", "talon", "riven", "irelia", "jax", "fiora"];
        
        if (mageChamps.includes(activeChamp)) {
            activeItem = startItems[2];
            advice = "Doran's Ring is optimal for spell-based trading, giving you bonus health and mana regeneration on minion kills.";
        } else if (bladeChamps.includes(activeChamp)) {
            activeItem = startItems[1];
            advice = "Doran's Blade is optimal for physical fighters, giving you health, attack damage, and life steal for early skirmishes.";
        }
    }
    
    el.loadingStartItems.innerHTML = `
        <div class="hud-inventory-node" title="${activeItem.name}" style="width: 42px; height: 42px; border: 1px solid var(--color-gold);">
            <img src="${activeItem.img}" alt="${activeItem.name}" style="width: 100%; height: 100%;">
        </div>
        <span style="font-size: 11px; font-weight: 700; color: var(--text-primary);">${activeItem.name}</span>
    `;
    el.loadingStartAdvice.textContent = advice;
    
    el.loadingLaneTips.innerHTML = "";
    if (state.activeTips && state.activeTips.length > 0) {
        state.activeTips.forEach(tip => {
            const li = document.createElement("li");
            li.style.marginBottom = "6px";
            li.textContent = tip;
            el.loadingLaneTips.appendChild(li);
        });
    } else {
        el.loadingLaneTips.innerHTML = `
            <li style="margin-bottom: 6px;">Focus on securing early level 2 priority in lane (first minion wave plus three melee minions).</li>
            <li style="margin-bottom: 6px;">Ward the river brush around 2:30 to reveal early jungler scuttle crab rotations.</li>
            <li style="margin-bottom: 6px;">Manage your minion waves to set up freezes near your tower when vulnerable to ganks.</li>
        `;
    }
}

// Pre-Lock Draft Coach Briefing
function renderPreLockBriefing(championName, role, stats) {
    if (!el.briefingWinrateBadge || !el.briefingBanName || !el.briefingAdviceText || !el.briefingThreatsList) return;
    
    // 1. Get winrate
    let wr = 50.0;
    if (stats) {
        wr = parseFloat(stats.win_rate || stats.winrate || 50.0);
    }
    
    // 2. Format Winrate Badge
    el.briefingWinrateBadge.textContent = `Hovering ${championName} (Winrate: ${wr.toFixed(1)}%)`;
    el.briefingWinrateBadge.className = "badge-accent";
    if (wr >= 51.5) {
        el.briefingWinrateBadge.style.background = "rgba(40, 167, 69, 0.15)";
        el.briefingWinrateBadge.style.color = "#28a745";
        el.briefingWinrateBadge.style.border = "1px solid #28a745";
    } else if (wr < 48.0) {
        el.briefingWinrateBadge.style.background = "rgba(220, 53, 69, 0.15)";
        el.briefingWinrateBadge.style.color = "#dc3545";
        el.briefingWinrateBadge.style.border = "1px solid #dc3545";
    } else {
        el.briefingWinrateBadge.style.background = "rgba(255, 193, 7, 0.15)";
        el.briefingWinrateBadge.style.color = "#ffc107";
        el.briefingWinrateBadge.style.border = "1px solid #ffc107";
    }
    
    // 3. Extract Counters list
    let counters = [];
    if (stats && stats.counters) {
        counters = stats.counters;
    } else if (stats && stats.worst_matchups) {
        counters = stats.worst_matchups;
    }
    
    const sortedCounters = [...counters].sort((a, b) => a.winrate - b.winrate);
    
    let worstCounterName = "None";
    if (sortedCounters.length > 0) {
        worstCounterName = sortedCounters[0].name;
        el.briefingBanName.textContent = worstCounterName;
    } else {
        el.briefingBanName.textContent = "None";
    }
    
    // 4. Voice Coach ban suggestion (once per champion hover)
    const hoverKey = `${championName}_hover`;
    if (state.lastHoveredChampion !== hoverKey) {
        state.lastHoveredChampion = hoverKey;
        
        let alertMsg = `You are preselecting ${championName}.`;
        if (worstCounterName !== "None") {
            alertMsg += ` ${worstCounterName} is your worst counter matchup. Consider banning them.`;
        } else {
            alertMsg += ` No major lane threats detected in our database.`;
        }
        speak(alertMsg);
    }
    
    // 5. Pick winrate advice text
    let adviceText = "";
    if (wr >= 51.5) {
        adviceText = `<strong>Pick Rating: Safe.</strong> ${championName} currently holds a strong ${wr.toFixed(1)}% winrate in the ${role} role. This is a reliable pick. Ensure you ban ${worstCounterName} to secure your lane.`;
    } else if (wr < 48.0) {
        adviceText = `<strong>Pick Rating: High Risk.</strong> ${championName} has a sub-optimal ${wr.toFixed(1)}% winrate in the ${role} role. You are highly vulnerable to lane counters like ${worstCounterName}. If picked early, they can easily counter-pick you.`;
    } else {
        adviceText = `<strong>Pick Rating: Balanced.</strong> ${championName} is a stable ${wr.toFixed(1)}% winrate pick. Watch out for enemy locks and focus on scaling. Consider banning ${worstCounterName} to block counter compositions.`;
    }
    el.briefingAdviceText.innerHTML = adviceText;
    
    // 6. Populates worst counters list
    el.briefingThreatsList.innerHTML = "";
    const topThreats = sortedCounters.slice(0, 3);
    if (topThreats.length > 0) {
        topThreats.forEach(t => {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.justifyContent = "space-between";
            row.style.fontSize = "11px";
            row.style.color = "var(--text-secondary)";
            
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${t.image || ''}" alt="${t.name}" style="width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--border-light);">
                    <span>${t.name}</span>
                </div>
                <span style="color: #dc3545; font-weight: 700;">${t.winrate.toFixed(1)}% Win</span>
            `;
            el.briefingThreatsList.appendChild(row);
        });
    } else {
        el.briefingThreatsList.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">No threat data found.</span>`;
    }
}

