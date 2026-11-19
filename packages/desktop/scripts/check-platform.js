function assertLinuxPlatform(platform) {
  if (platform !== "linux") {
    throw new Error(`Paseo desktop is only supported on Linux (received ${platform}).`);
  }
}

exports.default = function beforePack(context) {
  assertLinuxPlatform(process.platform);
  assertLinuxPlatform(context.electronPlatformName);
};

if (require.main === module) {
  assertLinuxPlatform(process.platform);
}
