# Expo mobile bridge

This starter embeds the deployed Builder in a React Native WebView so the existing same-origin sign-in and API protections stay in place. It does not duplicate credentials or call the generation API from a native client.

## Create an Expo SDK 56 app

Use Node.js LTS and create an Expo project with the default template:

```powershell
npx create-expo-app@latest phollet-ai-mobile
cd phollet-ai-mobile
npx expo install react-native-webview
```

Copy `BuilderWebView.jsx` from this folder into the new app, then render it from the app's root screen:

```jsx
import BuilderWebView from "./BuilderWebView";

export default function App() {
  return <BuilderWebView />;
}
```

Set `EXPO_PUBLIC_BUILDER_URL` in the mobile project's local environment to the deployed HTTPS Builder origin, then start the development app:

```powershell
npx expo start
```

Do not put AI provider keys, the Builder access password, or the session-signing secret in `EXPO_PUBLIC_*` variables. Expo inlines those variables into the client bundle. The WebView URL is public configuration, not a credential.

This is a WebView foundation, not a fully native client. It reuses the responsive web UI and its same-origin session. Native camera, microphone, push notifications, store billing, and individual account support require separate implementation and platform permission/privacy review before app-store release.
