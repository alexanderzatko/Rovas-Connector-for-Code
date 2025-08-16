// adjustTimeWebview.ts
// Webview panel for adjusting tracked time (hours, minutes, seconds)

import * as vscode from 'vscode';
// Update the import path to match the actual location and casing of your file
import { TimeTracker } from '../timeTracking/timeTracker';

export function showAdjustTimeWebview(context: vscode.ExtensionContext, tracker: TimeTracker) {
    const panel = vscode.window.createWebviewPanel(
        'adjustTime',
        'Adjust Tracked Time',
        vscode.ViewColumn.Active,
        { enableScripts: true }
    );

    const totalSeconds = tracker.getTrackedSeconds();
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    panel.webview.html = getWebviewContent(hours, minutes);

    panel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'setTime') {
            const { hours, minutes, seconds } = message;
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            await tracker.setTrackedSeconds(totalSeconds);
            vscode.window.showInformationMessage(`Tracked time set to ${hours}h ${minutes}m ${seconds}s.`);
            panel.dispose();
        } else if (message.command === 'cancel') {
            panel.dispose();
        }
    });
}

function getWebviewContent(hours: number, minutes: number) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Adjust Tracked Time</title>
        <style>
            body { font-family: sans-serif; margin: 20px; }
            label { display: block; margin-top: 10px; }
            input { width: 60px; margin-right: 10px; }
            button { margin-top: 20px; }
        </style>
    </head>
    <body>
        <h2>Adjust Tracked Time</h2>
        <form id="timeForm">
            <label>
                Hours: <input type="number" id="hours" min="0" value="${hours}" />
                Minutes: <input type="number" id="minutes" min="0" max="59" value="${minutes}" />
            </label>
            <button type="submit">Set Time</button>
            <button type="button" id="cancelBtn">Cancel</button>
        </form>
        <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('timeForm').addEventListener('submit', (e) => {
                e.preventDefault();
                const hours = parseInt(document.getElementById('hours').value) || 0;
                const minutes = parseInt(document.getElementById('minutes').value) || 0;
                vscode.postMessage({ command: 'setTime', hours, minutes, seconds: 0 });
            });
            document.getElementById('cancelBtn').addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });
        </script>
    </body>
    </html>
    `;
}
