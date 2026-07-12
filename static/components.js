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
    
    const mergedRunes = {
        primary_style: { ...uggRunes.primary_style },
        sub_style: { ...uggRunes.sub_style },
        perks: [],
        shards: [],
        primary_style_id: uggRunes.primary_style ? uggRunes.primary_style.id : (uggRunes.primary_style_id || 0),
        sub_style_id: uggRunes.sub_style ? uggRunes.sub_style.id : (uggRunes.sub_style_id || 0),
        perk_ids: uggRunes.perk_ids ? [...uggRunes.perk_ids] : (uggRunes.perks ? uggRunes.perks.map(p => p.id) : []),
        shard_ids: uggRunes.shard_ids ? [...uggRunes.shard_ids] : (uggRunes.shards ? uggRunes.shards.map(s => s.id) : []),
        champion: uggRunes.champion
    };
    
    mergedRunes.primary_style.consensus = (uggRunes.primary_style.id === opggRunes.primary_style.id);
    mergedRunes.sub_style.consensus = (uggRunes.sub_style.id === opggRunes.sub_style.id);
    
    // Merge individual perks
    uggRunes.perks.forEach((uggRune, idx) => {
        const opggRune = opggRunes.perks[idx];
        const isConsensus = opggRune && (uggRune.id === opggRune.id);
        mergedRunes.perks.push({
            ...uggRune,
            consensus: isConsensus
        });
    });
    
    // Merge shards
    uggRunes.shards.forEach((uggShard, idx) => {
        const opggShard = opggRunes.shards[idx];
        const isConsensus = opggShard && (uggShard.id === opggShard.id);
        mergedRunes.shards.push({
            ...uggShard,
            consensus: isConsensus
        });
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

// RENDER DASHBOARD CORE
function renderDashboard(data) {
    state.displayedData = data;
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
        const pStyle = runes.primary_style || {};
        el.primaryPathIcon.src = pStyle.icon || "";
        el.primaryPathName.textContent = pStyle.name || "";
        el.primaryRunesList.innerHTML = "";
        
        if (runes.perks) {
            runes.perks.slice(0, 4).forEach((rune, idx) => {
                const row = document.createElement("div");
                row.className = idx === 0 ? "rune-row-node keystone" : "rune-row-node";
                if (rune.consensus) row.classList.add("consensus-rune");
                row.innerHTML = `
                    <div class="rune-icon-circle">
                        <img src="${rune.icon || ''}" alt="${rune.name || ''}">
                    </div>
                    <span>${rune.name || ''}</span>
                `;
                el.primaryRunesList.appendChild(row);
            });
        }
        
        // Secondary Path
        const sStyle = runes.sub_style || {};
        el.secondaryPathIcon.src = sStyle.icon || "";
        el.secondaryPathName.textContent = sStyle.name || "";
        el.secondaryRunesList.innerHTML = "";
        
        if (runes.perks && runes.perks.length > 4) {
            runes.perks.slice(4).forEach(rune => {
                const row = document.createElement("div");
                row.className = "rune-row-node";
                if (rune.consensus) row.classList.add("consensus-rune");
                row.innerHTML = `
                    <div class="rune-icon-circle">
                        <img src="${rune.icon || ''}" alt="${rune.name || ''}">
                    </div>
                    <span>${rune.name || ''}</span>
                `;
                el.secondaryRunesList.appendChild(row);
            });
        }
        
        // Shards
        el.shardsList.innerHTML = "";
        if (runes.shards) {
            runes.shards.forEach(shard => {
                const node = document.createElement("div");
                node.className = "shard-node";
                if (shard.consensus) node.classList.add("consensus-rune");
                node.innerHTML = `<img src="${shard.icon || ''}" alt="${shard.name || ''}" title="${shard.name || ''}">`;
                el.shardsList.appendChild(node);
            });
        }
        
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
            const skillMap = {1: "Q", 2: "W", 3: "E", 4: "R"};
            data.build.skill_path.forEach((skill, idx) => {
                const node = document.createElement("div");
                const letter = typeof skill === 'number' ? (skillMap[skill] || skill) : skill;
                const skillClass = `skill-${String(letter).toLowerCase()}`;
                node.className = `skill-path-node ${skillClass}`;
                node.innerHTML = `
                    <span class="node-lvl">${idx + 1}</span>
                    <span class="node-letter">${letter}</span>
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
        
        // Cache parsed runes metadata so we can trigger auto-import
        state.displayedRunes = {
            champion: champName,
            primary_style_id: runes.primary_style ? runes.primary_style.id : (runes.primary_style_id || 0),
            sub_style_id: runes.sub_style ? runes.sub_style.id : (runes.sub_style_id || 0),
            perk_ids: runes.perks ? runes.perks.map(p => p.id) : (runes.perk_ids || []),
            shard_ids: runes.shards ? runes.shards.map(s => s.id) : (runes.shard_ids || [])
        };
        
        if (state.connected && el.importRunesBtn) {
            el.importRunesBtn.disabled = false;
        }
    } else {
        el.primaryRunesList.innerHTML = "<p class='subtext text-muted'>No build details available</p>";
        el.secondaryRunesList.innerHTML = "";
        el.shardsList.innerHTML = "";
        el.summonersList.innerHTML = "";
        el.skillsPriorityText.textContent = "-";
        el.skillPathRow.innerHTML = "";
        el.startingItemsList.innerHTML = "";
        el.coreItemsList.innerHTML = "";
        el.situationalItemsList.innerHTML = "";
        
        state.displayedRunes = null;
        if (el.importRunesBtn) el.importRunesBtn.disabled = true;
    }
    
    // 3. Render Matchup Counters
    el.countersList.innerHTML = "";
    if (data.counters && data.counters.length > 0) {
        // Handle sorting filters
        const activeFilter = state.matchupFilter; // "worst" vs "best"
        const sortedCounters = [...data.counters].sort((a, b) => {
            return activeFilter === "worst" ? a.win_rate - b.win_rate : b.win_rate - a.win_rate;
        });
        
        sortedCounters.forEach(c => {
            const row = document.createElement("div");
            row.className = "counter-row-item";
            
            const wr = c.win_rate <= 1.0 ? c.win_rate * 100 : c.win_rate;
            let wrClass = "wr-neutral";
            if (activeFilter === "worst") {
                if (wr < 48.0) wrClass = "wr-bad";
                else if (wr >= 51.5) wrClass = "wr-good";
            } else {
                if (wr >= 51.5) wrClass = "wr-good";
                else if (wr < 48.0) wrClass = "wr-bad";
            }
            
            // Render gold advantage info if available
            let goldHtml = "";
            if (c.gold_adv_15 !== undefined && c.gold_adv_15 !== 0) {
                const isLead = c.gold_adv_15 > 0;
                const leadClass = isLead ? "counter-stat-pill stat-lead" : "counter-stat-pill stat-behind";
                const leadText = isLead ? `+${c.gold_adv_15} G` : `${c.gold_adv_15} G`;
                goldHtml = `<span class="${leadClass}" title="Gold diff at 15 minutes">${leadText}</span>`;
            }
            
            // Render source badges if merged
            let sourceBadgeHtml = "";
            if (data.is_merged && c.sources) {
                if (c.sources.includes("ugg") && c.sources.includes("opgg")) {
                    sourceBadgeHtml = `<span class="source-badge both">Both</span>`;
                } else {
                    const src = c.sources[0];
                    sourceBadgeHtml = `<span class="source-badge ${src}">${src}</span>`;
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

// Render stats for the active data source
function renderActiveSourceStats() {
    let data = null;
    if (state.activeSource === "opgg") {
        data = state.statsOpgg;
    } else if (state.activeSource === "ugg") {
        data = state.statsUgg;
    } else if (state.activeSource === "merged") {
        data = getMergedStats();
    } else if (state.activeSource === "custom") {
        if (state.customBuild && state.customBuild.champion === state.activeChampion && state.customBuild.role === state.activeRole) {
            data = state.customBuild;
        } else if (state.activeChampion) {
            fetch(`/api/custom-build?champion=${encodeURIComponent(state.activeChampion)}&role=${encodeURIComponent(state.activeRole)}`)
            .then(res => res.json())
            .then(res => {
                if (res && (res.build || res.starting_items)) {
                    const buildData = res.build ? res.build : res;
                    state.customBuild = {
                        champion: state.activeChampion,
                        role: state.activeRole,
                        build: buildData,
                        counters: res.counters || []
                    };
                    renderDashboard(state.customBuild);
                } else {
                    showWaitingScreen(`No custom build found. Customize items/runes, and click 'Save as My Build' to save one!`);
                }
            })
            .catch(err => {
                console.error("Error fetching custom build:", err);
                showWaitingScreen(`Failed to fetch custom build.`);
            });
            return;
        }
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
    
    el.allyDamageRatio.textContent = `${allyAd}% AD / ${allyAp}% AP`;
    el.enemyDamageRatio.textContent = `${enemyAd}% AD / ${enemyAp}% AP`;
    
    el.allyAdBar.style.width = `${allyAd}%`;
    el.allyApBar.style.width = `${allyAp}%`;
    el.enemyAdBar.style.width = `${enemyAd}%`;
    el.enemyApBar.style.width = `${enemyAp}%`;
}

function renderLobbyAndMatchmaking(data, phase) {
    if (!el.lobbyMatchmakingStatus) return;

    if (!data || (!data.members || data.members.length === 0)) {
        el.lobbyMatchmakingStatus.classList.add("hidden");
        return;
    }

    el.lobbyMatchmakingStatus.classList.remove("hidden");

    if (el.lobbyPhaseBadge) {
        let phaseText = phase || "Lobby";
        if (phase === "Matchmaking") phaseText = "In Queue";
        else if (phase === "ReadyCheck") phaseText = "Match Ready!";
        el.lobbyPhaseBadge.textContent = phaseText;
    }

    if (el.queueSearchInfo) {
        if (data.search_state === "Searching") {
            el.queueSearchInfo.classList.remove("hidden");
            if (el.queueSearchName) el.queueSearchName.textContent = getQueueName(data.queue_id);
            if (el.queueSearchTime) el.queueSearchTime.textContent = formatTime(data.time_in_queue);
            if (el.queueSearchEstimated) el.queueSearchEstimated.textContent = formatTime(data.estimated_queue_time);
            
            if (el.queueSearchProgressBar) {
                const pct = data.estimated_queue_time > 0 ? Math.min(100, (data.time_in_queue / data.estimated_queue_time) * 100) : 0;
                el.queueSearchProgressBar.style.width = `${pct}%`;
            }
        } else {
            el.queueSearchInfo.classList.add("hidden");
        }
    }

    if (el.lobbyMembersList) {
        el.lobbyMembersList.innerHTML = "";
        data.members.forEach(member => {
            const memberRow = document.createElement("div");
            memberRow.style.display = "flex";
            memberRow.style.alignItems = "center";
            memberRow.style.justifyContent = "space-between";
            memberRow.style.padding = "8px 12px";
            memberRow.style.background = "rgba(255,255,255,0.02)";
            memberRow.style.border = "1px solid var(--border-light)";
            memberRow.style.borderRadius = "6px";

            const tierClass = member.rank_tier ? member.rank_tier.toUpperCase() : "UNRANKED";
            const division = member.rank_division || "";
            const lp = member.rank_lp || 0;
            const level = member.level || 1;
            const firstIcon = getPositionIcon(member.first_pos);
            const secondIcon = getPositionIcon(member.second_pos);

            memberRow.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: rgba(0,0,0,0.3); border: 1px solid var(--border-light); display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--color-gold); font-weight: 700;">
                        ${member.name ? member.name.charAt(0).toUpperCase() : "S"}
                    </div>
                    <div>
                        <div style="font-size: 12px; font-weight: 700; color: var(--text-primary);">${member.name}</div>
                        <div style="font-size: 9px; color: var(--text-muted);">Level ${level}</div>
                    </div>
                </div>
                
                <div style="font-size: 11px; font-weight: 600; color: var(--color-gold-bright); text-align: center;">
                    ${tierClass !== "UNRANKED" ? `${tierClass} ${division} <span style="font-size: 9px; color: var(--text-muted); font-weight: 400;">(${lp} LP)</span>` : "Unranked"}
                </div>
                
                <div style="display: flex; gap: 6px; align-items: center;">
                    ${firstIcon ? `<img src="${firstIcon}" title="Primary: ${member.first_pos}" style="width: 20px; height: 20px; opacity: 0.9;">` : `<span style="font-size: 9px; color: var(--text-muted);">-</span>`}
                    ${secondIcon ? `<img src="${secondIcon}" title="Secondary: ${member.second_pos}" style="width: 20px; height: 20px; opacity: 0.6;">` : ""}
                </div>
            `;
            el.lobbyMembersList.appendChild(memberRow);
        });
    }
}

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

const activeSpellTimers = {};

function renderInGameHUD(enemies) {
    if (!enemies || enemies.length === 0) {
        el.hudEnemiesList.innerHTML = `<p class="subtext text-muted" style="text-align: center; padding: 30px;">Waiting for active game session data...</p>`;
        return;
    }
    
    const checkboxStates = {};
    document.querySelectorAll(".haste-toggle").forEach(cb => {
        checkboxStates[cb.id] = cb.checked;
    });
    
    el.hudEnemiesList.innerHTML = "";
    
    enemies.forEach(enemy => {
        const row = document.createElement("div");
        row.className = "hud-enemy-row";
        
        const trackerId = `haste_${enemy.name.replace(/\s/g, "")}`;
        
        let hasPenetration = false;
        let penType = "";
        const penItemIds = [
            3135, 3137, 3020, // magic pen
            3036, 3033, 3035, 3302, // armor pen
            6676, 3142, 6701, 6706, 3814, 6675, 6692, 6695, 6696, 3179 // lethality
        ];
        if (enemy.items) {
            enemy.items.forEach(item => {
                if (penItemIds.includes(parseInt(item.id))) {
                    hasPenetration = true;
                    if ([3135, 3137, 3020].includes(parseInt(item.id))) {
                        penType = "Magic Pen";
                    } else {
                        penType = "Armor Pen/Lethality";
                    }
                }
            });
        }
        
        const penBadge = hasPenetration ? `<span class="badge-accent" style="margin-left: 8px; font-size: 9px; padding: 1px 6px; background: rgba(220, 53, 69, 0.15); border: 1px solid #dc3545; color: #dc3545; font-weight: 800;" title="${penType} items purchased!"><i class="fa-solid fa-burst"></i> PEN PROBED</span>` : "";
        
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
        
        // Restore checkbox states if they were set manually
        const lucidityCb = row.querySelector(`#${trackerId}_lucidity`);
        const insightCb = row.querySelector(`#${trackerId}_insight`);
        if (lucidityCb && checkboxStates[lucidityCb.id] !== undefined && !enemy.has_lucidity) {
            lucidityCb.checked = checkboxStates[lucidityCb.id];
        }
        if (insightCb && checkboxStates[insightCb.id] !== undefined) {
            insightCb.checked = checkboxStates[insightCb.id];
        }
        
        // Bind event listeners for haste updates
        const updateHaste = () => {
            let haste = 0;
            if (enemy.has_lucidity) haste += 12;
            else if (lucidityCb && lucidityCb.checked) haste += 12;
            
            if (insightCb && insightCb.checked) haste += 18;
            
            drawSpellButton(enemy, 1, enemy.spell1_id, haste);
            drawSpellButton(enemy, 2, enemy.spell2_id, haste);
        };
        
        if (lucidityCb) lucidityCb.addEventListener("change", updateHaste);
        if (insightCb) insightCb.addEventListener("change", updateHaste);
        
        // Initial draw
        let initialHaste = enemy.has_lucidity ? 12 : 0;
        if (insightCb && insightCb.checked) initialHaste += 18;
        
        drawSpellButton(enemy, 1, enemy.spell1_id, initialHaste);
        drawSpellButton(enemy, 2, enemy.spell2_id, initialHaste);
        drawUltimateButton(enemy);
    });
}

function drawSpellButton(enemy, slotIdx, spellId, extraHaste) {
    const containerId = `spell-btn_${enemy.name.replace(/\s/g, "")}_${slotIdx}`;
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = "";
    
    const spell = summonerSpellsData[spellId] || { name: "Unknown", file: "SummonerDot", cd: 180 };
    const baseCd = spell.cd;
    const cooldownReduction = extraHaste / (100 + extraHaste);
    const finalCd = Math.round(baseCd * (1 - cooldownReduction));
    
    const btn = document.createElement("button");
    btn.className = "hud-spell-btn";
    btn.title = `Click to start CD for ${spell.name} (Haste: +${extraHaste}, CD: ${finalCd}s)`;
    btn.innerHTML = `
        <img src="https://ddragon.leagueoflegends.com/cdn/${state.ddVersion || '14.13.1'}/img/spell/${spell.file}.png" alt="${spell.name}">
        <div class="cd-overlay">
            <span class="cd-text"></span>
        </div>
    `;
    
    btn.addEventListener("click", () => {
        const timerKey = `${enemy.name.replace(/\s/g, "")}_${spellId}`;
        
        if (activeSpellTimers[timerKey]) {
            clearInterval(activeSpellTimers[timerKey].interval);
            delete activeSpellTimers[timerKey];
            btn.classList.remove("on-cooldown");
            btn.title = `Click to start CD for ${spell.name}`;
            return;
        }
        
        let cdSeconds = finalCd;
        btn.classList.add("on-cooldown");
        btn.title = `${spell.name} on cooldown! Click to cancel.`;
        
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
    
    const timerKey = `${enemy.name.replace(/\s/g, "")}_${spellId}`;
    const active = activeSpellTimers[timerKey];
    if (active) {
        const remaining = Math.round((active.endTime - Date.now()) / 1000);
        if (remaining > 0) {
            btn.classList.add("on-cooldown");
            btn.title = `Spell on cooldown! Click to cancel.`;
            const text = btn.querySelector(".cd-text");
            text.textContent = `${remaining}s`;
            
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
let lastBaronKillTime = null;

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
            } else if (evt.EventName === "BaronKill") {
                const deathTime = evt.EventTime;
                if (!lastBaronKillTime || deathTime > lastBaronKillTime) {
                    lastBaronKillTime = deathTime;
                }
            }
            
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
    
    // 2. Void Grubs (8:00 to 13:45)
    let grubsStatus = "";
    let grubsTimeLeft = 0;
    if (gameTime < 480) {
        grubsTimeLeft = 480 - gameTime;
        grubsStatus = `Spawns at 8:00 (${formatTime(grubsTimeLeft)})`;
    } else if (gameTime >= 480 && gameTime < 825) {
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
    } else if (lastBaronKillTime) {
        const nextSpawn = lastBaronKillTime + 360;
        if (gameTime < nextSpawn) {
            baronTimeLeft = nextSpawn - gameTime;
            baronStatus = `Spawns in ${formatTime(baronTimeLeft)}`;
        } else {
            baronStatus = "Alive / Active";
        }
    } else {
        baronStatus = "Alive / Active";
    }
    objectives.push({ name: "Baron Nashor", status: baronStatus, timeLeft: baronTimeLeft, icon: "fa-skull" });
    
    // 5. Cannon Wave recall helper
    const nextCannonTime = getNextCannonWaveTime(gameTime);
    const waveTimeLeft = nextCannonTime - gameTime;
    const waveMsg = `Next Cannon Wave in ${formatTime(waveTimeLeft)} (at ${formatTime(nextCannonTime)})`;
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
            if (obj.timeLeft >= 55) {
                const alertKey = `${obj.name}_60s`;
                if (state.spokenObjectives && !state.spokenObjectives.has(alertKey)) {
                    state.spokenObjectives.add(alertKey);
                    speak(`${obj.name} is spawning in sixty seconds.`);
                }
            } else if (obj.timeLeft >= 12 && obj.timeLeft <= 18) {
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
        const apChamps = ["Ahri", "Akali", "Anivia", "Annie", "AurelionSol", "Azir", "Brand", "Cassiopeia", "Diana", "Elise", "Evelynn", "Fiddlesticks", "Fizz", "Galio", "Gragas", "Gwen", "Heimerdinger", "Karthus", "Kassadin", "Katarina", "Kayle", "Kennen", "Leblanc", "Lillia", "Lissandra", "Lulu", "Lux", "Malzahar", "Mordekaiser", "Morgana", "Neeko", "Nidalee", "Nunu", "Orianna", "Rumble", "Ryze", "Singed", "Swain", "Syndra", "Taliyah", "Teemo", "Vex", "Viktor", "Vladimir", "Xerath", "Ziggs", "Zoe", "Zyra", "Sona", "Soraka", "Janna", "Karma", "Nami", "Taric", "Yuumi", "Zilean", "Bard", "Milio", "RenataGlasc"];
        
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

function renderLoadingScreenAdvisor() {
    if (!el.loadingStartItems || !el.loadingStartAdvice || !el.loadingLaneTips) return;
    
    const startItems = [
        { name: "Doran's Shield", img: `https://ddragon.leagueoflegends.com/cdn/${state.ddVersion || '14.13.1'}/img/item/1054.png` },
        { name: "Doran's Blade", img: `https://ddragon.leagueoflegends.com/cdn/${state.ddVersion || '14.13.1'}/img/item/1055.png` },
        { name: "Doran's Ring", img: `https://ddragon.leagueoflegends.com/cdn/${state.ddVersion || '14.13.1'}/img/item/1056.png` }
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

function renderPreLockBriefing(championName, role, stats) {
    if (!el.briefingWinrateBadge || !el.briefingBanName || !el.briefingAdviceText || !el.briefingThreatsList) return;
    
    let wr = 50.0;
    if (stats) {
        wr = parseFloat(stats.win_rate || stats.winrate || 50.0);
    }
    
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
    
    let counters = [];
    if (stats && stats.counters) {
        counters = stats.counters;
    } else if (stats && stats.worst_matchups) {
        counters = stats.worst_matchups;
    }
    
    const sortedCounters = [...counters].sort((a, b) => {
        const aWr = a.win_rate !== undefined ? a.win_rate : (a.winrate !== undefined ? a.winrate : 50.0);
        const bWr = b.win_rate !== undefined ? b.win_rate : (b.winrate !== undefined ? b.winrate : 50.0);
        return aWr - bWr;
    });
    
    let worstCounterName = "None";
    if (sortedCounters.length > 0) {
        worstCounterName = sortedCounters[0].name;
        el.briefingBanName.textContent = worstCounterName;
    } else {
        el.briefingBanName.textContent = "None";
    }
    
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
    
    let adviceText = "";
    if (wr >= 51.5) {
        adviceText = `<strong>Pick Rating: Safe.</strong> ${championName} currently holds a strong ${wr.toFixed(1)}% winrate in the ${role} role. This is a reliable pick. Ensure you ban ${worstCounterName} to secure your lane.`;
    } else if (wr < 48.0) {
        adviceText = `<strong>Pick Rating: High Risk.</strong> ${championName} has a sub-optimal ${wr.toFixed(1)}% winrate in the ${role} role. You are highly vulnerable to lane counters like ${worstCounterName}. If picked early, they can easily counter-pick you.`;
    } else {
        adviceText = `<strong>Pick Rating: Balanced.</strong> ${championName} is a stable ${wr.toFixed(1)}% winrate pick. Watch out for enemy locks and focus on scaling. Consider banning ${worstCounterName} to block counter compositions.`;
    }
    el.briefingAdviceText.innerHTML = adviceText;
    
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
            
            const tWr = t.win_rate !== undefined ? t.win_rate : (t.winrate !== undefined ? t.winrate : 50.0);
            const displayWr = tWr <= 1.0 ? tWr * 100 : tWr;
            
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <img src="${t.image || ''}" alt="${t.name}" style="width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--border-light);">
                    <span>${t.name}</span>
                </div>
                <span style="color: #dc3545; font-weight: 700;">${displayWr.toFixed(1)}% Win</span>
            `;
            el.briefingThreatsList.appendChild(row);
        });
    } else {
        el.briefingThreatsList.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">No threat data found.</span>`;
    }
}

function showPostGameReport(lastGame) {
    if (!lastGame || !el.postGameModal) return;
    
    el.postGameHeroName.textContent = lastGame.championName;
    el.postGameHeroImg.src = lastGame.championImage;
    
    const minutes = lastGame.game_time / 60;
    const csMin = (lastGame.active_player.cs / minutes).toFixed(1);
    el.postGameCsMin.textContent = `${csMin} CS/min`;
    
    const isSupport = state.activeRole === "support" || state.activeRole === "utility";
    
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
    
    el.postGameDuration.textContent = formatTime(lastGame.game_time);
    
    const finalGold = lastGame.active_player.net_worth || lastGame.active_player.gold || 0;
    el.postGameGold.textContent = `${finalGold.toLocaleString()} G`;
    
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
    
    el.postGameModal.classList.remove("hidden");

    let win = true;
    if (lastGame.events) {
        const gameEnd = lastGame.events.find(e => e.EventName === "GameEnd");
        if (gameEnd && gameEnd.Result) {
            win = gameEnd.Result.toLowerCase() === "win" || gameEnd.Result.toLowerCase().includes("victory");
        }
    }

    fetch("/api/match-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            champion: lastGame.championName,
            role: state.activeRole,
            cs_min: parseFloat(csMin),
            gold_spent: finalGold,
            duration_sec: Math.floor(lastGame.game_time),
            win: win
        })
    })
    .then(() => {
        loadMatchHistory();
    })
    .catch(err => console.error("Error saving match history:", err));
}
