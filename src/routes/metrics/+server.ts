import { register } from '$lib/server/metrics';

export async function GET(): Promise<Response> {
	const body = await register.metrics();
	return new Response(body, {
		status: 200,
		headers: { 'content-type': register.contentType }
	});
}
