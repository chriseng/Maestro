#!/usr/bin/env node
/* Throwaway CDP harness for reproducing issue #1073 (terminal tab-switch reset).
 * Connects to the live Maestro page over CDP and runs an expression in its context.
 * Usage: node scripts/cdp-eval.js '<js-expression>'
 *        node scripts/cdp-eval.js --file path/to/snippet.js
 * Prints the JSON-serialized result (the expression should return a value).
 */
const WebSocket = require('ws');
const fs = require('fs');

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:12345';

async function getPageWsUrl() {
	const res = await fetch(`${CDP_HTTP}/json/list`);
	const targets = await res.json();
	const page = targets.find((t) => t.type === 'page' && t.url.includes('17173'));
	if (!page) throw new Error('Maestro page target not found');
	return page.webSocketDebuggerUrl;
}

async function main() {
	let expr;
	const arg = process.argv[2];
	if (arg === '--file') {
		expr = fs.readFileSync(process.argv[3], 'utf8');
	} else {
		expr = arg;
	}
	if (!expr) throw new Error('No expression provided');

	const wsUrl = await getPageWsUrl();
	const ws = new WebSocket(wsUrl);
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
	await send('Runtime.enable', {});
	const result = await send('Runtime.evaluate', {
		expression: `(async () => { return (${expr}); })()`,
		awaitPromise: true,
		returnByValue: true,
		userGesture: true,
	});
	if (result.exceptionDetails) {
		console.error('EXCEPTION:', JSON.stringify(result.exceptionDetails, null, 2));
		process.exit(1);
	}
	console.log(JSON.stringify(result.result.value, null, 2));
	ws.close();
}

main().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
