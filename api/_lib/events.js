// Free live events. Each one: who gets tagged in ActiveCampaign when they register.
//   tags:         added to every registrant
//   livePageTags: added on top when they registered from the live page's email gate
// Event times / Vimeo link live in the page's own config (assets/clearing.js) — the
// server only needs to know which tags to apply.

module.exports = {
  'live-energy-clearing': {
    name: 'Live Energy Clearing',
    tags: [1358],          // lead gen - rhu - live energy clearing - registered
    livePageTags: [1359],  // lead gen - rhu - live energy clearing - registered on live page
  },
};
