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
      // Invalid credentials is only an error in LDAP - base auth system can still look for a local
      // account for presenters
      it("should fire off an empty callback when LDAP bind credentials are invalid", function(done) {
        bind.yields(InvalidCredentialsError);
        auth.presenterAuth({}, function(err, user) {
          should.not.exist(err);
          should.not.exist(user);
          done();
        });
      });
      it("should fire off a callback with an error when LDAP bind gives an unknown error", function(done) {
        bind.yields({message: "Foo", name: "InvalidFooError"});
        auth.presenterAuth({}, function(err, user) {
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
          findLocalUser.withArgs("LDAP-foo", sinon.match.func).yields(null, fakeUser);
        });

        it("shouldn't call getLDAPUser", function(done) {
          auth.presenterAuth({user: "foo"}, function(err, user) {
            getLDAPUser.callCount.should.eql(0);
            done();
          });
        });

        it("should find and return a local user with LDAP-xxx as the username", function(done) {
          auth.presenterAuth({user: "foo"}, function(err, user) {
            should.not.exist(err);
            user.should.eql(fakeUser);
            done();
          });
        });
      });

      describe("(when a local user is not present)", function() {
        var fakeLDAPUser;
        var fakeAuth;
        var fakeFilter;

        beforeEach(function() {
          // findLocalUser returns no error, but also no user record
          findLocalUser.withArgs("LDAP-foo", sinon.match.func).yields(null, null);

          // getLDAPUser returns a username and email in the record
          fakeLDAPUser = {name: "Full Name", email: "email@example.com"};
          fakeAuth = {user: "foo"};
          fakeFilter = auth.config.presenterFilter = "fake presenter filter"
          getLDAPUser.withArgs(fakeAuth, fakeFilter, sinon.match.func).yields(null, fakeLDAPUser);
        });

        it("should import a local user with expected data", function(done) {
          // Make sure import doesn't fail, though we don't care about what it returns
          importLocalUser.yields(null, {});

          auth.presenterAuth(fakeAuth, function(err, user) {
            importLocalUser.callCount.should.eql(1);

            // Verify data one piece at a time
            var calledUser = importLocalUser.getCall(0).args[0];
            calledUser.name.should.eql(fakeLDAPUser.name);
            calledUser.email.should.eql(fakeLDAPUser.email);
            calledUser.user.should.eql("LDAP-" + fakeAuth.user);
            calledUser.pass.should.eql("LDAP");
            calledUser.external.should.eql(true);
            done();
          });
        });

        it("should call the callback with importLocalUser's user data", function(done) {
          importLocalUser.yields(null, {name: "foooooo"});
          auth.presenterAuth(fakeAuth, function(err, user) {
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
    it("Needs in-depth testing");
  });

  describe("#connect()", function() {
    it("Needs in-depth testing");
  });

  describe("#disconnect()", function() {
    it("Needs in-depth testing");
  });

  describe("#setConfig(data)", function() {
    it("Needs in-depth testing");
  });
});
