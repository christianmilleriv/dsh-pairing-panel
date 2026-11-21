# DSH pairing panel

A **Settings → Pairing** page that shows a short-lived QR code for pairing the DSH mobile app with this Host.

Part of the DSH phone-app pairing stack. The mobile half (QR scanner, device-key
provisioning, saved host profiles) lives in the
[DSH mobile app](https://github.com/christianmilleriv/dsh-harness-mobile-app).

## What it does

- Renders the pairing QR (host, port, SSH user, host-key SHA-256 fingerprint, pinned DSH version, verification code, one-time nonce, and this process's DSH launch token).
- Displays the verification code (SAS) to compare with the phone before accepting.
- Lists paired devices.
- Serves loopback-only HTTP routes:
  - `GET  /plugins/@local/dsh-pairing/pairing/state`
  - `POST /plugins/@local/dsh-pairing/pairing/regenerate`
  - `GET  /plugins/@local/dsh-pairing/pairing/qr?nonce=…`
  - `POST /plugins/@local/dsh-pairing/pairing/accept` `{ "nonce": "…", "device": { "name": "iPhone", "platform": "ios" } }`

The phone app scans the QR, opens the SSH connection with a loopback forward, exchanges the token at `GET /connect?token=…`, and then calls `accept`. The panel rotates the code after each acceptance.

## Install

From the DSH Web GUI: **Plugins → Add plugin → install a local directory**, selecting this folder. Restart DSH (or toggle the bundle off/on) after changing files, since editing an already-installed package needs a fresh module load.

The same install can be done through the plugin manager:

```
plugin_manager install_bundle /abs/path/to/dsh-pairing-panel
```

Or clone from GitHub and install the checkout:

```
git clone https://github.com/christianmilleriv/dsh-pairing-panel.git
plugin_manager install_bundle /abs/path/to/dsh-pairing-panel
```

## Configure

Edit the `dsh-pairing` row in the profile patch:

| Field | Meaning |
|---|---|
| `host` | SSH hostname the phone connects to |
| `port` | SSH port (default 22) |
| `user` | SSH user on the Host |
| `fingerprint` | Host-key SHA-256 fingerprint (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`); computed from `hostKeyFile` when empty |
| `hostKeyFile` | Public host-key file used to compute the fingerprint |
| `dshVersion` | Pinned DSH version; detected from the installation when empty |
| `offerTtlSeconds` | Pairing-code lifetime (30–3600 s, default 120) |

The panel intentionally shows a **fix-first** state (no scannable QR) until `host` and `user` are reachable values and the fingerprint, version, and token all resolve.

## Compatibility

Built against DSH `0.2.2-rc.5`. The QR payload uses the `dsh-pair` JSON format
(`kind: "dsh-pair"`); the mobile app currently provisions via the
`dsh.owner-pair.v1` owner-pairing endpoint — aligning the panel's QR with that
protocol is tracked as a follow-up. See the mobile app's
`docs/pairing-plugins.md` for the full pairing-architecture map.

## Security notes

- **The QR contains the DSH launch token.** Anyone who reads the code can mint an owner-level API cookie until the Host restarts. Show the code only while pairing, keep the lifetime short, and regenerate after use.
- All routes are loopback-only; the phone reaches them through the SSH tunnel.
- The verification code must be compared on both screens before continuing; it catches a swapped code.
- Paired devices are kept in memory for this process only; persistence and scoped (non-owner) access grants are follow-ups.

## License

MIT — see [LICENSE](./LICENSE). `qr.cjs` is vendored
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT, Kazuhiko Arase).
