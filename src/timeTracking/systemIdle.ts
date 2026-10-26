// Cross-platform "time since last keyboard/mouse input" helpers.
// Used so Cursor Chat/Agent typing (webview, invisible to VS Code APIs) still
// counts as activity via the OS input-idle clock.

import { execFileSync } from 'child_process';
import * as os from 'os';

/**
 * Seconds since the last OS-level keyboard/mouse input, or null if unsupported.
 * Includes input in Cursor Chat/Agent webviews (unlike VS Code editor events).
 */
export function getSystemIdleSeconds(): number | null {
	try {
		switch (os.platform()) {
			case 'darwin':
				return getMacIdleSeconds();
			case 'linux':
				return getLinuxIdleSeconds();
			case 'win32':
				return getWindowsIdleSeconds();
			default:
				return null;
		}
	} catch {
		return null;
	}
}

function getMacIdleSeconds(): number | null {
	// HIDIdleTime is nanoseconds since last HID input
	const out = execFileSync('ioreg', ['-c', 'IOHIDSystem'], {
		encoding: 'utf8',
		timeout: 1000,
		maxBuffer: 2 * 1024 * 1024
	});
	const match = out.match(/"HIDIdleTime"\s*=\s*(\d+)/);
	if (!match) {
		return null;
	}
	return Number(match[1]) / 1_000_000_000;
}

function getLinuxIdleSeconds(): number | null {
	// xprintidle outputs milliseconds (X11). May be missing on Wayland.
	try {
		const out = execFileSync('xprintidle', [], {
			encoding: 'utf8',
			timeout: 1000
		}).trim();
		const ms = Number(out);
		return Number.isFinite(ms) ? ms / 1000 : null;
	} catch {
		return null;
	}
}

function getWindowsIdleSeconds(): number | null {
	// GetLastInputInfo via PowerShell; returns idle milliseconds
	const script =
		"$sig='[DllImport(\"user32.dll\")]public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);[StructLayout(LayoutKind.Sequential)]public struct LASTINPUTINFO{public uint cbSize;public uint dwTime;}';" +
		"$t=Add-Type -MemberDefinition $sig -Name U32Idle -Namespace Win32 -PassThru;" +
		"$ii=New-Object Win32.U32Idle+LASTINPUTINFO;" +
		"$ii.cbSize=[System.Runtime.InteropServices.Marshal]::SizeOf($ii);" +
		"[void]$t::GetLastInputInfo([ref]$ii);" +
		"[int]([Environment]::TickCount - $ii.dwTime)";
	const out = execFileSync(
		'powershell.exe',
		['-NoProfile', '-NonInteractive', '-Command', script],
		{ encoding: 'utf8', timeout: 3000 }
	).trim();
	const ms = Number(out);
	return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}
