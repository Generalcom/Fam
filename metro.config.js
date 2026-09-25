const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The face anti-spoofing models are shipped with the app as .onnx files.
config.resolver.assetExts.push('onnx');

module.exports = config;
