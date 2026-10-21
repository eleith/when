interface VideoChatReady {
	ok: true;
	status: 'ready';
	url: string;
}

type VideoChatFailure = { ok: false; reason: string };
type VideoChatResult =
	| VideoChatReady
	| { ok: true; status: 'pending' | 'absent' | 'failed' | 'ambiguous' }
	| VideoChatFailure;
type VideoChatRemoveResult = { ok: true } | VideoChatFailure;

interface VideoChatRequestInput {
	name: string;
	requestId: string;
}

interface VideoChatAdapter {
	request(input: VideoChatRequestInput): Promise<VideoChatResult>;
	read(knownUrl: string | null): Promise<VideoChatResult>;
	removeLink(knownUrl: string | null): Promise<VideoChatRemoveResult>;
}

export type {
	VideoChatRequestInput,
	VideoChatReady,
	VideoChatFailure,
	VideoChatResult,
	VideoChatRemoveResult,
	VideoChatAdapter
};
