"""Stable PyInstaller entry point; executable name is always Keymaster.exe."""
from keymaster.app import main

if __name__ == "__main__":
    raise SystemExit(main())
