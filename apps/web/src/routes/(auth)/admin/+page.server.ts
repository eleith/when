import { signOutAction } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	redirect(307, '/admin/appointments/upcoming');
};

export const actions: Actions = {
	signout: signOutAction
};
