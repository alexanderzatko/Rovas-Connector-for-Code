// Minimal Rovas HTTP client for connector features

export const ROVAS_BASE_URL = 'https://rovas.app';

export interface RovasNode {
	nid: number;
	type: string;
	title: string;
	status: number;
	uid: number;
	created: string;
	changed: string;
	language: string;
	url: string;
	is_public: boolean;
}

export class RovasApiError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly body?: string
	) {
		super(message);
		this.name = 'RovasApiError';
	}
}

export async function fetchNode(
	nid: string | number,
	apiKey: string,
	apiToken: string
): Promise<RovasNode> {
	const id = String(nid).trim();
	if (!id) {
		throw new RovasApiError('Project ID is required.');
	}

	const response = await fetch(`${ROVAS_BASE_URL}/rovas/node/${encodeURIComponent(id)}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'API-KEY': apiKey,
			TOKEN: apiToken
		}
	});

	const text = await response.text();
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) {
			throw new RovasApiError(
				'Authentication failed. Check your API Key and Token.',
				response.status,
				text
			);
		}
		if (response.status === 404) {
			throw new RovasApiError(
				`No Rovas node found for ID ${id}.`,
				response.status,
				text
			);
		}
		throw new RovasApiError(
			`Rovas API error ${response.status}: ${text || response.statusText}`,
			response.status,
			text
		);
	}

	try {
		return JSON.parse(text) as RovasNode;
	} catch {
		throw new RovasApiError('Rovas API returned invalid JSON.', response.status, text);
	}
}

/** Smoke-test credentials + project ID; returns a short user-facing summary. */
export async function smokeTestConnection(
	apiKey: string,
	apiToken: string,
	projectId: string
): Promise<{ ok: true; title: string; nid: number; type: string; url: string } | { ok: false; message: string }> {
	if (!apiKey?.trim() || !apiToken?.trim()) {
		return { ok: false, message: 'API Key and Token are required.' };
	}
	if (!projectId?.trim()) {
		return { ok: false, message: 'Enter a Project ID to verify.' };
	}

	try {
		const node = await fetchNode(projectId, apiKey.trim(), apiToken.trim());
		if (node.type && node.type !== 'project') {
			return {
				ok: false,
				message: `ID ${node.nid} is a “${node.type}”, not a project (title: “${node.title}”).`
			};
		}
		return {
			ok: true,
			title: node.title,
			nid: node.nid,
			type: node.type,
			url: node.url
		};
	} catch (error) {
		if (error instanceof RovasApiError) {
			return { ok: false, message: error.message };
		}
		const msg = error instanceof Error ? error.message : String(error);
		return { ok: false, message: msg };
	}
}
