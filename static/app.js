// Initialize Application
async function init() {
    setupEventListeners();
    await fetchChampionsList();
    await loadSettingsFromServer();
    await setupConnectionQR();
    connectWebSocket();
    checkUpdateOnStartup();
    loadMatchHistory();
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
            
            el.roleButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            state.activeRole = role;
            
            if (state.activeChampion) {
                triggerStatsLookup(state.activeChampion, state.activeRole);
            }
            loadMatchHistory();
        });
    });

    // Save Custom Build Override Button
    if (el.saveBuildBtn) {
        el.saveBuildBtn.addEventListener("click", handleSaveCustomBuild);
    }
    
    // Trigger Auto Update Button
    if (el.triggerUpdateBtn) {
        el.triggerUpdateBtn.addEventListener("click", handleTriggerUpdate);
    }

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

    // Build Optimizer Modal Event Listeners
    if (el.optimizerToggleBtn && el.optimizerModal) {
        el.optimizerToggleBtn.addEventListener("click", () => {
            if (state.activeChampion) {
                el.optimizerChampSearch.value = state.activeChampion;
            } else {
                el.optimizerChampSearch.value = "Ahri";
            }
            el.optimizerRoleSelect.value = state.activeRole || "mid";
            el.optimizerModal.classList.remove("hidden");
        });
    }

    if (el.closeOptimizerBtn && el.optimizerModal) {
        el.closeOptimizerBtn.addEventListener("click", () => {
            el.optimizerModal.classList.add("hidden");
        });
    }

    const optStatCards = document.querySelectorAll(".opt-stat-card");
    optStatCards.forEach(card => {
        card.addEventListener("click", () => {
            optStatCards.forEach(c => c.classList.remove("active"));
            card.classList.add("active");
        });
    });

    if (el.optimizerChampSearch && el.optimizerAutocomplete) {
        el.optimizerChampSearch.addEventListener("input", () => {
            const val = el.optimizerChampSearch.value.trim().toLowerCase();
            if (!val) {
                el.optimizerAutocomplete.classList.add("hidden");
                el.optimizerAutocomplete.innerHTML = "";
                return;
            }
            const matches = state.allChampions.filter(c => 
                c.name.toLowerCase().includes(val) || c.key.toLowerCase().includes(val)
            ).slice(0, 8);
            if (matches.length === 0) {
                el.optimizerAutocomplete.classList.add("hidden");
                el.optimizerAutocomplete.innerHTML = "";
                return;
            }
            el.optimizerAutocomplete.innerHTML = "";
            matches.forEach(champ => {
                const item = document.createElement("div");
                item.className = "autocomplete-item";
                item.innerHTML = `
                    <img src="${champ.image}" alt="${champ.name}">
                    <span>${champ.name}</span>
                `;
                item.addEventListener("click", () => {
                    el.optimizerChampSearch.value = champ.name;
                    el.optimizerAutocomplete.classList.add("hidden");
                    el.optimizerAutocomplete.innerHTML = "";
                });
                el.optimizerAutocomplete.appendChild(item);
            });
            el.optimizerAutocomplete.classList.remove("hidden");
        });

        document.addEventListener("click", (e) => {
            if (!el.optimizerChampSearch.contains(e.target) && !el.optimizerAutocomplete.contains(e.target)) {
                el.optimizerAutocomplete.classList.add("hidden");
                el.optimizerAutocomplete.innerHTML = "";
            }
        });
    }

    if (el.calculateOptBuildBtn) {
        el.calculateOptBuildBtn.addEventListener("click", handleCalculateOptimalBuild);
    }

    if (el.optSaveCustomBtn) {
        el.optSaveCustomBtn.addEventListener("click", handleSaveOptimizedBuild);
    }
}

// Start App
window.addEventListener("DOMContentLoaded", init);
