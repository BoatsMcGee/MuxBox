# @app/electron-versions

Internal workspace helper (not published to npm) that reports the Chromium and
Node.js versions bundled with the Electron version in use. Build configs import
it to derive Vite `build.target` values, e.g. `chrome${getChromeMajorVersion()}`.

## API

- **getElectronVersions()**: Component versions bundled within Electron.
- **getChromeVersion()** / **getChromeMajorVersion()**: Chromium version (full / major).
- **getNodeVersion()** / **getNodeMajorVersion()**: Node.js version (full / major).

## Usage

```javascript
import { getChromeMajorVersion } from '@app/electron-versions';

export default {
  build: {
    target: `chrome${getChromeMajorVersion()}`,
  },
};
```

## License

MIT
