#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
APP_NAME="HTML Editor"
BUILD_DIR="build"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
DMG_NAME="HTML-Editor.dmg"

echo "=== 构建 $APP_NAME ==="
rm -rf "$BUILD_DIR" "$DMG_NAME"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

# 编译 Swift
echo ">> 编译..."
TARGET=$(swiftc -print-target-info 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['target']['triple'])")
swiftc -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME" src/App.swift \
  -framework Cocoa -framework WebKit -target "$TARGET" -O -whole-module-optimization

# 资源
cp Info.plist "$APP_BUNDLE/Contents/Info.plist"
cp Resources/editor.html "$APP_BUNDLE/Contents/Resources/editor.html"
cp -R Resources/vendor "$APP_BUNDLE/Contents/Resources/vendor"

# 图标
echo ">> 图标..."
python3 gen_icon.py

# 签名
echo ">> 签名..."
codesign --force --deep --sign - "$APP_BUNDLE" 2>/dev/null || true

# 创建 DMG
echo ">> 打包 DMG..."
DMG_TMP="$BUILD_DIR/dmg_tmp"
mkdir -p "$DMG_TMP"
cp -R "$APP_BUNDLE" "$DMG_TMP/"
ln -s /Applications "$DMG_TMP/Applications"

hdiutil create -volname "$APP_NAME" \
  -srcfolder "$DMG_TMP" \
  -ov -format UDZO \
  "$DMG_NAME"

# 设置 DMG 图标
python3 -c "
import plistlib, os
pl = {
  'bundle-version': '1.0.0',
  'bundle-background': 'background.tiff',
  'arrange-by': 'name',
  'icon-size': 80,
  'finder-window': {'position': (200, 200), 'bounds': ((200,200),(600,440)), 'sidebar-width': 0, 'statusbar': 0, 'toolbar': 0, },
}
open('/tmp/dmg_view.plist','wb').write(plistlib.dumps(pl))
" 2>/dev/null || true

rm -rf "$DMG_TMP"

echo ""
echo "=== 完成 ==="
echo "App: $APP_BUNDLE"
echo "DMG: $DMG_NAME ($(du -h "$DMG_NAME" | cut -f1))"
echo ""
echo "安装: 双击 $DMG_NAME, 将 App 拖入 Applications 文件夹"
