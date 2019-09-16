// process.env.VERBOSE = 1

var express = require('express');
var ParseServer = require('parse-server').ParseServer;
var path = require('path');
var util = require('util');
var humanTime = require('human-time');
var kue = require('kue');
var constants = require('./cloud/constants.js');

var databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;
var databasePrefix =
  process.env.PARSE_SERVER_COLLECTION_PREFIX !== undefined ? process.env.PARSE_SERVER_COLLECTION_PREFIX :
  process.env.MONGODB_PREFIX !== undefined ? process.env.MONGODB_PREFIX :
  process.env.APP_ID + "_";

if (!databaseUri) {
  console.log('DATABASE_URI not specified, falling back to localhost.');
}

var serverConfig = {
  databaseURI: databaseUri,
  collectionPrefix: databasePrefix,
  cloud: process.env.CLOUD_CODE_MAIN || __dirname + '/cloud/main.js',
  appId: process.env.APP_ID,
  masterKey: process.env.MASTER_KEY, //Add your master key here. Keep it secret!
  serverURL: process.env.SERVER_ROOT + process.env.PARSE_MOUNT,  // Don't forget to change to https if needed
  push: {
    android: {
      senderId: process.env.ANDROID_SENDER_ID,
      apiKey: process.env.ANDROID_API_KEY
    },
    ios: {
      pfx: process.env.IOS_CERTIFICATE || 'push/PushCertificate.p12',
      passphrase: process.env.IOS_PASSPHRASE || '',
      topic: process.env.IOS_BUNDLE,
      production: process.env.IOS_PRODUCTION == 'true'
    }
  },
  enableAnonymousUsers: false,
  allowClientClassCreation: false,
  verifyUserEmails: true,
  emailVerifyTokenValidityDuration: 2*60*60, // Expires in 2 hours
  preventLoginWithUnverifiedEmail: true,
  publicServerURL: process.env.SERVER_ROOT + process.env.PARSE_MOUNT,
  appName: process.env.APP_NAME,
  emailAdapter: {
    module: '@parse/simple-mailgun-adapter',
    options: {
      fromAddress: process.env.VERIFICATION_EMAIL_SENDER,
      domain: process.env.MAILGUN_DOMAIN,
      apiKey: process.env.MAILGUN_API_KEY
    }
  }
};

var api = new ParseServer(serverConfig);
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

var app = express();

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || '/parse';
app.use(mountPath, api);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function(req, res) {
  res.status(200).send('I dream of being a PB server.');
});


// Templating setup
var mustacheExpress = require('mustache-express');

// Register '.html' extension with The Mustache Express
app.engine('html', mustacheExpress());
app.set('view engine', 'html');


// Views
app.get('/join/:inviteId', function(req, res) {
  var inviteId = String(req.params.inviteId);
  
  var query = new Parse.Query(Parse.Object.extend("Invite"));
  query
    .include("inviter")
    .include("inviter.game")
    .include("inviter.user")
    .get(inviteId)
    .then(
      function(invite) {
        var inv = invite.toJSON();
        inv.createdAtHuman = humanTime(new Date(inv.createdAt));
        res.render("join", { invite: inv });
      },
      function(error) {
        res.render("join", { error: error });
      }
    );
});

if (process.env.TESTING === "true") {

  console.log("Power On Self Test");
  var idMap = {};
  for (var messageName in constants.t) {
    var message = constants.t[messageName];
    if (isNaN(message.id)) throw new Error("Invalid message: " + message);
    var inMap = idMap[message.id];
    if (inMap) throw new Error("Message ID for " + messageName + " already in use by " + inMap);
    idMap[message.id] = messageName;
  }
  idMap = null;


  // Start the kue job queue UI
  app.use("/kue", kue.app);
  console.log('kue UI available at /kue');

  Parse.Cloud.define("debugGame", function(req, res) {
    if (!req.master) { res.error("unauthorized"); return; }
    var query = new Parse.Query(Parse.Object.extend("Game"));
    query
      .get(req.params.gameId)
      .then(
        function(game) {
          res.success(game);
        },
        function(error) {
          res.error(error);
        }
      );
  });
  
   Parse.Cloud.define("destroyGame", function(req, res) {
    if (!req.master) { res.error("unauthorized"); return; }
    var query = new Parse.Query(Parse.Object.extend("Game"));
    query
      .get(req.params.gameId, { useMasterKey: true })
      .then(
        function(game) {
          return game.destroy({ useMasterKey: true });
        }
      ).then(
        function() {
          res.success({ destroyed: true });
        },
        function(error) {
          res.error(error);
        }
      );
  });

  Parse.Cloud.define("purgeContacts", function(req, res) {
    if (!req.master) { res.error("unauthorized"); return; }

    var userQuery = new Parse.Query(Parse.Object.extend("User"));
    userQuery
      .containedIn("username", [
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
        "dan@example.com"
      ])
      .find({ useMasterKey: true })
      .then(
        function(users) {
          var contactQuery = new Parse.Query(Parse.Object.extend("Contact"));
          return contactQuery
            .containedIn("user", users)
            .find({ useMasterKey: true });
        }
      ).then(
        function(contacts) {
          return Parse.Object.destroyAll(contacts, { useMasterKey: true });
        }
      ).then(
        function() {
          res.success({ purged: true });
        },
        function(error) {
          res.error(error);
        }
      );

  });

  Parse.Cloud.define("purgeRandomGames", function(req, res) {
    if (!req.master) { res.error("unauthorized"); return; }

    var configQuery = new Parse.Query(Parse.Object.extend("Config"));
    configQuery
      .equalTo("isRandom", true);
    
    var query = new Parse.Query(Parse.Object.extend("Game"));
    query
      .matchesQuery("config", configQuery)
      .equalTo("state", 1)
      .find({ useMasterKey: true })
      .then(
        function(games) {
          if (games) {
            return Parse.Object.destroyAll(games);
          } else {
            return Parse.Promise.reject("No games found.");
          }
        }
      ).then(
        function() {
          res.success({ purged: true });
        },
        function(error) {
          res.error(error);
        }
      );

  });

  Parse.Cloud.define("purgeGamesABCD", function(req, res) {
    if (!req.master) { res.error("unauthorized"); return; }

    var userQuery = new Parse.Query(Parse.Object.extend("User"));
    userQuery
      .containedIn("username", [
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
        "dan@example.com"
      ])
    
    var query = new Parse.Query(Parse.Object.extend("Game"));
    query
      .matchesQuery("creator", userQuery)
      .limit(10000)
      .find({ useMasterKey: true })
      .then(
        function(games) {
          console.log(games.length)
          if (games) {
            return Parse.Object.destroyAll(games);
          } else {
            return Parse.Promise.reject("No games found.");
          }
        }
      ).then(
        function() {
          res.success({ purged: true });
        },
        function(error) {
          res.error(error);
        }
      );

  });



  app.get('/createAccount', function(req, res) {
    var user = new Parse.User();
    user.set("username", req.query.user);
    user.set("displayName", req.query.display);
    user.set("password", req.query.pass);
    user.set("email", req.query.email);

    user.signUp().then(
      function(user) {
        res.status(200).send("Welcome " + user.get("username"));
      },
      function(error) {
        res.status(202).send(error);
      }
    );
  });

  app.get('/testPush', function(req, res) {
        
    var userQuery = new Parse.Query(Parse.Object.extend("User"));
    userQuery
      .equalTo("username", "carol@example.com");

    var sessionQuery = new Parse.Query(Parse.Session);
    sessionQuery
      .matchesQuery("user", userQuery);
    
    var installationQuery = new Parse.Query(Parse.Installation);
    installationQuery
      .matchesKeyInQuery("installationId", "installationId", sessionQuery);
    
    Parse.Push.send({
      where: installationQuery,
      data: {
        "alert": "This has extra stuff!",
        "data": { "name": "extra stuff" }
      }
    }, { useMasterKey: true })
    .then(
        function() {
          res.status(200).send("Pushed!");
        },
        function(error) {
          res.status(500).send(error);
        }
    );

  });

}


var port = process.env.PORT;
var httpServer = require('http').createServer(app);
httpServer.listen(port, function() {
    console.log('pbserver running on port ' + port + '.');
});

