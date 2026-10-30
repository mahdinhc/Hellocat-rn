// Wraps app.json. Push notifications (works when the app is closed) need google-services.json from Firebase.
// If the file is present it is wired in; if not, the app still builds and uses local notifications only.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const f = path.join(__dirname, 'google-services.json');
  if (fs.existsSync(f)) {
    config.android = { ...(config.android || {}), googleServicesFile: './google-services.json' };
  }
  return config;
};
