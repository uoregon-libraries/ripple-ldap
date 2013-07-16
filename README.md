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

Once the LDAP plugin has been added to the plugins directory of Ripple, an admin can configure it.
The LDAP plugin listing will display within Ripple's plugin page:

![Ripple Plugins][plugins]

Turn on the plugin by clicking the "on" button: ![On][on-button] and then "Configure": ![Configure][configure-button]

The configuration screen should look something like this:

![LDAP Configuration][ldap-config]

The configuration page must be filled in fully for the plugin to run.  You may need somebody
familiar with your institution's LDAP system to get the appropriate values filled in.  Settings
are described in more detail below:

### LDAP Host

Enter the LDAP hostname.  This is often `ldap.yourdomain.com` or, in the case of Active Directory
authentication, `ad.yourdomain.com`

### Bind DN Format

This field uses a replacement template, `{{user id}}`.  This will be replaced by the user's login
name when contacting the LDAP server.  This must be set to the proper value for your particular
LDAP setup.  This might be something like `CN={{user id}}` or `{{user id}}@ad.yourdomain.com`.

### Base DN

This field is another required LDAP setting, and again depends on your institution.  It is often
set to something like `DC=ldap,DC=yourdomain,DC=com`.

### Presenter Filter

This field tells LDAP exactly how to determine who is allowed to log in as a presenter, and will
vary greatly depending on your LDAP server and how you wish to restrict these logins.  A very basic
setting might be `(&(CN={{user id}})(objectClass=person))`, though this may or may not work in your
institution.  This field should be carefully chosen to ensure only specific groups are able to
create presentations.

### Client Filter

This field tells LDAP exactly how to determine who is allowed to log in as a member of the audience.
As with the presenter filter, the value will vary greatly depending on your institutional needs.


Is it working?
--------------

The easiest way to tell if the LDAP plugin is installed and working is by looking at the Ripple
login page.  The audience area should have a space for a username and password in addition to the
room:

![Post-install login page][login-page]

[0]: https://github.com/uoregon-libraries/ripple  "Ripple on github"
[1]: https://github.com/uoregon-libraries/ripple-ldap "LDAP plugin on github"

[plugins]: doc-images/plugin-listing.png "Plugins listing"
[on-button]: doc-images/on-button.png "Plugin 'on' button"
[configure-button]: doc-images/configure-button.png "Plugin 'configure' button"
[ldap-config]: doc-images/ldap-configuration.png "LDAP Plugin configuration page"
[login-page]: doc-images/post-install-login-page.png "Login page after LDAP install"
