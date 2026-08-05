# Time Tracker Project Justfile

#---------------------
# Config
#---------------------

set quiet
set dotenv-load
set ignore-comments

PNPM := "corepack pnpm"
WEB_HOST := "127.0.0.1"
WEB_PORT := "5173"
ACCEPTANCE_WEB_PORT := "4173"

#-----------------------------------------------------------------------------------------------------------------------
# Common Recipes
#-----------------------------------------------------------------------------------------------------------------------

[private]
default: help

[doc("Displays this help and exits")]
help:
    echo >&2 "\nTime Tracker\n"
    echo >&2 "Usage:"
    echo >&2 "just RECIPE [PARAMETERS]\n"
    just --list --unsorted

[doc("Initializes the project for local development")]
[group("common")]
init: install
    echo >&2 "[1/1] Project initialized for local development"

[doc("Starts the web app locally. Use -p/--port to override the port (default: 5173)")]
[group("common")]
[arg("port", short="p", long="port")]
start port=WEB_PORT:
    echo >&2 "[1/1] Starting the web app on http://{{WEB_HOST}}:{{port}}"
    {{PNPM}} --filter @timetracker/web dev --host {{WEB_HOST}} --port {{port}}

[doc("Stops locally managed services")]
[group("common")]
stop:
    echo >&2 "[1/1] No persistent local service is managed by this Justfile"

[doc("Shows local logs")]
[group("common")]
logs:
    echo >&2 "[1/1] No persistent local logs are managed by this Justfile"

[doc("Removes local build artifacts. Pass --force to delete them.")]
[group("common")]
clean force="":
    echo >&2 "[1/2] Planned cleanup targets: apps/web/dist, apps/web/dist-desktop, apps/desktop/out, apps/desktop/build"
    if [ "{{force}}" != "--force" ]; then echo >&2 "[2/2] Dry run only. Re-run with: just clean --force"; else just clean-force; fi

[doc("Removes dependencies and build artifacts. Pass --force to delete them.")]
[group("common")]
clean-all force="":
    echo >&2 "[1/2] Planned cleanup targets: node_modules, package node_modules, build artifacts"
    if [ "{{force}}" != "--force" ]; then echo >&2 "[2/2] Dry run only. Re-run with: just clean-all --force"; else just clean-all-force; fi

[private]
[confirm("This removes local build artifacts. Continue?")]
clean-force:
    rm -rf apps/web/dist apps/web/dist-desktop apps/desktop/out apps/desktop/build
    echo >&2 "[2/2] Removed local build artifacts"

[private]
[confirm("This removes local dependencies and build artifacts. Continue?")]
clean-all-force:
    rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/web/dist apps/web/dist-desktop apps/desktop/out apps/desktop/build
    echo >&2 "[2/2] Removed dependencies and local build artifacts"

#-----------------------------------------------------------------------------------------------------------------------
# Setup Recipes
#-----------------------------------------------------------------------------------------------------------------------

[doc("Installs workspace dependencies")]
[group("setup")]
install:
    echo >&2 "[1/2] Enabling Corepack"
    corepack enable
    echo >&2 "[2/2] Installing pnpm workspace dependencies"
    {{PNPM}} install

[doc("Installs Chromium for executable Gherkin acceptance tests")]
[group("setup")]
acceptance-install:
    echo >&2 "[1/1] Installing Playwright Chromium"
    {{PNPM}} --filter @timetracker/web exec playwright install chromium

#-----------------------------------------------------------------------------------------------------------------------
# App Recipes
#-----------------------------------------------------------------------------------------------------------------------

[doc("Starts the web app locally")]
[group("app")]
web-start:
    echo >&2 "[1/1] Starting the web app on http://{{WEB_HOST}}:{{WEB_PORT}}"
    {{PNPM}} --filter @timetracker/web dev --host {{WEB_HOST}} --port {{WEB_PORT}}

[doc("Starts the desktop app locally")]
[group("app")]
desktop-start:
    echo >&2 "[1/1] Starting the Electron desktop app"
    {{PNPM}} dev:desktop

[doc("Starts the API server locally")]
[group("app")]
api-start:
    echo >&2 "[1/2] Building development connector plugins"
    {{PNPM}} build:connectors
    echo >&2 "[2/2] Starting the API server"
    {{PNPM}} --filter @timetracker/api dev

[doc("Builds all workspace packages")]
[group("app")]
build:
    echo >&2 "[1/1] Building all workspace packages"
    {{PNPM}} build

[doc("Builds the desktop renderer")]
[group("app")]
desktop-build:
    echo >&2 "[1/1] Building the desktop renderer"
    {{PNPM}} build:desktop

[doc("Builds packaged connector archives for local installation")]
[group("app")]
connector-package:
    echo >&2 "[1/1] Building connector plugin archives"
    {{PNPM}} package:connectors

[doc("Packages the desktop app for this host")]
[group("app")]
desktop-package:
    echo >&2 "[1/1] Packaging the desktop app for this host"
    {{PNPM}} package:desktop

[doc("Creates the desktop app distributable for this host")]
[group("app")]
desktop-make:
    echo >&2 "[1/1] Creating the desktop app distributable for this host"
    {{PNPM}} make:desktop

[doc("Creates desktop distributables. Flags: --mac/-m and --windows/-w. No flags builds both.")]
[group("app")]
[script]
make *flags:
    set -eu
    flags="{{flags}}"
    make_mac=0
    make_windows=0
    if [ -z "$flags" ]; then make_mac=1; make_windows=1; fi
    for flag in $flags; do
      case "$flag" in
        --mac|-m) make_mac=1 ;;
        --windows|-w) make_windows=1 ;;
        *) echo >&2 "Unknown make flag: $flag"; echo >&2 "Usage: just make [--mac|-m] [--windows|-w]"; exit 2 ;;
      esac
    done
    if [ "$make_mac" -eq 1 ]; then echo >&2 "[mac] Creating the desktop app distributable"; {{PNPM}} make:desktop:mac; fi
    if [ "$make_windows" -eq 1 ]; then echo >&2 "[windows] Creating the desktop app distributable"; {{PNPM}} make:desktop:win; fi

[doc("Runs release versioning unit tests")]
[group("app")]
release-test:
    echo >&2 "[1/1] Running release versioning tests"
    node --test .github/scripts/release-plan.test.mjs

[doc("Runs all workspace tests")]
[group("app")]
test:
    echo >&2 "[1/1] Running workspace tests"
    {{PNPM}} test

[doc("Runs executable Gherkin acceptance tests in Chromium")]
[group("app")]
acceptance-test:
    echo >&2 "[1/1] Running web acceptance tests"
    {{PNPM}} --filter @timetracker/web acceptance-test

[private]
acceptance-server:
    {{PNPM}} --filter @timetracker/web dev --host {{WEB_HOST}} --port {{ACCEPTANCE_WEB_PORT}} --strictPort --mode test

[doc("Runs TypeScript checks across the workspace")]
[group("app")]
typecheck:
    echo >&2 "[1/1] Running TypeScript checks"
    {{PNPM}} typecheck
