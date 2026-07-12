function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function getNextCannonWaveTime(gameTime) {
    let t = 30; // First wave spawns at 30s
    let idx = 1;
    while (t <= 3600) { // Simulate up to 60 minutes
        let isCannon = false;
        if (t < 900) { // Before 15:00
            isCannon = (idx % 3 === 0);
        } else if (t < 1500) { // 15:00 to 25:00
            isCannon = (idx % 2 === 0);
        } else { // 25:00 onwards
            isCannon = true;
        }

        if (t > gameTime && isCannon) {
            return t;
        }

        // Determine interval to next wave
        let interval = 30;
        if (t >= 1800) { // At 30:00
            interval = 20;
        } else if (t >= 840) { // At 14:00
            interval = 25;
        }
        t += interval;
        idx++;
    }
    return gameTime; // fallback
}

function getQueueName(queueId) {
    const queueMap = {
        400: "Normal Draft",
        420: "Ranked Solo/Duo",
        430: "Normal Blind",
        440: "Ranked Flex",
        450: "ARAM",
        830: "Co-op vs AI Intro",
        840: "Co-op vs AI Beginner",
        850: "Co-op vs AI Intermediate",
        900: "URF",
        1020: "One for All",
        1300: "Nexus Blitz",
        1400: "Ultimate Spellbook",
        1700: "Arena"
    };
    return queueMap[queueId] || "Custom / Unknown Queue";
}

function getPositionIcon(pos) {
    const cleanPos = pos.toLowerCase();
    if (cleanPos === "top" || cleanPos === "toplane" || cleanPos === "first") {
        return "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-top.png";
    }
    if (cleanPos === "jungle") {
        return "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-jungle.png";
    }
    if (cleanPos === "mid" || cleanPos === "middle" || cleanPos === "midlane") {
        return "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-middle.png";
    }
    if (cleanPos === "adc" || cleanPos === "bottom" || cleanPos === "bot") {
        return "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-bottom.png";
    }
    if (cleanPos === "support" || cleanPos === "utility" || cleanPos === "sup") {
        return "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-utility.png";
    }
    if (cleanPos === "fill") {
        return "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-fill.png";
    }
    return null;
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

function resetImportButton() {
    el.importRunesBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Import to Client`;
    el.importRunesBtn.disabled = !state.connected;
    el.importRunesBtn.style.background = "";
    el.importRunesBtn.style.borderColor = "";
}

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
        if (el.leagueStatusDot) {
            el.leagueStatusDot.className = "dot dot-red";
            el.leagueStatusText.textContent = "Closed";
            el.leagueStatusText.style.color = "#dc3545";
        }
        el.summonerDisplay.classList.add("hidden");
    } else {
        const phase = payload.phase;
        if (el.leagueStatusDot) {
            let statusText = "Online";
            let dotClass = "dot dot-green";
            let textColor = "var(--color-green)";
            
            if (phase === "ChampSelect") {
                statusText = "Drafting";
                dotClass = "dot dot-yellow";
                textColor = "var(--color-gold)";
            } else if (phase === "InProgress") {
                statusText = "In Game";
                dotClass = "dot dot-blue";
                textColor = "#1e88e5";
            } else if (phase === "Matchmaking") {
                statusText = "Matchmaking";
                dotClass = "dot dot-yellow";
                textColor = "var(--color-gold)";
            } else if (phase === "ReadyCheck") {
                statusText = "Ready Check";
                dotClass = "dot dot-yellow";
                textColor = "var(--color-gold)";
            } else if (phase === "LoadingScreen") {
                statusText = "Loading Game";
                dotClass = "dot dot-blue";
                textColor = "#1e88e5";
            } else if (phase === "WaitingForStats") {
                statusText = "Post Game";
                dotClass = "dot dot-green";
                textColor = "var(--color-green)";
            } else if (phase === "PreEndOfGame") {
                statusText = "Ending";
                dotClass = "dot dot-green";
                textColor = "var(--color-green)";
            } else if (phase && phase !== "None") {
                statusText = phase.replace(/([A-Z])/g, ' $1').trim();
                dotClass = "dot dot-green";
                textColor = "var(--color-green)";
            } else {
                statusText = "Lobby";
                dotClass = "dot dot-green";
                textColor = "var(--color-green)";
            }
            
            el.leagueStatusDot.className = dotClass;
            el.leagueStatusText.textContent = statusText;
            el.leagueStatusText.style.color = textColor;
        }
    }
}

// Speech queue to prevent overlapping announcements
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
