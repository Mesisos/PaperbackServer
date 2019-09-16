# pbserver

Paperback Server using the [parse-server](https://github.com/ParsePlatform/parse-server) module on Express.

## Running locally

* `npm run dev` to run mongo and dashboard
* `npm run mongo` to run the Mongo database server
* `npm run dashboard` to run the Parse dashboard for database inspection
* `npm run local` or `heroku local` to run the web server locally in a Heroku environment
* `npm test` to run behavior tests

## Creating a new instance

1. Create a new Heroku instance either by clicking on the following button or by going to [heroku.com/deploy](https://heroku.com/deploy).

[![Deploy](https://www.herokucdn.com/deploy/button.png)](https://heroku.com/deploy)

2. Set Config Variables in Settings to the following:
  
  - `APP_ID` = A short ID for the app, e.g. `pbserver`
  - `APP_NAME` = Name of the product, e.g. `Paperback`
  - `MASTER_KEY` = Administration pass key, must remain secret, e.g. `ZBv4Rsk7P`
  - `MONGODB_URI` = MongoDB database url including username and password, can be shared across instances if they are properly prefixed
  - `REDIS_URL` = Redis server url including username and password, can be shared across instances by using different database indices, e.g. `redis://10.0.0.0:6379/?db=0` or `redis://10.0.0.0:6379/?db=1`. To make sure instances are isolated,
  use a different index for each instance. Default is index 0, Heroku Redis Premium
  supports 512 database indices, from 0 to 511.
  - `PARSE_MOUNT` = Url prefix for Parse access, most likely `/parse`
  - `SERVER_ROOT` = External url used to access this instance, usually `http://<instance-name>.herokuapp.com`
  - `ANDROID_SENDER_ID` = Android FCM Sender ID used for push notifications on Android, e.g. `12345678912`
  - `ANDROID_API_KEY` = Android GCM Server key used for push notifications on Android, e.g. `AAAABcDaBCD:ABC12aBCDeF-AbC...`
  - `VERIFICATION_EMAIL_SENDER` = Email address to send from for account verification, e.g. `support@example.com`
  - `MAILGUN_API_KEY` = Mailgun Account API key to use for sending emails, e.g. `key-12345abcd123456abcd`
  - `MAILGUN_DOMAIN` = Mailgun Account domain to send from, e.g. `sandboxabcd.mailgun.org`
  - `IOS_BUNDLE` = Name of the iOS app bundle used for push notifications, e.g. `com.example.PaperbackApp`
  - `IOS_PRODUCTION` = `true` for production push notification certificates, `false` for development certificates
  - `IOS_PASSPHRASE` = Password for the iOS push notifications certificate
  - `IOS_CERTIFICATE` = _(new, optional)_ Path to the iOS certificate file used for push notifications, defaults to `push/PushCertificate.p12`
  - `MONGODB_PREFIX` = _(new, optional)_ Prefix for MongoDB database collection names, allows sharing the same database across multiple instances, defaults to `APP_ID` + `_` (underscore)
  - `REDIS_PREFIX` = _(new, optional)_ Prefix for redis server keys used for the kue queue system, defaults to `q`, isolation between instances should be done via
  database indices (see above)

3. Push the server code to Heroku via Git using the steps described on the project dashboard. Take note that you might need to update/change/add the push certificate file for iOS first.

4. The server should now be operational and accessible via `http://<instance-name>.herokuapp.com`.

## MongoDB connection details

You should have your `MONGODB_URI` set in the Heroku dashboard in the following
format already if you are using the mLab MongoDB addon:

`mongodb://<username>:<password>@<host>:<port>/<database-name>`

The individual values usually look something like this:

* username: `heroku_abcd1234`
* password: `abcdef12345abcdef12345abcdef12345`
* host: `xx123456.mlab.com`
* port: `12345`
* database-name: usually the same as username

## Importing the schema into a remote server

You can import the included Parse schema by running the following command from
the repository working directory substituting the values with ones from your
MongoDB connection url (see above).

`mongorestore -h <host>:<port> -d <database-name> -u <username> -p <password> schema/dev`

On an uninitialized database, this should be enough. For an existing database,
you'll have to drop the `_SCHEMA` collection first with the following:

`mongo --eval "db.getCollection('_SCHEMA').drop()" <MONGODB_URI>`

## Backup and restore

Backup an entire remote database with `mongodump`:

`mongodump -h <host>:<port> -d <database-name> -u <username> -p <password> -o dump-dir`


Restore a remote database from a local dump directory with `mongorestore`:

`mongorestore -h <host>:<port> -d <database-name> -u <username> -p <password> -o dump-dir/<database-name>`

## MongoDB indexes

### Push status TTL

Push status logs can usually accumulate over time, so you can add a TTL (Time To Live) index for the `_PushStatus` collection by connecting with the `mongo` cli tool to the database and
executing the following line:

`db.getCollection('_PushStatus').createIndex({ "_created_at": 1 }, { expireAfterSeconds: 21600 })`

The entries will then get autodeleted after the specified amount of seconds +- a few minutes.

If you want to change the value in seconds you have to either delete the index and create
a new one or use the appropriate MongoDB commands to modify the value of `expireAfterSeconds`.

# API

## On success

All of the returned responses are wrapped in a `result` object if successful, e.g.:
```
{
  "result": {
    "available": true,
    "code": 1
  }
}
```

`code` is always < 1000 for successful results and it represents the response
code for the message to allow for easier application logic. See `constants.js`
for all the message code definitions.

For brevity purposes all cloud function responses are assumed to be wrapped in
this `result` structure. The return codes are specified as constant names,
found in `constants.js`, to avoid multiple possibly conflicting definitions,
with `/` separating successful and error codes.

## On error

If the request was unsuccessful, an error is returned, e.g.:
```
{
  "code": 141,
  "error": {
    "message": "Contact not found.",
    "code": 1404
  }
}
```

For application-level logic, the top level `code` is always `141`, meaning that
the Cloud Code script failed. The error field also contains details about the
failure, like a descriptive human readable `message` and a specific failure
error `code`.

The specific error code is between `1000` and `1998` for application errors,
`1999` for "other" Parse errors and between `2000` and `2999` for specific Parse
errors that occur in the middle of application logic. For Parse errors you can
get the server-level error code by subtracting `2000` from the error code. 

See `constants.js` for all application error definitions.

For Parse server-level errors, see Parse Server documentation.


## Sign up with username via `REST_signupWithUsername`
### Request parameters
```
{
  // Username should be an email that is then also used for verification and
  // password reset.
  "username": "test@example.com",
  
  // Email should not be used anymore, it is set to be the same as the username
  // automatically.
  // "email": --- deprecated ---,
  
  "password": "password",

  // Required to be unique, you can check for availability with `checkNameFree`.
  "displayName": "Signey",

  "avatar": integer
}
```
### Response
```
{
  "objectId": "wL3sIcT2NA",
  "createdAt": "2016-11-17T15:02:16.447Z",
  "sessionToken": "r:31ba286ce8adbee3aa938f79d99d0cdc"
}
```
### Errors
```
{
  "code": 200,
  "error": "bad or missing username"
}
```
```
{
  "code": 201,
  "error": "password is required"
}

```
```
// This applies for email as well, since they are equivalent.
{
  "code": 202,
  "error": "Account already exists for this username."
}
```
```
{
	"code": 141,
	"error": {
		"id": 1005,
		"m": "Display name already taken."
	}
}
```

## Reset password via `REST_requestPasswordReset`
### Request parameters
```
{
  "email": "test@example.com"
}
```
### Response
```
// Empty on success (sends password reset email)
{}
```
### Errors
```
{
  "code": 204,
  "error": "you must provide an email"
}
```
```
{
  "code": 205,
  "error": "No user found with email test."
}
```


## Login

All of the cloud functions below require you to be logged in as a user. Email verification is required before first login.

## Enums

### Game State
```
0 -> Init
1 -> Lobby
2 -> Running
3 -> Ended
```

### Player State
```
0 -> Active
1 -> Inactive
```

### AI Difficulty
```
0 -> None
1 -> Easy
2 -> Medium
3 -> Hard
```

### Slot Types
```
"creator"
"open"
"invite"
"none"
"ai"
```

### Turn Type
```
0 -> Player
1 -> Timeout
```

## `checkNameFree`
### Request
```
{
  "displayName": "name"
}
```
### Response
```
{
  "code": AVAILABILITY / INVALID_PARAMETER,

  "available": true|false
  "reason": {
    "code": / INVALID_PARAMETER | DISPLAY_NAME_BLACKLISTED | DISPLAY_NAME_TAKEN,
    "message": string
  }
}
```


## `userSet`
Change user preferences, currently only supports changing the avatar.
### Request
```
{
  "avatar": integer
}
```
### Response
```
{
  "code": USER_SAVED / INVALID_PARAMETER
}
```





## `createGame`
### Request
```
{
  // Optional game type identifier. Defaults to undefined.
  // This can then be filtered on later.
  "typeId": integer,

  // You can provide any number of slots (within reason)
  // for the game, but there has to be exactly
  // one `creator` slot.
  // The order of the slots defines the order
  // of the game turns / rounds.
  //
  // This generates a `playerNum` field, which holds the
  // number of non-`none`-type slots, and an `isRandom` field,
  // which is `true` if there are any `open`-type slots. 
  "slots": [

    // A publicly open slot, at least one
    // slot has to be open to mark the game as `isRandom`
    // and make it findable via `findGames`
    { "type": "open" },

    // Exactly one of these has to be present. The creator
    // gets automatically assigned to this slot.
    { "type": "creator" },

    // Reserved slot by display name. Converted to `userId`
    // on game creation to lock down the specified user, which
    // might be useful if display names are ever changeable.
    { "type": "invite", "displayName": "name" },

    // AI-type slot, not implemented correctly right now.
    // `difficulty` is an integer enum defined above.
    { "type": "ai", "difficulty": integer },
    
    // Accepted for now, but not really useful? Maybe for easier
    // mapping of indices.
    { "type": "none" },
  ],

  "fameCards": {
    "The Chinatown Connection": 6,
    "Dead Planet": 4,
    "Vicious Triangle": 3,
    "Lady of the West": 1
  },

  // After this many seconds, the turn ends automatically and the game
  // transitions to the next player
  "turnMaxSec": 60
}
```
### Response
```
// Game join response object
{
  "code": GAME_CREATED / GAME_QUOTA_EXCEEDED | GAME_INVALID_CONFIG | GAME_PLAYERS_UNAVAILABLE,

  // Game object
  "game": {
    "objectId": "id",
    "config": {
      // Number of players in the game, i.e. number of slots that do not have
      // the "none" type.
      "playerNum": 2,
      ...
    }
    ...
  },

  // Number of players after the game was joined
  "playerCount": 3,

  // Player object of the user
  "player": {
    "objectId": "id",
    // Slot index number of the player
    // Assigned automatically based on the provided slots
    "slot": integer
    ...
  }
}
```


## `getInvite`
### Request
```
{
  "gameId": "id"
}
```
### Response
```
{
  "code": GAME_INVITE / PLAYER_NOT_FOUND,
  
  "link": "url of the invite website",
  "invite": {
    "objectId": "id" // The invite ID
  }
}
```


## `declineInvite`
Declines the player invitation for the specified game and changes the relevant
game slot to open-type.
### Request
```
{
  "gameId": "id"
}
```
### Response
```
{
  "code": GAME_INVITE_DECLINED / GAME_NOT_FOUND | GAME_INVITE_ERROR,
}
```


## `joinGame`
### Request
```
{
  "gameId": "id"
}
```
### Response
```
// Game join response object (see createGame)
{
  "code": GAME_JOINED / GAME_NOT_FOUND | PLAYER_ALREADY_IN_GAME | GAME_INVALID_STATE,

  "game": {...},
  "playerCount": 3,
  "player": {...}
}
```


## `leaveGame`
Used to leave the specified game and inactivate the player. If the game is still
running, the user slot is replaced with an AI slot. All players must use this
at the end of the game to indicate that they are done with it and so it can get
destroyed.
### Request
```
{
  "gameId": "id"
}
```
### Response
```
{
  "code": GAME_LEFT / PLAYER_NOT_IN_GAME | GAME_INVALID_STATE | GAME_NOT_FOUND,
  "player": {...}
}
```


## `findGames`
Find games open to the public, i.e. with at least one open-type slot.
### Request
```
{
  // Game type id to filter on (optional)
  "typeId: integer
  // How many games to return sorted by least recent first
  "limit": integer (default 20, min 1, max 100)
  // How many games to skip (for pagination)
  "skip": integer (default 0)
}
```
### Response
```
{
  "code": GAME_LIST,

  // Game objects with `isRandom` being `true`
  "games": [
    {
      ...
      // `true` when you have already joined this game, otherwise `false`.
      "joined": true,

      // Number of free open slots available. This excludes invite slots and
      // open slots already taken up by other players.
      "freeSlots": 1,

      // See `listGames` for the rest of the properties.
      ...
    }
  ]
}
```


## `listInvites`
List games with an invite slot for the calling user.
### Request
```
{
  // Game type id to filter on (optional)
  "typeId: integer
  // How many games to return sorted by most recent first
  "limit": integer (default 20, min 1, max 100)
  // How many games to skip (for pagination)
  "skip": integer (default 0)
}
```
### Response
```
{
  "code": GAME_LIST,

  // Game objects
  "games": [
    {
      // See `listGames` for the properties.
      ...
    }
  ]
}
```


## `listGames`
List all the games the logged-in user is currently participating in.
### Request
```
{
  // Game type id to filter on (optional)
  "typeId: integer
  // How many games to return sorted by most recent first
  "limit": integer (default 20, min 1, max 100)
  // How many games to skip (for pagination)
  "skip": integer (default 0),
  // Optionally filter to specific game IDs
  "gameIds": ["idA", "idB", ...]
}
```
### Response
```
{
  "code": GAME_LIST,

  "games": [
    // Game one
    {
      "objectId": "idA",

      // State the game is in, see "Game State" above.
      "state": integer,

      // Turn number starting from 0, incremented every turn.
      "turn": integer,

      // `true` if the game is able to be manually started via
      // `startGame` by the creator.
      "startable": true|false,

      // Number of free open slots available. This excludes invite slots,
      // the creator slot and open slots already taken up by other players.
      "freeSlots": 1,

      // Should always be `true` for `listGames`
      "joined": true,

      "config": [
        // Game type id, if it exists.
        "typeId": integer
        "slots": [{
              // See "Slot Type" above.
              "type": string,

              // `true` if a player is occupying this slot.
              // Always `true` for AI-type slots.
              "filled": true|false,

              // If filled, a constrained Player object. Not available for
              // AI slot types, except if the AI slot is a result of the
              // player dropping.
             "player": {
               // User object
                "user": {
                  "displayName": string,
                  "avatar": integer,
                  "objectId": string
                },
                // Active or inactive, see Player State above.
                "state": integer,
              },

              // AI difficulty as specified in the create game configuration,
              // only present for AI-type slots.
              "difficulty": integer

            },
            {
              "type": "open",
              "filled": true,
              "player": {
                "slot": 1,
                "className": "Player"
              }
            }
        ]
        "playerNum": integer,
        "isRandom": true|false,
        "turnMaxSec": integer,
      ]


      ...
    },
    // Game two
    {
      "objectId": "idB",
      ...
    },
    ...
  ]
}
```


## `listFriends`
### Request
```
{
  // How many contacts to return sorted by most recent first
  "limit": integer (default 100, min 1, max 1000)
  // How many contacts to skip (for pagination)
  "skip": integer (default 0)
}
```
### Response
```
{
  "code": CONTACT_LIST,

  "contacts": [
    {
      "displayName": "Ally",
      "objectId": "idA",

      // You can set this number on user signup or with `userSet`
      "avatar": integer
    },
    {
      "displayName": "Bobzor",
      "objectId": "idB",
      "avatar": integer
    }
  ]
}
```


## `addFriend`
### Request
```
{
  "displayName": "name"
}
```
### Response
```
{
  "code": CONTACT_ADDED / USER_NOT_FOUND | CONTACT_NOT_FOUND | CONTACT_EXISTS,
  "contact": {

    // The user that added the contact
    "user": {
      "displayName": "Carry",
      "objectId": "ElX0nxSAy7",
      ...
    },

    // The contact that was added
    "contact": {
      "displayName": "Ally",
      "objectId": "etSAhagpLp",
      ...
    }

  },
}
```


## `blockFriend`
Block a user from inviting the calling user to games. Unblock by calling
`addFriend` again. Creates a contact with `blocked: true` if it doesn't
exist yet.
### Request
```
{
  "displayName": "name"
}
```
### Response
```
{
  "code": CONTACT_BLOCKED / USER_NOT_FOUND
}
```


## `deleteFriend`
### Request
```
{
  "displayName": "name"
}
```
### Response
```
{
  "code": CONTACT_DELETED / USER_NOT_FOUND | CONTACT_NOT_FOUND
}
```


## `startGame`
Start a game manually if it's able to be started (`startable` game property
in `listGames` should equal `true`). Only available to the creator of the game. 
### Request
```
{
  "gameId": "id"
}
```
### Response
```
// Game join response object (see createGame)
{
  "code": GAME_STARTED / GAME_THIRD_PARTY | GAME_NOT_STARTABLE | GAME_START_ERROR | GAME_INSUFFICIENT_PLAYERS,

  "game": {...},
  "playerCount": integer,
  "player": {...}
}
```


## `gameTurn`
Add a new game turn. The player order is based on the slot index. Lower slot
indexes are first, then it wraps around.
### Request
```
{
  "gameId": "id",
  "save": "save contents",
  "final": true|false
}
```
### Response
```
{
  "code": TURN_SAVED / TURN_NOT_IT | GAME_INVALID_STATE,

  "ended": true|false
}
```


## `listTurns`
### Request
```
{
  "gameId": "id",
  // How many turns to return sorted by most recent first
  "limit": integer (default 3, min 1, max 100)
  // How many turns to skip (for pagination)
  "skip": integer (default 0)
}
```
### Response
```
{
  "code": TURN_LIST / TURN_THIRD_PARTY | GAME_NOT_FOUND,

  "turns": [
    {
      // Player object (with a User)
      "player": {...},

      // Type, e.g. player made turn or 
      // turn made by timeout.
      // See "Turn Type" above.
      "type": integer,

      // Turn index
      "turn": integer,

      // Save contents provided in `gameTurn`.
      // In case of a timeout, this should equal
      // the last valid turn save made or `null`
      // if there were no valid turns yet i.e.
      // game starts with a turn timeout.
      "save": string
    },
    {
      "player": {...},
      "turn": 3,
      "save": "qwertz"
    },
    {
      "player": {...},
      "turn": 2,
      "save": "asdfg"
    },
    ...
  ]
}
```


## `storePushToken`
Stores a token for push notifications in the database.

Make sure you've sent an `X-Parse-Installation-Id` header with login and signup
requests, so the server can have a unique installation ID for the device.

Here is an example on how to generate the installation ID:
<https://github.com/parse-community/Parse-SDK-JS/blob/master/src/InstallationController.js#L18..L32>

If you don't send an installation ID along with your signup and login requests,
storing the push token will fail.

### Request
```
{
  "deviceToken": "Firebase registration token here",
  "pushType": "gcm"    // Optional, defaults to "gcm"
}
```

Note that `gcm` should be used as the `pushType` not only for GCM, but also for
FCM/Firebase push notifications, as they share the same push code.

### Response
```
{
  "code": PUSH_TOKEN_SET / PUSH_TOKEN_ERROR | INVALID_PARAMETER
}
```





# Database Schema

See `schema/schema.json`.

# Gist
```
example save game https://gist.github.com/MarkFassett/4d256c6e526d92eaba3dccab6d0d384b

account flow
  1. create account
  2. click auth link sent to e-mail
  3. log in with user/pass

pw recovery flow
  4. request password recovery e-mail via ui
  5. link to click to reset pw and related form

new device login
  send notification e-mail
  keep track of user's devices

Challenge flow
  1. create game, set max slots
  2. send challenge link(s) or request random players
    if random flag set, then people can join by request random
  3. start play when ready (min 2 players)

Other items
  Need push notifications to drive play
  Should keep log of all games

Ranking system
  maybe just go by avg score due to absence of griefing/competitive scores?
  or by deviation from group norm to normalize for the cards?
  Or something even more or less clever...

/checkNameFree?displayName=

/createAccount?user=&login=&displayname=
  - check no obscene name
  - check unique display name

/authenticate?user=&login=&deviceId=
/recoverPassword?email=

/createGame?settings=
  get back shortlink to send to let people play with you
  properties
    max players
    # of fame cards (1-16)
    AI player count
    ??? max turn time ??? - if expired next guy is notified and runs AI for the idle player

/requestGame
  used to join random game  
  create a lobby if none present
  lobbies will time out and start play to keep things going
  potentially secret AI?

/gameTurn?gameId&state
  Upload save game for next player and notify them it's ready
  16kb currently
  4 player will be couple kb more

/listGames
  get back state of all games you are involved in

/listFriends
  get list of all known buddies

/deleteFriend
  remove friend from list
```

# Parse Server

Read the full Parse Server guide here: https://github.com/ParsePlatform/parse-server/wiki/Parse-Server-Guide

### For Local Development

* Make sure you have at least Node 4.3. `node --version`
* Clone this repo and change directory to it.
* `npm install`
* Install mongo locally using https://docs.mongodb.com/master/administration/install-community/
* Run `mongo` to connect to your database, just to make sure it's working. Once you see a mongo prompt, exit with Control-D
* Run the server with: `npm start`
* By default it will use a path of /parse for the API routes.  To change this, or use older client SDKs, run `export PARSE_MOUNT=/1` before launching the server.
* You now have a database named "dev" that contains your Parse data
* Install ngrok and you can test with devices

### Getting Started With Heroku + mLab Development

#### With the Heroku Button

[![Deploy](https://www.herokucdn.com/deploy/button.png)](https://heroku.com/deploy)

#### Without It

* Clone the repo and change directory to it
* Log in with the [Heroku Toolbelt](https://toolbelt.heroku.com/) and create an app: `heroku create`
* Use the [mLab addon](https://elements.heroku.com/addons/mongolab): `heroku addons:create mongolab:sandbox --app YourAppName`
* By default it will use a path of /parse for the API routes.  To change this, or use older client SDKs, run `heroku config:set PARSE_MOUNT=/1`
* Deploy it with: `git push heroku master`

### Getting Started With AWS Elastic Beanstalk

#### With the Deploy to AWS Button

<a title="Deploy to AWS" href="https://console.aws.amazon.com/elasticbeanstalk/home?region=us-west-2#/newApplication?applicationName=ParseServer&solutionStackName=Node.js&tierName=WebServer&sourceBundleUrl=https://s3.amazonaws.com/elasticbeanstalk-samples-us-east-1/eb-parse-server-sample/parse-server-example.zip" target="_blank"><img src="http://d0.awsstatic.com/product-marketing/Elastic%20Beanstalk/deploy-to-aws.png" height="40"></a>

#### Without It

* Clone the repo and change directory to it
* Log in with the [AWS Elastic Beanstalk CLI](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3-install.html), select a region, and create an app: `eb init`
* Create an environment and pass in MongoDB URI, App ID, and Master Key: `eb create --envvars DATABASE_URI=<replace with URI>,APP_ID=<replace with Parse app ID>,MASTER_KEY=<replace with Parse master key>`

### Getting Started With Microsoft Azure App Service

#### With the Deploy to Azure Button

[![Deploy to Azure](http://azuredeploy.net/deploybutton.png)](https://azuredeploy.net/)

#### Without It

A detailed tutorial is available here:
[Azure welcomes Parse developers](https://azure.microsoft.com/en-us/blog/azure-welcomes-parse-developers/)


### Getting Started With Google App Engine

1. Clone the repo and change directory to it 
1. Create a project in the [Google Cloud Platform Console](https://console.cloud.google.com/).
1. [Enable billing](https://console.cloud.google.com/project/_/settings) for your project.
1. Install the [Google Cloud SDK](https://cloud.google.com/sdk/).
1. Setup a MongoDB server.  You have a few options:
  1. Create a Google Compute Engine virtual machine with [MongoDB pre-installed](https://cloud.google.com/launcher/?q=mongodb).
  1. Use [MongoLab](https://mongolab.com/google/) to create a free MongoDB deployment on Google Cloud Platform.
1. Modify `app.yaml` to update your environment variables.
1. Delete `Dockerfile`
1. Deploy it with `gcloud preview app deploy`

A detailed tutorial is available here:
[Running Parse server on Google App Engine](https://cloud.google.com/nodejs/resources/frameworks/parse-server)

### Getting Started With Scalingo

#### With the Scalingo button

[![Deploy to Scalingo](https://cdn.scalingo.com/deploy/button.svg)](https://my.scalingo.com/deploy)

#### Without it

* Clone the repo and change directory to it
* Log in with the [Scalingo CLI](http://cli.scalingo.com/) and create an app: `scalingo create my-parse`
* Use the [Scalingo MongoDB addon](https://scalingo.com/addons/scalingo-mongodb): `scalingo addons-add scalingo-mongodb free`
* Setup MongoDB connection string: `scalingo env-set DATABASE_URI='$SCALINGO_MONGO_URL'`
* By default it will use a path of /parse for the API routes. To change this, or use older client SDKs, run `scalingo env-set PARSE_MOUNT=/1`
* Deploy it with: `git push scalingo master`

### Getting Started With OpenShift Online (Next Gen)

1. Register for a free [OpenShift Online (Next Gen) account](http://www.openshift.com/devpreview/register.html)
1. Create a project in the [OpenShift Online Console](https://console.preview.openshift.com/console/).
1. Install the [OpenShift CLI](https://docs.openshift.com/online/getting_started/beyond_the_basics.html#btb-installing-the-openshift-cli).
1. Add the Parse Server template to your project: `oc create -f https://raw.githubusercontent.com/ParsePlatform/parse-server-example/master/openshift.json`
1. Deploy Parse Server from the web console
  1. Open your project in the [OpenShift Online Console](https://console.preview.openshift.com/console/):
  1. Click **Add to Project** from the top navigation
  1. Scroll down and select **NodeJS > Parse Server**
  1. (Optionally) Update the Parse Server settings (parameters)
  1. Click **Create**

A detailed tutorial is available here:
[Running Parse Server on OpenShift Online (Next Gen)](https://blog.openshift.com/parse-server/)

# Using it

Before using it, you can access a test page to verify if the basic setup is working fine [http://localhost:1337/test](http://localhost:1337/test).
Then you can use the REST API, the JavaScript SDK, and any of our open-source SDKs:

Example request to a server running locally:

```curl
curl -X POST \
  -H "X-Parse-Application-Id: myAppId" \
  -H "Content-Type: application/json" \
  -d '{"score":1337,"playerName":"Sean Plott","cheatMode":false}' \
  http://localhost:1337/parse/classes/GameScore
  
curl -X POST \
  -H "X-Parse-Application-Id: myAppId" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:1337/parse/functions/hello
```

Example using it via JavaScript:

```javascript
Parse.initialize('myAppId','unused');
Parse.serverURL = 'https://whatever.herokuapp.com';

var obj = new Parse.Object('GameScore');
obj.set('score',1337);
obj.save().then(function(obj) {
  console.log(obj.toJSON());
  var query = new Parse.Query('GameScore');
  query.get(obj.id).then(function(objAgain) {
    console.log(objAgain.toJSON());
  }, function(err) {console.log(err); });
}, function(err) { console.log(err); });
```

Example using it on Android:
```java
//in your application class

Parse.initialize(new Parse.Configuration.Builder(getApplicationContext())
  .applicationId("myAppId")
  .server("http://myServerUrl/parse/")   // '/' important after 'parse'
  .build());

ParseObject testObject = new ParseObject("TestObject");
testObject.put("foo", "bar");
testObject.saveInBackground();
```
Example using it on iOS (Swift):
```swift
//in your AppDelegate

Parse.initializeWithConfiguration(ParseClientConfiguration(block: { (configuration: ParseMutableClientConfiguration) -> Void in
  configuration.server = "https://<# Your Server URL #>/parse/" // '/' important after 'parse'
  configuration.applicationId = "<# Your APP_ID #>"
}))
```
You can change the server URL in all of the open-source SDKs, but we're releasing new builds which provide initialization time configuration of this property.
