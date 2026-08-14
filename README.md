# Dioptra — privacy policy and support pages

The two public pages for **Dioptra**, a file manager for macOS, served by GitHub
Pages:

- **Privacy policy** — <https://andreasne89.github.io/dioptra/>
- **Support** — <https://andreasne89.github.io/dioptra/support.html>

Both are linked from the app's App Store product page, where a reachable privacy
policy URL is required.

`404.html` catches anything else and points back at those two.

Still missing from the support page: a minimum macOS version, the current app
version, and a link to the App Store listing. Those three facts live with the
app rather than here, which is why they are not on the page yet.

## Why this repository exists separately

The app's source lives in a private repository. GitHub Pages will not serve a
private repository on a free plan, and making the source public in order to host
one page would have been a wildly disproportionate trade. This repository holds
those pages and nothing else.

The privacy policy's canonical text is kept alongside the code as `docs/PRIVACY.md`;
`index.html` here is its published form. If one changes, change both.

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

catches that drift, along with broken internal links, palette contrast below the
WCAG floor, missing landmarks or heading levels, and anything that would make a
page fetch from the network. It has no dependencies — no `package.json`, no
install step — and runs on every push via `.github/workflows/check.yml`. It reads
text rather than rendering, so it cannot see real computed styles or layout; the
header comment in the script says what it does and does not prove.

They follow the reader's light or dark system setting, lay out on a phone, and
print legibly: a `@media print` block forces the light palette, so saving the
privacy policy as a PDF from a dark-mode browser does not produce pale grey text
on white paper.
