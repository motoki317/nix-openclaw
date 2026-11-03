{
  lib,
  stdenvNoCC,
  fetchzip,
}:

stdenvNoCC.mkDerivation {
  pname = "openclaw-app";
  version = "2026.10.9";

  src = fetchzip {
    url = "https://github.com/openclaw/openclaw/releases/download/v2026.10.9/OpenClaw-2026.10.9.zip";
    hash = "sha256-WuhMmyq8P6tBcGNAmkBtn6SCuuuwddZ+HKdx0Xv4tYY=";
    stripRoot = false;
  };

  dontUnpack = true;
  # Shebang fixups would invalidate the signed upstream app bundle.
  dontFixup = true;

  installPhase = "${../scripts/openclaw-app-install.sh}";

  meta = with lib; {
    description = "OpenClaw macOS app bundle";
    homepage = "https://github.com/openclaw/openclaw";
    license = licenses.mit;
    platforms = platforms.darwin;
  };
}
