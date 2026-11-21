window.__ModuleLoader__.load({
  id: '@local/dsh-pairing',
  factory(require) {
    /** Client half of the DSH pairing panel: a Settings page showing the pairing QR. */
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const BASE = '/plugins/@local/dsh-pairing/pairing'
    const NS = 'pairing'

    const en = {
      title: 'Device pairing',
      intro: 'Pair the DSH mobile app with this Host. The phone must reach this machine over SSH; the code carries the SSH endpoint, the host-key fingerprint, the pinned DSH version, and a one-time DSH token.',
      qrAlt: 'Pairing QR code',
      passwordHint: 'Treat this code like a password: it grants owner-level access to this Host.',
      scanHint: 'Scan this code with the DSH mobile app, then compare the verification code on both screens before continuing.',
      sasTitle: 'Verification code',
      sasHint: 'Both screens must show the same four characters. If they differ, stop and generate a new code.',
      waiting: 'Waiting for your phone…',
      expiresIn: 'Expires in',
      expiredTitle: 'No active code',
      expiredBody: 'There is no code to scan yet. Generate one to start pairing.',
      regenerate: 'Generate new code',
      regenerateWarn: 'Generating a new code cancels the current one.',
      pairedTitle: 'Paired devices',
      noPaired: 'No devices paired yet.',
      pairedNotice: 'paired — you can close Settings.',
      memoryNote: 'Devices are remembered until this Host restarts.',
      warningsTitle: 'Fix these before pairing',
      connectionTitle: 'Connection details',
      host: 'SSH host',
      port: 'SSH port',
      user: 'SSH user',
      version: 'DSH version',
      fingerprint: 'Host-key fingerprint',
      regenerating: 'Generating…',
      retry: 'Retry',
      loadFailed: 'Could not load the pairing state',
      retrying: 'Retrying every few seconds…',
      warnHost: 'SSH host is not set. Edit the Device pairing plugin config and set host to the machine the phone will reach.',
      warnUser: 'SSH user is empty. Set user in the Device pairing plugin config.',
      warnFingerprint: 'Host-key fingerprint is missing. Set fingerprint in the plugin config (see ssh-keygen -lf).',
      warnToken: 'Could not read this process\'s DSH launch token, so the phone cannot complete the connection exchange.',
      warnVersion: 'DSH version is unknown. Set dshVersion in the plugin config to pin it.',
    }

    const zh = {
      title: '设备配对',
      intro: '将 DSH 移动应用与此主机配对。手机必须通过 SSH 访问本机；二维码包含 SSH 地址、主机密钥指纹、固定的 DSH 版本以及一次性 DSH 令牌。',
      qrAlt: '配对二维码',
      passwordHint: '请像对待密码一样保护此二维码：它授予本主机的所有者级访问权限。',
      scanHint: '使用 DSH 移动应用扫描此二维码，并在继续前核对两台设备上显示的校验码。',
      sasTitle: '校验码',
      sasHint: '两个屏幕必须显示相同的四个字符。如果不一致，请停止并生成新二维码。',
      waiting: '等待手机连接…',
      expiresIn: '有效期',
      expiredTitle: '暂无有效二维码',
      expiredBody: '当前没有可扫描的二维码，请生成一个以开始配对。',
      regenerate: '生成新二维码',
      regenerateWarn: '生成新二维码会使当前二维码失效。',
      pairedTitle: '已配对设备',
      noPaired: '尚未配对任何设备。',
      pairedNotice: '已配对 — 现在可以关闭设置。',
      memoryNote: '设备列表将在本主机重启后清空。',
      warningsTitle: '配对前请先修复',
      connectionTitle: '连接信息',
      host: 'SSH 主机',
      port: 'SSH 端口',
      user: 'SSH 用户',
      version: 'DSH 版本',
      fingerprint: '主机密钥指纹',
      regenerating: '正在生成…',
      retry: '重试',
      loadFailed: '无法加载配对状态',
      retrying: '每几秒自动重试…',
      warnHost: '未设置 SSH 主机。请在设备配对插件配置中将 host 设置为手机可访问的主机。',
      warnUser: 'SSH 用户为空。请在设备配对插件配置中设置 user。',
      warnFingerprint: '缺少主机密钥指纹。请在插件配置中设置 fingerprint（参见 ssh-keygen -lf）。',
      warnToken: '无法读取本进程的 DSH 启动令牌，手机将无法完成连接交换。',
      warnVersion: 'DSH 版本未知。请在插件配置中设置 dshVersion 以固定版本。',
    }

    const WARNING_TEXT = {
      'host-placeholder': 'warnHost',
      'ssh-user-missing': 'warnUser',
      'fingerprint-missing': 'warnFingerprint',
      'token-missing': 'warnToken',
      'version-missing': 'warnVersion',
    }

    const PLATFORM_LABEL = { ios: 'iOS', android: 'Android' }

    function formatCountdown(totalSeconds) {
      const seconds = Math.max(0, Math.floor(totalSeconds))
      const minutes = Math.floor(seconds / 60)
      return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
    }

    function formatTime(iso) {
      try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
      } catch {
        return iso
      }
    }

    const mono = 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)'
    const warnStroke = 'var(--dsw-alias-state-warn-secondary, var(--dsw-alias-border-l1))'

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 },
      intro: { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      h2: { margin: '12px 0 0', fontSize: 18, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      h3: { margin: '16px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      warnings: {
        border: `1px solid ${warnStroke}`, borderRadius: 'var(--dsw-radius-lg, 10px)',
        background: 'var(--dsw-alias-bg-layer-1)', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
      },
      warningLine: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
      row: { display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' },
      qrIsland: { background: '#ffffff', borderRadius: 12, padding: 10, lineHeight: 0 },
      qrImage: { width: 280, maxWidth: '100%', height: 'auto', display: 'block' },
      details: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: '1 1 300px' },
      sasBox: {
        display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 'var(--dsw-radius-md, 8px)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      sasLabel: { margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      sasValue: {
        margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: 8,
        fontFamily: mono, color: 'var(--dsw-alias-brand-primary)',
      },
      hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      countdown: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      expired: {
        margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)',
        padding: '12px 14px', border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 'var(--dsw-radius-lg, 10px)', background: 'var(--dsw-alias-bg-layer-1)',
        display: 'flex', flexDirection: 'column', gap: 8,
      },
      table: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 12, margin: 0 },
      term: { color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      value: { color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all', fontFamily: mono, margin: 0 },
      button: {
        alignSelf: 'flex-start', border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'transparent', color: 'var(--dsw-alias-brand-primary)',
        borderRadius: 'var(--dsw-radius-md, 8px)', padding: '6px 12px', fontSize: 13, cursor: 'pointer',
      },
      pairedList: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 },
      pairedItem: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      error: {
        margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-primary)',
        border: '1px solid var(--dsw-alias-state-error-primary)', borderRadius: 'var(--dsw-radius-lg, 10px)',
        background: 'var(--dsw-alias-bg-layer-1)', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
      },
      notice: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' },
    }

    function QrGlyph(props) {
      const size = props !== null && typeof props === 'object' && typeof props.size === 'number' ? props.size : 16
      const block = (x, y) => h('rect', { key: `${x},${y}`, x, y, width: 4, height: 4 })
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block', fill: 'currentColor' } },
        block(1, 1), block(1, 5), block(5, 1), block(5, 5),
        block(10, 1), block(10, 5),
        block(1, 10), block(5, 10),
        block(10, 10))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-pairing: dictionaries')

        function PairingSection() {
          const [state, setState] = useState(null)
          const [error, setError] = useState('')
          const [nowMs, setNowMs] = useState(() => Date.now())
          const [busy, setBusy] = useState(false)
          const [qrError, setQrError] = useState(false)
          const fetchedAtMs = useRef(Date.now())

          const load = useCallback(async () => {
            try {
              const response = await fetch(`${BASE}/state`, {
                headers: { accept: 'application/json' },
                cache: 'no-store',
              })
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              const next = await response.json()
              fetchedAtMs.current = Date.now()
              setState(next)
              setQrError(false)
              setError('')
              return next
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
              return null
            }
          }, [])

          const requestRegenerate = useCallback(async () => {
            setBusy(true)
            try {
              const response = await fetch(`${BASE}/regenerate`, { method: 'POST' })
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              return true
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
              return false
            } finally {
              setBusy(false)
            }
          }, [])

          const regenerate = async () => {
            const ok = await requestRegenerate()
            if (ok) await load()
          }

          useEffect(() => {
            let alive = true
            const clock = setInterval(() => { if (alive) setNowMs(Date.now()) }, 1000)
            let poll
            void (async () => {
              let first = await load()
              // Open the page with a full-TTL code: generate only when there is
              // nothing scannable, never over a live code the user may be comparing.
              if (alive && first !== null && (first.offer === null || first.now >= first.offer.exp)) {
                const ok = await requestRegenerate()
                if (alive && ok) await load()
              }
              poll = setInterval(() => { if (alive) load() }, 5000)
            })()
            return () => {
              alive = false
              clearInterval(clock)
              if (poll) clearInterval(poll)
            }
          }, [load, requestRegenerate])

          const loading = state === null && error === ''
          const offer = state !== null ? state.offer : null
          const nowSec = state !== null
            ? state.now + (nowMs - fetchedAtMs.current) / 1000
            : 0
          const remaining = offer !== null ? offer.exp - nowSec : 0
          const expired = offer !== null && remaining <= 0
          const fatal = state !== null && state.fatal === true
          const warnings = state !== null && Array.isArray(state.warnings) ? state.warnings : []
          const paired = state !== null && Array.isArray(state.paired) ? state.paired : []
          const lastAccepted = state !== null ? state.lastAccepted : null
          const showQr = !loading && !fatal && !expired && offer !== null && state.qr !== null

          return h('div', { style: styles.wrap },
            h('h2', { style: styles.h2 }, t('title')),
            h('p', { style: styles.intro }, t('intro')),

            h('style', null, '.dsh-pairing-button:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))}'),

            loading
              ? h('p', { style: styles.hint }, t('retrying'))
              : null,

            error !== ''
              ? h('div', { role: 'alert', style: styles.error },
                  h('span', null, `${t('loadFailed')}: ${error}`),
                  h('button', {
                    type: 'button', className: 'dsh-pairing-button', style: styles.button,
                    onClick: () => { load() },
                  }, t('retry')))
              : null,

            fatal
              ? h('div', { style: styles.warnings },
                  h('span', { style: styles.h3, margin: 0 }, t('warningsTitle')),
                  ...warnings.map((code, index) => h('p', { key: `w${index}`, style: styles.warningLine },
                    t(WARNING_TEXT[code] || code))))
              : null,

            showQr
              ? h('div', { style: styles.row },
                  h('div', { style: styles.qrIsland },
                    qrError
                      ? h('p', { style: { margin: 0, fontSize: 12, color: '#5b6572', padding: 12 } }, t('retrying'))
                      : h('img', {
                          src: state.qr,
                          alt: t('qrAlt'),
                          style: styles.qrImage,
                          onError: () => { setQrError(true) },
                        })),
                  h('div', { style: styles.details },
                    h('div', { style: styles.sasBox },
                      h('p', { style: styles.sasLabel }, t('sasTitle')),
                      h('p', { style: styles.sasValue }, offer.sas),
                      h('p', { style: styles.hint }, t('sasHint'))),
                    h('p', { style: styles.hint }, t('scanHint')),
                    h('p', { style: styles.hint }, t('passwordHint')),
                    h('p', { style: styles.countdown }, `${t('expiresIn')} ${formatCountdown(remaining)}`),
                    h('p', { style: styles.hint }, t('waiting'))))
              : null,

            expired
              ? h('div', { style: styles.expired },
                  h('span', { style: styles.h3, margin: 0 }, t('expiredTitle')),
                  h('p', { style: styles.hint }, t('expiredBody')))
              : null,

            (showQr || expired)
              ? h('button', {
                  type: 'button', className: 'dsh-pairing-button', style: styles.button,
                  disabled: busy, onClick: regenerate,
                }, busy ? t('regenerating') : t('regenerate'))
              : null,

            (showQr || expired)
              ? h('p', { style: styles.hint }, t('regenerateWarn'))
              : null,

            state !== null && offer !== null
              ? h('div', null,
                  h('h3', { style: styles.h3 }, t('connectionTitle')),
                  h('div', { style: styles.table },
                    h('span', { style: styles.term }, t('host')),
                    h('span', { style: styles.value }, offer.host),
                    h('span', { style: styles.term }, t('port')),
                    h('span', { style: styles.value }, String(offer.port)),
                    h('span', { style: styles.term }, t('user')),
                    h('span', { style: styles.value }, offer.user !== '' ? offer.user : '—'),
                    h('span', { style: styles.term }, t('version')),
                    h('span', { style: styles.value }, offer.ver !== '' ? offer.ver : '—'),
                    h('span', { style: styles.term }, t('fingerprint')),
                    h('span', { style: styles.value }, offer.fp !== '' ? offer.fp : '—')))
              : null,

            !loading
              ? h('div', { 'aria-live': 'polite' },
                  lastAccepted !== null
                    ? h('p', { style: styles.notice },
                        `${lastAccepted.name} ${t('pairedNotice')}`)
                    : null,
                  h('h3', { style: styles.h3 }, t('pairedTitle')),
                  paired.length === 0
                    ? h('p', { style: styles.pairedItem }, t('noPaired'))
                    : h('ul', { style: styles.pairedList },
                        ...paired.map((device, index) => h('li', { key: `p${index}`, style: styles.pairedItem },
                          `${device.name} · ${PLATFORM_LABEL[device.platform] || device.platform} · ${formatTime(device.at)}`))),
                  h('p', { style: styles.hint }, t('memoryNote')))
              : null)
        }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'pairing',
          order: 25,
          label: () => t('title'),
          locale: NS,
        }, PairingSection))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'pairing',
        }, QrGlyph))
      },
    }
  },
})
