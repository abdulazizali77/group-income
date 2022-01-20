'use strict'
import sbp from '~/shared/sbp.js'
import type { GIActionParams } from './types.js'

export default (sbp('sbp/selectors/register', {
  'gi.actions/chatroom/create': async function (params: GIActionParams) {
    const message = await sbp('chelonia/out/registerContract', {
      contractName: 'gi.contracts/chatroom',
      data: params.data
    })

    return message
  },
  ...encryptedAction('gi.actions/chatroom/join', L('Failed to join chat channel.')),
  ...encryptedAction('gi.actions/chatroom/rename', L('Failed to rename chat channel.')),
  ...encryptedAction('gi.actions/chatroom/changeDescription', L('Failed to change chat channel description.')),
  ...encryptedAction('gi.actions/chatroom/leave', L('Failed to leave chat channel.')),
}): string[])
