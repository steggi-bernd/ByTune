/**
 * The native libraries' object files nest their whole source path under the
 * build folder, which passes Windows' 260 characters even from a short
 * folder. With a limit set, CMake shortens those names with a hash instead.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

// Long enough for the object folder plus a hashed name (below that CMake gives up on shortening),
// short enough for Windows' 248 characters for a folder.
const ARGUMENT = "-DCMAKE_OBJECT_PATH_MAX=240";

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(ARGUMENT)) {
      c.modResults.contents = c.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (open) => `${open}\n        externalNativeBuild {\n            cmake {\n                arguments "${ARGUMENT}"\n            }\n        }`
      );
    }
    return c;
  });
