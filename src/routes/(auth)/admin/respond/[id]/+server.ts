import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Legacy: emails sent before project 03 commit 9 pointed at /admin/respond/[id]?action=…&token=….
// New canonical surface is /admin/booking/[id]. The detail page reads `?action=accept|decline`
// from the query to pre-focus the relevant button.
const handler: RequestHandler = ({ params, url }) => {
	redirect(301, `/admin/booking/${params.id}${url.search}`);
};

export const GET = handler;
export const POST = handler;
