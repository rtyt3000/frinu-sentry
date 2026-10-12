import { readFlag, writeFlag } from '../shared/storage.js'

const ENABLED_KEY = 'enabled'
const EXTRA_MS = 1000

inu.registerSettings(inu.ui.settingsPage({
  title: 'frinu-sentry',
  items: () => [
    inu.ui.header('frinu-sentry'),
    inu.ui.check({
      text: 'Send automatically when slowmode ends',
      checked: readFlag(ENABLED_KEY, true),
      onChange: (checked) => {
        writeFlag(ENABLED_KEY, checked)
      },
    }),
  ],
}))

interface Queued {
  peer: number
  text: TextWithEntities
  replyToMessageId?: number
  topicId?: number
  silent: boolean
}

// seconds until the user may post in the channel again, 0 if they can right now
async function slowmodeLeft(account: inu.Account, peer: number): Promise<number> {
  const parsed = inu.utils.peers.parseMarkedPeerId(peer)
  if (parsed.type !== 'channel') return 0
  const input = await account.resolvePeer(peer)
  if (input._ !== 'inputPeerChannel') return 0
  const res = await account.invokeRpc({
    _: 'channels.getFullChannel',
    channel: { _: 'inputChannel', channel_id: input.channel_id, access_hash: input.access_hash },
  })
  const full = res?.full_chat
  if (!full || full._ !== 'channelFull' || !full.slowmode_seconds) return 0
  const next = full.slowmode_next_send_date ?? 0
  return Math.max(0, next - Math.floor(Date.now() / 1000))
}

function schedule(item: Queued, seconds: number): void {
  setTimeout(() => {
    void deliver(item)
  }, seconds * 1000 + EXTRA_MS)
}

async function deliver(item: Queued): Promise<void> {
  try {
    await inu.account().sendMessage(item.peer, item.text, {
      replyToMessageId: item.replyToMessageId,
      topicId: item.topicId,
      silent: item.silent,
    })
  } catch (e) {
    // slowmode was extended or our estimate was off: wait the advertised time and retry
    const m = e instanceof inu.RpcError ? /^SLOWMODE_WAIT_(\d+)$/.exec(e.text) : null
    if (m) {
      schedule(item, Number(m[1]))
      return
    }
    console.log('slowmode sender: failed to send', String(e))
    inu.ui.toast('Slowmode sender: failed to send message')
  }
}

inu.interceptSendMessage({ stage: 'compose', media: false, forward: false }, async ({ message, account }) => {
  if (!readFlag(ENABLED_KEY, true)) return 'send'
  if (message.scheduleDate !== null) return 'send'

  let left = 0
  try {
    left = await slowmodeLeft(account, message.peer)
  } catch (e) {
    console.log('slowmode sender: lookup failed', String(e))
    return 'send'
  }
  if (left <= 0) return 'send'

  const text = message.text
  if (!text.text.trim()) return 'send'
  schedule({
    peer: message.peer,
    text: { text: text.text, entities: text.entities ? [...text.entities] : [] },
    replyToMessageId: message.reply?.messageId,
    topicId: message.topicId ?? undefined,
    silent: message.silent,
  }, left)
  inu.ui.toast(`Slowmode: will send in ${inu.utils.formatDuration(left + 1)}`)
  return 'drop'
})
