# Logo evaluation gate

Every added or replaced logo needs a direct, official asset URL and a body fingerprint in `logo-sources.json`. A product or brand page is evidence, but is never a logo URL.

Run:

```sh
npm run logo:eval -- <canonical-slug>
```

The evaluator rejects malformed or unsafe SVG patterns, missing 128 × 128 intrinsic dimensions, an indirect source URL, an asset whose vector body does not match the registered official source, a live fallback response, and a live asset that differs from the checked-in file.

This establishes provenance and deterministic rendering delivery. Add a renderer-backed visual snapshot check at 32, 48, and 128 px on light and dark backgrounds before making this a merge-blocking CI workflow; that check should compare against approved PNG baselines and flag empty, clipped, or excessively padded artwork.
