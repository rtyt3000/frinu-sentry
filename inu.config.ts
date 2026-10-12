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
          en: 'Holds your message while slowmode is active and sends it right after it ends',
          ru: 'Удерживает сообщение во время slowmode и отправляет сразу после его окончания',
        },
        icon: 'tg://emoji?id=5936039484796706359',
        grants: [
          'interceptSendMessage',
          'invokeRpc(channels.getFullChannel)',
          'account.read(peers)',
          'account.write(send)',
        ],
      },
    },
  },
})
