# Bundled-Electron approach inspired by AUR paseo-desktop-git:
# https://aur.archlinux.org/packages/paseo-desktop-git

pkgname=paseo-proximyst-git
pkgver=0.16.1.r6637.g110a99dbd
pkgrel=1
pkgdesc='Linux desktop and CLI for local AI coding agents (Proximyst fork)'
arch=('x86_64')
url='https://github.com/Proximyst/getpaseo-paseo'
license=('Apache-2.0')
depends=(
  'alsa-lib'
  'at-spi2-core'
  'bash'
  'cairo'
  'coreutils'
  'dbus'
  'expat'
  'glib2'
  'glibc'
  'grep'
  'gtk3'
  'hicolor-icon-theme'
  'libcups'
  'libgcc'
  'libnotify'
  'libsecret'
  'libstdc++'
  'libx11'
  'libxcb'
  'libxcomposite'
  'libxdamage'
  'libxext'
  'libxfixes'
  'libxkbcommon'
  'libxrandr'
  'libxss'
  'libxtst'
  'mesa'
  'nspr'
  'nss'
  'openssh'
  'pango'
  'systemd-libs'
  'util-linux'
  'xdg-utils'
)
# Electron and electron-builder come from npm ci, not Arch's system Electron.
makedepends=('git' 'nodejs>=22.13.0' 'npm' 'python')
optdepends=('git: Git repositories and worktrees')
provides=("paseo=$pkgver" "paseo-desktop=$pkgver")
conflicts=(
  'paseo'
  'paseo-bin'
  'paseo-git'
  'paseo-appimage'
  'paseo-cli'
  'paseo-cli-bun'
  'paseo-cli-edge'
  'paseo-cli-git'
  'paseo-cli-git-bin'
  'paseo-desktop'
  'paseo-desktop-bin'
  'paseo-desktop-bin-edge'
  'paseo-desktop-git'
  'paseo-desktop-git-bin'
)
# Build directly from the checkout containing this recipe.
source=()
sha256sums=()
options=('!strip' '!debug')

pkgver() {
  cd "$startdir" || return
  local version
  # Preserve every prerelease/build identifier, replacing Arch-forbidden hyphens.
  version=$(node -p "require('./package.json').version.replace(/[-+]/g, '.')")
  printf '%s.r%s.g%s\n' "$version" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

_build_environment() {
  export npm_config_cache="$srcdir/npm-cache"
  export npm_config_devdir="$srcdir/node-gyp"
  # Repository patches and native dependency installation require npm hooks.
  export npm_config_ignore_scripts=false
  export XDG_CACHE_HOME="$srcdir/cache"
  export ELECTRON_CACHE="$srcdir/electron-cache"
  export ELECTRON_BUILDER_CACHE="$srcdir/electron-builder-cache"
  export EXPO_NO_TELEMETRY=1
  export DO_NOT_TRACK=1
  export CI=1
  export LEFTHOOK=0
  # These downloads are unnecessary for the Linux desktop build. Keep normal
  # lifecycle scripts: they apply the repository patches and install node-pty.
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  export PUPPETEER_SKIP_DOWNLOAD=1
  export ONNXRUNTIME_NODE_INSTALL=skip
  # afterPack can opt into a GUI smoke test; package builds must never launch it.
  export PASEO_DESKTOP_SMOKE=0
}

prepare() {
  cd "$startdir" || return
  _build_environment
  npm ci --no-audit --no-fund
}

build() {
  cd "$startdir" || return
  _build_environment
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192"
  npm run build:desktop -- --publish never --linux dir --x64
}

package() {
  cd "$startdir" || return
  local unpacked='packages/desktop/release/linux-unpacked'
  local file

  # Require the wrapper, real Electron executable, CLI runner, and web UI rather
  # than accidentally packaging an incomplete or differently targeted build.
  for file in \
    Paseo \
    Paseo.bin \
    chrome-sandbox \
    resources/app.asar \
    resources/app.asar.unpacked/dist/daemon/node-entrypoint-runner.js \
    resources/bin/paseo \
    resources/app-dist/index.html; do
    if [[ ! -s "$unpacked/$file" ]]; then
      error "Missing required desktop output: $unpacked/$file"
      return 1
    fi
  done
  for file in locales resources/builtin-plugins; do
    if [[ ! -d "$unpacked/$file" ]]; then
      error "Missing required desktop output directory: $unpacked/$file"
      return 1
    fi
  done

  install -dm755 "$pkgdir/opt/paseo" "$pkgdir/usr/bin"
  cp -a "$unpacked/." "$pkgdir/opt/paseo/"
  chmod -R go-w "$pkgdir/opt/paseo"
  # Pacman owns updates; never ship the upstream GitHub updater feed.
  rm -f "$pkgdir/opt/paseo/resources/app-update.yml"
  chown -R root:root "$pkgdir/opt/paseo"
  chmod 755 "$pkgdir/opt/paseo/Paseo" "$pkgdir/opt/paseo/Paseo.bin" \
    "$pkgdir/opt/paseo/resources/bin/paseo"
  # Preserve Chromium's fallback when user namespaces are unavailable. package()
  # runs under fakeroot, so the archive records root ownership and the SUID bit.
  chmod 4755 "$pkgdir/opt/paseo/chrome-sandbox"

  ln -s /opt/paseo/Paseo "$pkgdir/usr/bin/paseo-desktop"
  ln -s /opt/paseo/resources/bin/paseo "$pkgdir/usr/bin/paseo"
  install -Dm644 packaging/arch/paseo.desktop "$pkgdir/usr/share/applications/paseo.desktop"
  install -Dm644 packages/desktop/assets/icon.png "$pkgdir/usr/share/icons/hicolor/512x512/apps/paseo.png"
  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
