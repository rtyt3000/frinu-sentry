import { readFlag, writeFlag } from '../shared/storage.js'

const ENABLED_KEY = 'enabled'
const EXTRA_MS = 1000

inu.registerSettings(inu.ui.settingsPage({
  title: 'frinu-sentry',
  items: () => [
    inu.ui.header('frinu-sentry'),
    inu.ui.check({
      text: 'Send the draft when slowmode ends',
      checked: readFlag(ENABLED_KEY, true),
      onChange: (checked) => {
        writeFlag(ENABLED_KEY, checked)
      },
    }),
  ],
}))

const timers = new Map<string, number>()

// unix time when the user may post in the channel again, 0 if there is no slowmode
async function slowmodeEnd(account: inu.Account, peer: number, sentAt: number): Promise<number> {
  if (inu.utils.peers.parseMarkedPeerId(peer).type !== 'channel') return 0
  const input = await account.resolvePeer(peer)
  if (input._ !== 'inputPeerChannel') return 0
  const res = await account.invokeRpc({
    _: 'channels.getFullChannel',
    channel: { _: 'inputChannel', channel_id: input.channel_id, access_hash: input.access_hash },
  })
  const full = res?.full_chat
  if (!full || full._ !== 'channelFull' || !full.slowmode_seconds) return 0
  return Math.max(full.slowmode_next_send_date ?? 0, sentAt + full.slowmode_seconds)
}

function schedule(peer: number, topicId: number | null, endsAt: number): void {
  const key = `${peer}:${topicId ?? 0}`
  const prev = timers.get(key)
  if (prev !== undefined) clearTimeout(prev)
  const delay = Math.max(0, endsAt * 1000 - Date.now()) + EXTRA_MS
  timers.set(key, setTimeout(() => {
    timers.delete(key)
    void flushDraft(peer, topicId)
  }, delay))
}

async function flushDraft(peer: number, topicId: number | null): Promise<void> {
  const account = inu.account()
  const draft = account.getDraft(peer, topicId === null ? undefined : { topicId })
  if (!draft || !draft.text.trim()) return
  try {
    await account.sendMessage(peer, draft, {
      topicId: topicId ?? undefined,
      clearDraft: true,
    })
  } catch (e) {
    // slowmode was extended or our estimate was off: wait the advertised time and retry
    const m = e instanceof inu.RpcError ? /^SLOWMODE_WAIT_(\d+)$/.exec(e.text) : null
    if (m) {
      schedule(peer, topicId, Math.floor(Date.now() / 1000) + Number(m[1]))
      return
    }
    console.log('frinu-sentry: failed to send draft', String(e))
    inu.ui.toast('frinu-sentry: failed to send draft')
  }
}

inu.onNewMessage((message, account) => {
  if (!message.out || message.dialogId === null || !readFlag(ENABLED_KEY, true)) return
  const peer = message.dialogId
  const topicId = message.topicId
  slowmodeEnd(account, peer, message.date).then((endsAt) => {
    if (endsAt > 0) schedule(peer, topicId, endsAt)
  }).catch((e) => {
    console.log('frinu-sentry: slowmode lookup failed', String(e))
  })
})
