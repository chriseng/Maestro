#!/usr/bin/env node
/* Throwaway CDP driver for issue #1073 repro: dispatch keys/text + screenshots
 * against the live Maestro page in one CDP session (keeps timing tight).
 *
 * Reads a newline-separated script of steps from argv[2] (a file) OR inline via --steps.
 * Step grammar (one per line):
 *   key <name> [meta|ctrl|alt|shift ...]   e.g. "key j meta"  "key Enter"
 *   text <string to insert>
 *   shot <path.png>
 *   wait <ms>
 */
const WebSocket = require('ws');
const fs = require('fs');

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:12345';

const KEY_DEFS = {
	Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
	j: { key: 'j', code: 'KeyJ', keyCode: 74 },
};

function modBits(mods) {
	let m = 0;
	for (const x of mods) {
		if (x === 'alt') m |= 1;
		if (x === 'ctrl') m |= 2;
		if (x === 'meta') m |= 4;
		if (x === 'shift') m |= 8;
	}
	return m;
}

async function main() {
	const file = process.argv[2];
	const steps = fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

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
	await send('Runtime.enable', {});

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	for (const step of steps) {
		const [cmd, ...rest] = step.split(' ');
		if (cmd === 'wait') {
			await sleep(parseInt(rest[0], 10));
		} else if (cmd === 'shot') {
			const shot = await send('Page.captureScreenshot', { format: 'png' });
			fs.writeFileSync(rest[0], Buffer.from(shot.data, 'base64'));
			console.log('shot', rest[0]);
		} else if (cmd === 'text') {
			await send('Input.insertText', { text: rest.join(' ') });
		} else if (cmd === 'key') {
			const name = rest[0];
			const mods = rest.slice(1);
			const def = KEY_DEFS[name] || { key: name, code: name, keyCode: name.charCodeAt(0) };
			const modifiers = modBits(mods);
			await send('Input.dispatchKeyEvent', {
				type: 'keyDown',
				modifiers,
				key: def.key,
				code: def.code,
				windowsVirtualKeyCode: def.keyCode,
				nativeVirtualKeyCode: def.keyCode,
				...(def.text && !modifiers ? { text: def.text } : {}),
			});
			await send('Input.dispatchKeyEvent', {
				type: 'keyUp',
				modifiers,
				key: def.key,
				code: def.code,
				windowsVirtualKeyCode: def.keyCode,
				nativeVirtualKeyCode: def.keyCode,
			});
		}
		await sleep(120);
	}
	ws.close();
}
main().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
