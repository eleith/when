import { expect, test, vi } from 'vitest';
import { readCalDavReportBody } from './caldav-response.js';

const encoder = new TextEncoder();

function chunkedResponse(chunks: Uint8Array[], cancel = vi.fn()) {
	let position = 0;
	const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
		if (position < chunks.length) controller.enqueue(chunks[position++]);
		else controller.close();
	});
	const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }));
	return { response, pull, cancel };
}

test('preserves split UTF-8 characters at the exact UTF-16 budget, excluding the BOM', async () => {
	const text = 'Aé😀B';
	const bytes = encoder.encode(`\uFEFF${text}`);
	const chunks = [bytes.slice(0, 1), bytes.slice(1, 5), bytes.slice(5, 8), bytes.slice(8)];
	const { response, cancel } = chunkedResponse(chunks);
	const result = await readCalDavReportBody(response, text.length);
	expect(result).toBe(text);
	expect(cancel).not.toHaveBeenCalled();
	expect(response.body!.locked).toBe(false);
});

test('flushes incomplete UTF-8 at EOF and counts the replacement character against the budget', async () => {
	const incomplete = Uint8Array.of(65, 0xe2, 0x82);
	const withinBudget = chunkedResponse([incomplete]).response;
	const result = await readCalDavReportBody(withinBudget, 2);
	expect(result).toBe('A\uFFFD');

	const overBudget = chunkedResponse([incomplete]).response;
	await expect(readCalDavReportBody(overBudget, 1)).rejects.toThrow(/exceeds 1 UTF-16 code units/);
});

test('cancels an oversized REPORT before reading the remaining chunks, without returning a prefix', async () => {
	const { response, pull, cancel } = chunkedResponse(
		['abc', 'de', 'must not be read'].map((text) => encoder.encode(text))
	);
	await expect(readCalDavReportBody(response, 4)).rejects.toThrow(/exceeds 4 UTF-16 code units/);
	expect(pull).toHaveBeenCalledTimes(2);
	expect(cancel).toHaveBeenCalledOnce();
	expect(response.body!.locked).toBe(false);
});

test('counts a supplementary character as two UTF-16 code units', async () => {
	const { response, cancel } = chunkedResponse([encoder.encode('😀')]);
	await expect(readCalDavReportBody(response, 1)).rejects.toThrow(/exceeds 1 UTF-16 code units/);
	expect(cancel).toHaveBeenCalledOnce();
});

test('preserves the size failure when cancellation also fails', async () => {
	const cancel = vi.fn().mockRejectedValue(new Error('cancellation failed'));
	const { response } = chunkedResponse([encoder.encode('too long')], cancel);
	await expect(readCalDavReportBody(response, 4)).rejects.toThrow(/exceeds 4 UTF-16 code units/);
	expect(cancel).toHaveBeenCalledOnce();
	expect(response.body!.locked).toBe(false);
});

test('propagates a read failure rather than returning previously received text', async () => {
	let reads = 0;
	const response = new Response(
		new ReadableStream(
			{
				pull(controller) {
					if (reads++ === 0) controller.enqueue(encoder.encode('<multistatus xmlns="DAV:"/>'));
					else controller.error(new Error('connection lost'));
				}
			},
			{ highWaterMark: 0 }
		)
	);
	await expect(readCalDavReportBody(response, 100)).rejects.toThrow('connection lost');
	expect(response.body!.locked).toBe(false);
});
