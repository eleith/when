---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Send booking notifications independently of background video generation. Persist Generate/Remove choices, checkpoint provider requests and guarded link publication, and send a neutral video-link-added update with a newer ICS sequence through the existing notification pipeline. Calendar publishing now preserves conferencing rather than generating or adopting links. Existing selected links are included immediately; missing links normally produce a separate follow-up even when generation is fast.
