const EXTRA_MS = 1000

interface Armed {
  timer: number
  text: TextWithEntities
}

const armed = new Map<string, Armed>()

const keyOf = (peer: number, topicId?: number) => `${peer}:${topicId ?? 0}`

// unix time when the user may post in the channel again, 0 if they can post right now
async function slowmodeEnd(account: inu.Account, peer: number): Promise<number> {
  if (inu.utils.peers.parseMarkedPeerId(peer).type !== 'channel') return 0
  const input = await account.resolvePeer(peer)
  if (input._ !== 'inputPeerChannel') return 0
  const res = await account.invokeRpc({
    _: 'channels.getFullChannel',
    channel: { _: 'inputChannel', channel_id: input.channel_id, access_hash: input.access_hash },
  })
  const full = res?.full_chat
  if (!full || full._ !== 'channelFull' || !full.slowmode_seconds) return 0
  return full.slowmode_next_send_date ?? 0
}

function arm(peer: number, topicId: number | undefined, text: TextWithEntities, endsAt: number): void {
  const key = keyOf(peer, topicId)
  const delay = Math.max(0, endsAt * 1000 - Date.now()) + EXTRA_MS
  const timer = setTimeout(() => {
    armed.delete(key)
    void send(peer, topicId, text)
  }, delay)
  armed.set(key, { timer, text })
}

async function send(peer: number, topicId: number | undefined, text: TextWithEntities): Promise<void> {
  try {
    await inu.account().sendMessage(peer, text, { topicId, clearDraft: false })
  } catch (e) {
    // slowmode was extended or our estimate was off: wait the advertised time and retry
    const m = e instanceof inu.RpcError ? /^SLOWMODE_WAIT_(\d+)$/.exec(e.text) : null
    if (m) {
      arm(peer, topicId, text, Math.floor(Date.now() / 1000) + Number(m[1]))
      return
    }
    console.log('frinu-sentry: failed to send', String(e))
    inu.ui.toast('frinu-sentry: failed to send message')
  }
}

inu.registerChatAction({
  id: 'send-after-slowmode',
  text: (ctx) => ctx && armed.has(keyOf(ctx.dialogId, ctx.topicId))
    ? 'Cancel scheduled send'
    : 'Send draft after slowmode',
  icon: inu.icons.customEmoji('5936039484796706359'),
  visible: (ctx) => inu.utils.peers.parseMarkedPeerId(ctx.dialogId).type === 'channel',
  callback: async ({ account, dialogId, topicId }) => {
    const key = keyOf(dialogId, topicId)
    const prev = armed.get(key)
    if (prev) {
      clearTimeout(prev.timer)
      armed.delete(key)
      inu.ui.toast('Scheduled send cancelled')
      return
    }
    const draft = account.getDraft(dialogId, topicId === undefined ? undefined : { topicId })
    if (!draft || !draft.text.trim()) {
      inu.ui.toast('Type a message first, it is sent from the draft')
      return
    }
    try {
      const left = (await slowmodeEnd(account, dialogId)) - Math.floor(Date.now() / 1000)
      arm(dialogId, topicId, draft, Math.floor(Date.now() / 1000) + Math.max(left, 0))
      await account.setDraft(dialogId, null, { topicId })
      inu.ui.toast(left > 0
        ? `Will send in ${inu.utils.formatDuration(left + 1)}`
        : 'No slowmode, sending')
    } catch (e) {
      console.log('frinu-sentry: slowmode lookup failed', String(e))
      inu.ui.toast('frinu-sentry: could not read slowmode')
    }
  },
})
