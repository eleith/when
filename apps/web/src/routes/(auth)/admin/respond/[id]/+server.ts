import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Legacy: old organizer emails linked here with a response_token to accept/decline
// in one click. That flow is retired — the organizer now signs in and acts from the
// login-gated /booked/[id] detail page. Route stale links through sign-in.
const handler: RequestHandler = ({ params }) => {
	redirect(301, `/signin?callbackUrl=${encodeURIComponent(`/booked/${params.id}`)}`);
};

export const GET = handler;
export const POST = handler;
