import { env } from '$env/dynamic/private';
import { register } from '$lib/server/metrics';

export async function GET({ request }: { request: Request }): Promise<Response> {
	const token = env.METRICS_TOKEN;
	if (!token) {
		return new Response('METRICS_TOKEN not configured', { status: 500 });
	}

	const auth = request.headers.get('authorization');
	const expected = `Bearer ${token}`;
	if (!auth || auth !== expected) {
		return new Response('Unauthorized', { status: 401 });
	}

	const body = await register.metrics();
	return new Response(body, {
		status: 200,
		headers: { 'content-type': register.contentType }
	});
}
