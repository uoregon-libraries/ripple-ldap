MOCHA_OPTS=
REPORTER = tap

check: test

test: test-unit

test-unit:
	@NODE_ENV=test ./node_modules/.bin/mocha \
		--reporter $(REPORTER) \
		$(MOCHA_OPTS)

test-cov: lib-cov/ldap-auth.js
	@PLUGIN_COV=1 $(MAKE) test REPORTER=html-cov > coverage.html

lib-cov/ldap-auth.js: lib/ldap-auth.js
	@rm -rf lib-cov
	@jscoverage lib lib-cov

.PHONY: test test-unit
