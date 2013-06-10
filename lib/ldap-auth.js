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

// Libraries
var util = require('util')
  , ldap = require('ldapjs')

// Handlers
var plugin = {
  enable:           onEnable,
  configMenuInputs: configMenu,
  loadConfig:       loadConfig
};

var auth = {
  presenterAuth:    presenterAuth,
  clientUI:         clientUI,
  clientAuth:       clientAuth
};

// Alias to eventually hold the parent app's api
var api;

module.exports = exports;
module.exports.plugin = plugin;
module.exports.auth = auth;

// Object encompassing global methods and data - this is to help facilitate testing, but it's
// starting to look like this should have been an object from the get-go.
var LDAPAuth = {
  bind: bind,
  onEnable: onEnable,
  findLocalUser: findLocalUser,
  importLocalUser: importLocalUser,
  configMenu: configMenu,
  getLDAPUser: getLDAPUser,
  loadConfig: loadConfig,
  presenterAuth: presenterAuth,
  clientAuth: clientAuth,
  clientUI: clientUI,
  validateConfiguration: validateConfiguration,
  connect: connect,
  disconnect: disconnect,

  // Configuration settings passed in by app
  config: {},

  // LDAP client object
  client: null,

  // User id string for config replacement
  USER_ID: "{{user id}}",
}

// For testing, we expose direct function access
module.exports._LDAPAuth = LDAPAuth;

// Prefix for all account names - this ensures LDAP accounts are unlikely to collide with local
// accounts
var ACCOUNT_NAME_PREFIX = "LDAP-";

/**
 * EVENT HANDLERS
 */

// Aliases the plugin API on enable
function onEnable() {
  console.log("enabled");
  api = module.exports.pluginManager.api;
}

// Event handler - hit when the app requests this plugin's configuration menu
function configMenu(menu) {
  api.logger.info("Configuration menu requested: ", util.inspect(menu));

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
    label: "LDAP bind DN format - use \"" + LDAPAuth.USER_ID + "\" as a placeholder for where the user's id will be (this will probably look something like \"CN=" + LDAPAuth.USER_ID + "\")",
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
    label: "LDAP filter expression for presenter accounts - use \"" + LDAPAuth.USER_ID + "\" as a placeholder for where the user's id will be (this will probably look something like \"(&(CN=" + LDAPAuth.USER_ID + ")(objectClass=person))\")",
    placeholder: "Enter your LDAP filter for presenters",
    value: ""
  });

  // Filter expression for finding and authenticating client data
  menu.inputs.push({
    key: "clientFilter",
    label: "LDAP filter expression for client lookups - use \"" + LDAPAuth.USER_ID + "\" as a placeholder for where the user's id will be (this will probably look something like \"(&(CN=" + LDAPAuth.USER_ID + ")(objectClass=person))\")",
    placeholder: "Enter your LDAP filter for clients",
    value: ""
  });
}

function presenterAuth(auth, cb) {
  // Always disconnect after finishing regardless of whatever else has happened
  var callback = function(err, obj) {
    LDAPAuth.disconnect();
    cb(err, obj);
  };

  LDAPAuth.bind(auth, function(err) {
    if (err) {
      // Invalid credentials for presenter isn't an error - we just let the normal system
      // authenticate as usual
      if (err.name == "InvalidCredentialsError") {
        api.logger.info("Unable to authenticate via LDAP - falling back to local auth");
        return callback();
      }

      // Any other errors mean we have to toss the error up the stack
      return callback(err, null);
    }

    // Now we have bound to the LDAP socket, and can validate that the user can be found in LDAP
    // with our given filter
    LDAPAuth.getLDAPUser(auth, LDAPAuth.config.presenterFilter, function(err, userLDAPData) {
      if (err) {
        api.logger.error("Error trying to search user data: " + util.inspect(err));
        return callback(err, null);
      }

      // We don't want a local admin denied just because he's not a presenter in LDAP.  For
      // instance, student needs to present so admin adds student to local db.  Student chooses
      // the same password she uses in LDAP.  We need the local account to override the LDAP filter
      // exclusion so she can still present.  i.e., local always trumps LDAP.
      if (!userLDAPData || !userLDAPData.name) {
        api.logger.info("LDAP user not found - falling back to local auth");
        return callback();
      }

      // If we got here, the authentication was a success - add the user if necessary, and store
      // fake credentials in all cases
      api.logger.info("LDAP authentication successful");

      // Set up the username with the prefix for lookup and possible import
      var localName = ACCOUNT_NAME_PREFIX + auth.user;

      // Look for a local account with the same user id - we always assume user id will be unique.
      // If a user is found, we just return that and bypass the normal authentication.  If there is
      // no user, we create one, using the previously-pulled data from LDAP.
      LDAPAuth.findLocalUser(localName, function(err, user) {
        // If we get a user, we have what we wanted and can return it here.
        if (user) {
          return callback(err, user);
        }

        userLDAPData.user = localName;
        userLDAPData.pass = "LDAP";
        userLDAPData.external = true;

        api.logger.info("LDAP read successful - attempting to import: ", util.inspect(userLDAPData));
        LDAPAuth.importLocalUser(userLDAPData, function(err, user) {
          if (err) {
            return callback(err, user);
          }

          api.logger.info("Local import successful");
          return callback(null, user);
        });
      });
    });
  });
}

// Wraps the user lookup call to account manager to keep AM dependencies isolated.
function findLocalUser(localName, callback) {
  var AM = require("../../../lib/account-manager");

  AM.findUserByName(localName, function(err, user) {
    callback(err, user);
  });
}

// Imports the given user data into the local database, wrapping the account manager call in order
// to keep this dependency isolated for testing or replacing with a proper API call.
function importLocalUser(user, callback) {
  var AM = require("../../../lib/account-manager");

  AM.signup(user, function(err) {
    callback(err, user)
  });
}

function clientAuth(auth, cb) {
  // Always disconnect after finishing regardless of whatever else has happened
  var callback = function(err, obj) {
    LDAPAuth.disconnect();
    cb(err, obj);
  };

  LDAPAuth.bind(auth, function(err) {
    if (err) {
      // All errors are fatal on the client auth side since there's no "fallback" login system
      return callback(err, null);
    }

    api.logger.info("LDAP authentication successful");

    // Search for LDAP user to make sure this user is allowed here
    LDAPAuth.getLDAPUser(auth, LDAPAuth.config.clientFilter, function(err, userData) {
      if (err) {
        api.logger.error("Error trying to search client data: " + util.inspect(err));
        return callback(err, null);
      }

      api.logger.info("Authenticated and retrieved client user information: " + util.inspect(userData));
      return callback(null, userData);
    });
  });
}

// Searches for the given username, replacing the given filter's USER_ID text with the desired
// user name.  Calls the callback function with LDAP errors or a user object containing the full
// name and email address of the requested person.
function getLDAPUser(auth, filter, callback) {
  LDAPAuth.client.search(LDAPAuth.config.baseDN, {filter: filter.replace(LDAPAuth.USER_ID, auth.user), scope: "sub"}, function(err, res) {
    if (err) {
      api.logger.error("Error trying to search user data: " + util.inspect(err));
      return callback(err, null);
    }

    // Set up an empty record
    var newUser = {}

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

      return callback(null, newUser);
    });
  });
}

// Attempts to bind to ldap with the given credentials.  Calls the callback method with either null
// (successful bind) or an error object - either from local problems or an error returned by the
// LDAP library returned (unsuccessful bind).
function bind(auth, callback) {
  // Get an LDAP connection
  LDAPAuth.connect();

  // Only check LDAP if we managed to get a working client
  if (!LDAPAuth.client) {
    // If we got here, something went very wrong with the LDAP connection
    return callback({message: "LDAP connection was missing in authentication attempt", name: "MissingConnection"});
  }

  // Make sure we don't crash when bad data is passed in
  if (!auth || !auth.password || !auth.user) {
    return callback({message: "Bad credentials provided", name: "BadCredentials"});
  }

  LDAPAuth.client.bind(LDAPAuth.config.bindDNFormat.replace(LDAPAuth.USER_ID, auth.user), auth.password, function(err) {
    if (err) {
      return callback(err)
    }

    // Success!
    return callback(null);
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
  var config = LDAPAuth.config;

  if (!config) {
    return ["No configuration has been loaded"];
  }

  if (!config.hostname) {
    errors.push("Hostname is required");
  }

  if (!config.bindDNFormat) {
    errors.push("Bind DN format is required");
  }
  else if (config.bindDNFormat.indexOf(LDAPAuth.USER_ID) == -1) {
    errors.push("Invalid bindDN format - missing \"" + LDAPAuth.USER_ID + "\"");
  }

  if (!config.baseDN) {
    errors.push("Base DN is required");
  }

  if (!config.presenterFilter) {
    errors.push("Presenter filter is required");
  }
  else if (config.presenterFilter.indexOf(LDAPAuth.USER_ID) == -1) {
    errors.push("Invalid presenter filter format - missing \"" + LDAPAuth.USER_ID + "\"");
  }

  if (!config.clientFilter) {
    errors.push("Client filter is required");
  }
  else if (config.clientFilter.indexOf(LDAPAuth.USER_ID) == -1) {
    errors.push("Invalid client filter format - missing \"" + LDAPAuth.USER_ID + "\"");
  }

  return errors;
}

// Connects the ldap client if it has configuration
function connect() {
  var errors = LDAPAuth.validateConfiguration();
  var errorCount = errors.length;
  if (errorCount > 0) {
    api.logger.error("LDAP configuration error, connect() aborted:");
    for(var i = 0; i < errorCount; i++) {
      api.logger.error("* ", errors[i]);
    }

    return;
  }

  LDAPAuth.client = ldap.createClient({url: LDAPAuth.config.hostname});
  api.logger.info("LDAP client connected to " + LDAPAuth.config.hostname);
}

// Disconnects the ldap client if it's connected
function disconnect() {
  if (LDAPAuth.client) {
    api.logger.info("LDAP client disconnecting");
    LDAPAuth.client.unbind();
    LDAPAuth.client = null;
  }
}

/**
 * Stores config data passed in by app
 */
function loadConfig(data) {
  api.logger.info("LDAP client got config: " + util.inspect(data));

  // Make sure we only copy in relevant information - no need to get id, plugin name, or any other
  // potential data that the DB might throw our way
  LDAPAuth.config = {
    hostname: data.hostname,
    bindDNFormat: data.bindDNFormat,
    baseDN: data.baseDN,
    presenterFilter: data.presenterFilter,
    clientFilter: data.clientFilter,
  }
}
