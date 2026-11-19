const pkg = require("./package.json");

export default {
  expo: {
    name: "Paseo",
    slug: "voice-mobile",
    version: pkg.version,
    platforms: ["web"],
    icon: "./assets/images/icon.png",
    scheme: "paseo",
    userInterfaceStyle: "automatic",
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    plugins: ["expo-router"],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {},
    },
  },
};
