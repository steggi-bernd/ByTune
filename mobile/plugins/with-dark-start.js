/**
 * The first thing Android shows of the app is a start screen around its icon:
 * white by default, in front of an app that is all black.
 */
const { AndroidConfig, withAndroidColors, withAndroidStyles } = require("expo/config-plugins");

const BLACK = "#000000";

module.exports = (config) => {
  config = withAndroidColors(config, (c) => {
    c.modResults = AndroidConfig.Colors.assignColorValue(c.modResults, { name: "splashscreen_background", value: BLACK });
    return c;
  });
  return withAndroidStyles(config, (c) => {
    c.modResults = AndroidConfig.Styles.assignStylesValue(c.modResults, {
      add: true,
      parent: { name: "Theme.App.SplashScreen", parent: "AppTheme" },
      name: "android:windowSplashScreenBackground",
      value: BLACK,
    });
    return c;
  });
};
