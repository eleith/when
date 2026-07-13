# @when/avatar

Deterministic default avatars for schedule owners who haven't set their own
`avatar_url`. Wraps [DiceBear](https://www.dicebear.com) v10 with the
`initial-face` style (CC0 1.0) and seeds it from a stable string (the owner's
name), so the same input always renders the same face.

```ts
import { defaultAvatar } from '@when/avatar';

const { svg, dataUri } = defaultAvatar('Jane Doe');
```

Avatars are generated server-side and embedded as a data URI, so nothing is
fetched at runtime.
