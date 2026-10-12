import { defineConfig } from '@inugram/cli'

export default defineConfig({
  plugins: {
    'frinu-sentry': {
      entry: 'src/frinu-sentry/index.ts',
      manifest: {
        id: 'rtyt3000.frinu-sentry',
        name: 'frinu-sentry',
        author: 'rtyt3000',
        version: '1.0.0',
        description: {
          en: 'Tap the slowmode timer to send the typed message right after slowmode ends',
          ru: 'Тап по таймеру slowmode: отправляет набранное сообщение сразу после его окончания',
        },
        icon: 'tg://emoji?id=5936039484796706359',
        grants: [
          'account.read(peers)',
          'account.write(send)',
          'unsafe.jvm',
          'unsafe.xposed',
        ],
      },
    },
  },
})
