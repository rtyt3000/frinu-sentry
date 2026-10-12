const EXTRA_MS = 1000
const ENTER_VIEW = 'org.telegram.ui.Components.ChatActivityEnterView'
const SEND_HELPER = 'org.telegram.messenger.SendMessagesHelper'
const MARKED_CHANNEL_BASE = 1_000_000_000_000
// ChatActivityEnterView parks slowModeTimer at Integer.MAX_VALUE(-1) while its own message is still uploading
const UPLOADING_TIMER = 2147483646
const SEND_REQUEST_ARGS = 9

// a send we asked the app to make, whose network request the hook below should hold back
interface DeferNext {
  dialogId: number
  endsAt: number
}

let deferNext: DeferNext | null = null
// local ids of the held-back bubbles that the user deleted before they were sent
const cancelled = new Set<number>()
const timers = new Map<number, number>()

// keeps the arguments of a held-back performSendMessageRequest alive on the Java side
const Held = inu.jvm.defineClass({
  fields: {
    method: 'java.lang.Object',
    helper: 'java.lang.Object',
    a0: 'java.lang.Object',
    a1: 'java.lang.Object',
    a2: 'java.lang.Object',
    a3: 'java.lang.Object',
    a4: 'java.lang.Object',
    a5: 'java.lang.Object',
    a6: 'java.lang.Object',
    a7: 'java.lang.Object',
    a8: 'java.lang.Object',
  },
})

function release(held: JavaObject, msgId: number): void {
  timers.delete(msgId)
  if (cancelled.delete(msgId)) return
  const args: any[] = []
  for (let i = 0; i < SEND_REQUEST_ARGS; i++) args.push(held.getField(`a${i}`))
  // the app wants network work on its UI thread, and the original bypasses our own hooks
  inu.jvm.cls('org.telegram.messenger.AndroidUtilities').callStatic('runOnUIThread', inu.jvm.runnable(() => {
    inu.xposed.callOriginalMethod(held.getField('method'), held.getField('helper'), args)
  }))
}

// hold back the request of the bubble we just created, the bubble itself stays on screen with a clock
inu.xposed.hookAllOverloads(inu.jvm.cls(SEND_HELPER), 'performSendMessageRequest', {
  before: (ctx) => {
    const want = deferNext
    if (!want || ctx.args.length !== SEND_REQUEST_ARGS) return
    const msg = ctx.args[1]
    if (!msg || Number(msg.call('getDialogId')) !== want.dialogId) return
    deferNext = null

    const held = new Held()
    held.setField('method', ctx.method)
    held.setField('helper', ctx.thisObject)
    for (let i = 0; i < SEND_REQUEST_ARGS; i++) held.setField(`a${i}`, ctx.args[i])
    const msgId = Number(msg.call('getId'))
    ctx.setReturnValue(null)

    const delay = Math.max(0, want.endsAt * 1000 - Date.now()) + EXTRA_MS
    // timers are only available on the plugin thread
    void Promise.resolve().then(() => {
      timers.set(msgId, setTimeout(() => release(held, msgId), delay))
    })
  },
})

// deleting the bubble cancels the held-back send
inu.xposed.hookAllOverloads(inu.jvm.cls(SEND_HELPER), 'cancelSendingMessage', {
  before: (ctx) => {
    const arg = ctx.args[0]
    if (!arg) return
    const ids: number[] = []
    if (inu.jvm.cls('java.util.ArrayList').isInstance(arg)) {
      const size = Number(arg.call('size'))
      for (let i = 0; i < size; i++) ids.push(Number(arg.call('get', i).call('getId')))
    } else {
      ids.push(Number(arg.call('getId')))
    }
    void Promise.resolve().then(() => {
      for (const id of ids) {
        const timer = timers.get(id)
        if (timer === undefined) continue
        clearTimeout(timer)
        timers.delete(id)
      }
    })
    for (const id of ids) if (timers.has(id)) cancelled.add(id)
  },
})

// fallback when the request was not held back and the server answered with slowmode: wait and send again
function sendLater(peer: number, topicId: number | undefined, text: string, endsAt: number): void {
  const delay = Math.max(0, endsAt * 1000 - Date.now()) + EXTRA_MS
  setTimeout(() => {
    void sendNow(peer, topicId, text)
  }, delay)
}

async function sendNow(peer: number, topicId: number | undefined, text: string): Promise<void> {
  try {
    await inu.account().sendMessage(peer, text, { topicId, clearDraft: false })
  } catch (e) {
    const m = e instanceof inu.RpcError ? /^SLOWMODE_WAIT_(\d+)$/.exec(e.text) : null
    if (m) {
      sendLater(peer, topicId, text, Math.floor(Date.now() / 1000) + Number(m[1]))
      return
    }
    console.log('frinu-sentry: failed to send', String(e))
    inu.ui.toast('frinu-sentry: failed to send message')
  }
}

interface Tap {
  dialogId: number
  topicId: number | undefined
  text: string
  endsAt: number
}

function handleTap(tap: Tap): void {
  const peer = -MARKED_CHANNEL_BASE + tap.dialogId
  deferNext = { dialogId: tap.dialogId, endsAt: tap.endsAt }
  inu.account().sendMessage(peer, tap.text, { topicId: tap.topicId, clearDraft: false }).catch((e) => {
    deferNext = null
    const m = e instanceof inu.RpcError ? /^SLOWMODE_WAIT_(\d+)$/.exec(e.text) : null
    if (m) {
      sendLater(peer, tap.topicId, tap.text, Math.floor(Date.now() / 1000) + Number(m[1]))
      return
    }
    console.log('frinu-sentry: failed to send', String(e))
    inu.ui.toast('frinu-sentry: failed to send message')
  })
  // the bubble shows up right away; whatever deferNext is left over is stale after a moment
  setTimeout(() => {
    deferNext = null
  }, 2000)
}

const TimerClickListener = inu.jvm.defineClass({
  interfaces: [inu.jvm.cls('android.view.View$OnClickListener')],
  fields: { enterView: ENTER_VIEW },
  methods: {
    onClick: {
      params: ['android.view.View'],
      returns: 'void',
      body: (self: JavaObject) => {
        const view = self.getField('enterView')
        const dialogId = Number(view.getField('dialog_id'))
        if (dialogId >= 0) return
        let topic = 0
        try {
          topic = Number(view.call('getThreadMessageId'))
        } catch (e) {
          topic = 0
        }
        const field = view.call('getFieldText')
        const text = field === null ? '' : String(field.call('toString'))
        if (!text.trim()) {
          void Promise.resolve().then(() => inu.ui.toast('Type a message first, then tap the timer'))
          return
        }
        const timer = Number(view.getField('slowModeTimer'))
        const endsAt = timer >= UPLOADING_TIMER ? Math.floor(Date.now() / 1000) + 3 : timer
        view.call('setFieldText', '')
        void Promise.resolve().then(() => handleTap({
          dialogId,
          topicId: topic > 0 ? topic : undefined,
          text,
          endsAt,
        }))
      },
    },
  },
})

inu.xposed.hookAllOverloads(inu.jvm.cls(ENTER_VIEW), 'setSlowModeTimer', {
  after: (ctx) => {
    const view = ctx.thisObject
    if (!view) return
    const listener = new TimerClickListener()
    listener.setField('enterView', view)
    view.getField('slowModeButton').call('setOnClickListener', listener)
  },
})
