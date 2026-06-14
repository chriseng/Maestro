#!/usr/bin/env node
/* Throwaway: hard-reload the live Maestro page over CDP (bypass cache). */
const WebSocket = require('ws');
const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:12345';
async function main() {
	const res = await fetch(`${CDP_HTTP}/json/list`);
	const targets = await res.json();
	const page = targets.find((t) => t.type === 'page' && t.url.includes('17173'));
	if (!page) throw new Error('Maestro page not found');
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	let id = 0;
	const pending = new Map();
	const send = (method, params) =>
		new Promise((resolve, reject) => {
			const msgId = ++id;
			pending.set(msgId, { resolve, reject });
			ws.send(JSON.stringify({ id: msgId, method, params }));
		});
	ws.on('message', (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(new Error(JSON.stringify(msg.error)));
			else resolve(msg.result);
		}
	});
	await new Promise((r) => ws.on('open', r));
	await send('Page.enable', {});
	await send('Page.reload', { ignoreCache: true });
	console.log('hard-reloaded');
	ws.close();
}
main().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
