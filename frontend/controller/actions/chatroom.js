'use strict'
import sbp from '~/shared/sbp.js'
import L from '@view-utils/translations.js'
import { GIErrorUIRuntimeError } from '@model/errors.js'
import { encryptedAction } from './utils.js'
import type { GIActionParams } from './types.js'

export default (sbp('sbp/selectors/register', {
  'gi.actions/chatroom/create': async function (params: GIActionParams) {
    try {
      const message = await sbp('chelonia/out/registerContract', {
        contractName: 'gi.contracts/chatroom',
        data: params.data
      })

      return message
    } catch (e) {
      console.error('gi.actions/chatroom/register failed!', e)
      throw new GIErrorUIRuntimeError(L('Failed to create chat channel.'))
    }
  },
  ...encryptedAction('gi.actions/chatroom/addMessage', L('Failed to add message.')),
  ...encryptedAction('gi.actions/chatroom/join', L('Failed to join chat channel.')),
  ...encryptedAction('gi.actions/chatroom/rename', L('Failed to rename chat channel.')),
  ...encryptedAction('gi.actions/chatroom/changeDescription', L('Failed to change chat channel description.')),
  ...encryptedAction('gi.actions/chatroom/leave', L('Failed to leave chat channel.')),
  ...encryptedAction('gi.actions/chatroom/delete', L('Failed to delete chat channel.'))
}): string[])
