// A stand-in for a plugin renderer that outlived its Ajour: an Electron
// process of Ajour's own binary that nothing ends. The lifecycle check
// (#391) records it as a plugin renderer, so the next launch's sweep must
// end it. It ends itself after a while, should the check fail first.
"use strict";

const { app } = require("electron");

const userData = process.env.AJOUR_USER_DATA_PATH;
if (userData) app.setPath("userData", userData);
setTimeout(() => app.exit(0), 90_000);
