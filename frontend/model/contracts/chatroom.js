'use strict'

import sbp from '~/shared/sbp.js'
import Vue from 'vue'
import {
  objectMaybeOf, objectOf, mapOf, arrayOf,
  string, literalOf, unionOf, number
} from '~/frontend/utils/flowTyper.js'
import { merge } from '~/frontend/utils/giLodash.js'
import L from '~/frontend/views/utils/translations.js'
import {
  CHATROOM_NAME_LIMITS_IN_CHARS,
  CHATROOM_DESCRIPTION_LIMITS_IN_CHARS,
  CHATROOM_MESSAGES_PER_PAGE,
  MESSAGE_ACTION_TYPES,
  CHATROOM_TYPES,
  CHATROOM_PRIVACY_LEVEL,
  MESSAGE_TYPES,
  MESSAGE_NOTIFICATIONS
} from './constants.js'
import { CHATROOM_MESSAGE_ACTION } from '~/frontend/utils/events.js'

export const chatRoomType: any = objectOf({
  name: string,
  description: string,
  type: unionOf(...Object.values(CHATROOM_TYPES).map(v => literalOf(v))),
  privacyLevel: unionOf(...Object.values(CHATROOM_PRIVACY_LEVEL).map(v => literalOf(v)))
})

export const messageType: any = objectMaybeOf({
  id: string, // hash of message once it is initialized
  type: unionOf(...Object.values(MESSAGE_TYPES).map(v => literalOf(v))),
  from: string, // username
  time: string, // new Date()
  text: string, // message text | proposalId when type is INTERACTIVE | notificationType when type if NOTIFICATION
  notification: objectMaybeOf({
    type: unionOf(...Object.values(MESSAGE_NOTIFICATIONS).map(v => literalOf(v))),
    params: mapOf(string, string) // { username }
  }),
  replyingMessage: objectOf({
    id: string, // scroll to the original message and highlight
    index: number, // index of the list of messages
    username: string, // display username
    text: string // display text(if too long, truncate)
  }),
  emoticons: mapOf(string, arrayOf(string)), // mapping of emoticons and usernames
  onlyVisibleTo: arrayOf(string) // list of usernames, only necessary when type is NOTIFICATION
  // TODO: need to consider POLL and add more down here
})

export function createMessage ({ meta, data, hash, state }: {
  meta: Object, data: Object, hash: string, state?: Object
}): Object {
  const { type, text, replyingMessage } = data
  const { createdDate } = meta

  let newMessage = { type, time: new Date(createdDate), id: hash, from: meta.username }

  if (type === MESSAGE_TYPES.TEXT) {
    newMessage = !replyingMessage ? { ...newMessage, text } : { ...newMessage, text, replyingMessage }
  } else if (type === MESSAGE_TYPES.POLL) {
    // TODO: Poll message creation
  } else if (type === MESSAGE_TYPES.NOTIFICATION) {
    const params = {
      channelName: state?.attributes.name,
      channelDescription: state?.attributes.description,
      ...data.notification
    }
    delete params.type
    newMessage = {
      ...newMessage,
      notification: { type: data.notification.type, params }
    }
  } else if (type === MESSAGE_TYPES.INTERACTIVE) {
    // TODO: Interactive message creation for proposals
  }
  return newMessage
}

export function getLatestMessages ({
  count, messages
}: { count: number, messages: Array<Object> }): Array<Object> {
  return messages.slice(Math.max(messages.length - count, 0))
}

export async function leaveChatRoom ({ contractID }: {
  contractID: string
}) {
  const rootState = sbp('state/vuex/state')
  if (contractID === rootState.currentChatRoomId) {
    await sbp('state/vuex/commit', 'setCurrentChatRoomId', {
      groupId: rootState.currentGroupId
    })
    const curRouteName = sbp('controller/router').history.current.name
    if (curRouteName === 'GroupChat' || curRouteName === 'GroupChatConversation') {
      sbp('controller/router').push({ name: 'GroupChat' })
    }
  }
  sbp('state/vuex/commit', 'removeContract', contractID)
}

function createNotificationData (
  notificationType: string,
  moreParams: Object = {}
): Object {
  return {
    type: MESSAGE_TYPES.NOTIFICATION,
    notification: {
      type: notificationType,
      ...moreParams
    }
  }
}

function emitMessageEvents ({ type, contractID, hash, state }: {
  type: string, contractID: string, hash: string, state: Object
}): void {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].id === hash) {
      sbp('okTurtles.events/emit', `${CHATROOM_MESSAGE_ACTION}-${contractID}`, {
        type,
        data: { message: state.messages[i] }
      })
      break
    }
  }
}

sbp('chelonia/defineContract', {
  name: 'gi.contracts/chatroom',
  metadata: {
    validate: objectOf({
      createdDate: string, // action created date
      username: string, // action creator
      identityContractID: string // action creator identityContractID
    }),
    create () {
      const { username, identityContractID } = sbp('state/vuex/state').loggedIn
      return {
        createdDate: new Date().toISOString(),
        username,
        identityContractID
      }
    }
  },
  state (contractID) {
    return sbp('state/vuex/state')[contractID]
  },
  getters: {
    currentChatRoomState (state) {
      return state
    },
    chatRoomSettings (state, getters) {
      return getters.currentChatRoomState.settings || {}
    },
    chatRoomAttributes (state, getters) {
      return getters.currentChatRoomState.attributes || {}
    },
    chatRoomUsers (state, getters) {
      return getters.currentChatRoomState.users || {}
    },
    chatRoomLatestMessages (state, getters) {
      const messages = getters.currentChatRoomState.messages || []
      return getLatestMessages({
        count: getters.chatRoomSettings.messagesPerPage,
        messages
      })
    }
  },
  actions: {
    // This is the constructor of Chat contract
    'gi.contracts/chatroom': {
      validate: chatRoomType,
      process ({ meta, data }, { state }) {
        const initialState = merge({
          settings: {
            messagesPerPage: CHATROOM_MESSAGES_PER_PAGE,
            maxNameLetters: CHATROOM_NAME_LIMITS_IN_CHARS,
            maxDescriptionLetters: CHATROOM_DESCRIPTION_LIMITS_IN_CHARS
          },
          users: {},
          messages: []
        }, {
          attributes: {
            ...data,
            creator: meta.username,
            deletedDate: null,
            archievedDate: null
          }
        })
        for (const key in initialState) {
          Vue.set(state, key, initialState[key])
        }
      }
    },
    'gi.contracts/chatroom/join': {
      validate: objectMaybeOf({
        username: string,
        referer: string
      }),
      process ({ data, meta, hash }, { state }) {
        const { username, referer } = data

        const notificationType = username === referer ? MESSAGE_NOTIFICATIONS.JOIN_MEMBER : MESSAGE_NOTIFICATIONS.ADD_MEMBER
        const notificationData = createNotificationData(
          notificationType,
          notificationType === MESSAGE_NOTIFICATIONS.ADD_MEMBER ? { username } : {}
        )
        const newMessage = createMessage({ meta, hash, data: notificationData, state })
        Vue.set(state.messages, [state.messages.length], newMessage)

        if (state.users[username] && !state.users[username].departedDate) {
          console.log(`chatroom Join: ${username} is already joined the chatroom #${state.name}`)
          return
        }

        Vue.set(state.users, username, {
          joinedDate: meta.createdDate,
          departedDate: null
        })
      },
      sideEffect ({ contractID, hash }, { state }) {
        emitMessageEvents({ type: MESSAGE_ACTION_TYPES.ADD_MESSAGE, contractID, hash, state })
      }
    },
    'gi.contracts/chatroom/rename': {
      validate: objectOf({
        name: string
      }),
      process ({ data, meta, hash }, { state }) {
        Vue.set(state.attributes, 'name', data.name)
        const notificationData = createNotificationData(MESSAGE_NOTIFICATIONS.UPDATE_NAME, {})
        const newMessage = createMessage({ meta, hash, data: notificationData, state })
        Vue.set(state.messages, [state.messages.length], newMessage)
      },
      sideEffect ({ contractID, hash }, { state }) {
        emitMessageEvents({ type: MESSAGE_ACTION_TYPES.ADD_MESSAGE, contractID, hash, state })
      }
    },
    'gi.contracts/chatroom/changeDescription': {
      validate: objectOf({
        description: string
      }),
      process ({ data, meta, hash }, { state }) {
        Vue.set(state.attributes, 'description', data.description)
        const notificationData = createNotificationData(
          MESSAGE_NOTIFICATIONS.UPDATE_DESCRIPTION, {}
        )
        const newMessage = createMessage({ meta, hash, data: notificationData, state })
        Vue.set(state.messages, [state.messages.length], newMessage)
      },
      sideEffect ({ contractID, hash }, { state }) {
        emitMessageEvents({ type: MESSAGE_ACTION_TYPES.ADD_MESSAGE, contractID, hash, state })
      }
    },
    'gi.contracts/chatroom/leave': {
      validate: objectOf({
        username: string
      }),
      process ({ data, meta, hash }, { state }) {
        const { username } = data
        if (state.users[username] && !state.users[username].departedDate) {
          if (!sbp('okTurtles.data/get', 'JOINING_CHATROOM')) {
            Vue.set(state.users[username], 'departedDate', meta.createdDate)
          }

          const notificationType = username === meta.username ? MESSAGE_NOTIFICATIONS.LEAVE_MEMBER : MESSAGE_NOTIFICATIONS.KICK_MEMBER
          const notificationData = createNotificationData(
            notificationType,
            notificationType === MESSAGE_NOTIFICATIONS.KICK_MEMBER ? { username } : {})
          const newMessage = createMessage({ meta, hash, data: notificationData, state })
          Vue.set(state.messages, [state.messages.length], newMessage)
          return
        }
        console.log(`chatroom Leave: ${username} is not a member of this chatroom #${state.name}`)
      },
      sideEffect ({ data, hash, contractID }, { state }) {
        if (sbp('okTurtles.data/get', 'JOINING_CHATROOM')) {
          return
        }
        const rootState = sbp('state/vuex/state')
        if (data.username === rootState.loggedIn.username) {
          leaveChatRoom({ contractID })
        }
        emitMessageEvents({ type: MESSAGE_ACTION_TYPES.ADD_MESSAGE, contractID, hash, state })
      }
    },
    'gi.contracts/chatroom/delete': {
      validate: (data, { state, getters, meta }) => {
        if (state.attributes.creator !== meta.username) {
          throw new TypeError(L('Only the channel creator can delete channel.'))
        }
      },
      process ({ data, meta }, { state, rootState }) {
        Vue.set(state.attributes, 'deletedDate', meta.createdDate)
        for (const username in state.users) {
          Vue.set(state.users[username], 'departedDate', meta.createdDate)
        }
      },
      sideEffect ({ meta, contractID }, { state }) {
        if (state.attributes.creator === meta.username) { // Not sure this condition is necessary
          if (sbp('okTurtles.data/get', 'JOINING_CHATROOM')) {
            return
          }
          leaveChatRoom({ contractID })
        }
      }
    },
    'gi.contracts/chatroom/addMessage': {
      validate: objectMaybeOf({
        type: unionOf(...Object.values(MESSAGE_TYPES).map(v => literalOf(v))),
        text: string,
        notification: objectMaybeOf({
          type: unionOf(...Object.values(MESSAGE_NOTIFICATIONS).map(v => literalOf(v))),
          params: mapOf(string, string) // { username }
        }),
        replyingMessage: objectOf({
          id: string, // scroll to the original message and highlight
          username: string, // display
          text: string, // display
          time: string // to search easily
        }),
        onlyVisibleTo: arrayOf(string)
      }),
      process ({ data, meta, hash }, { state }) {
        const newMessage = createMessage({ meta, data, hash, state })
        Vue.set(state.messages, [state.messages.length], newMessage)
      },
      sideEffect ({ contractID, hash }, { state }) {
        emitMessageEvents({ type: MESSAGE_ACTION_TYPES.ADD_MESSAGE, contractID, hash, state })
      }
    },
    'gi.contracts/chatroom/deleteMessage': {
      validate: objectMaybeOf({

      }),
      process ({ data, meta }, { state }) {

      }
    },
    'gi.contracts/chatroom/editMessage': {
      validate: objectMaybeOf({

      }),
      process ({ data, meta }, { state }) {

      }
    },
    'gi.contracts/chatroom/addEmoticon': {
      validate: objectMaybeOf({

      }),
      process ({ data, meta }, { state }) {

      }
    },
    'gi.contracts/chatroom/deleteEmoticon': {
      validate: objectMaybeOf({

      }),
      process ({ data, meta }, { state }) {

      }
    }
  }
})
