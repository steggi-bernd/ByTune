/**
 * The app used to be called ByTune Local, and its library, settings and
 * listening history sit in a folder of that name. main.ts imports this first,
 * so they have moved before anything opens a file there.
 */
import { app } from "electron";
import * as path from "path";
import { carryOverData } from "./data-folder";

const OLD_NAME = "ByTune Local";

const appData = app.getPath("appData");
const folder = app.getPath("userData");
// A profile set by hand (the test launchers) has nothing to do with the old folder.
if (path.resolve(folder) === path.resolve(appData, app.getName())) {
  const used = carryOverData(path.join(appData, OLD_NAME), folder);
  if (used !== folder) app.setPath("userData", used);
}
