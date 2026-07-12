let currentOptimizedBuild = null;

async function handleCalculateOptimalBuild() {
    const champName = el.optimizerChampSearch.value.trim();
    const role = el.optimizerRoleSelect.value;
    const activeCard = document.querySelector(".opt-stat-card.active");
    const targetStat = activeCard ? activeCard.dataset.stat : "ap";
    const includeBoots = el.optBootsCheckbox.checked;

    if (!champName) {
        alert("Please enter a champion name.");
        return;
    }

    el.calculateOptBuildBtn.disabled = true;
    el.calculateOptBuildBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Calculating...`;

    try {
        const res = await fetch("/api/optimize-build", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_stat: targetStat,
                include_boots: includeBoots
            })
        });

        if (res.ok) {
            const data = await res.json();
            currentOptimizedBuild = {
                champion: champName,
                role: role,
                items: data.items,
                total_gold: data.total_gold,
                total_stat: data.total_stat,
                target_stat: targetStat
            };

            el.optimizerItemsGrid.innerHTML = "";
            data.items.forEach(item => {
                const card = document.createElement("div");
                card.style.background = "rgba(0,0,0,0.3)";
                card.style.border = "1px solid var(--border-light)";
                card.style.borderRadius = "6px";
                card.style.padding = "6px";
                card.style.display = "flex";
                card.style.flexDirection = "column";
                card.style.alignItems = "center";
                card.style.textAlign = "center";
                card.style.gap = "4px";

                let formattedStatVal = item.stat_value.toString();
                if (targetStat === "as") {
                    formattedStatVal = `+${Math.round(item.stat_value * 100)}%`;
                } else if (item.stat_value > 0) {
                    formattedStatVal = `+${item.stat_value}`;
                } else {
                    formattedStatVal = `Utility`;
                }

                card.innerHTML = `
                    <img src="${item.image}" style="width: 36px; height: 36px; border-radius: 4px; border: 1px solid var(--border-light);" alt="${item.name}">
                    <span style="font-size: 8px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; font-weight: 600;" title="${item.name}">${item.name}</span>
                    <span style="font-size: 8px; color: var(--color-gold); font-weight: 700;">${formattedStatVal}</span>
                    <span style="font-size: 7px; color: var(--text-muted);">${item.gold_total}g</span>
                `;
                el.optimizerItemsGrid.appendChild(card);
            });

            let statLabel = targetStat.toUpperCase();
            if (targetStat === "as") {
                statLabel = "Attack Speed";
                el.optResultTotalStat.textContent = `+${Math.round(data.total_stat * 100)}% ${statLabel}`;
            } else {
                if (targetStat === "ap") statLabel = "AP";
                if (targetStat === "ad") statLabel = "AD";
                if (targetStat === "health") statLabel = "HP";
                if (targetStat === "armor") statLabel = "Armor";
                if (targetStat === "mr") statLabel = "MR";
                el.optResultTotalStat.textContent = `+${data.total_stat} ${statLabel}`;
            }

            el.optResultTotalGold.textContent = `${data.total_gold}g`;
            el.optimizerResults.classList.remove("hidden");
        } else {
            alert("Optimization failed.");
        }
    } catch (e) {
        console.error("Optimization error:", e);
        alert("Optimization failed: " + e.message);
    } finally {
        el.calculateOptBuildBtn.disabled = false;
        el.calculateOptBuildBtn.innerHTML = `<i class="fa-solid fa-gears"></i> Calculate Mathematically Optimal Build`;
    }
}

async function handleSaveOptimizedBuild() {
    if (!currentOptimizedBuild) return;

    el.optSaveCustomBtn.disabled = true;
    el.optSaveCustomBtn.textContent = "Saving...";

    try {
        const bootsItem = currentOptimizedBuild.items.find(i => 
            i.name.toLowerCase().includes("boots") || 
            i.name.toLowerCase().includes("greaves") || 
            i.name.toLowerCase().includes("shoes") || 
            i.name.toLowerCase().includes("treads") || 
            i.name.toLowerCase().includes("steelcaps")
        );
        const coreItems = currentOptimizedBuild.items.filter(i => i !== bootsItem);

        // Fallback to active displayed build runes/skills if champion matches
        let runes = {
            primary_style: { name: "Precision", icon: "" },
            sub_style: { name: "Domination", icon: "" },
            perks: [],
            shards: []
        };
        let skills = {
            priority: "Q > W > E",
            path: ["Q", "W", "E", "Q", "Q", "R", "Q", "W", "Q", "W", "R", "W", "W", "E", "E", "R", "E", "E"]
        };
        let starting_items = [
            { id: "1055", name: "Doran's Blade", image: "https://ddragon.leagueoflegends.com/cdn/16.13.1/img/item/1055.png", gold_total: 450 }
        ];

        if (state.displayedData && state.displayedData.build && state.displayedData.champion.toLowerCase() === currentOptimizedBuild.champion.toLowerCase()) {
            if (state.displayedData.build.runes) runes = state.displayedData.build.runes;
            if (state.displayedData.build.skill_priority) skills.priority = state.displayedData.build.skill_priority;
            if (state.displayedData.build.skill_path) skills.path = state.displayedData.build.skill_path;
            if (state.displayedData.build.starting_items) starting_items = state.displayedData.build.starting_items;
        }

        const customBuildPayload = {
            champion: currentOptimizedBuild.champion,
            role: currentOptimizedBuild.role,
            build: {
                champion: currentOptimizedBuild.champion,
                role: currentOptimizedBuild.role,
                skills: skills,
                runes: runes,
                starting_items: starting_items,
                core_items: coreItems.map(i => ({ id: i.id, name: i.name, image: i.image, gold_total: i.gold_total })),
                situational_items: bootsItem ? [
                    { id: bootsItem.id, name: bootsItem.name, image: bootsItem.image, gold_total: bootsItem.gold_total }
                ] : []
            }
        };

        const res = await fetch("/api/custom-builds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(customBuildPayload)
        });

        if (res.ok) {
            state.customBuild = customBuildPayload.build;
            alert(`Successfully saved build for ${currentOptimizedBuild.champion} (${currentOptimizedBuild.role.toUpperCase()})! To apply it, select the "My Build" source tab on the dashboard.`);
            el.optimizerModal.classList.add("hidden");
            
            if (state.activeChampion === currentOptimizedBuild.champion && state.activeRole === currentOptimizedBuild.role) {
                renderDashboard(state.customBuild);
            }
        } else {
            alert("Failed to save build.");
        }
    } catch (e) {
        console.error("Save error:", e);
        alert("Failed to save build: " + e.message);
    } finally {
        el.optSaveCustomBtn.disabled = false;
        el.optSaveCustomBtn.innerHTML = `<i class="fa-solid fa-floppy-disk text-gold"></i> Save generated set as "My Build" for this Champion & Role`;
    }
}
