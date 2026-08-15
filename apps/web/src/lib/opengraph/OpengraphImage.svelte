<svelte:options css="injected" />

<script lang="ts">
	interface Props {
		title: string;
		description: string;
		fontFamily: string;
		appIconSrc?: string;
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
		appIconSrc,
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
	<div class="bottom"></div>
	{#if appIconSrc}
		<div class="app-icon">
			<div class="app-icon-clip"><img src={appIconSrc} alt="" /></div>
		</div>
	{/if}
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
		height: 330px;
		padding: 48px 84px 0;
		background: var(--bg);
	}
	.title {
		font-size: 78px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -2px;
		color: var(--text);
		margin-top: 14px;
	}
	.desc {
		font-size: 30px;
		font-weight: 400;
		line-height: 1.34;
		color: var(--muted);
		max-width: 720px;
		margin-top: 16px;
	}
	.divider {
		height: 14px;
		background: var(--primary);
	}
	.bottom {
		display: flex;
		flex: 1;
		background: var(--primary-tint);
	}
	.app-icon {
		position: absolute;
		top: 267px;
		left: 84px;
		display: flex;
		padding: 10px;
		border-radius: 9999px;
		background: var(--primary);
	}
	.app-icon-clip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 120px;
		height: 120px;
		border-radius: 9999px;
		background: var(--bg);
		overflow: hidden;
	}
	.app-icon-clip img {
		width: 80px;
		height: 80px;
	}
	.avatar {
		position: absolute;
		top: 153px;
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
