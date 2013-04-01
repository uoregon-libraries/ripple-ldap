var libpath = process.env['PLUGIN_COV'] ? '../lib-cov' : '../lib';

var should = require("should")
  , sinon = require("sinon")
  , ldap = require('ldapjs')
  , auth = require(libpath + "/ldap-auth")._LDAPAuth

describe("LDAP Authentication", function() {
  var createClient, findLocalUser, importLocalUser;
  var fakeClient;
  var fakeUser;
  var InvalidCredentialsError = {message: "Foo", name: "InvalidCredentialsError"};

  beforeEach(function() {
    // NEVER hit actual LDAP during unit tests!
    createClient = sinon.stub(ldap, "createClient");

    // To be sure we don't call createClient anywhere we shouldn't, we start off having it return
    // bogus data - if tests need ldap, they should overwrite this!
    fakeClient = {};
    createClient.returns(fakeClient);

    // NEVER hit the AM module functions (tests won't work if these methods aren't stubbed unless
    // one installs the entire Ripple app and runs tests inside it)!
    fakeUser = {
      name: 'Joebob Smith-Wesson',
      email: 'joebob@example.com',
      user: 'LDAP-joebob',
      pass: 'LDAP',
      external: true
    };
    findLocalUser = sinon.stub(auth, "findLocalUser");
    importLocalUser = sinon.stub(auth, "importLocalUser");
  });

  afterEach(function() {
    createClient.restore();
    findLocalUser.restore();
    importLocalUser.restore();
  });

  describe("#configMenu(menu)", function() {
    var menu;
    beforeEach(function() {
      menu = {};
      auth.configMenu(menu);
    });

    it("should add multiple inputs to the menu", function() {
      should.exist(menu.inputs);
      menu.inputs.length.should.be.above(1);
    });

    it("should set up key, label, value, and placeholder for all inputs", function() {
      for (var x = 0, l = menu.inputs.length; x < l; x++) {
        var input = menu.inputs[x];
        should.exist(input.key);
        should.exist(input.label);
        should.exist(input.value);
        should.exist(input.placeholder);
      }
    });
  });

  describe("#menuSave", function() {
    it("should call setConfig with data passed in", function() {
      var stub = sinon.stub(auth, "setConfig");
      auth.menuSave({foo: "bar"});
      stub.withArgs({foo: "bar"}).calledOnce.should.be.true;
      stub.restore();
    });
  });

  describe("#configLoaded(documents)", function() {
    it("should call setConfig with ldap-authentication's data", function() {
      var document = {name: "ldap-authentication", data: 3};
      var documents = [
        {name: "foo", data: 1},
        {name: "bar", data: 2},
        document,
        {name: "baz", data: 4},
      ];

      var stub = sinon.stub(auth, "setConfig");
      auth.configLoaded(documents);
      stub.calledOnce.should.be.true;
      stub.withArgs(document).calledOnce.should.be.true;
      stub.restore();
    });
  });

  describe("#presenterAuth(auth, cb)", function() {
    var bind;
    var getLDAPUser;
    var presenterLDAPUser;
    var presenterLogin;
    var fakeFilter;

    beforeEach(function() {
      bind = sinon.stub(auth, "bind");

      // Stub getLDAPUser since it is critical to success of presenter login
      getLDAPUser = sinon.stub(auth, "getLDAPUser");

      // Set up fake data
      presenterLogin = {user: "presenter"};
      presenterLDAPUser = {name: "Full Name", email: "email@example.com"};
      fakeFilter = auth.config.presenterFilter = "fake presenter filter"

      // Default to an error response so it's clear when we don't pass in the right args
      getLDAPUser.yields({name: "Not Implemented", message: "This is stubbed, dude"}, null)

      // When presenter auth is present, we yield the good user data
      getLDAPUser.withArgs(presenterLogin, fakeFilter, sinon.match.func).yields(null, presenterLDAPUser);
    });

    afterEach(function() {
      bind.restore();
      getLDAPUser.restore();
    });

    // No user returned would typically mean the LDAP filter excluded this person
    describe("(when user isn't returned by LDAP)", function() {
      beforeEach(function() {
        getLDAPUser.yields(null, {});
      });

      it("shouldn't call importLocalUser", function(done) {
        auth.presenterAuth(presenterLogin, function(err, user) {
          importLocalUser.callCount.should.eql(0);
          done();
        });
      });

      // We don't want a local admin denied just because he's not a presenter in LDAP.  For
      // instance, student needs to present so admin adds student to local db.  Student chooses
      // the same password she uses in LDAP.  We need the local account to override the LDAP filter
      // exclusion so she can still present.  i.e., local always trumps LDAP.
      it("should fire off an empty callback", function(done) {
        auth.presenterAuth(presenterLogin, function(err, user) {
          should.not.exist(err);
          should.not.exist(user);
          done();
        });
      });
    });

    describe("(when bind is unsuccessful)", function() {
      // Invalid credentials is only an error in LDAP - base auth system can still look for a local
      // account for presenters
      it("should fire off an empty callback when LDAP bind credentials are invalid", function(done) {
        bind.yields(InvalidCredentialsError);
        auth.presenterAuth(presenterLogin, function(err, user) {
          should.not.exist(err);
          should.not.exist(user);
          done();
        });
      });
      it("should fire off a callback with an error when LDAP bind gives an unknown error", function(done) {
        bind.yields({message: "Foo", name: "InvalidFooError"});
        auth.presenterAuth(presenterLogin, function(err, user) {
          err.should.eql({message: "Foo", name: "InvalidFooError"});
          should.not.exist(user);
          done();
        });
      });
    });

    describe("(when bind is successful)", function() {
      beforeEach(function() {
        bind.yields(null);
      });

      describe("(when a local user is present)", function() {
        beforeEach(function() {
          findLocalUser.withArgs("LDAP-" + presenterLogin.user, sinon.match.func).yields(null, fakeUser);
        });

        it("should find and return a local user", function(done) {
          auth.presenterAuth(presenterLogin, function(err, user) {
            should.not.exist(err);
            user.should.eql(fakeUser);
            done();
          });
        });
      });

      describe("(when a local user is not present)", function() {
        beforeEach(function() {
          // findLocalUser returns no error, but also no user record
          findLocalUser.withArgs("LDAP-" + presenterLogin.user, sinon.match.func).yields(null, null);
        });

        describe("(when getLDAPUser has an error)", function() {
          it("should call callback with the error", function(done) {
            // We can't overwrite a previous stub, it seems, so we have to re-stub for this specific
            // error situation
            findLocalUser.withArgs("LDAP-bar", sinon.match.func).yields(null, null);
            getLDAPUser.withArgs({user: "bar"}, fakeFilter, sinon.match.func).yields("error in getLDAPUser");
            auth.presenterAuth({user: "bar"}, function(err, user) {
              err.should.eql("error in getLDAPUser");
              should.not.exist(user);
              done();
            });
          });
        });

        describe("(when importLocalUser has an error)", function() {
          it("should call callback with the error", function(done) {
            importLocalUser.yields("error in importLocalUser");
            auth.presenterAuth(presenterLogin, function(err, user) {
              err.should.eql("error in importLocalUser");
              should.not.exist(user);
              done();
            });
          });
        });

        it("should import a local user with expected data", function(done) {
          // Make sure import doesn't fail, though we don't care about what it returns
          importLocalUser.yields(null, {});

          auth.presenterAuth(presenterLogin, function(err, user) {
            importLocalUser.callCount.should.eql(1);

            // Verify data one piece at a time
            var calledUser = importLocalUser.getCall(0).args[0];
            calledUser.name.should.eql(presenterLDAPUser.name);
            calledUser.email.should.eql(presenterLDAPUser.email);
            calledUser.user.should.eql("LDAP-" + presenterLogin.user);
            calledUser.pass.should.eql("LDAP");
            calledUser.external.should.eql(true);
            done();
          });
        });

        it("should call the callback with importLocalUser's user data", function(done) {
          importLocalUser.yields(null, {name: "foooooo"});
          auth.presenterAuth(presenterLogin, function(err, user) {
            should.not.exist(err);
            user.should.eql({name: "foooooo"});
            done();
          });
        });
      });
    });
  });

  describe("#clientAuth(auth, cb", function() {
    var bind;
    var getLDAPUser;

    beforeEach(function() {
      bind = sinon.stub(auth, "bind");
      getLDAPUser = sinon.stub(auth, "getLDAPUser");
      getLDAPUser.yields({name: "Not Implemented", message: "This is stubbed, dude"}, null)
    });

    afterEach(function() {
      bind.restore();
      getLDAPUser.restore();
    });

    describe("(when bind is unsuccessful)", function() {
      // Invalid credentials is an error for clients, as we don't allow local accounts for them
      it("should fire off an error callback even on invalid credentials", function(done) {
        bind.yields(InvalidCredentialsError);
        auth.clientAuth({}, function(err, user) {
          should.not.exist(user);
          err.should.eql(InvalidCredentialsError);
          done();
        });
      });
    });

    describe("(when bind is successful)", function() {
      var fakeLDAPUser;
      var fakeAuth;
      var fakeFilter;

      beforeEach(function() {
        bind.yields(null);

        // getLDAPUser returns a username and email in the record
        fakeLDAPUser = {name: "Full Name", email: "email@example.com"};
        fakeAuth = {user: "foo"};
        fakeFilter = auth.config.clientFilter = "fake client filter"
      });

      it("should return an error if getLDAPUser has an error", function(done) {
        getLDAPUser.withArgs(fakeAuth, fakeFilter, sinon.match.func).yields("foo", fakeLDAPUser);
        auth.clientAuth(fakeAuth, function(err, user) {
          should.not.exist(user);
          err.should.eql("foo");
          done();
        });
      });

      it("should return a user if getLDAPUser returns no error", function(done) {
        getLDAPUser.withArgs(fakeAuth, fakeFilter, sinon.match.func).yields(null, fakeLDAPUser);
        auth.clientAuth(fakeAuth, function(err, user) {
          should.not.exist(err);
          user.should.eql(fakeLDAPUser);
          done();
        });
      });
    });
  });

  describe("#clientUI(locals)", function() {
    it("should set auth to true on locals", function() {
      var locals = {};
      auth.clientUI(locals);
      locals.auth.should.be.true;
    });
  });

  describe("#getLDAPUser(auth, filter, callback)", function() {
    var search;
    var emitter;
    var fakeEntry;
    var fakeDN;
    var on;

    beforeEach(function() {
      // Hack in a fake client
      auth.client = { search: function(){} }

      // Create an event emitter for the fake LDAP to spit out on search
      emitter = { on: function(){} };

      // Stub search and hack some search config to allow easier yields in tests
      search = sinon.stub(auth.client, "search");
      fakeDN = auth.config.baseDN = "fake base DN";
      fakeEntry = {object: {displayName: "Joebob Smith-Wesson", mail: "joebob@example.com"}};

      // Stub emitter's "on" so we aren't trying to send real events through
      //
      // Changing the order of event handlers will make this fail, so we want the order to stay
      // as-is unless we can come up with a test that's using real events, but is still clean
      on = sinon.stub(emitter, "on");
      on.withArgs("searchEntry", sinon.match.func).yields(fakeEntry);
      on.withArgs("end", sinon.match.func).yields(true);
    });

    afterEach(function() {
      search.restore();
    });

    it("should call client.search with basedn config and passed-in filter, replacing {{user id}}", function(done) {
      search.withArgs(fakeDN, {filter: "filter test_id", scope: "sub"}, sinon.match.func).yields(null, emitter);

      auth.getLDAPUser({user: "test_id"}, "filter {{user id}}", function(err, user) {
        should.not.exist(err);
        user.should.eql({name: fakeEntry.object.displayName, email: fakeEntry.object.mail});
        done();
      });
    });

    it("should return any errors from search", function(done) {
      search.withArgs(fakeDN, {filter: "filter test_id", scope: "sub"}, sinon.match.func).yields("error", emitter);

      auth.getLDAPUser({user: "test_id"}, "filter {{user id}}", function(err, user) {
        should.not.exist(user);
        err.should.eql("error");
        done();
      });
    });

    it("should return the LDAP user if no errors occurred", function(done) {
      search.withArgs(fakeDN, {filter: "filter test_id", scope: "sub"}, sinon.match.func).yields(null, emitter);

      auth.getLDAPUser({user: "test_id"}, "filter {{user id}}", function(err, user) {
        user.name.should.eql(fakeEntry.object.displayName);
        user.email.should.eql(fakeEntry.object.mail);
        done();
      });
    });

    it("should return search errors if an 'error' event fires off", function(done) {
      search.withArgs(fakeDN, {filter: "filter test_id", scope: "sub"}, sinon.match.func).yields(null, emitter);
      on.withArgs("error", sinon.match.func).yields("MASSIVE FAILURE");

      auth.getLDAPUser({user: "test_id"}, "filter {{user id}}", function(err, user) {
        should.not.exist(user);
        err.should.eql("MASSIVE FAILURE");
        done();
      });
    });
  });

  describe("#validateConfiguration()", function() {
    // This should contain a minimal good configuration example
    var goodConfig = {
      hostname:         "ldaps://ldap.yoursite.com",
      bindDNFormat:     "{{user id}}@ldap.yoursite.com",
      baseDN:           "DC=ldap,DC=yoursite,DC=com",
      presenterFilter:  "(&(uid={{user id}})(objectClass=person))",
      clientFilter:     "(&(uid={{user id}})(objectClass=person))",
    };

    // This should contain all required fields and expected error substrings to ease testing
    var required = {
      hostname:         /hostname/i,
      bindDNFormat:     /bind dn format/i,
      baseDN:           /base dn/i,
      presenterFilter:  /presenter filter/i,
      clientFilter:     /client filter/i,
    };

    it("Succeeds with good config", function() {
      auth.config = goodConfig;
      auth.validateConfiguration().should.eql([]);
    });

    it("Fails with empty config", function() {
      auth.config = null;
      var errors = auth.validateConfiguration();
      errors.length.should.eql(1);
    });

    function clone(obj) {
      var target = {};
      for (var i in obj) {
        if (obj.hasOwnProperty(i)) {
          target[i] = obj[i];
        }
      }
      return target;
    }

    // Loop required fields and build a dynamic test for each
    for (var field in required) {
      if (required.hasOwnProperty(field)) {
        // Closure magic ensures the test is getting the correct field
        it("Requires " + field + " to be set", function(_field) {
          return function() {
            auth.config = clone(goodConfig);
            auth.config[_field] = null;
            var errors = auth.validateConfiguration();
            errors.length.should.eql(1);
            errors[0].should.match(required[_field]);
          }
        }(field));
      }
    }

    // These elements require the magic USER_ID string
    var userIDRequired = {
      bindDNFormat:     /bindDN/i,
      presenterFilter:  /presenter filter/i,
      clientFilter:     /client filter/i
    };

    // Loop USER_ID fields and build a dynamic test for each
    for (var field in userIDRequired) {
      if (userIDRequired.hasOwnProperty(field)) {
        // Closure magic ensures the test is getting the correct field
        it("Requires " + field + " to have the magic string", function(_field) {
          return function() {
            auth.config = clone(goodConfig);
            auth.config[_field] = "Filled out but no magic string";
            var errors = auth.validateConfiguration();
            errors.length.should.eql(1);
            errors[0].should.match(userIDRequired[_field]);
          }
        }(field));
      }
    }
  });

  describe("#connect()", function() {
    var validate;
    var log;

    beforeEach(function() {
      validate = sinon.stub(auth, "validateConfiguration");
      log = sinon.spy(console, "log");
    });

    afterEach(function() {
      validate.restore();
      log.restore();
    });

    it("should not set client if errors are returned from validateConfiguration", function() {
      validate.returns(["error 1", "error 2"]);
      auth.client = null;
      auth.connect();

      should.not.exist(auth.client);
      // The main "no good" error + one per validation error
      log.callCount.should.eql(3);
    });

    it("should set client if there are no errors in validateConfiguration", function() {
      validate.returns([]);
      auth.client = null;
      auth.connect();

      auth.client.should.eql(fakeClient);
    });
  });

  describe("#disconnect()", function() {
    var log;

    beforeEach(function() {
      log = sinon.spy(console, "log");
    });

    afterEach(function() {
      log.restore();
    });

    describe("(when the client is set)", function() {
      it("Shouldn't do anything", function() {
        // We validate that log isn't called, but the real test here is that nothing crashes
        auth.client = null;
        auth.disconnect();
        log.callCount.should.eql(0);
      });
    });

    describe("(when the client is null)", function() {
      it("Should call unbind", function() {
        auth.client = { unbind: function(){} };
        var spy = sinon.spy(auth.client, "unbind");
        auth.disconnect();
        should.not.exist(auth.client);
        spy.callCount.should.eql(1);
      });
    });
  });

  describe("#setConfig(data)", function() {
    var knownFields = [ "hostname", "bindDNFormat", "baseDN", "presenterFilter", "clientFilter" ];

    it("Copies all known fields", function() {
      var data = {};
      for (var x = 0; x < knownFields.length; x++) {
        data[knownFields[x]] = x;
      }

      auth.setConfig(data);

      for (var x = 0; x < knownFields.length; x++) {
        auth.config[knownFields[x]].should.eql(x);
      }
    });

    it("Ignores unknown fields", function() {
      auth.setConfig({foo: "bar"});
      should.not.exist(auth.config.foo);
    });
  });

  describe("#bind", function() {
    var connect;
    var ldapBind;
    var fakeAuth;

    beforeEach(function() {
      auth.client = fakeClient;
      fakeClient.bind = function() {};
      auth.config.bindDNFormat = "foo";
      fakeAuth = {user: "user", password: "pass"};

      connect = sinon.stub(auth, "connect");
      ldapBind = sinon.stub(fakeClient, "bind");

      // Assume success unless a test needs to verify failure
      ldapBind.yields(null);
    });

    afterEach(function() {
      connect.restore();
      ldapBind.restore();
    });

    it("should call connect()", function(done) {
      auth.bind(fakeAuth, function() {
        connect.callCount.should.eql(1);
        done();
      });
    });

    it("should call callback with an error when the client cannot be created", function(done) {
      auth.client = null;
      auth.bind(fakeAuth, function(err) {
        err.name.should.eql("MissingConnection");
        done();
      });
    });

    it("should call callback with an error when auth is null", function(done) {
      auth.bind(null, function(err) {
        err.name.should.eql("BadCredentials");
        done();
      });
    });

    it("should call callback with an error when auth is missing user", function(done) {
      fakeAuth.user = null;
      auth.bind(fakeAuth, function(err) {
        err.name.should.eql("BadCredentials");
        done();
      });
    });

    it("should call callback with an error when auth is missing password", function(done) {
      fakeAuth.password = null;
      auth.bind(fakeAuth, function(err) {
        err.name.should.eql("BadCredentials");
        done();
      });
    });

    it("should call callback with an error if ldap bind returns an error", function(done) {
      ldapBind.withArgs("foo", "pass").yields({name: "foo"});
      auth.bind(fakeAuth, function(err) {
        err.name.should.eql("foo");
        done();
      });
    });

    it("should have no error if ldap bind succeeds", function(done) {
      auth.bind(fakeAuth, function(err) {
        should.not.exist(err);
        done();
      });
    });
  });
});
