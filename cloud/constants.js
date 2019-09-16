var testTimeouts = process.env.TESTING_TIMEOUTS == "true";

module.exports = Object.freeze({

  INVITE_URL_PREFIX: process.env.SERVER_ROOT + "/join/",



  FAME_CARD_NAMES: [
    "The Chinatown Connection",
    "Dead Planet",
    "Vicious Triangle",
    "Lady of the West"
  ],

  AVATAR_DEFAULT: 0,

  GAME_DEFAULT_CONFIG: {
    slots: [
      { "type": "creator", "avatar": 0 },
      { "type": "open", "avatar": 1 },
      { "type": "open", "avatar": 2 },
      { "type": "open", "avatar": 3 }
    ],
    fameCards: {},
    turnMaxSec: 10
  },

  GAME_MAX_SLOTS: 16,

  START_GAME_MANUAL_TIMEOUT: 10,
  START_GAME_AUTO_TIMEOUT: testTimeouts ? 30 : 2*24*60*60,

  GAME_LIMIT_TOTAL: 20,
  GAME_LIMIT_RECENT: 10,
  GAME_LIMIT_RECENT_TIMEOUT: testTimeouts ? 5 : 60*60,

  GAME_ENDING_INACTIVE_ROUNDS: 2,

  DISPLAY_NAME_MIN: 2,
  DISPLAY_NAME_MAX: 30,

  GAME_PAGING: {
    limit: {
      default: 20,
      min: 1,
      max: 100
    },
    sort: [ { name: "createdAt", dir: "descending" } ]
  },

  FIND_GAME_PAGING: {
    limit: {
      default: 20,
      min: 1,
      max: 100
    },
    sort: [ { name: "createdAt", dir: "ascending" } ]
  },

  LIST_INVITES_PAGING: {
    limit: {
      default: 20,
      min: 1,
      max: 100
    },
    sort: [ { name: "createdAt", dir: "descending" } ]
  },

  TURN_PAGING: {
    limit: {
      default: 3,
      min: 1,
      max: 100
    },
    sort: [ { name: "createdAt", dir: "descending" } ]
  },

  CONTACT_PAGING: {
    limit: {
      default: 100,
      min: 1,
      max: 1000
    },
    sort: [ { name: "createdAt", dir: "descending" } ]
  },

  GameState: {
    Init: 0,
    Lobby: 1,
    Running: 2,
    Ended: 3,

    getName: function(state) {
      for (var prop in GameState) {
        if (GameState[prop] == state) return prop + " (" + state + ")";
      }
      return null;
    }
  },

  PlayerState: {
    Active: 0,
    Inactive: 1
  },

  SlotType: {
    Creator: "creator",
    Open: "open",
    Invite: "invite",
    None: "none",
    AI: "ai",

    parse: function(type) {
      switch (type) {
        case SlotType.Creator:
        case SlotType.Open:
        case SlotType.Invite:
        case SlotType.None:
        case SlotType.AI:
          break;
        default: return null;
      }
      return type;
    }
  },

  AIDifficulty: {
    None:   0,
    Easy:   1,
    Medium: 2,
    Hard:   3,

    parse: function(type) {
      switch (type) {
        case AIDifficulty.None:
        case AIDifficulty.Easy:
        case AIDifficulty.Medium:
        case AIDifficulty.Hard:
          break;
        default: return null;
      }
      return type;
    }
  },

  /**
   * Messages with codes and templates.
   */
  t: {

    AVAILABILITY: { id:   1 },

    GAME_CREATED: { id: 100, m:
      "Game {{game.objectId}} created"
    },
    GAME_STARTED: { id: 101, m:
      "Your game with {{others}} has started!"
    },
    GAME_ENDED: { id: 102, m:
      "Your game with {{others}} has ended!",
    },
    GAME_JOINED: { id: 103 },
    GAME_LEFT: { id: 104 },

    GAME_INVITE: { id: 105, m:
      "{{invite.inviter.user.displayName}} invited you to a game!"
    },
    GAME_LIST: { id: 106 },

    USER_SAVED: { id: 107 },
    
    GAME_INVITE_DECLINED: { id: 108 },

    GAME_LOBBY_TIMEOUT: { id: 120, m:
      "Your game with {{others}} timed out, nobody joined!"
    },
    GAME_INACTIVE_TIMEOUT: { id: 121, m:
      "Your game with {{others}} ran out!"
    },

    GAME_ABORTED: { id: 122, m:
      "Your game with {{others}} ended by creator."
    },

    PLAYER_TURN: { id: 200, m:
      "It's your turn!"
    },

    TURN_SAVED: { id: 300 },
    TURN_LIST: { id: 301 },

    CONTACT_LIST: { id: 400 },
    CONTACT_DELETED: { id: 401 },
    CONTACT_ADDED: { id: 402 },
    CONTACT_BLOCKED: { id: 403 },

    PUSH_TOKEN_SET: { id: 500 },


    // Errors

    INVALID_PARAMETER: { id: 1001, m:
      "Invalid parameter"
    },
    UNKNOWN_ERROR: { id: 1002 },
    USER_NOT_FOUND: { id: 1004, m:
      "User not found."
    },
    DISPLAY_NAME_TAKEN: { id: 1005, m:
      "Display name already taken."
    },
    DISPLAY_NAME_BLACKLISTED: { id: 1006, m:
      "Display name blacklisted."
    },

    GAME_INVALID_STATE: { id: 1100, m:
      "Game state '{{stateName}}' does not accept this operation. Supported states: {{acceptableNames}}"
    },
    GAME_NOT_STARTABLE: { id: 1101, m:
      "Game is not startable yet."
    },
    GAME_START_ERROR: { id: 1102, m:
      "Unable to start game."
    },
    GAME_INSUFFICIENT_PLAYERS: { id: 1103, m:
      "Not enough players to start the game."
    },
    GAME_NOT_FOUND: { id: 1104, m:
      "Game not found."
    },
    GAME_INVITE_ERROR: { id: 1105, m:
      "Unable to get invite."
    },
    GAME_FULL: { id: 1106, m:
      "Unable to join, game is full."
    },
    GAME_FULL_PLAYER_ERROR: { id: 1107, m:
      "Game is too full, but unable to remove player."
    },
    GAME_THIRD_PARTY: { id: 1108, m:
      "Unable to start a third party game."
    },
    GAME_INVALID_TIMEOUT: { id: 1109, m:
      "Invalid game timeout: {{timeout}}"
    },
    GAME_INVALID_CONFIG: { id: 1110, m:
      "Invalid game configuration: {{reason}}"
    },
    GAME_PLAYERS_UNAVAILABLE: { id: 1111, m:
      "{{names}} not available to play a game right now."
    },
    GAME_QUOTA_EXCEEDED: { id: 1112, m:
      "Unable to create game, exceeded quota."
    },

    PLAYER_ALREADY_IN_GAME: { id: 1200, m: 
      "Player already in game."
    },
    PLAYER_NOT_IN_GAME: { id: 1201, m: 
      "Player not in game."
    },
    PLAYER_NOT_FOUND: { id: 1204, m:
      "Player not found."
    },
    PLAYER_NEXT_NO_CURRENT: { id: 1205, m:
      "Unable to find next player, no current player"
    },

    TURN_THIRD_PARTY: { id: 1300, m:
      "Unable to list third party turns."
    },
    TURN_NOT_IT: { id: 1301, m:
      "Game turn invalid, it's not your turn!"
    },
    TURN_INVALID_SAVE: { id: 1302, m:
      "Game turn save string invalid."
    },

    CONTACT_EXISTS: { id: 1400, m:
      "Contact already exists."
    },
    CONTACT_NOT_FOUND: { id: 1404, m:
      "Contact not found."
    },

    PUSH_TOKEN_ERROR: { id: 1500, m:
      "Error occurred while setting push token."
    }

  }

});
