// Cross-platform "time since last keyboard/mouse input" helpers.
// Used so Cursor Chat/Agent typing (webview, invisible to VS Code APIs) still
// counts as activity via the OS input-idle clock.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

let cachedAt = 0;
let cachedSeconds: number | null = null;
const CACHE_MS = 400;

/**
 * Seconds since the last OS-level keyboard/mouse input, or null if unsupported.
 * Includes input in Cursor Chat/Agent webviews (unlike VS Code editor events).
 */
export function getSystemIdleSeconds(): number | null {
	const now = Date.now();
	if (now - cachedAt < CACHE_MS) {
		return cachedSeconds;
	}
	cachedAt = now;
	try {
		switch (os.platform()) {
			case 'darwin':
				cachedSeconds = getMacIdleSeconds();
				break;
			case 'linux':
				cachedSeconds = getLinuxIdleSeconds();
				break;
			case 'win32':
				cachedSeconds = getWindowsIdleSeconds();
				break;
			default:
				cachedSeconds = null;
		}
	} catch {
		cachedSeconds = null;
	}
	return cachedSeconds;
}

function getMacIdleSeconds(): number | null {
	// Electron/Cursor extension hosts often have a minimal PATH without /usr/sbin,
	// so calling bare `ioreg` silently fails and idle detection never runs.
	const ioreg = ['/usr/sbin/ioreg', '/sbin/ioreg', 'ioreg'].find((p) => {
		try {
			return p === 'ioreg' || fs.existsSync(p);
		} catch {
			return false;
		}
	});
	if (!ioreg) {
		return null;
	}

	// -r -d 4 keeps the dump small; HIDIdleTime is nanoseconds since last HID input
	const out = execFileSync(ioreg, ['-c', 'IOHIDSystem', '-r', '-d', '4'], {
		encoding: 'utf8',
		timeout: 1500,
		maxBuffer: 2 * 1024 * 1024,
		env: { ...process.env, PATH: `/usr/sbin:/sbin:/usr/bin:/bin:${process.env.PATH || ''}` }
	});

	const matches = [...out.matchAll(/"HIDIdleTime"\s*=\s*(\d+)/g)];
	if (matches.length === 0) {
		return null;
	}
	// Use the maximum idle among entries (some nodes stay near 0)
	let maxNs = 0;
	for (const m of matches) {
		const ns = Number(m[1]);
		if (Number.isFinite(ns) && ns > maxNs) {
			maxNs = ns;
		}
	}
	return maxNs / 1_000_000_000;
}

function getLinuxIdleSeconds(): number | null {
	try {
		const out = execFileSync('xprintidle', [], {
			encoding: 'utf8',
			timeout: 1000,
			env: { ...process.env, PATH: `/usr/bin:/bin:${process.env.PATH || ''}` }
		}).trim();
		const ms = Number(out);
		return Number.isFinite(ms) ? ms / 1000 : null;
	} catch {
		return null;
	}
}

function getWindowsIdleSeconds(): number | null {
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
