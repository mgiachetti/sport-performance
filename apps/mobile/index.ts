// App entry: the Intl polyfills Hermes needs (ADR 0099) before expo-router
// loads any route or module that formats.
import './src/platform/intl-native.ts';
import 'expo-router/entry';
