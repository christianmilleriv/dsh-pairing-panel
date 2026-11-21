/**
 * DSH pairing panel — Host half.
 *
 * Serves a short-lived pairing offer for the DSH mobile app:
 *   GET  /plugins/@local/dsh-pairing/pairing/state       current offer + paired devices (pure, never rotates)
 *   POST /plugins/@local/dsh-pairing/pairing/regenerate  rotate the offer
 *   GET  /plugins/@local/dsh-pairing/pairing/qr          SVG QR of the current offer
 *   POST /plugins/@local/dsh-pairing/pairing/accept      phone confirms a device (single use)
 *
 * The offer carries the SSH endpoint, the host-key SHA-256 fingerprint, the
 * pinned DSH version, a verification code (SAS), and this process's DSH launch
 * token so the phone can exchange it for an API cookie via `GET /connect`.
 *
 * Warnings are returned as stable codes, never prose: the Client half maps
 * them to localized text. A warning means the code cannot work yet, so the
 * panel shows the fix-first state instead of a scannable QR.
 *
 * Every route is loopback-only. The launch token is the sensitive part: anyone
 * who reads the QR can mint an owner-level API cookie until the Host restarts.
 * Rotate/expire the code and treat the QR like a password.
 */
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const qrcode = require('./qr.cjs')

const PKG = '@local/dsh-pairing'
const BASE = `/plugins/${PKG}/pairing`
const SAS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEFAULT_TTL_SECONDS = 120
const DEFAULT_HOST_KEY_FILE = '/etc/ssh/ssh_host_ed25519_key.pub'
const PLACEHOLDER_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1', 'workstation.example.com'])

/** This plugin's display name. */
export const name = 'dsh-pairing'

/** Services required before the panel can serve anything. */
export const inject = ['webApp', 'webServer', 'connection']

/** Read and clamp the row configuration. */
function normalizeConfig(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const port = Number(source.port)
  const ttl = Number(source.offerTtlSeconds)
  return {
    host: typeof source.host === 'string' ? source.host.trim() : '',
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22,
    user: typeof source.user === 'string' ? source.user.trim() : '',
    fingerprint: typeof source.fingerprint === 'string' ? source.fingerprint.trim() : '',
    hostKeyFile: typeof source.hostKeyFile === 'string' && source.hostKeyFile.length > 0
      ? source.hostKeyFile
      : DEFAULT_HOST_KEY_FILE,
    dshVersion: typeof source.dshVersion === 'string' ? source.dshVersion.trim() : '',
    offerTtlSeconds: Number.isFinite(ttl) && ttl >= 30 && ttl <= 3600
      ? Math.floor(ttl)
      : DEFAULT_TTL_SECONDS,
  }
}

/** Short authentication string: compare it on the Host screen and the phone. */
function randomSas(length = 4) {
  const bytes = randomBytes(length)
  let sas = ''
  for (let i = 0; i < length; i += 1) sas += SAS_ALPHABET[bytes[i] % SAS_ALPHABET.length]
  return sas
}

/** Single-use offer identifier. */
function randomNonce() {
  return randomBytes(16).toString('base64url')
}

/** True when the request came from the Host itself (the loopback SSH forward). */
function isLoopback(req) {
  const address = req.socket !== undefined && req.socket.remoteAddress !== undefined
    ? req.socket.remoteAddress
    : ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address === '::ffff:7f00:1'
}

/** JSON response helper. */
function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** Read a small JSON request body. */
function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** The running DSH version, from the installation manifest when reachable. */
function detectVersion(settings) {
  if (settings.dshVersion !== '') return settings.dshVersion
  const candidates = []
  if (typeof process.env.DSH_INSTALL_DIR === 'string' && process.env.DSH_INSTALL_DIR !== '') {
    candidates.push(join(process.env.DSH_INSTALL_DIR, 'package.json'))
  }
  if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
    candidates.push(join(process.resourcesPath, 'app.asar/dsh/node_modules/@deepseek-ai/dsh/package.json'))
  }
  for (const file of candidates) {
    try {
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof manifest.version === 'string' && manifest.version !== '') return manifest.version
    } catch {
      // Try the next location.
    }
  }
  return ''
}

/** SSH host-key SHA-256 fingerprint computed from the public key file. */
function fingerprintFromKeyFile(file) {
  try {
    const text = readFileSync(file, 'utf8').trim()
    const blob = text.split(/\s+/u).find(field => field.length > 40 && /^[A-Za-z0-9+/=]+$/u.test(field))
    if (blob === undefined) return ''
    const der = Buffer.from(blob, 'base64')
    const digest = createHash('sha256').update(der).digest('base64').replace(/=+$/u, '')
    return `SHA256:${digest}`
  } catch {
    return ''
  }
}

/**
 * Mount the pairing panel's host routes.
 * @param ctx - Host plugin context carrying `webApp`, `webServer`, and `connection`.
 * @param config - The row configuration.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const paired = []
  let lastAccepted = null
  let offer = null
  let warnings = []

  const resolveFingerprint = () => settings.fingerprint !== ''
    ? settings.fingerprint
    : fingerprintFromKeyFile(settings.hostKeyFile)

  const resolveToken = () => {
    try {
      const advertised = ctx.webApp.getAdvertisedUrl()
      const authenticated = ctx.connection.authenticatedUrl(advertised)
      const token = new URL(authenticated).searchParams.get('token')
      return token !== null ? token : ''
    } catch {
      return ''
    }
  }

  const rotate = () => {
    warnings = []
    if (PLACEHOLDER_HOSTS.has(settings.host)) {
      warnings.push('host-placeholder')
    }
    if (settings.user === '') {
      warnings.push('ssh-user-missing')
    }
    const fingerprint = resolveFingerprint()
    if (fingerprint === '') {
      warnings.push('fingerprint-missing')
    }
    const token = resolveToken()
    if (token === '') {
      warnings.push('token-missing')
    }
    const version = detectVersion(settings)
    if (version === '') {
      warnings.push('version-missing')
    }
    const now = Date.now()
    offer = {
      nonce: randomNonce(),
      sas: randomSas(),
      createdAt: now,
      exp: Math.floor(now / 1000) + settings.offerTtlSeconds,
      host: settings.host,
      port: settings.port,
      user: settings.user,
      fp: fingerprint,
      ver: version,
      token,
    }
  }

  const offerExpired = () => offer === null || Math.floor(Date.now() / 1000) >= offer.exp

  const publicOffer = () => offer === null
    ? null
    : {
        host: offer.host,
        port: offer.port,
        user: offer.user,
        fp: offer.fp,
        ver: offer.ver,
        sas: offer.sas,
        exp: offer.exp,
        nonce: offer.nonce,
      }

  const statePayload = () => ({
    base: BASE,
    now: Math.floor(Date.now() / 1000),
    offer: publicOffer(),
    qr: offer === null ? null : `${BASE}/qr?nonce=${encodeURIComponent(offer.nonce)}`,
    paired,
    lastAccepted,
    warnings: warnings.slice(),
    fatal: warnings.length > 0,
    ttlSeconds: settings.offerTtlSeconds,
  })

  const qrPayload = () => offer === null
    ? null
    : {
        v: 1,
        kind: 'dsh-pair',
        host: offer.host,
        port: offer.port,
        user: offer.user,
        fp: offer.fp,
        ver: offer.ver,
        sas: offer.sas,
        exp: offer.exp,
        nonce: offer.nonce,
        token: offer.token,
      }

  const handleState = (req, res) => {
    if (!isLoopback(req)) return writeJson(res, 403, { error: 'loopback only' })
    // Pure read: never rotate here. The Client asks for a new code explicitly,
    // so a visible code never changes under the user while they compare the SAS.
    writeJson(res, 200, statePayload())
  }

  const handleRegenerate = (req, res) => {
    if (!isLoopback(req)) return writeJson(res, 403, { error: 'loopback only' })
    if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
    rotate()
    lastAccepted = null
    writeJson(res, 200, statePayload())
  }

  const handleQr = (req, res) => {
    if (!isLoopback(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('loopback only\n')
      return
    }
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const nonce = url.searchParams.get('nonce')
    const payload = qrPayload()
    if (offer === null || payload === null || nonce !== offer.nonce || offerExpired()) {
      res.writeHead(410, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('pairing code expired or replaced\n')
      return
    }
    let svg
    try {
      const qr = qrcode(0, 'M')
      qr.addData(JSON.stringify(payload))
      qr.make()
      svg = qr.createSvgTag({ cellSize: 5, margin: 16, alt: 'DSH pairing QR code' })
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`qr generation failed: ${error instanceof Error ? error.message : String(error)}\n`)
      return
    }
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(svg),
    })
    res.end(svg)
  }

  const handleAccept = async (req, res) => {
    if (!isLoopback(req)) return writeJson(res, 403, { error: 'loopback only' })
    if (req.method !== 'POST') return writeJson(res, 405, { error: 'POST only' })
    let body
    try {
      const raw = await readBody(req)
      body = JSON.parse(raw)
    } catch {
      return writeJson(res, 400, { error: 'invalid JSON body' })
    }
    if (body === null || typeof body !== 'object' || typeof body.nonce !== 'string') {
      return writeJson(res, 400, { error: 'nonce is required' })
    }
    if (offer === null || offerExpired()) {
      return writeJson(res, 410, { error: 'pairing code expired' })
    }
    if (body.nonce !== offer.nonce) {
      return writeJson(res, 409, { error: 'pairing code replaced; rescan the current code' })
    }
    const device = body.device !== null && typeof body.device === 'object' ? body.device : {}
    const name = typeof device.name === 'string' && device.name.trim() !== ''
      ? device.name.trim().slice(0, 64)
      : 'DSH mobile device'
    const platform = typeof device.platform === 'string' ? device.platform.trim().slice(0, 32) : 'unknown'
    const accepted = { name, platform, at: new Date().toISOString() }
    paired.push(accepted)
    if (paired.length > 20) paired.splice(0, paired.length - 20)
    lastAccepted = accepted
    rotate()
    writeJson(res, 200, { ok: true, accepted, paired, state: statePayload() })
  }

  rotate()

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/state`, handler: handleState }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/regenerate`, handler: handleRegenerate }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/qr`, handler: handleQr }),
      ctx.webServer.register({ kind: 'exact', path: `${BASE}/accept`, handler: handleAccept }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-pairing: pairing routes')
}
