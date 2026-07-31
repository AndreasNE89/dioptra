# Dioptra — privacy policy and support pages

The two public pages for **Dioptra**, a file manager for macOS, served by GitHub
Pages:

- **Privacy policy** — <https://andreasne89.github.io/dioptra/>
- **Support** — <https://andreasne89.github.io/dioptra/support.html>

Both are linked from the app's App Store product page, where a reachable privacy
policy URL is required.

## Why this repository exists separately

The app's source lives in a private repository. GitHub Pages will not serve a
private repository on a free plan, and making the source public in order to host
one page would have been a wildly disproportionate trade. This repository holds
the two pages and nothing else.

The privacy policy's canonical text is kept alongside the code as `docs/PRIVACY.md`;
`index.html` here is its published form. If one changes, change both.

## The pages

Each is a single self-contained HTML file. No scripts, no external fonts, no
images, no analytics — nothing is fetched from anywhere. That is partly good
manners and partly consistency: a page whose entire claim is "this app collects
nothing about you" has no business loading a third-party tracker to say so.

They follow the reader's light or dark system setting and lay out on a phone.
