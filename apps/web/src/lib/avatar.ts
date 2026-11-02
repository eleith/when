/** Put the configured path in the URL for cache identity, not source selection. */
export function avatarThumbnailUrl(avatarPath: string): string {
	const url = new URL(avatarPath, 'http://when.invalid');
	url.pathname = `/avatar${url.pathname}`;
	url.searchParams.set('thumbnail', 'true');
	return `${url.pathname}${url.search}${url.hash}`;
}
