import { Avatar } from '@dicebear/core';
import initialFace from '@dicebear/styles/initial-face.json' with { type: 'json' };

export interface AvatarImage {
	svg: string;
	dataUri: string;
}

// A deterministic default avatar: DiceBear's "initial-face" style (CC0), seeded
// from the given string so the same seed always renders the same face.
export function defaultAvatar(seed: string): AvatarImage {
	const avatar = new Avatar(initialFace, { seed });
	return { svg: avatar.toString(), dataUri: avatar.toDataUri() };
}
