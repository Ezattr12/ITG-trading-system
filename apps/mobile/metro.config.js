// Metro config for the ITG TraderOS mobile shell.
//
// The app is intentionally STANDALONE: it is not part of the root
// npm-workspaces install graph (see README.md), so the default
// single-project Metro config is correct — no monorepo
// watchFolders / nodeModulesPaths overrides are needed.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
