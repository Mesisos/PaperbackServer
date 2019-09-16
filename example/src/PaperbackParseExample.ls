package
{
    import loom.Application;
    import loom2d.display.StageScaleMode;
    import loom2d.display.Image;
    import loom2d.display.Quad;
    import loom2d.textures.Texture;    
    import loom2d.events.Event;
    import loom2d.events.Touch;
    import loom2d.events.TouchEvent;
    import loom2d.events.TouchPhase;
    import loom2d.Loom2D;
    import system.ByteArray;

    import loom2d.text.TextField;    
    import loom2d.text.BitmapFont;
    
    import feathers.themes.MetalWorksMobileTheme;
    import feathers.controls.TextInput;
    import feathers.controls.Button;    
    import feathers.controls.Label;
    import feathers.events.FeathersEventType;

    import loom.social.Parse;
    import loom.platform.Mobile;

    enum GameState {
        Init,
        Lobby,
        Running,
        Ended
    };

    public class PaperbackParseExample extends Application
    {
        var sessionToken:String;
        var quad:Quad;

        var gameId:String;

        override public function run():void
        {

            quad = new Quad(50, 50, 0x00FF00);
            stage.addChild(quad);

            trace("Running from remote notification:", Mobile.wasOpenedViaRemoteNotification(), Mobile.getRemoteNotificationData("alert"));

            Mobile.onOpenedViaRemoteNotification += function() {
                var notificationData = Mobile.getRemoteNotificationData("data");
                var json = JSON.parse(notificationData);
                trace("Opened via remote notification:", Mobile.getRemoteNotificationData("alert"));
                trace(json.serialize());
            };

            //Set our onTimeout delegate. This will trigger after 10 seconds (by default) without a server response.
            Parse.REST_onTimeout = function()
            {
                trace("Timed out");
            };

            var username = "alice@example.com";

            trace("Parse active: " + Parse.isActive());
            if(Parse.isActive())
            {
                var updated = Parse.updateInstallationUserID(username);
                trace("Installation user ID updated: " + updated);
                trace("Installation ID: " + Parse.getInstallationID());
                trace("Installation Object ID: " + Parse.getInstallationObjectID());
            }

            loginUser(username, "p", createGame);
        }

        private function printGameResponse(result:JSON)
        {
            if (!result) return;

            // trace("Game JSON:", result.serialize());

            var game:JSON = result.getValue("game") as JSON;
            gameId = game.getValue("objectId") as String;
            var gameState:GameState = game.getValue("state") as GameState;
            var playerId:String = (result.getValue("player") as JSON).getValue("objectId") as String;
            var playerCount:int = result.getValue("playerCount") as int;

            trace("Game: " + gameId + "  State: " + gameState + "  Players: " + playerCount + "  Player: " + playerId);
        }

        private function createGame()
        {
            trace("Creating a game");
            Parse.REST_callCloudFunction(
                "createGame",
                JSON.fromDictionary({
                    "slotNum": 2,
                    "isRandom": false,
                    "fameCardNum": 10,
                    "aiNum": 0,
                    "turnMaxSec": 60
                }),
                function(response:ByteArray)
                {
                    var responseJSON:JSON = JSON.parse(response.toString());
                    printGameResponse(responseJSON.getValue("result") as JSON);
                    loginUser("bob@example.com", "p", joinGame);
                },
                function(response:ByteArray)
                {
                    trace("Error: " + response.toString());
                }
            );
        }

        private function joinGame()
        {
            trace("Joining the game");
            Parse.REST_callCloudFunction(
                "joinGame",
                JSON.fromDictionary({
                    "gameId": gameId
                }),
                function(response:ByteArray)
                {
                    var responseJSON:JSON = JSON.parse(response.toString());
                    printGameResponse(responseJSON.getValue("result") as JSON);
                },
                function(response:ByteArray)
                {
                    trace("Error: " + response.toString());
                }
            );
        }

        //Call the Parse tick function to increment timeout and the request queue timer.
        //If this is not called, requests will not send or time out.
        override public function onTick():void
        {            
            super.onTick();

            var f = (Math.sin(Loom2D.juggler.elapsedTime * 2) + 1) * 0.5;
            quad.x = f * stage.stageWidth;
            quad.y = f * stage.stageHeight;
        }

        public function loginUser(username:String, password:String, done:Function)
        {
            Parse.REST_loginWithUsername(
                username,
                password,
                function(result:ByteArray) //request success delegate
                {
                    //Create a JSON object to parse the result the server returned
                    var responseJSON:JSON = JSON.parse(result.toString());

                    var username:String = responseJSON.getString("username");
                    trace("Logged in as " + username);
                    
                    Parse.REST_SessionToken = responseJSON.getString("sessionToken");

                    //If Parse Push Notes are supported on this device, we pass the username to the Installation so we can target our push notes.
                    if (Parse.isActive())
                    {
                        Parse.updateInstallationUserID(username);
                    }

                    done();
                },
                function(result:ByteArray) //request failure delegate
                {
                    trace("Login failed:");
                    trace(result.toString());
                }
            );
        }
        
    }
}