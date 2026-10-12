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
          en: 'Chat menu button that sends your draft right after slowmode ends',
          ru: 'Кнопка в меню чата: отправляет черновик сразу после окончания slowmode',
        },
        icon: 'tg://emoji?id=5936039484796706359',
        grants: [
          'invokeRpc(channels.getFullChannel)',
          'account.read(peers, draft)',
          'account.write(send, draft)',
        ],
      },
    },
  },
})
