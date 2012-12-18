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
  "auth:presenterAuth":       [presenterAuth],
  "auth:clientUI":            [clientUI],
  "auth:clientAuth":          [clientAuth],
};

module.exports = exports;
module.exports.handlers = handlers;

// On enable and menuSave, we update the configuration sent in to us and store it here
var config = {};

// Package-global LDAP client object
var client;

// We're using this enough that it needs to stop being a magic string
var USER_ID = "{{user id}}";

/**
 * EVENT HANDLERS
 */

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
    label: "LDAP bind DN format - use \"" + USER_ID + "\" as a placeholder for where the user's id will be (this will probably look something like \"CN=" + USER_ID + "\")",
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

  // Filter expression for finding and importing presenter data
  menu.inputs.push({
    key: "presenterFilter",
    label: "LDAP filter expression for presenter accounts - use \"" + USER_ID + "\" as a placeholder for where the user's id will be (this will probably look something like \"(&(CN=" + USER_ID + ")(objectClass=person))\")",
    placeholder: "Enter your LDAP filter for presenters",
    value: ""
  });

  // Filter expression for finding and authenticating client data
  menu.inputs.push({
    key: "clientFilter",
    label: "LDAP filter expression for client lookups - use \"" + USER_ID + "\" as a placeholder for where the user's id will be (this will probably look something like \"(&(CN=" + USER_ID + ")(objectClass=person))\")",
    placeholder: "Enter your LDAP filter for clients",
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

function presenterAuth(auth, cb) {
  // Always disconnect after finishing regardless of whatever else has happened
  callback = function(err, obj) {
    disconnect();
    cb(err, obj);
  };

  // Get an LDAP connection
  connect();

  // Only check LDAP if we managed to get a working client
  if (!client) {
    // If we got here, something went very wrong with the LDAP connection
    console.log("LDAP connection was missing in authentication attempt");
    return callback();
  }

  // Make sure we don't crash when bad data is passed in
  if (!auth || !auth.password || !auth.user) {
    return callback();
  }

  // Pull in the account manager only where it's needed - there's a circular require issue which
  // causes AM's plugin object to be null if plugin-manager loads a module which relies on AM.
  //
  // TODO: Create a public / plugin API rather than using modules directly
  var AM = require("../../lib/account-manager");

  client.bind(config.bindDNFormat.replace(USER_ID, auth.user), auth.password, function(err) {
    if (err) {
      // Invalid credentials isn't really an error - we just let the normal system authenticate
      // as usual
      if (err.name == "InvalidCredentialsError") {
        console.log("Unable to authenticate via LDAP - falling back to local auth");
        return callback();
      }

      // Real error?  Shoot it up the stack.
      console.log("Unable to authenticate via LDAP due to errors: " + err.name + " " + err.message);
      return callback(err, null);
    }

    // If we got here, the authentication was a success - add the user if necessary, and store
    // fake credentials in all cases
    console.log("LDAP authentication successful");

    // Look for a local account with the same user id - we always assume user id will be unique.
    // If a user is found, we just return that and bypass the normal authentication.  If there is
    // no user, we create one, importing data from LDAP.
    //
    // TODO: We should validate that this user is allowed to be a presenter in case local accounts
    // are created for clients later on
    AM.findUserByName(auth.user, function(err, user) {
      if (user) {
        return callback(null, user);
      }

      // Import LDAP user
      client.search(config.baseDN, {filter: config.presenterFilter.replace(USER_ID, auth.user), scope: "sub"}, function(err, res) {
        if (err) {
          console.log("Error trying to search user data: " + util.inspect(err));
          return callback(err, null);
        }

        // Start building the new user record
        var newUser = {
          user: auth.user,

          // We set password to a dummy string because there's no way our hashed passwords could
          // ever use this to allow local authentication.  The "external" flag tells AM not to
          // do any of its usual salting.
          pass: "LDAP",
          external: true
        };

        // If any errors occur, we need to flag the user search as having failed so we can call
        // the callback properly
        var failure = null;
        res.on('error', function(err) {
          failure = err;
        });

        res.on('searchEntry', function(entry) {
          newUser.name = entry.object.displayName;
          newUser.email = entry.object.mail;
        });

        res.on('end', function(result) {
          if (failure) {
            return callback(failure);
          }

          console.log("LDAP read successful - attempting to import: ", util.inspect(newUser));
          AM.signup(newUser, function(err) {
            if (err) {
              return callback(err, null);
            }

            console.log("Local import successful");
            return callback(null, newUser);
          });
        });
      });
    });
  });
}

function clientAuth(auth, cb) {
  // Always disconnect after finishing regardless of whatever else has happened
  callback = function(err, obj) {
    disconnect();
    cb(err, obj);
  };

  // Get an LDAP connection
  connect();

  // Only check LDAP if we managed to get a working client
  if (!client) {
    // If we got here, something went very wrong with the LDAP connection
    return callback({message: "LDAP connection was missing in authentication attempt", name: "MissingConnection"});
  }

  // Make sure we don't crash when bad data is passed in
  if (!auth || !auth.password || !auth.user) {
    return callback({message: "Bad credentials provided"});
  }

  client.bind(config.bindDNFormat.replace(USER_ID, auth.user), auth.password, function(err) {
    if (err) {
      // All errors are fatal on the client auth side since there's no "fallback" login system
      return callback(err, null);
    }

    console.log("LDAP authentication successful");

    // Search for LDAP user to make sure this user is allowed here
    client.search(config.baseDN, {filter: config.clientFilter.replace(USER_ID, auth.user), scope: "sub"}, function(err, res) {
      if (err) {
        return callback(err, null);
      }

      // Set up a user data record
      var userData = { user: auth.user };

      // If any errors occur, we need to flag the user search as having failed so we can call
      // the callback properly
      var failure = null;
      res.on('error', function(err) {
        failure = err;
      });

      res.on('searchEntry', function(entry) {
        userData.name = entry.object.displayName;
        userData.email = entry.object.mail;
      });

      res.on('end', function(result) {
        if (failure) {
          return callback(failure);
        }

        return callback(null, userData);
      });
    });
  });
}

// Alerts the UI that we want name and password on the form
function clientUI(locals) {
  locals.auth = true;
}

/**
 * HELPER METHODS
 */

// Returns an array of error messages when configuration isn't valid
function validateConfiguration() {
  var errors = [];
  if (!config) {
    return ["No configuration has been loaded"];
  }

  if (!config.hostname) {
    errors.push("Hostname is required");
  }

  if (!config.bindDNFormat) {
    errors.push("Bind DN format is required");
  }
  else if (config.bindDNFormat.indexOf(USER_ID) == -1) {
    errors.push("Invalid bindDN format - missing \"" + USER_ID + "\"");
  }

  if (!config.baseDN) {
    errors.push("Base DN is required");
  }

  if (!config.presenterFilter) {
    errors.push("Presenter filter is required");
  }
  else if (config.presenterFilter.indexOf(USER_ID) == -1) {
    errors.push("Invalid presenter filter format - missing \"" + USER_ID + "\"");
  }

  if (!config.clientFilter) {
    errors.push("Client filter is required");
  }
  else if (config.clientFilter.indexOf(USER_ID) == -1) {
    errors.push("Invalid client filter format - missing \"" + USER_ID + "\"");
  }

  return errors;
}

// Connects the ldap client if it has configuration
function connect() {
  // TODO: Make this log errors in a nicer way (logger API exposed in plugin-manager?)
  var errors = validateConfiguration();
  var errorCount = errors.length;
  if (errorCount > 0) {
    console.log("LDAP configuration error, connect() aborted:");
    for(i = 0; i < errorCount; i++) {
      console.log("* ", errors[i]);
    }

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

  // Make sure we only copy in relevant information - no need to get id, plugin name, or any other
  // potential data that the DB might throw our way
  config = {
    hostname: data.hostname,
    bindDNFormat: data.bindDNFormat,
    baseDN: data.baseDN,
    presenterFilter: data.presenterFilter,
    clientFilter: data.clientFilter,
  }
}
