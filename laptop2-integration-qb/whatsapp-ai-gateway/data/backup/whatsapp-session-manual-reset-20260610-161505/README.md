# External Session Storage Only

This repository must not store Chromium profiles, WhatsApp Web session state, cookies, local storage, or login databases.

Provision runtime session/auth state outside Git on the target machine, using the deployed gateway's external runtime paths such as `data/session/` or the configured WhatsApp auth directory.

If the gateway starts without external session state, re-provision a fresh runtime profile outside the repository instead of copying browser data back into Git.
