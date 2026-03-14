# FlightTracker

A sleek, lightweight Windows desktop application built with Electron to track live flight statuses from your System Tray. 
FlightTracker runs quietly in the background, polling for updates, and delivers native rich notifications to your desktop whenever your flight changes status (e.g., from Scheduled to Active, or estimating new landing times).

## Features
- **System Tray Integration**: Runs entirely in the background. Right-click the tray icon to Update Flight or Exit.
- **Auto-Updating Tooltips**: Hover over the tray icon for a live glance at your flight's status.
- **Rich Notifications**: Native Windows alerts when a flight status changes, complete with timezone-corrected UTC estimated landing times.
- **Google-Style Timeline UI**: The main window features a rich, responsive interface with a visual progress bar and detailed terminal/gate metrics.
- **Multi-leg Accuracy**: Flight matching algorithms lock onto Departure and Arrival IATA codes so it doesn't accidentally poll the wrong back-and-forth leg of a flight number.

## Usage
Simply grab the `FlightTracker-Release.zip` from the Releases section, extract it, and run `FlightTracker.exe`!

To run from source:
1. Clone this repository array.
2. Run `npm install`
3. Run `npm start` 
4. OR Run `npx electron-packager . FlightTracker --platform=win32 --arch=x64 --out=dist` to build your own executable.

Note: Requires a free API Key from AviationStack.
