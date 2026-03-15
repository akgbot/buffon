const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Remove the default "X-Powered-By: Express" header to avoid technology fingerprinting
app.disable('x-powered-by');

// Security headers middleware
app.use((req, res, next) => {
  // Prevent browsers from MIME-sniffing away from the declared content-type
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Disallow framing from any origin (clickjacking protection)
  res.setHeader('X-Frame-Options', 'DENY');

  // Only send the origin as the referrer when navigating to a less-secure origin
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable browser features this app has no need for
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Content Security Policy:
  //   - script-src 'self'           : only our own simulation.js (no inline scripts)
  //   - style-src  'self' 'unsafe-inline': external stylesheet + inline style="" attrs in HTML
  //   - img-src    'self' data:     : canvas toDataURL() produces data: URLs if user saves
  //   - frame-ancestors 'none'      : belt-and-suspenders clickjacking block (CSP level 2+)
  //   - object-src 'none'           : block Flash / plugins
  //   - base-uri   'self'           : prevent base-tag injection
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );

  next();
});

app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));

app.listen(PORT, () => {
  console.log(`Buffon's Needle Simulator running on port ${PORT}`);
});
