'use strict'

import sbp from '~/shared/sbp.js'
import Vue from 'vue'
import {
  objectMaybeOf, objectOf, mapOf, arrayOf,
  string, boolean, optional, number,
  literalOf, unionOf
} from '~/frontend/utils/flowTyper.js'
import { merge } from '~/frontend/utils/giLodash.js'
import {
  CHATROOM_NAME_LIMITS_IN_CHARS,
  CHATROOM_DESCRIPTION_LIMITS_IN_CHARS,
  chatRoomTypes
} from './constants.js'

export const chatRoomType: any = objectOf({
  name: string, // General, Bulgaria Hackathon 2021, ...
  description: string,
  type: unionOf(...Object.values(chatRoomTypes).map(v => literalOf(v))),
  private: boolean,
  editable: boolean
})

export const ChatMessageTypeNormal = 'normal'
export const ChatMessageTypeInform = 'inform'
export const ChatMessageTypePoll = 'poll'

export const chatMessageNormal: any = objectOf({
  text: string, // can not be empty
  creator: string, // identityContractID
  createdDate: string, // new Date().toISOString() when created
  editedDate: optional(string), // new Date().toISOString() when updated
  removedDate: optional(string), // new Date().toISOString() when removed
  repliedTo: optional(string), // messageID
  previewDismissed: optional(boolean) // we use this when we want to discuss the preview of URL link
})

export const chatMessageInform: any = objectOf({
  text: string, // can not be empty
  creator: string, // TODO: need to decide if necessary
  createdDate: string, // new Date().toISOString()
  // when a channel is removed, the users will automatically redirected to the #general channel and a message would be displayed ONLY for them
  visibleTo: mapOf(string, boolean), // default: {}
  previewDismissed: optional(boolean)
})

export const chatMessagePoll: any = objectOf({
  text: string, // can not be empty
  creator: string, // identityContractID
  createdDate: string, // new Date().toISOString()
  options: arrayOf(string), // minimal length: 2
  votes: mapOf(string, objectOf({ // key: string = identityContractID
    votedFor: number, // index of options
    votedDate: string, // new Date().toISOString()
    updatedDate: string // new Date().toISOString()
  })),
  previewDismissed: optional(boolean)
})

export const messageType: any = objectOf({
  id: string, // hash of message when it is initialized
  // type: unionOf(...[ChatMessageTypeNormal, ChatMessageTypeInform, ChatMessageTypePoll].map(k => literalOf(k))),
  // value: unionOf(...[chatMessageNormal, chatMessageInform, chatMessagePoll])
  text: string,
  creator: string
})

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
      return getters.currentChatRoomState.settings
    },
    chatRoomAttributes (state, getters) {
      return getters.currentChatRoomState.attributes
    },
    chatRoomUsers (state, getters) {
      return getters.currentChatRoomState.users
    },
    chatRoomMessages (state, getters) {
      return getters.currentChatRoomState.messages
    }
  },
  actions: {
    // This is the constructor of Chat contract
    'gi.contracts/chatroom': {
      validate: chatRoomType,
      process ({ meta, data }, { state }) {
        const initialState = merge({
          settings: {
            maxNameLetters: CHATROOM_NAME_LIMITS_IN_CHARS,
            maxDescriptionLetters: CHATROOM_DESCRIPTION_LIMITS_IN_CHARS
          },
          users: {},
          messages: {}
        }, {
          attributes: {
            ...data,
            creator: meta.identityContractID
          }
        })
        for (const key in initialState) {
          Vue.set(state, key, initialState[key])
        }
      }
    },
    'gi.contracts/chatroom/join': {
      validate: objectMaybeOf({
        identityContractID: optional(string)
      }),
      process ({ data, meta }, { state }) {
        const identityContractID = data.identityContractID || meta.identityContractID
        if (state.users[identityContractID]) {
          console.log(`chatroom Join: ${identityContractID} is already joined the chatroom #${state.name}`)
          return
        }
        Vue.set(state.users, identityContractID, {
          joinedDate: meta.createdDate
        })
        // create a new system message to inform a new member is joined
      }
    },
    'gi.contracts/chatroom/renameChatRoom': {
      validate: objectOf({
        name: string
      }),
      process ({ data, meta }, { state }) {
        Vue.set(state.attributes, 'name', data.name)
      }
    }
  }
})