/**
 * Spotify's map: three tabs, each with its own stack of pages, so the player
 * and the tab bar stay in place (the tab bar slot holds both: BottomBar); the
 * lyrics and the queue open over everything.
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { ComponentType } from "react";
import { BottomBar } from "./components/BottomBar";
import { AlbumScreen } from "./screens/AlbumScreen";
import { ArtistScreen } from "./screens/ArtistScreen";
import { CollectionScreen } from "./screens/CollectionScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { LyricsScreen } from "./screens/LyricsScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { colors } from "./theme";

const Root = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const Pages = createNativeStackNavigator();

const pageOptions = { headerShown: false, contentStyle: { backgroundColor: colors.base } };

function tabStack(name: string, First: ComponentType) {
  return function TabStack() {
    return (
      <Pages.Navigator screenOptions={pageOptions}>
        <Pages.Screen name={name} component={First} />
        <Pages.Screen name="Album" component={AlbumScreen} />
        <Pages.Screen name="Artist" component={ArtistScreen} />
        <Pages.Screen name="Collection" component={CollectionScreen} />
        <Pages.Screen name="Settings" component={SettingsScreen} />
      </Pages.Navigator>
    );
  };
}

const HomeTab = tabStack("Home", HomeScreen);
const SearchTab = tabStack("Search", SearchScreen);
const LibraryTab = tabStack("Library", LibraryScreen);

function Main() {
  return (
    <Tabs.Navigator
      tabBar={(props) => <BottomBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.base } }}
    >
      <Tabs.Screen name="HomeTab" component={HomeTab} />
      <Tabs.Screen name="SearchTab" component={SearchTab} />
      <Tabs.Screen name="LibraryTab" component={LibraryTab} />
    </Tabs.Navigator>
  );
}

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.base, card: colors.base, border: "transparent" } };

export function AppNavigation() {
  return (
    <NavigationContainer theme={theme}>
      <Root.Navigator screenOptions={pageOptions}>
        <Root.Screen name="Main" component={Main} />
        <Root.Screen name="Lyrics" component={LyricsScreen} options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
        <Root.Screen
          name="Queue"
          component={QueueScreen}
          options={{ presentation: "transparentModal", animation: "slide_from_bottom", contentStyle: { backgroundColor: "transparent" } }}
        />
      </Root.Navigator>
    </NavigationContainer>
  );
}
