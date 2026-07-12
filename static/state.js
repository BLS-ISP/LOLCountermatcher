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
    lastHoveredChampion: null,
    
    displayedData: null,
    customBuild: null,
    version: null,
    ddVersion: null,
    sessionId: null
};

// DOM Elements
const el = {
    serverStatusDot: document.getElementById("server-status-dot"),
    serverStatusText: document.getElementById("server-status-text"),
    leagueStatusDot: document.getElementById("league-status-dot"),
    leagueStatusText: document.getElementById("league-status-text"),
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
    
    // Lobby & Matchmaking Status
    lobbyMatchmakingStatus: document.getElementById("lobby-matchmaking-status"),
    lobbyPhaseBadge: document.getElementById("lobby-phase-badge"),
    queueSearchInfo: document.getElementById("queue-search-info"),
    queueSearchName: document.getElementById("queue-search-name"),
    queueSearchTime: document.getElementById("queue-search-time"),
    queueSearchProgressBar: document.getElementById("queue-search-progress-bar"),
    queueSearchEstimated: document.getElementById("queue-search-estimated"),
    lobbyMembersList: document.getElementById("lobby-members-list"),
    
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
    warmupText: document.getElementById("warmup-text"),
    warmupDot: document.getElementById("warmup-dot"),
    
    saveBuildBtn: document.getElementById("save-build-btn"),
    updateBanner: document.getElementById("update-banner"),
    updateVersion: document.getElementById("update-version"),
    triggerUpdateBtn: document.getElementById("trigger-update-btn"),
    avgCsMin: document.getElementById("avg-cs-min"),
    matchHistoryList: document.getElementById("match-history-list"),
    optimizerToggleBtn: document.getElementById("optimizer-toggle-btn"),
    optimizerModal: document.getElementById("build-optimizer-modal"),
    closeOptimizerBtn: document.getElementById("close-optimizer-btn"),
    optimizerChampSearch: document.getElementById("optimizer-champ-search"),
    optimizerAutocomplete: document.getElementById("optimizer-autocomplete"),
    optimizerRoleSelect: document.getElementById("optimizer-role-select"),
    calculateOptBuildBtn: document.getElementById("calculate-opt-build-btn"),
    optimizerResults: document.getElementById("optimizer-results"),
    optimizerItemsGrid: document.getElementById("optimizer-items-grid"),
    optResultTotalStat: document.getElementById("opt-result-total-stat"),
    optResultTotalGold: document.getElementById("opt-result-total-gold"),
    optSaveCustomBtn: document.getElementById("opt-save-custom-btn"),
    optBootsCheckbox: document.getElementById("optimizer-boots-checkbox")
};
