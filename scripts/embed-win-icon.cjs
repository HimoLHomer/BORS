const fs = require("node:fs");
const path = require("node:path");

/**
 * Embed the app icon into the Windows exe when signAndEditExecutable is false.
 * electron-builder skips rcedit in that mode (avoids winCodeSign 7z extract that
 * needs symlink privileges on some machines), so shortcuts would show the default
 * Electron icon unless we patch the exe here.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, "..", "resources", "icon.ico");

  if (!fs.existsSync(exePath)) {
    throw new Error(`embed-win-icon: missing exe at ${exePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`embed-win-icon: missing ${iconPath} (run npm run icons first)`);
  }

  const { rcedit } = await import("rcedit");
  await rcedit(exePath, { icon: iconPath });
  console.log(`embed-win-icon: embedded ${iconPath} into ${exePath}`);
};
