const fs = require('fs');
const path = require('path');

try {
  const componentsDts = path.join(__dirname, 'src', 'components.d.ts');
  fs.unlinkSync(componentsDts);
} catch (e) { }
