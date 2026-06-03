/**
 * Stub for @react-native-async-storage/async-storage on the Node backend.
 *
 * The HR-prediction model is bundled from the React Native source via esbuild
 * (see server/build-model.mjs) and runs server-side inside fetch-slate.mjs.
 * One of its transitive imports — src/logic/calibration.js — pulls in
 * AsyncStorage at top level so the device can persist a calibration map.
 *
 * On the backend that's dead code: CALIBRATION_ENABLED is hard-false and no
 * code path actually invokes any of these methods during scoring. But the
 * import still needs to RESOLVE for esbuild's bundle to succeed, so we
 * alias the package name to this no-op shim that satisfies the surface
 * area calibration.js touches (getItem / setItem / removeItem).
 */
export default {
  getItem:    async () => null,
  setItem:    async () => {},
  removeItem: async () => {},
};
