const { ipcRenderer } = require('electron');

// --- Icon Generation Logic ---
let baseIconImg = new Image();
baseIconImg.src = 'icon.png';

async function updateTaskbarIcon(statusChanged) {
    if (!baseIconImg.complete || baseIconImg.naturalWidth === 0) {
        // Wait for image to load if not ready
        await new Promise(resolve => {
            baseIconImg.onload = resolve;
            baseIconImg.onerror = resolve; // proceed anyway
        });
    }

    const canvas = document.createElement('canvas');
    const size = 64; // arbitrary size for the canvas to ensure good resolution
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Draw base icon
    if (baseIconImg.complete && baseIconImg.naturalWidth > 0) {
        ctx.drawImage(baseIconImg, 0, 0, size, size);
    } else {
        // Fallback if image fails to load
        ctx.fillStyle = '#0a84ff';
        ctx.fillRect(0, 0, size, size);
    }

    // Draw status circle
    const circleRadius = size * 0.22;
    const padding = size * 0.08;
    const cx = size - circleRadius - padding;
    const cy = circleRadius + padding;

    ctx.beginPath();
    ctx.arc(cx, cy, circleRadius, 0, 2 * Math.PI);
    
    if (statusChanged) {
        ctx.fillStyle = '#34C759'; // Green for new info
    } else {
        ctx.fillStyle = '#8E8E93'; // Grey for no new info / viewed
    }
    
    ctx.fill();
    // Add a stroke to make it pop against the icon
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    const dataUrl = canvas.toDataURL('image/png');
    ipcRenderer.send('update-app-icon', dataUrl);
}

const getTzOffsetMins = (tz) => {
    try {
        const d = new Date();
        const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
        const loc = new Date(d.toLocaleString('en-US', { timeZone: tz }));
        return (loc.getTime() - utc.getTime()) / 60000;
    } catch (e) { return 0; }
};

document.addEventListener('DOMContentLoaded', async () => {
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keyStatus = document.getElementById('key-status');

    const flightNumInput = document.getElementById('flight-num-input');
    const searchBtn = document.getElementById('search-flight-btn');
    const searchLoading = document.getElementById('search-loading');
    const searchError = document.getElementById('search-error');
    const resultsContainer = document.getElementById('results-container');
    const resultsList = document.getElementById('results-list');

    const trackedDisplay = document.getElementById('tracked-flight-display');

    // Load saved Data
    const apiKey = await ipcRenderer.invoke('get-store-val', 'apiKey');
    if (apiKey) apiKeyInput.value = apiKey;

    const initialTrack = await ipcRenderer.invoke('get-store-val', 'trackedFlight');
    const initialLatest = await ipcRenderer.invoke('get-store-val', 'latestFlightData');
    updateTrackedDisplay(initialTrack, initialLatest);

    ipcRenderer.on('window-shown', async () => {
        const t = await ipcRenderer.invoke('get-store-val', 'trackedFlight');
        const l = await ipcRenderer.invoke('get-store-val', 'latestFlightData');
        updateTrackedDisplay(t, l);
    });

    ipcRenderer.on('flight-data-updated', async () => {
        const t = await ipcRenderer.invoke('get-store-val', 'trackedFlight');
        const l = await ipcRenderer.invoke('get-store-val', 'latestFlightData');
        updateTrackedDisplay(t, l);

        const lastViewed = await ipcRenderer.invoke('get-store-val', 'lastViewedStatus');
        const currentStatus = l ? l.flight_status : null;
        if (currentStatus && currentStatus !== lastViewed) {
            updateTaskbarIcon(true); // show green circle
        } else {
            updateTaskbarIcon(false); // show grey circle
        }
    });

    ipcRenderer.on('mark-viewed', async () => {
        const l = await ipcRenderer.invoke('get-store-val', 'latestFlightData');
        if (l && l.flight_status) {
            ipcRenderer.send('set-store-val', 'lastViewedStatus', l.flight_status);
        }
        updateTaskbarIcon(false); // revert to grey circle
    });

    // Initial icon render
    updateTaskbarIcon(false);

    // Save API Key
    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            ipcRenderer.send('set-store-val', 'apiKey', key);
            keyStatus.textContent = 'API Key saved successfully!';
            keyStatus.className = 'status-msg success';
            setTimeout(() => { keyStatus.className = 'status-msg hidden'; }, 3000);
        }
    });

    // Search Flights
    searchBtn.addEventListener('click', async () => {
        const fnum = flightNumInput.value.trim().toUpperCase();
        const currentKey = apiKeyInput.value.trim();

        if (!currentKey) {
            searchError.textContent = 'Please save your Aviationstack API key first.';
            searchError.className = 'status-msg error';
            return;
        }

        if (!fnum) {
            searchError.textContent = 'Please enter a flight number.';
            searchError.className = 'status-msg error';
            return;
        }

        searchError.className = 'status-msg hidden';
        searchLoading.className = 'loading-spinner';
        // Remove inline hidden display
        searchLoading.classList.remove('hidden');

        resultsContainer.classList.add('hidden');
        resultsList.innerHTML = '';

        const res = await ipcRenderer.invoke('search-flights', currentKey, fnum);
        searchLoading.classList.add('hidden');

        if (!res.success) {
            searchError.textContent = 'Error: ' + res.error;
            searchError.className = 'status-msg error';
            return;
        }

        const data = res.data;
        if (!data || data.length === 0) {
            searchError.textContent = 'No current data found for that flight number.';
            searchError.className = 'status-msg error';
            return;
        }

        // Display Results
        resultsContainer.classList.remove('hidden');
        data.forEach(flightObj => {
            const f = flightObj.flight;
            const t = flightObj.departure ? flightObj.departure.airport : 'Unknown Dep';
            const a = flightObj.arrival ? flightObj.arrival.airport : 'Unknown Arr';
            const depIata = flightObj.departure ? flightObj.departure.iata : null;
            const arrIata = flightObj.arrival ? flightObj.arrival.iata : null;

            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `
        <div class="flight-info">
          <h4>${flightObj.airline ? flightObj.airline.name : ''} ${f.iata || fnum}</h4>
          <p>${t} ➔ ${a}</p>
          <span class="tag">${flightObj.flight_status || 'scheduled'}</span>
        </div>
        <button class="btn secondary select-btn">Track</button>
      `;

            // Assign click
            div.querySelector('.select-btn').addEventListener('click', () => {
                const trackData = {
                    flight_iata: f.iata || fnum,
                    flight_date: flightObj.flight_date,
                    departure_iata: depIata,
                    arrival_iata: arrIata,
                    airline: flightObj.airline ? flightObj.airline.name : 'Unknown Airline',
                    route: `${t} to ${a}`
                };
                ipcRenderer.send('set-store-val', 'trackedFlight', trackData);
                updateTrackedDisplay(trackData, null);
                resultsContainer.classList.add('hidden');
                flightNumInput.value = '';
            });

            resultsList.appendChild(div);
        });
    });

    function formatTime(dateObj) {
        if (!dateObj) return '--:--';
        return dateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function calculateProgress(depTimeMs, arrTimeMs) {
        if (!depTimeMs || !arrTimeMs) return 0;
        const now = Date.now();
        if (now < depTimeMs) return 0;
        if (now > arrTimeMs) return 100;
        const total = arrTimeMs - depTimeMs;
        const elapsed = now - depTimeMs;
        return Math.min(100, Math.max(0, (elapsed / total) * 100));
    }

    function updateTrackedDisplay(trackData, latestData) {
        if (!trackData) {
            trackedDisplay.innerHTML = `No flight currently being tracked.`;
            trackedDisplay.className = 'empty-state';
            return;
        }

        let depIata = trackData.departure_iata || 'DEP';
        let arrIata = trackData.arrival_iata || 'ARR';
        let depTimeStr = '--:--';
        let arrTimeStr = '--:--';
        let depTerminal = '-';
        let depGate = '-';
        let arrTerminal = '-';
        let arrGate = '-';
        let statusText = 'SCHEDULED';
        let progressPct = 0;
        let flightColor = 'var(--text-main)';

        if (latestData) {
            statusText = (latestData.flight_status || 'unknown').toUpperCase();

            if (latestData.departure) {
                depIata = latestData.departure.iata || depIata;
                depTerminal = latestData.departure.terminal || '-';
                depGate = latestData.departure.gate || '-';

                // Parse true time
                let tMs = 0;
                if (latestData.departure.actual) {
                    tMs = new Date(latestData.departure.actual).getTime();
                } else if (latestData.departure.estimated) {
                    tMs = new Date(latestData.departure.estimated).getTime();
                } else if (latestData.departure.scheduled) {
                    tMs = new Date(latestData.departure.scheduled).getTime();
                }

                if (tMs > 0) {
                    const realMs = tMs - (getTzOffsetMins(latestData.departure.timezone) * 60000);
                    depTimeStr = formatTime(new Date(realMs));
                }
            }

            if (latestData.arrival) {
                arrIata = latestData.arrival.iata || arrIata;
                arrTerminal = latestData.arrival.terminal || '-';
                arrGate = latestData.arrival.gate || '-';

                let tMs = 0;
                if (latestData.arrival.estimated) {
                    tMs = new Date(latestData.arrival.estimated).getTime();
                } else if (latestData.arrival.scheduled) {
                    tMs = new Date(latestData.arrival.scheduled).getTime();
                }

                if (tMs > 0) {
                    const realMs = tMs - (getTzOffsetMins(latestData.arrival.timezone) * 60000);
                    arrTimeStr = formatTime(new Date(realMs));
                }
            }

            // Calculate progress line
            if (statusText === 'ACTIVE') {
                flightColor = 'var(--success-color)';
                if (latestData.departure?.actual && latestData.arrival?.estimated) {
                    const depMs = new Date(latestData.departure.actual).getTime() - (getTzOffsetMins(latestData.departure.timezone) * 60000);
                    const arrMs = new Date(latestData.arrival.estimated).getTime() - (getTzOffsetMins(latestData.arrival.timezone) * 60000);
                    progressPct = calculateProgress(depMs, arrMs);
                } else {
                    progressPct = 50; // default middle if missing timestamps
                }
            } else if (statusText === 'LANDED') {
                progressPct = 100;
                flightColor = 'var(--text-muted)';
            } else if (statusText === 'CANCELLED') {
                flightColor = 'var(--error-color)';
            }
        }

        let footerText = 'Monitoring every 5 minutes';
        const terminalStatuses = ['LANDED', 'CANCELLED', 'INCIDENT', 'DIVERTED'];
        if (terminalStatuses.includes(statusText)) {
            footerText = 'Flight ended. Monitoring stopped.';
        }

        // SVG Airplane Icon
        const planeSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2C10.67 2 10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z"/>
        </svg>`;

        trackedDisplay.className = '';
        trackedDisplay.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">${trackData.airline} ${trackData.flight_iata}</div>
        <div style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; border: 1px solid ${flightColor}; color: ${flightColor}; margin-bottom: 12px;">
            ${statusText}
        </div>

        <div class="flight-status-card">
            <div class="flight-header-row">
                <div class="airport-code">${depIata}</div>
                <div class="timeline-container">
                    <div class="timeline-line">
                        <div class="timeline-progress" style="width: ${progressPct}%; background-color: ${flightColor}"></div>
                        <div class="timeline-plane" style="left: ${progressPct}%; color: ${flightColor}; transform: translate(-50%, -50%) rotate(90deg);">
                            ${planeSvg}
                        </div>
                    </div>
                </div>
                <div class="airport-code">${arrIata}</div>
            </div>

            <div class="flight-info-grid">
                <div class="airport-info-block">
                    <h4>Departure</h4>
                    <div class="info-metrics">
                        <div class="metric">
                            <span class="metric-label">Time</span>
                            <span class="metric-value time" style="color: ${flightColor}">${depTimeStr}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Terminal</span>
                            <span class="metric-value terminal-gate">${depTerminal}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Gate</span>
                            <span class="metric-value terminal-gate">${depGate}</span>
                        </div>
                    </div>
                </div>

                <div class="airport-info-block">
                    <h4>Arrival</h4>
                    <div class="info-metrics">
                        <div class="metric">
                            <span class="metric-label">Estimated</span>
                            <span class="metric-value time" style="color: ${flightColor}">${arrTimeStr}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Terminal</span>
                            <span class="metric-value terminal-gate">${arrTerminal}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Gate</span>
                            <span class="metric-value terminal-gate">${arrGate}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="flight-footer">
                <span>${footerText}</span>
                <span>Source: Aviationstack</span>
            </div>
        </div>
        `;
    }
});
