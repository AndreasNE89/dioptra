# Dioptra — privacy policy and support pages

The two public pages for **Dioptra**, a file manager for macOS, served by GitHub
Pages:

- **Privacy policy** — <https://andreasne89.github.io/dioptra/>
- **Support** — <https://andreasne89.github.io/dioptra/support.html>

Both are linked from the app's App Store product page, where a reachable privacy
policy URL is required.

`404.html` catches anything else and points back at those two.

**The privacy policy stays at `/`.** The App Store record points there, Help ▸
Privacy Policy in 1.1 and later opens it, and the policy promises that changes
will be posted "at this same address". If `/` ever becomes a product page, the
full policy text stays on it for as long as any build that opens `/` is in use.

The support page now carries the requirements (macOS 26 or later; Apple
Intelligence for Organize) and links the App Store listing by its app id,
`id6796373724`, which does not change. Still missing, on purpose: the current
app version. It would go stale with every release; the page points at About
Dioptra and the App Store's version history instead. Also missing: an App Store
badge, which would have to be Apple's artwork; the pages use a text link.

Two parts of the support page are tied to releases and need revisiting:

- **Known issues in versions 1.0 and 1.1** comes out once 1.2 is on the App
  Store with those fixes in it. Check the 1.2 release notes against each bullet
  first; if one is not fixed, keep that bullet and change the heading.
- **The Photos and Mail answer** describes 1.0 and 1.1 separately because
  nothing in the app's docs records whether 1.1 passed review. Once that is
  known and 1.0 is no longer in use, the 1.0 half can go.

## Why this repository exists separately

The app's source lives in a private repository. GitHub Pages will not serve a
private repository on a free plan, and making the source public in order to host
one page would have been a wildly disproportionate trade. This repository holds
those pages and nothing else.

The privacy policy's canonical text is kept alongside the code as `docs/PRIVACY.md`;
`index.html` here is its published form. If one changes, change both, including
the "Last updated" date.

## The pages

Each is a single self-contained HTML file. No scripts, no external fonts, no
images, no analytics — nothing is fetched from anywhere. That is partly good
manners and partly consistency: a page whose entire claim is "this app collects
nothing about you" has no business loading a third-party tracker to say so.

The favicon is an inline `data:` URI of the app mark, so even the icon costs no
request. Each page also carries a `Content-Security-Policy` of
`default-src 'none'`, which makes the browser enforce that rather than take the
page's word for it: `img-src data:` permits the inline favicon and nothing else,
and `style-src 'unsafe-inline'` permits the inline `<style>` without permitting a
remote one. `frame-ancestors` and `report-uri` are absent because a `meta` tag
cannot carry them and GitHub Pages cannot set real headers.

The consequence of being self-contained is that the shared shell — the palette,
the layout, the mark — is copied into each file rather than linked. When one
changes, change all three; they have drifted apart before.

    node tools/check.mjs

catches that drift, along with broken internal links (including `#fragment`
links whose id does not exist), palette contrast below the WCAG floor, missing
landmarks or heading levels, and anything that would make a page fetch from the
network. Every CSS rule must be on all three pages unless `PAGE_SPECIFIC` in the
script names the pages it belongs on, so a shared rule deleted from one page
fails, and so does a second `<style>` block or a `style` attribute. It has no
dependencies — no `package.json`, no install step — and runs on every push via
`.github/workflows/check.yml`, together with `node tools/check-selftest.mjs`,
which breaks copies of the pages on purpose and expects the checker to notice.
It reads text rather than rendering, so it cannot see real computed styles or
layout; the header comment in the script says what it does and does not prove.

**The check does not block publishing.** GitHub Pages deploys whatever is on
`main` whether the workflow passes or fails, so run both commands before
merging.

They follow the reader's light or dark system setting, lay out on a phone, and
print legibly: a `@media print` block forces the light palette, so saving the
privacy policy as a PDF from a dark-mode browser does not produce pale grey text
on white paper.
