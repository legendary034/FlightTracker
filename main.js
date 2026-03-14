const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification } = require('electron');
const path = require('path');
const axios = require('axios');

let store = null;
let win = null;
let tray = null;
let pollInterval = null;

// Base64 16x16 airplane icon placeholder (blue square)
const iconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAcSURBVDhPY/z//z/DfwYGBgZGBkYGGA4QMAAAwwACADgVQQAAAABJRU5ErkJggg==';

const getTzOffsetMins = (tz) => {
    try {
        const d = new Date();
        const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
        const loc = new Date(d.toLocaleString('en-US', { timeZone: tz }));
        return (loc.getTime() - utc.getTime()) / 60000;
    } catch (e) { return 0; }
};

function formatTrueTime(timeStr, tz) {
    if (!timeStr) return null;
    const tMs = new Date(timeStr).getTime();
    if (isNaN(tMs)) return null;
    const realMs = tMs - (getTzOffsetMins(tz) * 60000);
    return new Date(realMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function createWindow() {
    win = new BrowserWindow({
        width: 650,
        height: 750,
        show: false, // Start minimized/hidden
        icon: path.join(__dirname, 'icon.png'),
        autoHideMenuBar: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#ffffff',
            symbolColor: '#1a1a1a',
            height: 48
        },
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('index.html');

    // Intercept the close event to minimize the window instead of quitting
    win.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            win.minimize();
        }
    });

    win.on('show', () => {
        win.webContents.send('window-shown');
        win.webContents.send('mark-viewed');
    });

    win.on('focus', () => {
        win.webContents.send('mark-viewed');
    });
}

function createTray() {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Update Flight', click: () => { win.show(); win.focus(); } },
        { type: 'separator' },
        {
            label: 'Test Notification',
            click: () => {
                const tracked = store.get('trackedFlight');
                const latest = store.get('latestFlightData');
                if (tracked && latest) {
                    let timeInfo = '';
                    if (latest.arrival) {
                        const est = formatTrueTime(latest.arrival.estimated, latest.arrival.timezone);
                        const sched = formatTrueTime(latest.arrival.scheduled, latest.arrival.timezone);
                        if (est && sched) timeInfo = `\nEst Landing: ${est} (Orig: ${sched})`;
                    }

                    new Notification({
                        title: `Flight ${tracked.flight_iata} Status`,
                        body: `Current status is ${latest.flight_status.toUpperCase()}. Route: ${tracked.departure_iata || 'DEP'} -> ${tracked.arrival_iata || 'ARR'}${timeInfo}`
                    }).show();
                } else {
                    new Notification({
                        title: 'Flight Tracker',
                        body: 'No active data to notify you about right now.'
                    }).show();
                }
            }
        },
        { type: 'separator' },
        { label: 'Exit', click: () => { app.isQuitting = true; app.quit(); } }
    ]);

    tray.setToolTip('FlightTracker');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        win.show();
        win.focus();
    });
}

function checkFlightStatus() {
    const apiKey = store.get('apiKey');
    const trackedObj = store.get('trackedFlight');
    const lastStatus = store.get('lastStatus');

    if (!apiKey || !trackedObj || !trackedObj.flight_iata) return;

    const terminalStatuses = ['landed', 'cancelled', 'incident', 'diverted'];
    if (lastStatus && terminalStatuses.includes(lastStatus.toLowerCase())) {
        return; // Stop polling the API if the flight is already completed
    }

    axios.get(`http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${trackedObj.flight_iata}`)
        .then(response => {
            const data = response.data;
            if (data && data.data && data.data.length > 0) {
                // Find the specific flight by IATA, flight_date, and airports to ensure exact leg
                const flight = data.data.find(f => {
                    const matchIata = f.flight.iata === trackedObj.flight_iata;
                    const matchDate = f.flight_date === trackedObj.flight_date;
                    const matchDep = trackedObj.departure_iata ? f.departure.iata === trackedObj.departure_iata : true;
                    const matchArr = trackedObj.arrival_iata ? f.arrival.iata === trackedObj.arrival_iata : true;
                    return matchIata && matchDate && matchDep && matchArr;
                }) || data.data[0];

                if (flight) {
                    const newStatus = flight.flight_status; // 'scheduled', 'active', 'landed', 'cancelled', 'incident', 'diverted'
                    const lastStatus = store.get('lastStatus');

                    // Update the hover tooltip
                    if (tray) {
                        tray.setToolTip(`Tracking: ${flight.flight.iata}\nStatus: ${newStatus.toUpperCase()}`);
                    }
                    store.set('latestFlightData', flight);
                    if (win) {
                        win.webContents.send('flight-data-updated');
                    }

                    if (newStatus && newStatus !== lastStatus) {
                        let timeInfo = '';
                        if (flight.arrival) {
                            const est = formatTrueTime(flight.arrival.estimated, flight.arrival.timezone);
                            const sched = formatTrueTime(flight.arrival.scheduled, flight.arrival.timezone);
                            if (est && sched) timeInfo = `\nEst Landing: ${est} (Orig: ${sched})`;
                        }

                        new Notification({
                            title: `Flight ${flight.flight.iata} Update`,
                            body: `The new status for your flight is: ${newStatus.toUpperCase()}.${timeInfo}`
                        }).show();
                        store.set('lastStatus', newStatus);
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error polling flight status:', error);
        });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Close the existing instance and reopen a new one
        app.relaunch();
        app.quit();
    });

    app.whenReady().then(async () => {
        const { default: Store } = await import('electron-store');
        store = new Store();

        createWindow();
        createTray();

        // Start polling every 5 minutes (300,000 ms)
        pollInterval = setInterval(checkFlightStatus, 5 * 60 * 1000);

        // Do an initial check 5 seconds after startup if track exists
        setTimeout(checkFlightStatus, 5000);

        // Setup IPC Handlers for the renderer

        ipcMain.on('update-app-icon', (event, dataUrl) => {
            const img = nativeImage.createFromDataURL(dataUrl);
            if (win) {
                win.setIcon(img);
            }
            if (tray) {
                tray.setImage(img);
            }
        });

        ipcMain.handle('get-store-val', (event, key) => {
            return store.get(key);
        });

        ipcMain.on('set-store-val', (event, key, val) => {
            store.set(key, val);
            if (key === 'trackedFlight') {
                // Clear lastStatus when a new flight is tracked
                store.delete('lastStatus');
                store.delete('latestFlightData');
                if (tray) {
                    tray.setToolTip(`Tracking: ${val.flight_iata}\nStatus: Checking...`);
                }
                checkFlightStatus(); // Trigger immediate check
            }
        });

        ipcMain.handle('search-flights', async (event, apiKey, flightNumber) => {
            try {
                const response = await axios.get(`http://api.aviationstack.com/v1/flights?access_key=${apiKey}&flight_iata=${flightNumber}`);
                return { success: true, data: response.data.data };
            } catch (error) {
                if (error.response) {
                    return { success: false, error: error.response.data.error || error.message };
                }
                return { success: false, error: error.message };
            }
        });
    });

    app.on('window-all-closed', () => {
        // Do nothing. The app should stay running in the tray.
    });
}
