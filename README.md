Ripple-LDAP: plugin for [Ripple][0]
====================

ripple-ldap is a middleware plugin for Ripple, an audience response system built off of node.js.

This module modifies the way presenters, administrators, and audience members run the application.
In the case of audience members, an LDAP login is required to participate.  For presenters, the
LDAP system can be used to allow users to present in Ripple without having to have an account
created for them by an administrator.

The LDAP settings are configurable, allowing for very tight control of which LDAP users are able
to log in with presenter access.  The audience login is configured separately, which allows for
more permissive access if desired.

Requires
---------------------

- [Ripple][0], audience response system (open-source software)
- An LDAP authentication server
- A command-line tool, such as Terminal

Installation and Use
---------------------

- Install [Ripple][0]
- Install [ripple-ldap][1] into your Ripple app's "plugins" directory:
  - `cd /path/to/ripple/plugins`
  - `git clone git@github.com:uoregon-libraries/ripple-ldap.git`
- Install the LDAP node modules:
  - `cd /path/to/ripple/plugins/ripple-ldap`
  - `npm install`
- Start the [Ripple][0] server:
  - `cd /path/to/ripple`
  - `node app.js`
- On [Ripple][0], login as admin and navigate to Plugins
- Configure the [ripple-ldap][1] plugin (see below)

Plugin Configuration Page (within [Ripple][0])
---------------------

[0]: https://github.com/uoregon-libraries/ripple  "Ripple on github"
[1]: https://github.com/uoregon-libraries/ripple-ldap "LDAP plugin on github"
