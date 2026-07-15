<svelte:options css="injected" />

<script lang="ts">
	interface Props {
		title: string;
		description: string;
		fontFamily: string;
		url: string;
		logoSrc?: string;
		avatarSrc?: string;
		primary: string;
		primaryTint: string;
		text: string;
		background: string;
		muted: string;
	}

	let {
		title,
		description,
		fontFamily,
		url,
		logoSrc,
		avatarSrc,
		primary,
		primaryTint,
		text,
		background,
		muted
	}: Props = $props();

	let vars = $derived(
		`--font:${fontFamily}; --primary:${primary}; --primary-tint:${primaryTint}; --text:${text}; --bg:${background}; --muted:${muted}`
	);
</script>

<div class="og" style={vars}>
	<div class="top">
		<span class="title">{title}</span>
		<span class="desc">{description}</span>
	</div>
	<div class="divider"></div>
	<div class="bottom">
		<div class="lockup">
			{#if logoSrc}
				<img src={logoSrc} alt="" />
			{/if}
			<span class="url">{url}</span>
		</div>
	</div>
	{#if avatarSrc}
		<div class="avatar">
			<div class="avatar-clip"><img src={avatarSrc} alt="" /></div>
		</div>
	{/if}
</div>

<style>
	.og {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 1200px;
		height: 630px;
		font-family: var(--font);
		background: var(--bg);
	}
	.top {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		height: 390px;
		padding: 58px 84px 0;
		background: var(--bg);
	}
	.title {
		font-size: 78px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -2px;
		color: var(--text);
		margin-top: 18px;
	}
	.desc {
		font-size: 30px;
		font-weight: 400;
		line-height: 1.34;
		color: var(--muted);
		max-width: 720px;
		margin-top: 20px;
	}
	.divider {
		height: 14px;
		background: var(--primary);
	}
	.bottom {
		display: flex;
		flex: 1;
		align-items: flex-end;
		justify-content: center;
		padding-bottom: 28px;
		background: var(--primary-tint);
	}
	.lockup {
		position: absolute;
		left: 84px;
		bottom: 28px;
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.lockup img {
		width: 40px;
		height: 40px;
	}
	.url {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: var(--primary);
	}
	.avatar {
		position: absolute;
		top: 196px;
		left: 776px;
		display: flex;
		padding: 14px;
		border-radius: 9999px;
		background: var(--primary);
	}
	.avatar-clip {
		display: flex;
		width: 340px;
		height: 340px;
		border-radius: 9999px;
		overflow: hidden;
	}
	.avatar-clip img {
		width: 340px;
		height: 340px;
	}
</style>
