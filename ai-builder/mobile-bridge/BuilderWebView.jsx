import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

function isAllowedBuilderUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (__DEV__ && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

function LoadingView() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#6ee7b7" />
      <Text style={styles.secondary}>Connecting to Phollet AI Builder…</Text>
    </View>
  );
}

export default function BuilderWebView() {
  const builderUrl = process.env.EXPO_PUBLIC_BUILDER_URL;
  const [instance, setInstance] = useState(0);
  const [loadError, setLoadError] = useState(false);

  if (!builderUrl || !isAllowedBuilderUrl(builderUrl)) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.title}>Builder URL required</Text>
          <Text style={styles.secondary}>
            Set EXPO_PUBLIC_BUILDER_URL to the deployed HTTPS Builder URL.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const builderOrigin = new URL(builderUrl).origin;

  return (
    <SafeAreaView style={styles.screen}>
      <WebView
        key={instance}
        source={{ uri: builderUrl }}
        originWhitelist={["https://*", "http://localhost/*", "http://127.0.0.1/*"]}
        onShouldStartLoadWithRequest={(request) => {
          try {
            return new URL(request.url).origin === builderOrigin;
          } catch {
            return false;
          }
        }}
        onLoadStart={() => setLoadError(false)}
        onError={() => setLoadError(true)}
        startInLoadingState
        renderLoading={LoadingView}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        style={styles.webview}
      />
      {loadError && (
        <View style={styles.errorPanel}>
          <Text style={styles.title}>Could not load the Builder</Text>
          <Text style={styles.secondary}>Check your connection and try again.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLoadError(false);
              setInstance((current) => current + 1);
            }}
            style={styles.retry}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b0e12" },
  webview: { flex: 1, backgroundColor: "#0b0e12" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 28 },
  title: { color: "#f1f5f9", fontSize: 17, fontWeight: "600", textAlign: "center" },
  secondary: { color: "#94a3b8", fontSize: 13, lineHeight: 20, textAlign: "center" },
  errorPanel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 28,
    backgroundColor: "#0b0e12",
  },
  retry: { marginTop: 4, borderRadius: 10, backgroundColor: "#059669", paddingHorizontal: 18, paddingVertical: 11 },
  retryLabel: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
