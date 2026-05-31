export function GET(): Response {
	return new Response('ok\n', {
		status: 200,
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
}
