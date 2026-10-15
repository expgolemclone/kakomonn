const adDomains = [
  'googlesyndication.com',
  'doubleclick.net',
  'googletagmanager.com',
  'anymind360.com',
  'geniee.jp',
];

async function blockAdRequests(context) {
  await context.route('**/*', async route => {
    const hostname = new URL(route.request().url()).hostname;
    const isAd = adDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    if (isAd) await route.abort();
    else await route.continue();
  });
}

module.exports = { blockAdRequests };
