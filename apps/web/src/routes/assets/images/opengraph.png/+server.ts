import { renderConfiguredOpengraph } from '$lib/server/opengraph';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ fetch }) => renderConfiguredOpengraph(fetch);
