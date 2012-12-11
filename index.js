/**
 * This module intercepts and modifies the application as follows:
 *
 * - The main page is modified to provide a login form to enter a room
 * - On submission of the presenter form, we first check LDAP for the user's credentials.  If not
 *   found, the app does whatever normal local auth it does.  If the user is found, however, we
 *   tell the app to skip its normal authentication and send back the user's relevant data.
 * - On submit of the room entry form from the main page, we require authentication in a similar
 *   manner to the presenter.  We first check LDAP, then do normal local auth, returning user data
 *   to the application.
 */

// TODO: onEnable is currently not used because we can't open the LDAP connection until we have
// the latest configuration data.

// Libraries
var util = require('util')
  , ldap = require('ldapjs')

// Handlers
var handlers = {
  "plugin:configMenuInputs":  [configMenu],
  "plugin:menuSave":          [menuSave],
  "plugin:configLoaded":      [configLoaded],
  "user:authenticate":        [userAuthenticate],
};

module.exports = exports;
module.exports.handlers = handlers;

// On enable and menuSave, we update the configuration sent in to us and store it here
var config = {};

// Package-global LDAP client object
var client;

/**
 * EVENT HANDLERS
 */

// Closes the LDAP connection if it's open
exports.onDisable = function() {
  disconnect();
  console.log("LDAP Authentication disabled");
}

// Event handler - hit when the app requests this plugin's configuration menu
function configMenu(menu) {
  console.log("Configuration menu requested: ", util.inspect(menu));

  // Set up inputs to an empty array
  menu.inputs = [];

  // Hostname - where do we send our LDAP query?
  menu.inputs.push({
    key: "hostname",
    label: "LDAP host, such as \"ldaps://ldap.yourdomain.com\"",
    placeholder: "Enter your LDAP host",
    value: ""
  });

  // Bind DN
  menu.inputs.push({
    key: "bindDNFormat",
    label: "LDAP bind DN format - use \"{{user id}}\" as a placeholder for where the user's id will be (this will probably look something like \"CN={{user id}}\")",
    placeholder: "Enter your LDAP bind DN format",
    value: ""
  });

  // Base DN
  menu.inputs.push({
    key: "baseDN",
    label: "LDAP base DN (this will probably look something like \"DC=ldap,DC=yourdomain,DC=com\")",
    placeholder: "Enter your LDAP base DN",
    value: ""
  });
}

// Changes config and closes and reopens the LDAP connection if enabled
function menuSave(data) {
  setConfig(data);
}

/**
 * Configuration was sent from the main application.  We store configuration, then open an LDAP
 * connection.  This is currently called immediately after enable, so we do all post-enable logic
 * here.
 *
 * TODO: when we get a configuration API, this function needs to be migrated into the enable hook.
 * The lack of a config API means the enable hook isn't currently very useful, since we need the
 * configuration before we can start the LDAP connection.
 */
function configLoaded(documents) {
  var document = {};

  for (var i = 0,len = documents.length; i < len; i++) {
    if (documents[i].name == "ldap-authentication") {
      setConfig(documents[i])
    }
  }
}

function userAuthenticate(auth, callback) {
  // Only check LDAP if we have a working client
  if (client) {
    // Pull in the account manager only where it's needed - there's some circular reference issue
    // which causes AM's plugin object to be null if the plugin loads a module which relies on AM.
    //
    // TODO: Create a public / plugin API rather than using modules directly
    var AM = require("../../lib/account-manager");

    client.bind(config.bindDNFormat.replace("{{user id}}", auth.user), auth.password, function(err) {
      if (err) {
        // Invalid credentials isn't really an error - we just let the normal system authenticate
        // as usual
        if (err.name == "InvalidCredentialsError") {
          return callback();
        }

        // Real error?  Shoot it up the stack.
        return callback(err, null);
      }

      // If we got here, the authentication was a success - add the user if necessary, and store
      // fake credentials in all cases
      console.log("Authenticated via LDAP - setting up local access");

      // Look for a local account with the same user id - we always assume user id will be unique.
      // If a user is found, we just return that and bypass the normal authentication.  If there is
      // no user, we create one, importing data from LDAP.
      AM.findUserByName(auth.user, function(err, user) {
        if (user) {
          return callback(null, user);
        }

        // TODO: Import LDAP stuff here
        var newUser = {
          name: "Test O. User",
          email: "testo@example.com",
          user: auth.user,

          // TODO: Hard-coded password allows anybody to bypass LDAP auth to gain access to
          // the local account.  Maybe add a flag to .signup which forces an impossible password,
          // such as an empty string, so local auth becomes impossible.
          pass: "TODO"
        };

        AM.signup(newUser, function(err) {
          if (err) {
            return callback(err);
          }
          return callback(null, newUser);
        });
      });
    });
  }
}

/**
 * HELPER METHODS
 */

// Connects the ldap client if it has configuration
function connect() {
  // Missing config means no attempt to connect
  if (!config || !config.hostname || !config.bindDNFormat || !config.baseDN) {
    console.log("LDAP client missing configuration - not connecting");
    return;
  }

  // Make sure we have the right replace string for user id
  if (config.bindDNFormat.indexOf("{{user id}}") == -1) {
    console.log("LDAP client configuration invalid - \"{{user id}}\" must be part of the bind DN format");
    return;
  }

  client = ldap.createClient({url: config.hostname});
  console.log("LDAP client connected to " + config.hostname);
}

// Disconnects the ldap client if it's connected
function disconnect() {
  if (client) {
    console.log("LDAP client disconnecting");
    client.unbind();
    client = null;
  }
}

/**
 * Stores config data - called from menuSave and configLoaded hooks to centralize the common
 * behavior of disconnect, set config, reconnect.
 *
 * TODO: when we get a configuration API, this function needs to be migrated into the enable hook.
 * The lack of a config API means the enable hook isn't currently very useful, since we need the
 * configuration before we can start the LDAP connection.
 */
function setConfig(data) {
  console.log("LDAP client got config: " + util.inspect(data));

  // Always disconnect on config changes - even if we're disabled this call won't cost us anything
  disconnect();

  // Make sure we only copy in relevant information - no need to get id, plugin name, or any other
  // potential data that the DB might throw our way
  config = {
    hostname: data.hostname,
    bindDNFormat: data.bindDNFormat,
    baseDN: data.baseDN
  }

  // In theory we should only reconnect on enable, but the current API can only get config to
  // plugins that are enabled, so this is safe.
  connect();
}
