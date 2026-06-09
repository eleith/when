import { externalSchema } from '@when/config';

export function GET(): Response {
	return new Response(JSON.stringify(externalSchema, null, 2), {
		status: 200,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'public, max-age=300'
		}
	});
}
