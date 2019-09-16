require('dotenv').config()

var appId = process.env.APP_ID;
var masterKey = process.env.MASTER_KEY;

var constants = require('../cloud/constants.js');
var GameState = constants.GameState;
var PlayerState = constants.PlayerState;
var AIDifficulty = constants.AIDifficulty;

var timeoutMultiplier = 2;
var testTimeouts = process.env.TESTING_TIMEOUTS == "true";

var should = require('chai').should();
var fs = require('fs');
var util = require('util');
var rest = require('rest');
var mime = require('rest/interceptor/mime');
var Parse = require('parse/node');
var kue = require('kue');
var jobs = kue.createQueue({
  prefix: process.env.REDIS_PREFIX || "q",
  redis: process.env.REDIS_URL
});
var Promise = Parse.Promise;
var client = rest.wrap(mime);


var urlRoot = process.env.SERVER_ROOT + "/";
var urlParse = urlRoot + "parse/";

var logins = [
  { name: "Alice", user: "alice@example.com", pass: "p" },
  { name: "Bob", user: "bob@example.com", pass: "p" },
  { name: "Carol", user: "carol@example.com", pass: "p" },
  { name: "Dan", user: "dan@example.com", pass: "p" }
];
var tokens = {};


var messageById = {
  "-1": "unspecified, please fix test"
};
for (var messageName in constants.t) {
  var message = constants.t[messageName];
  if (isNaN(message.id)) throw new Error("Invalid message: " + message);
  var inMap = messageById[message.id];
  if (inMap) throw new Error("Message ID for " + messageName + " already in use by " + inMap);
  messageById[message.id] = messageName;
}


function requestLogin(username, password) {    
  return client({
    path: urlParse + "login" +
      "?username=" + encodeURIComponent(username) + 
      "&password=" + encodeURIComponent(password),
    headers: {
      "X-Parse-Application-Id": appId,
      "X-Parse-Master-Key": masterKey
    }
  }).then(function(response) {
    response.should.have.property("entity");
    return Promise.resolve(response.entity);
  });
}

function parseCall(auth, apiName, payload) {

  var headers = {
    "Content-Type": "application/json",
    "X-Parse-Application-Id": appId
  };

  if (typeof(auth) == 'string') {
    var token = tokens[auth];
    if (typeof(token) != "string" || token === "") {
      return Promise.reject(new Error("Token missing for " + auth));
    }
    headers["X-Parse-Session-Token"] = token;
  } else if (auth && typeof(auth) == 'object') {
    if (auth.useMasterKey) {
      headers["X-Parse-Master-Key"] = masterKey;
    }
  }

  if (apiName.indexOf("/") == -1) apiName = "functions/" + apiName;

  return client({
    path: urlParse + apiName,
    headers: headers,
    entity: payload
  }).then(function(response) {
    response.should.have.property("entity");
    return Promise.resolve(response.entity);
  });
}

function parseError(message) {
  return (function(entity) {
    entityError(entity, message);
  });
}


function entityResult(entity, message) {
  if (typeof(entity.error) == 'string') should.not.exist(entity.error);
  if (entity.error) should.not.exist(entity.error.message);
  if (entity.code) should.not.exist(entity.message);
  entity.should.have.property("result");
  if (message) {
    entity.result.code.should.equal(message.id);
  }
  return entity.result;
}

function entityError(entity, message) {
  if (!message.id) throw new Error("Invalid message provided");

  // Cloud Code Error Code
  
  if (entity.result) {
    var unexpected = messageById[entity.result.code];
    should.not.exist(unexpected);
  }

  entity.should.have.property("code");
  entity.code.should.equal(141);

  entity.should.have.property("error");
  
  var error = entity.error;
  error.should.be.an("object");

  error.should.have.property("message");
  error.message.should.be.a("string");
  
  error.should.have.property("code");
  error.code.should.be.a("number");

  var expected = messageById[message.id];
  expected = expected ? expected + " (" + message.id + ")" : message.id;

  var actual = messageById[error.code];
  if (!actual && error.code >= 1999 && error.code < 3000) {
    actual = "ParseError";
    actual = actual + " (2/" + (error.code - 2000) + ")";
  } else {
    actual = actual ? actual + " (" + error.code + ")" : error.code;
  }

  var msg = "Expected " + actual + " to equal " + expected + "\n" + util.inspect(error);
  error.code.should.equal(message.id, msg);

  error.should.not.have.property("error");
}

function entityGameId(entity) {
  var result = entityResult(entity);
  result.should.have.property("game");
  var game = result.game;
  game.should.have.property("objectId");
  game.objectId.should.be.a("string");
  return game.objectId;
}

function getUserSessions() {
  var sessionFile = __dirname + "/sessions.json";
  var mainPromise = new Promise();
  fs.readFile(sessionFile, "utf8", function(err, data) {
    var pending = [];
    if (err && err.code == "ENOENT") {
      console.info("Sessions file missing, rebuilding: " + sessionFile);
      pending = logins;
    } else {
      tokens = JSON.parse(data);
      logins.forEach(function(login) {
        if (!tokens[login.name]) pending.push(login);
      }, this);
    }
    
    var promises = [];
    pending.forEach(function(login) {
      promises.push(requestLogin(login.user, login.pass));
    }, this);

    if (promises.length === 0) {
      return mainPromise.resolve();
    } else {
      return Promise.when(promises).then(
        function(results) {
          results.forEach(function(loginResult) {
            var user = loginResult.username;
            var name = logins.find(function(login) {
              return login.user == user;
            }).name;
            tokens[name] = loginResult.sessionToken;
            console.log("Updated session token for " + user);
          }, this);

          fs.writeFile(sessionFile, JSON.stringify(tokens), function(err) {
            if (err) {
              mainPromise.reject(new Error(
                "Unable to update sessions file: " + err
              ));
            } else {
              console.log("Sessions file updated");
              mainPromise.resolve();
            }
          });
        },
        function(error) {
          console.error(error);
          mainPromise.reject(new Error("Unable to login all users"));
        }
      );
    }
    
  });

  return mainPromise;
}

function joinGameCheck(entity) {
  entityResult(entity, constants.t.GAME_JOINED)
    .should.have.deep.property("player.objectId");
}

function resultShouldError(message) {
  if (!message.id) {
    resultShouldError({ id: -1 })(message);
  }
  return (function(entity) {
    entityError(entity, message);
  });
}

function joinGame(name, game, desc, playerFunc) {
  if (!desc) desc = 'has ' + name + ' join game and get player id';
  it(desc, function() {
    return parseCall(name, "joinGame", {
      gameId: game.id
    }).then(
      function(entity) {
        if (playerFunc) playerFunc(entity);
        else joinGameCheck(entity);
      }
    );
  });
}

function leaveGame(name, game, desc, playerFunc) {
  if (!desc) desc = 'has ' + name + ' leave game';
  it(desc, function() {
    return parseCall(name, "leaveGame", {
      gameId: game.id
    }).then(
      function(entity) {
        if (playerFunc) playerFunc(entity);
        else entityResult(entity, constants.t.GAME_LEFT);
      }
    );
  });
}

function purgeGames() {
  return parseCall({ useMasterKey: true }, "purgeGamesABCD",
    {}
  ).then(
    function(result) {
      result.should.have.property("result");
      should.equal(result.result.purged, true);
    }
  );
}

function purgeRandom() {
  it('should remove random games first', function() {
    return parseCall({ useMasterKey: true }, "purgeRandomGames",
      {}
    ).then(
      function(result) {
        result.should.have.property("result");
        should.equal(result.result.purged, true);
      }
    );
  });
}

function internalStartGame(name, game, desc, customFunc, delay) {
  var timeBuffer = 1;
  if (!desc) desc = 'has ' + name + ' start the game';
  it(desc, function() {
    
    var promise = new Promise();

    if (delay === 0) {
      promise.resolve();
    } else {
      var relativeDelay = delay - (game.startTime > 0 ? (Date.now() - game.startTime) : 0);
      if (relativeDelay <= 0) {
        promise.resolve();
      } else {
        this.timeout(2000 + relativeDelay);

        setTimeout(function() {
          promise.resolve();
        }, relativeDelay);
      }
    }

    return promise.then(function() {
      return parseCall(name, "startGame", {
        gameId: game.id
      });
    }).then(
      function(entity) {
        if (customFunc) customFunc(entity);
        else {
          var result = entityResult(entity, constants.t.GAME_STARTED);
          result.should.have.deep.property("player.objectId");
          result.game.state.should.equal(GameState.Running);
        }
      }
    );
  });
}

function waitAndStartGame(name, game, desc, customFunc) {
  if (testTimeouts) internalStartGame(name, game, desc, customFunc, constants.START_GAME_MANUAL_TIMEOUT*1000);
}

function startGame(name, game, desc, customFunc) {
  internalStartGame(name, game, desc, customFunc, 0);
}

function listGames(name, gamesObj, desc, testFunc) {
  it(desc, function() {
    var req = {};
    if (gamesObj) {
      var games = null;
      if (Array.isArray(gamesObj)) {
        games = gamesObj;
      } else {
        games = gamesObj.games;
        req.typeId = gamesObj.typeId;
      }
      if (games) req.gameIds = games.map(function(game) { return game.id; });
    }
    return parseCall(name, "listGames", req).then(
      function(entity) {
        var result = entityResult(entity, constants.t.GAME_LIST);
        result.should.have.property("games");
        result.games.should.be.an("array");
        testFunc(result.games);
      }
    );
  });
}

function getGame(name, game, desc, testFunc) {
  if (!desc) desc = 'returns the right game status to ' + name;
  listGames(name, { games: [game], typeId: game.typeId }, desc, function(games) {
    games.should.have.length(1);
    testFunc(games[0]);
  });
}

function makeTurn(name, game, type, turnNumber) {
  var msg;
  switch (type) {
    case "invalid": msg = "get invalid state for"; break;
    default: msg = type;
  }
  it('should ' + msg + ' game turn by ' + name, function() {
    return parseCall(name, "gameTurn", {
      gameId: game.id,
      save: "turn " + turnNumber,
      final: type == "finish"
    }).then(
      function(entity) {
        switch (type) {
          case "allow":
            entityResult(entity, constants.t.TURN_SAVED);
            break;
          
          case "invalid":
            entityError(entity, constants.t.GAME_INVALID_STATE);
            break;

          case "deny":
            entityError(entity, constants.t.TURN_NOT_IT);
            break;

          case "finish":
            var result = entityResult(entity, constants.t.TURN_SAVED);
            result.should.have.property("ended");
            result.ended.should.equal(true);
            break;

          default:
            should.fail(entity, "supported type", "Invalid turn type");
        }
      }
    );
  });
}

function getJob(id) {
  var promise = new Promise();
  kue.Job.get(id, function(err, job) {
    if (err) {
      promise.reject(new Error(err));
      return;
    }
    promise.resolve(job);
  });
  return promise;
}

function checkDeletedJob(id) {
  var promise = new Promise();
  getJob(id).then(
    function(job) {
      promise.reject(new Error(
        "Job was found, but it should've been deleted: " + job.id
      ));
    },
    function(err) {
      promise.resolve();
    }
  );
  return promise;
}


describe('public', function() {
  describe('name check', function() {

    function checkName(desc, name, err) {
      it(desc, function() {
        return parseCall(null, "checkNameFree", {
          displayName: name
        }).then(
          function(entity) {
            var result = entityResult(entity);
            result.available.should.equal(!err);
            if (err) {
              result.should.have.property("reason");
              result.reason.code.should.equal(err.id);
            }
          }
        );
      });
    }

    checkName("denies existing name", "Ally", constants.t.DISPLAY_NAME_TAKEN);
    checkName("approves a free name", "47421dabef3b", null);
    checkName("denies too short name", "a", constants.t.INVALID_PARAMETER);
    checkName("denies too long name", "ThisNameIsWayTooLongAndDefinitelyGoesOverTheLimit", constants.t.INVALID_PARAMETER);
    checkName("denies an obscene name", "shitosaur", constants.t.DISPLAY_NAME_BLACKLISTED);
    
    it("should error on missing parameter", function() {
      return parseCall(null, "checkNameFree", {}).then(
        parseError(constants.t.INVALID_PARAMETER)
      );
    });

    it("should error on empty name", function() {
      return parseCall(null, "checkNameFree", {
        displayName: ""
      }).then(
        parseError(constants.t.INVALID_PARAMETER)
      );
    });

  });
});


describe('game flow', function() {
  before(getUserSessions);

  describe('invite', function() {

    function checkSlots(game, expectedFill) {
      listGames("Alice", [game],
        "should return these slots as filled: " + expectedFill,
        function(games) {
          games.should.have.length(1);
          game.id.should.equal(games[0].objectId);

          var slots = games[0].config.slots;
          var filled = slots.map(function(slot) {
            return slot.filled;
          })

          filled.should.deep.equal(expectedFill);

        }
      );
    }

    describe('four player game', function() {
        
      var game = {};

      it('creates a game and gets the game id with Alice', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { type: "creator" },
            { type: "open" },
            { type: "invite", displayName: "Bobzor" },
            { type: "invite", displayName: "Carry" },
          ],
          "fameCards": {},
          "turnMaxSec": 60
        }).then(
          function(entity) {
            game.id = entityGameId(entity);
            var result = entityResult(entity, constants.t.GAME_CREATED);
            result.game.state.should.equal(GameState.Lobby);

            var slots = result.game.config.slots;
            slots.should.have.length(4);
            slots[3].type.should.equal("invite");

          }
        );
      });
      
      checkSlots(game, [true, false, false, false])

      joinGame("Bob", game);
      checkSlots(game, [true, false, true, false])
      listGames("Alice", [game],
        "should keep the same slot type",
        function(games) {
          games.should.have.length(1);
          game.id.should.equal(games[0].objectId);

          var slots = games[0].config.slots;
          slots.should.have.length(4);
          slots[3].type.should.equal("invite");
        }
      );

      it('declines invite with Carol', function() {
        return parseCall("Carol", "declineInvite", {
          "gameId": game.id
        }).then(
          function(entity) {
            entityResult(entity, constants.t.GAME_INVITE_DECLINED);
          }
        );
      });
      checkSlots(game, [true, false, true, false])

      listGames("Alice", [game],
        "should have the slot type changed to open",
        function(games) {
          games.should.have.length(1);
          game.id.should.equal(games[0].objectId);

          var slots = games[0].config.slots;
          slots.should.have.length(4);
          slots[3].type.should.equal("open");
        }
      );
    })

    describe('two player game', function() {
        
      var game = {};

      purgeRandom();

      it('creates a game and gets the game id with Alice', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { type: "creator" },
            { type: "invite", displayName: "Bobzor" },
          ],
          "fameCards": {},
          "turnMaxSec": 60
        }).then(
          function(entity) {
            game.id = entityGameId(entity);
            var result = entityResult(entity, constants.t.GAME_CREATED);
            result.game.state.should.equal(GameState.Lobby);

            var slots = result.game.config.slots;
            slots.should.have.length(2);
            slots[1].type.should.equal("invite");
          }
        );
      });
      
      it('finds no games with Bob', function() {
        return parseCall("Bob", "findGames", {
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.GAME_LIST);
            result.should.have.property("games");
            result.games.should.have.length(0);
          }
        );
      });
      
      it('finds no games with Carol', function() {
        return parseCall("Carol", "findGames", {
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.GAME_LIST);
            result.should.have.property("games");
            result.games.should.have.length(0);
          }
        );
      });

      it('declines invite with Bob', function() {
        return parseCall("Bob", "declineInvite", {
          "gameId": game.id
        }).then(
          function(entity) {
            entityResult(entity, constants.t.GAME_INVITE_DECLINED);
          }
        );
      });
      checkSlots(game, [true, false])

      it('should find a game with Bob after declining invite', function() {
        return parseCall("Bob", "findGames", {
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.GAME_LIST);
            result.should.have.property("games");
            result.games.should.have.length(1);
          }
        );
      });
      
      it('should find a game with Carol after declining invite', function() {
        return parseCall("Carol", "findGames", {
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.GAME_LIST);
            result.should.have.property("games");
            result.games.should.have.length(1);
          }
        );
      });
      
    })

    describe("list", function() {

      var gameByName = {};

      it('creates an Alice game inviting Bob and Carol', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { type: "creator" },
            { type: "open" },
            { type: "invite", displayName: "Bobzor" },
            { type: "invite", displayName: "Carry" },
          ],
          "turnMaxSec": 60
        }).then(
          function(entity) {
            gameByName.Alice = { id: entityGameId(entity) }
          }
        );
      });

      it('creates a Bob game inviting Carol', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { type: "creator" },
            { type: "open" },
            { type: "invite", displayName: "Carry" },
          ],
          "turnMaxSec": 60
        }).then(
          function(entity) {
            gameByName.Bob = { id: entityGameId(entity) }
          }
        );
      });

      it('contains Alice\'s game for Bob', function() {
        return parseCall("Bob", "listInvites", {
          limit: 1
        }).then(
          function(entity) {
            var result = entityResult(entity);
            result.should.have.property("games");
            
            var games = result.games;
            games.should.have.length(1);

            var game = games[0];
            game.objectId.should.equal(gameByName.Alice.id);
          }
        )
      })

      it('contains Bob\'s and Alice\'s game for Carol', function() {
        return parseCall("Carol", "listInvites", {
          limit: 2
        }).then(
          function(entity) {
            var result = entityResult(entity);
            result.should.have.property("games");
            
            var games = result.games;
            games.should.have.length(2);

            games[0].objectId.should.equal(gameByName.Bob.id);
            games[1].objectId.should.equal(gameByName.Alice.id);
          }
        )
      })

    })

  })


  describe('two user game', function() {

    var gameByName = {};
    var game = {};
    var gameBob = {};

    it('creates a game and gets the game id with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "none" },
          { "type": "none" }
        ],
        "fameCards": { "The Chinatown Connection": 3 },
        "turnMaxSec": 60
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          var result = entityResult(entity, constants.t.GAME_CREATED);
          result.game.state.should.equal(GameState.Lobby);

          var config = result.game.config;
          config.playerNum.should.equal(2);
          config.isRandom.should.equal(true);
          config.fameCards.should.have.property("The Chinatown Connection");
          config.fameCards["The Chinatown Connection"].should.equal(3);
          config.turnMaxSec.should.equal(60);
          gameByName.Alice = game.id;
        }
      );
    });

    
    it('gets an invite link with Alice', function() {
      return parseCall("Alice", "getInvite", {
        "gameId": game.id
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_INVITE);
          result.should.have.property("link");
          game.invite = result.link;
          result.should.have.deep.property("invite.objectId");
          result.link.should.equal(constants.INVITE_URL_PREFIX + result.invite.objectId);
        }
      );
    });


    it('gets the same invite link with Alice', function() {
      return parseCall("Alice", "getInvite", {
        "gameId": game.id
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_INVITE);
          result.should.have.property("link");
          result.link.should.equal(game.invite);
        }
      );
    });

    getGame("Alice", game, '', function(game) {
      should.exist(game);
      game.state.should.equal(GameState.Lobby);
      game.turn.should.equal(0);

      game.should.have.property("freeSlots");
      game.freeSlots.should.equal(1);
      game.should.have.property("joined");
      game.joined.should.equal(true);

      game.should.have.property("config");
      game.config.should.have.property("slots");
      var slots = game.config.slots;
      slots.should.have.length(4);
      slots[0].type.should.equal("creator");
      slots[0].filled.should.equal(true);
      slots[1].type.should.equal("open");
      slots[1].filled.should.equal(false);
      slots[2].type.should.equal("none");
      slots[2].filled.should.equal(false);
      slots[3].type.should.equal("none");
      slots[3].filled.should.equal(false);
    });

    makeTurn("Alice", game, "invalid");
    makeTurn("Bob",   game, "invalid");
    makeTurn("Carol", game, "invalid");

    joinGame("Alice", game,
      "should fail joining Alice as it's her game",
      resultShouldError(constants.t.PLAYER_ALREADY_IN_GAME)
    );
    
    joinGame("Bob", game);


    getGame("Alice", game, '', function(game) {
      game.state.should.equal(GameState.Running);
      game.turn.should.equal(0);
    });

    joinGame("Carol", game,
      "should fail joining Carol as the game is running",
      resultShouldError(constants.t.GAME_INVALID_STATE)
    );

    it('creates another game with Bob', function() {
      return parseCall("Bob", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "open" },
          { "type": "open" }
        ],
        "fameCards": { "The Chinatown Connection": 3 },
        "turnMaxSec": 60
      }).then(
        function(entity) {
          gameByName.Bob = gameBob.id = entityGameId(entity);
        }
      );
    });

    getGame(
      "Bob",
      gameBob,
      'should return one free slot for game',
      function(game) {
        should.exist(game);
        game.should.have.property("freeSlots");
        game.freeSlots.should.equal(3);
        game.should.have.property("joined");
        game.joined.should.equal(true);
      }
    );


    var turnNumber = 0;

    makeTurn("Bob",   game, "deny",  turnNumber);

    it('should error on missing game turn save', function() {
      return parseCall('Alice', "gameTurn", {
        gameId: game.id
      }).then(
        function(entity) {
          entityError(entity, constants.t.TURN_INVALID_SAVE);
        }
      );
    });
    
    it('should error on undefined game turn save', function() {
      return parseCall('Alice', "gameTurn", {
        gameId: game.id,
        save: undefined
      }).then(
        function(entity) {
          entityError(entity, constants.t.TURN_INVALID_SAVE);
        }
      );
    });

    it('should error on null game turn save', function() {
      return parseCall('Alice', "gameTurn", {
        gameId: game.id,
        save: null
      }).then(
        function(entity) {
          entityError(entity, constants.t.TURN_INVALID_SAVE);
        }
      );
    });

    it('should error on empty game turn save', function() {
      return parseCall('Alice', "gameTurn", {
        gameId: game.id,
        save: ""
      }).then(
        function(entity) {
          entityError(entity, constants.t.TURN_INVALID_SAVE);
        }
      );
    });

    it('should error on wrong type game turn save', function() {
      return parseCall('Alice', "gameTurn", {
        gameId: game.id,
        save: 12345
      }).then(
        function(entity) {
          entityError(entity, constants.t.TURN_INVALID_SAVE);
        }
      );
    });

    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Alice", game, "deny",  turnNumber);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "deny",  turnNumber);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "deny",  turnNumber);

    
    it('denies listing of turns by Carol', function() {
      return parseCall("Carol", "listTurns", {
        gameId: game.id,
        limit: 100,
        skip: 0
      }).then(resultShouldError(constants.t.TURN_THIRD_PARTY));
    });

    it('gets the latest turn with Alice', function() {
      return parseCall("Alice", "listTurns", {
        gameId: game.id,
        limit: 1
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turns");
          result.turns.should.have.length(1);
          var turn = result.turns[0];
          turn.turn.should.equal(5);
          turn.save.should.equal("turn 5");
          turn.player.user.displayName.should.equal("Bobzor");
        }
      );
    });

    it('gets two turns in the middle with Alice', function() {
      return parseCall("Alice", "listTurns", {
        gameId: game.id,
        limit: 2,
        skip: 1
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turns");
          result.turns.should.have.length(2);

          var turnAlice = result.turns[0];
          turnAlice.player.user.displayName.should.equal("Ally");
          turnAlice.turn.should.equal(4);

          var turnBob = result.turns[1];
          turnBob.player.user.displayName.should.equal("Bobzor");
          turnBob.turn.should.equal(3);
        }
      );
    });


    it('gets a valid list of all turns with Bob', function() {
      return parseCall("Bob", "listTurns", {
        gameId: game.id,
        limit: 100,
        skip: 0
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turns");
          result.turns.forEach(function(turn) {
            turn.save.should.equal("turn " + turn.turn);
            turn.player.user.displayName.should.equal(
              turn.turn%2 === 0 ? "Ally" : "Bobzor"
            );
          }, this);
        }
      );
    });


    getGame("Bob", game, '', function(game) {
      game.state.should.equal(GameState.Running);
      game.turn.should.equal(6);
    });

    function matchGameId(name, gameNeedle) {
      listGames(
        name,
        null,
        'should return created game id in the list of games to ' + name,
        function(games) {
          games.some(function(game) {
            return game.objectId == gameNeedle.id;
          }).should.equal(true);
        }
      );

      listGames(
        name,
        null,
        'should not return a 3rd party game to ' + name,
        function(games) {
          function gameMatcher(matcher, game) {
            return game.id == ngame;
          }

          for (var gname in gameByName) {
            var ngame = gameByName[gname];
            if (gname != name && ngame != gameNeedle.id) {
              games.some(gameMatcher.bind(this, gname)).should.equal(false);
            }
          }
        }
      );
    }
    
    matchGameId('Alice', game);
    matchGameId('Bob', game);

    makeTurn("Alice", game, "finish", turnNumber++);

    getGame("Bob", game, 'should get the ended game state with one more turn', function(game) {
      game.state.should.equal(GameState.Ended);
      game.turn.should.equal(7);
    });

    makeTurn("Alice", game, "invalid");
    makeTurn("Bob",   game, "invalid");
    makeTurn("Carol", game, "invalid");
    makeTurn("Dan",   game, "invalid");
    
    listGames("Alice", [game],
      "test",
      function(games) {
        games.should.have.length(1);
        var bobSlot = games[0].config.slots[1];
        bobSlot.filled.should.equal(true);
        bobSlot.should.have.deep.property('player.user.displayName');
        bobSlot.player.user.displayName.should.equal('Bobzor');
      }
    );
    
    leaveGame("Bob", game);
    
    listGames("Alice", [game],
      "test",
      function(games) {
        games.should.have.length(1);
        var bobSlot = games[0].config.slots[1];
        bobSlot.filled.should.equal(true);
        bobSlot.should.have.deep.property('player.user.displayName');
        bobSlot.player.user.displayName.should.equal('Bobzor');
      }
    );

  });


  describe('typeId filtering', function() {

    var gameDefault = {};
    var gameTypeOne = { typeId: 1 };

    purgeRandom();

    it('creates a default id game with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "none" },
          { "type": "none" }
        ],
        "turnMaxSec": 60
      }).then(
        function(entity) {
          gameDefault.id = entityGameId(entity);
          var result = entityResult(entity, constants.t.GAME_CREATED);
          result.game.state.should.equal(GameState.Lobby);
        }
      );
    });

    it('creates a typeId 1 game with Alice', function() {
      return parseCall("Alice", "createGame", {
        "typeId": gameTypeOne.typeId,
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "none" },
          { "type": "none" }
        ],
        "turnMaxSec": 60
      }).then(
        function(entity) {
          gameTypeOne.id = entityGameId(entity);
          var result = entityResult(entity, constants.t.GAME_CREATED);
          result.game.state.should.equal(GameState.Lobby);
        }
      );
    });

    getGame("Alice", gameDefault, 'does not return a typeId for Alice', function(game) {
      should.exist(game);

      game.should.have.property("config");
      game.config.should.not.have.property("typeId");
    });

    listGames("Alice", [gameDefault],
      "should return the game in the list of active games for Alice",
      function(games) {
        games.should.have.length(1);
        gameDefault.id.should.equal(games[0].objectId);
      }
    );

    listGames("Alice", [gameTypeOne],
      "should not return typeId 1 game in the list of default active games for Alice",
      function(games) {
        games.should.have.length(0);
      }
    );

    getGame("Alice", gameTypeOne, 'does return typeId 1 for Alice if requested', function(game) {
      should.exist(game);

      game.should.have.property("config");
      game.config.should.have.property("typeId");
      game.config.typeId.should.equal(1);
    });

    listGames("Alice", { typeId: 1, games: [gameTypeOne] },
      "should return typeId 1 game when filtered to typeId 1 games for Alice",
      function(games) {
        games.should.have.length(1);
        gameTypeOne.id.should.equal(games[0].objectId);
      }
    );

    it('finds only the default game by default with Bob', function() {
      return parseCall("Bob", "findGames", {}).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          result.should.have.property("games");
          result.games.should.have.length(1);
          gameDefault.id.should.equal(result.games[0].objectId);
        }
      );
    });

    it('finds only the typeId 1 game when filtered with Bob', function() {
      return parseCall("Bob", "findGames", { typeId: 1 }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          result.should.have.property("games");
          result.games.should.have.length(1);
          gameTypeOne.id.should.equal(result.games[0].objectId);
        }
      );
    });

  });

  describe('find games', function() {

    var gameInfos = [];
    var gameToJoin = {};
    var gameNum = 7;

    purgeRandom();

    it('finds no games with Bob after all of them are removed', function() {
      return parseCall("Bob", "findGames", {
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          result.should.have.property("games");
          result.games.should.have.length(0);
        }
      );
    });

    function createRandomGame(gameInfos) {
      return parseCall("Alice", "createGame", {
        "fameCards": { "The Chinatown Connection": 3 },
        "turnMaxSec": 60
      }).then(
        function(entity) {
          var gameInfo = entityResult(entity, constants.t.GAME_CREATED);
          gameInfo.should.have.property("game");
          gameInfos.push(gameInfo);
        }
      );
    }
    
    for (var gameIndex = 0; gameIndex < gameNum; gameIndex++) {
      it('should make Alice create random game #' + (gameIndex + 1) + ' and get the result', createRandomGame.bind(null, gameInfos));
    }

    it('finds random games with Bob that match the above', function() {
      return parseCall("Bob", "findGames", {
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          should.not.exist(result.playerCount);
          result.should.have.property("games");
          var games = result.games;
          games.should.have.length(gameNum);
          for (var gameIndex = 0; gameIndex < gameNum; gameIndex++) {
            var game = games[gameIndex];
            should.exist(game);
            game.should.have.property("objectId");
            game.objectId.should.equal(gameInfos[gameIndex].game.objectId);
            game.joined.should.equal(false);
          }
        }
      );
    });

    it('finds the first three games with Bob', function() {
      return parseCall("Bob", "findGames", {
        "limit": 3
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          should.not.exist(result.playerCount);
          result.should.have.property("games");
          var games = result.games;
          games.should.have.length(3);
          for (var gameIndex = 0; gameIndex < 3; gameIndex++) {
            games.should.have.property(gameIndex);
            var game = games[gameIndex];
            game.should.have.property("objectId");
            game.objectId.should.equal(gameInfos[gameIndex].game.objectId);
          }
        }
      );
    });

    it('finds the next three games with Bob', function() {
      return parseCall("Bob", "findGames", {
        "limit": 3,
        "skip": 3
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          should.not.exist(result.playerCount);
          result.should.have.property("games");
          var games = result.games;
          games.should.have.length(3);
          for (var gameIndex = 0; gameIndex < 3; gameIndex++) {
            games.should.have.property(gameIndex);
            var game = games[gameIndex];
            game.should.have.property("objectId");
            game.objectId.should.equal(gameInfos[3 + gameIndex].game.objectId);
          }
        }
      );
    });

    
    it('finds the one random game to join with Bob', function() {
      return parseCall("Bob", "findGames", {
        "limit": 1,
        "skip": 1,
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          should.not.exist(result.playerCount);
          result.should.have.property("games");
          var games = result.games;
          games.should.have.length(1);
          var game = games[0];
          should.exist(game);
          game.should.have.property("objectId");
          game.objectId.should.equal(gameInfos[1].game.objectId);
          game.joined.should.equal(false);
          gameToJoin.id = game.objectId;
        }
      );
    });

    joinGame("Bob", gameToJoin, "should try joining the found game with Bob");
    joinGame("Bob", gameToJoin,
      "should not be able to join twice",
      resultShouldError(constants.t.PLAYER_ALREADY_IN_GAME)
    );

    it('verified joined status for three games', function() {
      return parseCall("Bob", "findGames", {
        "limit": 3,
        "skip": 0
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          var games = result.games;
          for (var gameIndex = 0; gameIndex < 3; gameIndex++) {
            var game = games[gameIndex];
            game.joined.should.equal(gameIndex == 1);
          }
        }
      );
    });

    describe('free slots', function() {

      function createGameSlotsCheck(entity) {
        var gameInfo = entityResult(entity, constants.t.GAME_CREATED);
        gameInfo.game.config.should.have.property("slots");
        game.id = gameInfo.game.objectId;
      }
      function createGameSlots(game, slots, desc, resultFunc) {
        if (!desc) desc = "create game with " + slots.length + " slots";
        it(desc, function() {
          return parseCall("Alice", "createGame", {
            "slots": slots
          }).then(
            function(entity) {
              if (resultFunc) resultFunc(entity);
              else createGameSlotsCheck(entity);
            }
          );
        });
      }

      function checkFreeSlots(game, desc, playerNum) {
        it("should equal " + playerNum + " for " + desc, function() {
          return parseCall("Alice", "findGames", {}).then(
            function(entity) {
              var result = entityResult(entity, constants.t.GAME_LIST);
              result.should.have.property("games");
              if (playerNum == -1) {
                result.games.length.should.equal(0);
              } else {
                result.games.length.should.equal(1);
                result.games[0].freeSlots.should.equal(playerNum);
              }
            }
          );
        });
      }

      var game = {};
      function testGameSlots(desc, playerNum, slots) {
        purgeRandom();
        createGameSlots(game, desc, slots);
        checkFreeSlots(game, playerNum);
      }
      
      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "none" },
        { type: "none" },
        { type: "none" }
      ]);
      checkFreeSlots(game, 'game with no open slots', -1);
      
      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "none" },
        { type: "none" }
      ]);
      checkFreeSlots(game, 'game with one open slot', 1);

      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "open" },
        { type: "none" }
      ]);
      checkFreeSlots(game, 'game with two open slots', 2);

      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "invite", displayName: "Bobzor" },
        { type: "none" }
      ]);
      checkFreeSlots(game, 'game with one open slot and one invite slot', 1);
      
      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "open" },
        { type: "open" }
      ]);
      joinGame("Bob", game);
      checkFreeSlots(game, 'game with three open slots, one filled', 2);
      
      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "invite", displayName: "Bobzor" },
        { type: "open" }
      ]);
      joinGame("Bob", game);
      joinGame("Carol", game);
      checkFreeSlots(game, 'game with one invite, two open slots, one filled', 1);
      
      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "invite", displayName: "Bobzor" },
        { type: "invite", displayName: "Carry" },
      ]);
      joinGame("Bob", game);
      joinGame("Carol", game);
      checkFreeSlots(game, 'game with two invites, one open', 1);
      
      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "invite", displayName: "Bobzor" },
        { type: "invite", displayName: "Bobzor" },
        { type: "open" }
      ], "duplicate invites should error", resultShouldError(constants.t.GAME_INVALID_CONFIG));



      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "ai", difficulty: 2 },
        { type: "open" }
      ]);
      joinGame("Bob", game);
      checkFreeSlots(game, 'game with two open, one ai', 1);

      function checkSlots(game) {
        game.should.have.property("config");
        var config = game.config;
        config.should.have.property("slots");
        var slots = config.slots;
        slots.should.have.length(4);

        slots[0].type.should.equal("creator");
        slots[0].filled.should.equal(true);
        slots[0].should.have.property("player");
        slots[0].player.should.have.property("user");
        slots[0].player.user.displayName.should.equal("Ally");

        slots[1].type.should.equal("open");
        slots[1].filled.should.equal(true);
        slots[1].should.have.property("player");
        slots[1].player.should.have.property("user");
        slots[1].player.user.displayName.should.equal("Bobzor");

        slots[2].type.should.equal("ai");
        slots[2].filled.should.equal(true);
        slots[2].should.not.have.property("player");
        slots[2].difficulty.should.equal(2);

        slots[3].type.should.equal("open");
        slots[3].filled.should.equal(false);
        slots[3].should.not.have.property("player");
      }

      checkFreeSlots(game, 'game with one ai slot, two open slots, one filled', 1);
      it("should have the right slot config returned", function() {
        return parseCall("Alice", "findGames", {}).then(
          function(entity) {
            var result = entityResult(entity, constants.t.GAME_LIST);
            result.should.have.property("games");
            result.games.length.should.equal(1);
            var game = result.games[0];
            checkSlots(game);
          }
        );
      });
      it("should have the right slot config returned with listGames too", function() {
        return parseCall("Alice", "listGames", { "limit": 1 }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.GAME_LIST);
            result.should.have.property("games");
            result.games.length.should.equal(1);
            var game = result.games[0];
            checkSlots(game);
          }
        );
      });

      

      purgeRandom();
      createGameSlots(game, [
        { type: "creator" },
        { type: "open" },
        { type: "none" },
        { type: "open" }
      ]);
      joinGame("Bob", game);
      checkFreeSlots(game, 'game with two open, one none', 1);





    });


  });


  describe("start game", function() {

    var game = {};
    var nonstarterGame = {};

    it('creates a game and gets the game id with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "open" }
        ],
        "fameCards": { "The Chinatown Connection": 3 },
        "turnMaxSec": 60
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          game.startTime = Date.now();
        }
      );
    });

    it('creates a game and gets the game id with Bob', function() {
      return parseCall("Bob", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "open" }
        ],
        "fameCards": { "The Chinatown Connection": 3 },
        "turnMaxSec": 60
      }).then(
        function(entity) {
          nonstarterGame.id = entityGameId(entity);
          nonstarterGame.startTime = Date.now();
        }
      );
    });

    joinGame("Bob", game);
    
    startGame("Alice", game,
      'should not allow Alice to start the game already',
      resultShouldError(constants.t.GAME_NOT_STARTABLE)
    );

    startGame("Bob", game,
      'should not allow Bob to start the Alice game',
      resultShouldError(constants.t.GAME_THIRD_PARTY)
    );

    startGame("Bob", nonstarterGame,
      'should not allow Bob to start his game already',
      resultShouldError(constants.t.GAME_NOT_STARTABLE)
    );
    
    waitAndStartGame("Bob", nonstarterGame,
      'should not allow Bob to start a game with just himself',
      resultShouldError(constants.t.GAME_INSUFFICIENT_PLAYERS)
    );
    
    waitAndStartGame("Bob", game,
      'should not allow a non-creator to start the game',
      resultShouldError(constants.t.GAME_THIRD_PARTY)
    );

    waitAndStartGame("Alice", game,
      'should allow Alice to start the game after the timeout'
    );
    
    waitAndStartGame("Bob", game,
      'should not allow Bob to start the game after Alice',
      resultShouldError(constants.t.GAME_THIRD_PARTY)
    );

    waitAndStartGame("Alice", game,
      'should not allow Alice to start the game twice',
      resultShouldError(constants.t.GAME_NOT_STARTABLE)
    );
    
  });



  describe("leave game", function() {

    var game = {};
    
    it('creates a game and gets the game id with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "open" }
        ],
        "fameCards": { "The Chinatown Connection": 3 },
        "turnMaxSec": 7
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
        }
      );
    });

    leaveGame("Bob", game,
      "should not allow Bob to leave a game he's not in",
      resultShouldError(constants.t.PLAYER_NOT_IN_GAME)
    );

    joinGame("Bob", game);
    joinGame("Carol", game);

    var turnNumber = 0;

    makeTurn("Bob",   game, "deny", turnNumber);
    makeTurn("Carol", game, "deny", turnNumber);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Alice", game, "deny", turnNumber);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "deny", turnNumber);
    makeTurn("Carol", game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Carol", game, "allow", turnNumber++);
    

    listGames("Alice", [game],
      "should return the game in the list of active games for Alice",
      function(games) {
        games.should.have.length(1);
        game.id.should.equal(games[0].objectId);
      }
    );


    leaveGame("Alice", game);
    
    listGames("Alice", [game],
      "should remove the game from the list of active games for Alice",
      function(games) {
        games.should.have.length(0);
      }
    );
    
    listGames("Bob", [game],
      "should change the Alice slot type to AI",
      function(games) {
        games.should.have.length(1);
        
        var slots = games[0].config.slots;
        slots.should.have.length(3);
        slots[0].type.should.equal("ai");
        slots[0].filled.should.equal(true);
        slots[0].should.have.deep.property("player.user.displayName");
        slots[0].player.user.displayName.should.equal("Ally");
      }
    );

    leaveGame("Alice", game,
      "should not allow Alice to leave the game twice",
      resultShouldError(constants.t.PLAYER_NOT_IN_GAME)
    );

    makeTurn("Alice", game, "deny", turnNumber);
    makeTurn("Carol", game, "deny", turnNumber);
    makeTurn("Bob",   game, "allow", turnNumber++);

    joinGame("Alice", game,
      "should not allow Alice to rejoin",
      resultShouldError(constants.t.GAME_INVALID_STATE)
    );
    leaveGame("Bob", game);

    listGames("Carol", [game],
      "should change the Bob slot type to AI",
      function(games) {
        games.should.have.length(1);
        
        var slots = games[0].config.slots;
        slots.should.have.length(3);
        slots[1].type.should.equal("ai");
      }
    );

    leaveGame("Bob", game,
      "should not allow Bob to leave the game twice",
      resultShouldError(constants.t.PLAYER_NOT_IN_GAME)
    );
    joinGame("Bob", game,
      "should not allow Bob to rejoin",
      resultShouldError(constants.t.GAME_INVALID_STATE)
    );

    it("should keep the game alive with one player left", function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.state.should.equal(GameState.Running);
        }
      );
    });

    leaveGame("Carol", game);

    it("should destroy the game after the last player leaves", function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          entityError(entity, constants.t.GAME_NOT_FOUND);
        }
      );
    });

    describe("before starting", function() {
        
      var game = {};

      it('creates a game and gets the game id with Alice', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { "type": "creator" },
            { "type": "open" },
            { "type": "open" },
            { "type": "open" }
          ],
          "turnMaxSec": 10
        }).then(
          function(entity) {
            game.id = entityGameId(entity);
          }
        );
      });
      joinGame("Bob", game);
      leaveGame("Bob", game, "with Bob");

      listGames("Alice", [game],
        "should keep it running after Bob leaves",
        function(games) {
          games.should.have.length(1);
          
          var slots = games[0].config.slots;
          slots.should.have.length(4);
          slots[1].type.should.equal("open");
          slots[1].filled.should.equal(true);
          slots[1].should.have.deep.property("player.user.displayName");
          slots[1].player.user.displayName.should.equal("Bobzor");
          slots[1].player.state.should.equal(PlayerState.Inactive);
        }
      );

      joinGame("Carol", game);

      leaveGame("Alice", game, "with Alice");
        
      it("should end the game", function() {
        return parseCall({ useMasterKey: true }, "debugGame", {
          gameId: game.id
        }).then(
          function(entity) {
            var result = entityResult(entity);
            result.state.should.equal(GameState.Ended);
          }
        );
      });

    });

  });

  describe("two user, then solo game", function() {
    
    var game = {};

    it('creates a game and gets the game id with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" }
        ],
        "fameCards": {},
        "turnMaxSec": 60
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
        }
      );
    });

    makeTurn("Alice", game, "invalid");
    makeTurn("Bob",   game, "invalid");

    joinGame("Bob", game);

    var turnNumber = 0;

    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    
    getGame("Bob", game, 'should be running before Alice leaves', (function(turn, game) {
      game.state.should.equal(GameState.Running);
      game.turn.should.equal(turn);
    }).bind(this, turnNumber++));

    leaveGame("Alice", game, null);

    getGame("Bob", game, 'should keep running after Alice leaves', (function(turn, game) {
      game.state.should.equal(GameState.Running);
      game.turn.should.equal(turn);
    }).bind(this, turnNumber++));

    makeTurn("Alice", game, "deny", turnNumber);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "allow", turnNumber++);
    makeTurn("Bob",   game, "finish", turnNumber++);
    
    getGame("Bob", game, 'should end after finishing turn', function(game) {
      game.state.should.equal(GameState.Ended);
    });

  });

  describe("ai", function() {
    describe("should copy the turn if the current player leaves", function() {
        
      var game = {};

      it('creates a game and gets the game id with Alice', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { "type": "creator" },
            { "type": "open" },
            { "type": "open" }
          ],
          "turnMaxSec": 10
        }).then(
          function(entity) {
            game.id = entityGameId(entity);
          }
        );
      });
      joinGame("Bob", game);
      joinGame("Carol", game);

      turnNumber = 0;

      makeTurn("Alice", game, "allow", turnNumber++);
      makeTurn("Bob",   game, "allow", turnNumber++);
      makeTurn("Carol", game, "allow", turnNumber++);
      makeTurn("Alice", game, "allow", turnNumber++);

      leaveGame("Bob", game);

      it("gets the copied turn", function() {
        return parseCall("Alice", "listTurns", {
          gameId: game.id,
          limit: 2
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.TURN_LIST);
            var turns = result.turns;
            turns[0].turn.should.equal(4);
            turns[0].player.user.displayName.should.equal("Bobzor");
            turns[1].turn.should.equal(3);
            turns[1].player.user.displayName.should.equal("Ally");
            turns[0].save.should.equal(turns[1].save);
            turns[0].save.should.equal("turn 3");
          }
        );
      })

      listGames("Alice", [game],
        "should turn to AI and advance to the next player",
        function(games) {
          games.should.have.length(1);
          var gameResult = games[0];
          game.id.should.equal(gameResult.objectId);


          var slots = gameResult.config.slots;
          slots.should.have.length(3);
          slots[1].type.should.equal(constants.SlotType.AI);
          
          var currentPlayer = gameResult.currentPlayer;
          currentPlayer.user.displayName.should.equal("Carry");
        }
      ); 
      
    });

    if (testTimeouts) describe("should copy the turn if the current player times out", function() {
        
      var game = {};
      var turnMaxSec = 5;

      it('creates a game and gets the game id with Alice', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { "type": "creator" },
            { "type": "open" },
            { "type": "open" }
          ],
          "turnMaxSec": turnMaxSec
        }).then(
          function(entity) {
            game.id = entityGameId(entity);
          }
        );
      });
      joinGame("Bob", game);
      joinGame("Carol", game);

      turnNumber = 0;

      makeTurn("Alice", game, "allow", turnNumber++);
      makeTurn("Bob",   game, "allow", turnNumber++);
      makeTurn("Carol", game, "allow", turnNumber++);
      makeTurn("Alice", game, "allow", turnNumber++);
      
      it("waits for turn to time out", function() {
        var promise = new Promise();
        setTimeout(function() {
          promise.resolve();
        }, turnMaxSec*1000 + 1000);
        this.timeout(turnMaxSec*1000 + 2000);
        return promise;
      })

      it("gets the copied turn", function() {
        return parseCall("Alice", "listTurns", {
          gameId: game.id,
          limit: 2
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.TURN_LIST);
            var turns = result.turns;
            turns[0].turn.should.equal(4);
            turns[0].player.user.displayName.should.equal("Bobzor");
            turns[1].turn.should.equal(3);
            turns[1].player.user.displayName.should.equal("Ally");
            turns[0].save.should.equal(turns[1].save);
            turns[0].save.should.equal("turn 3");
          }
        );
      })

      listGames("Alice", [game],
        "should advance to the next player",
        function(games) {
          games.should.have.length(1);
          var gameResult = games[0];
          game.id.should.equal(gameResult.objectId);


          var slots = gameResult.config.slots;
          slots.should.have.length(3);
          slots[1].type.should.equal(constants.SlotType.AI);
          
          var currentPlayer = gameResult.currentPlayer;
          currentPlayer.user.displayName.should.equal("Carry");
        }
      );

      
    });

    describe("should create an empty turn for starting AI", function() {
        
      var game = {};
      var turnMaxSec = 5;

      it('creates a game and gets the game id with Alice', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { "type": "creator" },
            { "type": "open" },
            { "type": "open" }
          ],
          "turnMaxSec": turnMaxSec
        }).then(
          function(entity) {
            game.id = entityGameId(entity);
          }
        );
      });
      joinGame("Bob", game);
      joinGame("Carol", game);

      leaveGame("Alice", game);

      it("gets the initial empty turn", function() {
        return parseCall("Bob", "listTurns", {
          gameId: game.id
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.TURN_LIST);
            var turns = result.turns;
            turns.should.have.length(1);

            var turn = turns[0];
            turn.save.should.equal("");
            turn.turn.should.equal(0);
          }
        );
      })

      listGames("Bob", [game],
        "should advance to the next player",
        function(games) {
          games.should.have.length(1);
          var gameResult = games[0];
          game.id.should.equal(gameResult.objectId);

          var slots = gameResult.config.slots;
          slots.should.have.length(3);
          slots[0].type.should.equal(constants.SlotType.AI);
          
          var currentPlayer = gameResult.currentPlayer;
          currentPlayer.user.displayName.should.equal("Bobzor");
        }
      );

      
    });

  });

});


describe("quota", function() {
  before(function() {
    return Promise.when(
      getUserSessions(),
      purgeGames()
    );
  });
  after(purgeGames);

  describe("create game", function() {

    function createGame(expected, desc) {
      it(desc || expected.m, function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { "type": "creator" },
            { "type": "invite", "displayName": "Bobzor" },
            { "type": "none" },
            { "type": "open" },
          ],
          "fameCards": {},
          "turnMaxSec": 60
        }).then(
          function(entity) {
            if (expected.id > 1000) {
              entityError(entity, expected);
            } else {
              entityResult(entity, expected);
            }
          }
        );
      });
    }

    function testRecentQuota(index) {
      var min = index*constants.GAME_LIMIT_RECENT;
      var max = Math.min(constants.GAME_LIMIT_TOTAL, (index + 1)*constants.GAME_LIMIT_RECENT);
      for (var i = min; i < max; i++) {
        createGame(constants.t.GAME_CREATED, "create game " + (i + 1));
      }
      createGame(constants.t.GAME_QUOTA_EXCEEDED, "should fail creating game due to recent quota");
    }

    function waitForQuota() {
      it("wait for the quota to expire", function() {
        var promise = new Promise();
        setTimeout(function() {
          promise.resolve();
        }, constants.GAME_LIMIT_RECENT_TIMEOUT*1000);
        return promise;
      })
    }

    this.timeout(2000 + recencyPumps*constants.GAME_LIMIT_RECENT_TIMEOUT*1000);

    purgeGames();

    var recencyPumps = Math.ceil(constants.GAME_LIMIT_TOTAL / constants.GAME_LIMIT_RECENT);
    for (var i = 0; i < recencyPumps; i++) {
      testRecentQuota(i);

      var gameNum = Math.min(constants.GAME_LIMIT_TOTAL, (i + 1)*constants.GAME_LIMIT_RECENT);
      it("should return " + gameNum + " games", function(gameNum) {
        return parseCall("Alice", "listGames", {
          limit: 100
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.GAME_LIST);
            result.should.have.property("games");
            result.games.should.be.an("array");
            result.games.should.have.length(gameNum);
          }
        );
      }.bind(this, gameNum))

      waitForQuota();
    }

    createGame(constants.t.GAME_QUOTA_EXCEEDED, "should fail creating game due to total quota");

  })


})

describe("users", function() {
  before(getUserSessions);

  it("set avatar for Alice to 5", function() {
    return parseCall("Alice", "userSet", {
      avatar: 5
    }).then(
      function(entity) {
        entityResult(entity, constants.t.USER_SAVED);
      }
    );
  });

  it("add Alice as friend with Bob", function() {
    return parseCall("Bob", "addFriend", {
      displayName: "Ally"
    }).then(
      function(entity) {
        try {
          entityResult(entity, constants.t.CONTACT_ADDED);
        } catch(e) {
          entityError(entity, constants.t.CONTACT_EXISTS);
        }
      }
    );
  });

  it("should see avatar 5 for Alice in Bob's friends", function() {
    return parseCall("Bob", "listFriends", {}).then(
      function(entity) {
        var result = entityResult(entity, constants.t.CONTACT_LIST);
        var alice = result.contacts.find(function(contact) {
          return contact.displayName == "Ally";
        });
        alice.avatar.should.equal(5);
      }
    )
  })

  it("set avatar for Alice to 1", function() {
    return parseCall("Alice", "userSet", {
      avatar: 1
    }).then(
      function(entity) {
        entityResult(entity, constants.t.USER_SAVED);
      }
    );
  });
  
  it("should see avatar 1 for Alice in Bob's friends", function() {
    return parseCall("Bob", "listFriends", {}).then(
      function(entity) {
        var result = entityResult(entity, constants.t.CONTACT_LIST);
        var alice = result.contacts.find(function(contact) {
          return contact.displayName == "Ally";
        });
        alice.avatar.should.equal(1);
      }
    )
  })

})

describe("contacts", function() {
  before(getUserSessions);

  function removeContacts() {
    it("should remove contacts first", function() {
      return parseCall({ useMasterKey: true }, "purgeContacts", {}).then(
        function(result) {
          result.should.have.property("result");
          should.equal(result.result.purged, true);
        }
      );
    });
  }

  function contactCheck(name, desc, include, exclude, done) {
    var nobody = !include && !exclude;
    if (!desc) {
      desc = nobody ?
        'returns nobody for ' + name :
        'returns ' + 
          include.join(" and ") +
          ' and not ' + exclude.join(" and ") +
          ' as friends of ' + name;
    }
    it(desc, function() {
      return parseCall(name, "listFriends", {
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.CONTACT_LIST);
          result.should.have.property("contacts");
          var contacts = result.contacts;
          if (nobody) {
            contacts.should.have.length(0);
          } else {

            include.forEach(function(contactName) {
              should.exist(contacts.find(function(contact) {
                return contact.displayName == contactName;
              }));
            }, this);

            exclude.forEach(function(contactName) {
              should.not.exist(contacts.find(function(contact) {
                return contact.displayName == contactName;
              }));
            }, this);
            
          }

          if (done) done(contacts);
        }
      );
    });
  }

  function addContact(name, contactName, desc) {
    if (!desc) {
      desc = name + ' adds ' + contactName + ' as a friend';
    }
    it(desc, function() {
      return parseCall(name, "addFriend", {
        displayName: contactName
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.CONTACT_ADDED);
          result.should.have.property("contact");
          var contact = result.contact;
          contact.contact.displayName.should.equal(contactName);
        }
      );
    });
  }

  function deleteContact(name, contactName, desc) {
    if (!desc) {
      desc = name + ' removes ' + contactName + ' from friends';
    }
    it(desc, function() {
      return parseCall(name, "deleteFriend", {
        displayName: contactName
      }).then(
        function(entity) {
          entityResult(entity, constants.t.CONTACT_DELETED);
        }
      );
    });
  }

  function blockContact(name, contactName, desc) {
    if (!desc) {
      desc = name + ' blocks ' + contactName;
    }
    it(desc, function() {
      return parseCall(name, "blockFriend", {
        displayName: contactName
      }).then(
        function(entity) {
          entityResult(entity, constants.t.CONTACT_BLOCKED);
        }
      );
    });
  }

  describe("basic", function() {
    removeContacts();

    contactCheck("Alice");
    contactCheck("Bob");
    contactCheck("Carol");
    contactCheck("Dan");

    var game = {};

    it('creates a game and gets the game id with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" },
          { "type": "none" },
          { "type": "open" },
        ],
        "fameCards": { "The Chinatown Connection": 3 },
        "turnMaxSec": 60
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
        }
      );
    });

    joinGame("Bob", game, 'has Bob join game');
    joinGame("Carol", game, 'has Carol join game');
    
    contactCheck("Alice");
    contactCheck("Bob");
    contactCheck("Carol");
    contactCheck("Dan");

    addContact("Alice", "Carry");
    contactCheck("Alice", null, ["Carry"], ["Ally", "Bobzor", "Dan the Man"]);
    contactCheck("Carol");

    addContact("Bob", "Carry");
    contactCheck("Alice", null, ["Carry"], ["Ally", "Bobzor", "Dan the Man"]);
    contactCheck("Bob", null, ["Carry"], ["Ally", "Bobzor", "Dan the Man"]);
    contactCheck("Carol");

    addContact("Carol", "Bobzor");
    contactCheck("Alice", null, ["Carry"], ["Ally", "Bobzor", "Dan the Man"]);
    contactCheck("Bob", null, ["Carry"], ["Ally", "Bobzor", "Dan the Man"]);
    contactCheck("Carol", null, ["Bobzor"], ["Ally", "Carol", "Dan the Man"]);
    contactCheck("Dan");

    addContact("Carol", "Dan the Man");
    contactCheck("Carol", null, ["Bobzor", "Dan the Man"], ["Ally", "Carol"]);
    contactCheck("Dan");

    deleteContact("Carol", "Bobzor");
    contactCheck("Carol", null, ["Dan the Man"], ["Bobzor", "Ally", "Carol"]);
    contactCheck("Dan");
  })

  describe("blocking", function() {

    var game = {};

    function createGame(expected) {
      it('creates a game and gets the game id with Alice', function() {
        return parseCall("Alice", "createGame", {
          "slots": [
            { "type": "creator" },
            { "type": "invite", "displayName": "Bobzor" },
            { "type": "none" },
            { "type": "open" },
          ],
          "fameCards": {},
          "turnMaxSec": 60
        }).then(
          function(entity) {
            if (expected.id > 1000) {
              entityError(entity, expected);
            } else {
              entityResult(entity, expected);
            }
          }
        );
      });
    }

    describe("stranger", function() {
      removeContacts();
      createGame(constants.t.GAME_CREATED);
      contactCheck("Alice");
      contactCheck("Bob");

      blockContact("Bob", "Ally");
      createGame(constants.t.GAME_PLAYERS_UNAVAILABLE);

      addContact("Bob", "Ally")
      createGame(constants.t.GAME_CREATED);
    })
    
    describe("friend", function() {
      removeContacts();
      createGame(constants.t.GAME_CREATED);
      contactCheck("Alice");
      contactCheck("Bob");

      addContact("Bob", "Ally")
      createGame(constants.t.GAME_CREATED);

      blockContact("Bob", "Ally");
      createGame(constants.t.GAME_PLAYERS_UNAVAILABLE);

      addContact("Bob", "Ally")
      createGame(constants.t.GAME_CREATED);
    })


  })


    
});


describe("kue", function() {
  before(getUserSessions);

  
  if (testTimeouts) describe("lobby timeout job", function() {

    var game = {};

    if (testTimeouts) it('creates a game and waits for timeout with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" }
        ],
        "fameCards": {},
        "turnMaxSec": 60
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          var result = entityResult(entity);
        }
      );
    });
    
    it('should end the game after timeout', function() {
      
      var promise = new Promise();

      setTimeout(function() {
       promise.resolve();
      }, constants.START_GAME_AUTO_TIMEOUT*1000 + 1000);

      this.timeout(constants.START_GAME_AUTO_TIMEOUT*1000 + 2000);

      return promise.then(
        function() {
          return parseCall("Alice", "listGames", {
            gameIds: [game.id]  
          });
        }
      ).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_LIST);
          result.should.have.property("games");
          result.games.should.be.an("array");
          result.games.should.have.length(1);

          var game = result.games[0];
          game.state.should.equal(GameState.Ended);
          return Promise.resolve();
        }
      );
    });

  });

  
  describe("lobby timeout skipped job", function() {

    var game = {};

    it('creates a game and gets the game id with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" }
        ],
        "fameCards": {},
        "turnMaxSec": 60
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          var result = entityResult(entity);
        }
      );
    });
    joinGame("Bob", game);

    it("should get deleted after game starts", function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          var result = entityResult(entity);
          return checkDeletedJob(result.lobbyTimeoutJob);
        }
      );
    });
  });

  describe("turn timeout job", function() {

    var turnMaxSec = 1*timeoutMultiplier;
    var game = {};

    it('creating a game with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" }
        ],
        "turnMaxSec": turnMaxSec
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          var result = entityResult(entity);
        }
      );
    });
    joinGame("Bob", game);

    it('sets job id in game', function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turnTimeoutJob");
          game.turnTimeoutJob = result.turnTimeoutJob; 
        }
      );
    });
    
    it('should be running', function() {
      return getJob(game.turnTimeoutJob).then(
        function(job) {
          job.id.should.equal(game.turnTimeoutJob);
        }
      );
    });

    var turnNumber = 0;
    makeTurn("Alice", game, "allow", turnNumber++);
    
    it("should get deleted after a turn is made", function() {
      return checkDeletedJob(game.turnTimeoutJob);
    });

    it('sets new job id in game', function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turnTimeoutJob");
          result.turnTimeoutJob.should.not.equal(game.turnTimeoutJob);
          game.turnTimeoutJob = result.turnTimeoutJob; 
        }
      );
    });

    makeTurn("Alice", game, "deny", turnNumber);
    
    if (testTimeouts) {
      turnNumber++;
      it("should advance to the next player after timeout", function() {
        var promise = new Promise();
        setTimeout(function() {
          promise.resolve();
        }, turnMaxSec*1000 + 1000);
        this.timeout(turnMaxSec*1000 + 2000);

        return promise.then(
          function() {
            return parseCall({ useMasterKey: true }, "debugGame", {
              gameId: game.id
            });
          }
        ).then(
          function(entity) {
            var result = entityResult(entity);
            result.should.have.property("turnTimeoutJob");
            result.turnTimeoutJob.should.not.equal(game.turnTimeoutJob);
            game.turnTimeoutJob = result.turnTimeoutJob;
          }
        );
      });
      makeTurn("Bob", game, "deny", turnNumber);
      makeTurn("Alice", game, "allow", turnNumber++);

      if (testTimeouts) it('works together with normal turns', function() {
        return parseCall("Alice", "listTurns", {
          gameId: game.id,
          limit: 4
        }).then(
          function(entity) {
            var result = entityResult(entity, constants.t.TURN_LIST);
            var turns = result.turns;
            turns.should.have.length(3);

            turns.forEach(function(turn, index) {
              // Invert index (most recent is highest)
              index = turns.length - 1 - index;
              turn.should.have.deep.property("player.state");
              if (index == 1) {
                // Timeout turn
                turn.player.state.should.equal(PlayerState.Inactive);
                turn.save.should.equal("turn 0");
              } else {
                turn.player.state.should.equal(PlayerState.Active);
                turn.save.should.equal("turn " + index);
              }
            }, this);
          }
        );
      });
    }

    makeTurn("Alice", game, "finish", turnNumber++);

    if (testTimeouts) it('should be different after a few turns', function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turnTimeoutJob");
          result.turnTimeoutJob.should.not.equal(game.turnTimeoutJob);
          game.turnTimeoutJob = result.turnTimeoutJob;
        }
      );
    });

    it('should not exist after end of game', function() {
      return checkDeletedJob(game.turnTimeoutJob);
    });

  });

  
  if (testTimeouts) describe("game ending turn timeout job", function() {

    var slots = [
      { "type": "creator" },
      { "type": "open" }
    ];
    var turnMaxSec = 1*timeoutMultiplier;
    var game = {};

    it('creating a game with Alice', function() {
      return parseCall("Alice", "createGame", {
        "slots": [
          { "type": "creator" },
          { "type": "open" }
        ],
        "turnMaxSec": turnMaxSec
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          var result = entityResult(entity);
        }
      );
    });
    joinGame("Bob", game);

    it('should be running', function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turnTimeoutJob");
          game.turnTimeoutJob = result.turnTimeoutJob;
          return getJob(game.turnTimeoutJob); 
        }
      ).then(
        function(job) {
          job.id.should.equal(game.turnTimeoutJob);
        }
      );
    });
    
    var turnNumber = 0;
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob", game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob", game, "allow", turnNumber++);

    it('should still be running', function() {
      return parseCall({ useMasterKey: true }, "debugGame", {
        gameId: game.id
      }).then(
        function(entity) {
          var result = entityResult(entity);
          result.should.have.property("turnTimeoutJob");
          game.turnTimeoutJob = result.turnTimeoutJob;
          return getJob(game.turnTimeoutJob); 
        }
      ).then(
        function(job) {
          job.id.should.equal(game.turnTimeoutJob);
        }
      );
    });

    it("should destroy the game after " + constants.GAME_ENDING_INACTIVE_ROUNDS + " inactive rounds", function() {
      var waitMs = (turnMaxSec + 1)*slots.length*constants.GAME_ENDING_INACTIVE_ROUNDS*1000;
      var promise = new Promise();
      setTimeout(function() {
        promise.resolve();
      }, waitMs + 1000);
      this.timeout(waitMs + 2000);

      return promise.then(
        function() {
          return parseCall({ useMasterKey: true }, "debugGame", {
            gameId: game.id
          });
        }
      ).then(
        function(entity) {
          entityError(entity, constants.t.GAME_NOT_FOUND);
        }
      );
    });

  });

});

describe("cleanup", function() {
  before(getUserSessions);
  
  var game = {};
  function exists(extraDesc) {
    extraDesc = extraDesc ? " " + extraDesc : "";
    it('exists' + extraDesc, function() {
      return parseCall({ useMasterKey: true }, "classes/Game/" + game.id).then(
        function(retGame) {
          retGame.objectId.should.equal(game.id);
          game.jobs = [
            retGame.turnTimeoutJob
          ];
          if (game.result.state == GameState.Lobby) {
            game.jobs.push(retGame.lobbyTimeoutJob);
          }
        }
      );
    });
  }

  function destroyed() {
    it('does not exist anymore', function() {
      return parseCall({ useMasterKey: true }, "classes/Game/" + game.id).then(
        function(result) {
          if (result && result.code == Parse.Error.OBJECT_NOT_FOUND) {
            return Promise.resolve();
          }
          return Promise.reject(new Error("it exists"));
        }
      );
    });

    it('jobs do not exist anymore', function() {
      return Promise.when(game.jobs.map(
        function(jobId) {
          return getJob(jobId);
        }
      )).then(
        function(retJobs) {
          return Promise.reject(new Error("they exist"));
        },
        function() {
          return Promise.resolve();
        }
      );
    });

    it('turns do not exist anymore', function() {
      this.timeout(20000);
      return Promise.when(game.turns.map(
        function(turn) {
          return parseCall({ useMasterKey: true }, "classes/Turn/" + turn.objectId);
        }
      )).then(
        function(results) {
          if (results) {
            var everyNotFound = results.every(function(result) {
              return result.code == Parse.Error.OBJECT_NOT_FOUND;
            });
            if (everyNotFound) {
              return Promise.resolve();
            }
          }
          return Promise.reject(new Error("they exist"));
        }
      );
    });
    
    it('invite does not exist anymore', function() {
      return parseCall({ useMasterKey: true }, "classes/Invite/" + game.invite.objectId).then(
        function(result) {
          if (result && result.code == Parse.Error.OBJECT_NOT_FOUND) {
            return Promise.resolve();
          }
          return Promise.reject(new Error("it exists"));
        }
      );
    });
  }

  describe("game normally", function() {

    it('gets created with Alice', function() {
      return parseCall("Alice", "createGame", {
        slots: [
          { type: "creator" },
          { type: "open" }
        ]
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          game.result = entityResult(entity);
        }
      );
    });
    
    it('provides invite link to Alice', function() {
      return parseCall("Alice", "getInvite", {
        "gameId": game.id
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_INVITE);
          game.invite = result.invite;
        }
      );
    });

    joinGame("Bob", game);

    var turnNumber = 0;
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob", game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob", game, "allow", turnNumber++);
    
    it('provides turn list', function() {
      return parseCall("Alice", "listTurns", {
        gameId: game.id,
        limit: 10,
        skip: 0
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.TURN_LIST);
          game.turns = result.turns;
        }
      );
    });

    exists();

    it('jobs exist', function() {
      return Promise.when(game.jobs.map(
        function(jobId) {
          return getJob(jobId);
        }
      )).then(
        function(retJobs) {
          for (var jobIndex in retJobs) {
            var jobId = game.jobs[jobIndex];
            var retJob = retJobs[jobIndex];
            retJob.id.should.equal(jobId);
          }
        }
      );
    });
    
    it('turns exist', function() {
      return Promise.when(game.turns.map(
        function(turn) {
          return parseCall({ useMasterKey: true }, "classes/Turn/" + turn.objectId);
        }
      )).then(
        function(retTurns) {
          for (var turnIndex in retTurns) {
            var turn = game.turns[turnIndex];
            var retTurn = retTurns[turnIndex];
            retTurn.objectId.should.equal(turn.objectId);
          }
        }
      );
    });
    
    it('invite exists', function() {
      return parseCall({ useMasterKey: true }, "classes/Invite/" + game.invite.objectId).then(
        function(retInvite) {
          retInvite.objectId.should.equal(game.invite.objectId);
        }
      );
    });


    // Use leaveGame with all players to destroy the game

    makeTurn("Alice", game, "finish", turnNumber++);
    exists("after finishing turn");

    leaveGame("Alice", game)
    exists("after Alice leaves");

    leaveGame("Bob", game)

    destroyed();
  });

  describe("game when everyone leaves mid-game", function() {
    
    it('gets created with Alice', function() {
      return parseCall("Alice", "createGame", {
        slots: [
          { type: "creator" },
          { type: "open" },
          { type: "open" }
        ]
      }).then(
        function(entity) {
          game.id = entityGameId(entity);
          game.result = entityResult(entity);
        }
      );
    });
    
    it('provides invite link to Alice', function() {
      return parseCall("Alice", "getInvite", {
        "gameId": game.id
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.GAME_INVITE);
          game.invite = result.invite;
        }
      );
    });
    
    joinGame("Bob", game);
    joinGame("Carol", game);

    var turnNumber = 0;
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob", game, "allow", turnNumber++);
    makeTurn("Carol", game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob", game, "allow", turnNumber++);
    makeTurn("Carol", game, "allow", turnNumber++);
    makeTurn("Alice", game, "allow", turnNumber++);
    makeTurn("Bob", game, "allow", turnNumber++);
    
    it('provides turn list', function() {
      return parseCall("Alice", "listTurns", {
        gameId: game.id,
        limit: 10,
        skip: 0
      }).then(
        function(entity) {
          var result = entityResult(entity, constants.t.TURN_LIST);
          game.turns = result.turns;
        }
      );
    });

    exists();

    // Use leaveGame with all players to destroy the game

    leaveGame("Carol", game)
    exists("after Carol leaves");
    
    leaveGame("Alice", game)
    exists("after Alice leaves");

    leaveGame("Bob", game)

    destroyed();
  });


});


describe("access security", function() {
  before(getUserSessions);
  
  function checkAccess(desc, apiName) {
    apiName = "/" + apiName;
    it(desc + " (" + apiName + ")", function() {
      return parseCall(null, apiName).then(
        function(result) {
          result.should.not.have.property("results");
          result.should.have.property("code");
          result.code.should.equal(119);
        }
      );
    });
  }

  describe("user access", function() {

    checkAccess("should not return list of users", "users");
    checkAccess("should not return specific user", "users/etSAhagpLp");

    it("should return Alice", function() {
      return parseCall("Alice", "/users/me").then(
        function(result) {
          result.should.have.property("objectId");
          result.should.have.property("displayName");
          result.displayName.should.equal("Ally");
        }
      );
    });

  });

  function checkClassAccess(className) {
    checkAccess("should not return list of " + className + "s", "classes/" + className);
  }

  describe("class access", function() {
    
    checkClassAccess("_Installation");
    checkClassAccess("_User");
    checkClassAccess("Session");
    checkClassAccess("Game");
    checkClassAccess("Config");
    checkClassAccess("Invite");
    checkClassAccess("Player");
    checkClassAccess("Turn");

  });


});