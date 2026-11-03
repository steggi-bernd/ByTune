const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const repo = path.resolve(__dirname, "..");
const config = getDefaultConfig(__dirname);

// The library logic is the desktop app's own (../src/lib, ../electron's pure files).
config.watchFolders = [path.join(repo, "src"), path.join(repo, "electron")];
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];

module.exports = config;
