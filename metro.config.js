const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Firebase v10 ships some .cjs files
config.resolver.sourceExts.push('cjs');
module.exports = config;
