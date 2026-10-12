const EXTRA_MS = 1000
const ENTER_VIEW = 'org.telegram.ui.Components.ChatActivityEnterView'
const MARKED_CHANNEL_BASE = 1_000_000_000_000
// ChatActivityEnterView parks slowModeTimer at Integer.MAX_VALUE(-1) while its own message is still uploading
const UPLOADING_TIMER = 2147483646

interface Armed {
  timer: number
  text: string
}

const armed = new Map<string, Armed>()

function arm(key: string, peer: number, topicId: number | undefined, text: string, endsAt: number): void {
  const delay = Math.max(0, endsAt * 1000 - Date.now()) + EXTRA_MS
  const timer = setTimeout(() => {
    armed.delete(key)
    void send(key, peer, topicId, text)
  }, delay)
  armed.set(key, { timer, text })
}

async function send(key: string, peer: number, topicId: number | undefined, text: string): Promise<void> {
  try {
    await inu.account().sendMessage(peer, text, { topicId, clearDraft: false })
  } catch (e) {
    // slowmode was extended or our estimate was off: wait the advertised time and retry
    const m = e instanceof inu.RpcError ? /^SLOWMODE_WAIT_(\d+)$/.exec(e.text) : null
    if (m) {
      arm(key, peer, topicId, text, Math.floor(Date.now() / 1000) + Number(m[1]))
      return
    }
    console.log('frinu-sentry: failed to send', String(e))
    inu.ui.toast('frinu-sentry: failed to send message')
  }
}

// what the tap on the slowmode timer gathered on the UI thread; handled on the plugin thread
interface Tap {
  key: string
  peer: number
  topicId: number | undefined
  text: string
  endsAt: number
}

function handleTap(tap: Tap): void {
  const left = tap.endsAt - Math.floor(Date.now() / 1000)
  arm(tap.key, tap.peer, tap.topicId, tap.text, tap.endsAt)
  inu.ui.toast(`Will send in ${inu.utils.formatDuration(Math.max(left, 0) + 1)}, tap the timer to cancel`)
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
        const peer = -MARKED_CHANNEL_BASE + dialogId
        let topic = 0
        try {
          topic = Number(view.call('getThreadMessageId'))
        } catch (e) {
          topic = 0
        }
        const topicId = topic > 0 ? topic : undefined
        const key = `${peer}:${topicId ?? 0}`

        const pending = armed.get(key)
        if (pending) {
          // second tap: cancel and give the text back
          view.call('setFieldText', pending.text)
          void Promise.resolve().then(() => {
            clearTimeout(pending.timer)
            armed.delete(key)
            inu.ui.toast('Scheduled send cancelled')
          })
          return
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
        void Promise.resolve().then(() => handleTap({ key, peer, topicId, text, endsAt }))
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
