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
          en: 'Sends your draft right after chat slowmode ends',
          ru: 'Отправляет черновик сразу после окончания slowmode в чате',
        },
        icon: 'tg://emoji?id=5936039484796706359',
        grants: [
          'onUpdate(new_message)',
          'invokeRpc(channels.getFullChannel)',
          'account.read(peers, draft)',
          'account.write(send)',
        ],
      },
    },
  },
})
